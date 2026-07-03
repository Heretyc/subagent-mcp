/**
 * Integration tests for the advanced-ruleset hook inside launch_agent
 * (src/index.ts wiring), spoken over real MCP stdio sessions.
 *
 * The interpreter is faked with zero production seams: the session env sets
 * SUBAGENT_RULESET_PYTHON=node and NODE_OPTIONS preloads
 * test/fixtures/fake-ruleset-preload.cjs, which impersonates the .py script.
 * Behavior lives in a mode FILE so a single server process can flip behavior
 * between launch_agent calls — that is what proves FAILURE NEVER LATCHES.
 *
 * The server resolves routing-table.json (and the scaffold) as dist siblings,
 * so each session runs a private dist/ copy carrying the deterministic
 * 2-candidate fixture table (test/fixtures/ruleset-routing-table.fixture.json).
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");
const fixtureTablePath = join(repoRoot, "test", "fixtures", "ruleset-routing-table.fixture.json");

// Verbatim duplicates of the spec'd strings (house convention: tests duplicate
// exact strings so source drift fails loudly). The hard-fail message carries
// NO hints — a deliberate, documented exception to the hint convention.
const HARD_FAIL =
  "subagent ruleset erroring. Please ask the system administrator to debug before continuing. It is highly discouraged to continue use of this chat session as the system is now operating outside safe parameters.";
const AUTO_HINT =
  "Tip: omit provider/model/effort entirely and the server auto-selects the best provider/model/effort for this task_category, with automatic silent fallback.";
const VETO_ERROR = `Error: advanced ruleset returned zero candidates for task_category coding; launch vetoed by ruleset.\n${AUTO_HINT}`;

// Fixture-table candidates as the server builds them (cost_efficiency/coding).
const CE_RANK1 = { provider: "claude", model: "sonnet", effort: "medium" };
const CE_RANK2 = { provider: "codex", model: "gpt-5.5", effort: "xhigh" };
const PERF_RANK1 = { provider: "claude", model: "opus-4-8", effort: "high" };

function assertNoRoutingTier(payload, label) {
  assert.equal(payload.routing_tier, undefined, `${label} must not expose routing_tier`);
}

function assertSelection(payload, expected, label) {
  assert.equal(payload.provider, expected.provider, `${label} provider`);
  assert.equal(payload.model, expected.model, `${label} model`);
  assert.equal(payload.effort, expected.effort, `${label} effort`);
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function withTimeout(promise, ms, label, getDetails) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const details = getDetails ? ` ${getDetails()}` : "";
        reject(new Error(`${label} timed out after ${ms}ms.${details}`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function prependPath(env, dir) {
  const next = { ...env };
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === "path") || "PATH";
  next[pathKey] = `${dir}${delimiter}${next[pathKey] || ""}`;
  if (process.platform === "win32") {
    next.PATHEXT = next.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  }
  return next;
}

function createMcpSession(entrypoint, options = {}) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let nextId = 1;
  let stdout = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    while (true) {
      const newline = stdout.indexOf("\n");
      if (newline === -1) break;
      const line = stdout.slice(0, newline).replace(/\r$/, "");
      stdout = stdout.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("exit", (code, signal) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`server exited before response (code=${code}, signal=${signal}, stderr=${stderr})`));
    }
    pending.clear();
  });

  function request(method, params) {
    const id = nextId++;
    const response = new Promise((resolveResponse, rejectResponse) => {
      pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return withTimeout(response, 4000, `${method} response`, () => `stderr=${stderr}`);
  }

  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async function initialize() {
    const response = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "ruleset-handler-test", version: "0.0.0" },
    });
    notify("notifications/initialized");
    return response;
  }

  async function close() {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill();
    }
    await withTimeout(
      new Promise((resolveClose) => child.once("exit", resolveClose)),
      2000,
      "server close",
      () => `stderr=${stderr}`
    ).catch(() => {});
  }

  return { request, initialize, close };
}

async function enableManualSelection(session) {
  const response = await session.request("tools/call", {
    name: "model-selection-mode",
    arguments: { mode: "user-approved-overrides" },
  });
  assert.notEqual(
    response.result.isError,
    true,
    `model-selection-mode failed: ${response.result.content[0].text}`
  );
}

function writeFakePathTools(fakeBin) {
  if (process.platform === "win32") {
    writeFileSync(join(fakeBin, "npm.cmd"), "@echo off\r\necho %FAKE_NPM_PREFIX%\r\n");
    copyFileSync(process.execPath, join(fakeBin, "claude.exe"));
    copyFileSync(process.execPath, join(fakeBin, "codex.exe"));
    return;
  }

  const npmPath = join(fakeBin, "npm");
  const claudePath = join(fakeBin, "claude");
  const codexPath = join(fakeBin, "codex");
  writeFileSync(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$FAKE_NPM_PREFIX\"\n");
  writeFileSync(claudePath, "#!/bin/sh\nexit 0\n");
  writeFileSync(codexPath, "#!/bin/sh\nexit 0\n");
  chmodSync(npmPath, 0o755);
  chmodSync(claudePath, 0o755);
  chmodSync(codexPath, 0o755);
}

function writeMockDriverScript(tempRoot) {
  const script = join(tempRoot, "mock-provider-driver.mjs");
  writeFileSync(
    script,
    `
import readline from "node:readline";

const provider = process.argv[2] || "claude";
let turn = 0;
const rl = readline.createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type !== "turn.start") return;
  turn += 1;
  const text = msg.message || "";
  if (provider === "claude") {
    send({ type: "assistant", message: { content: [{ type: "text", text: "ack:" + text }] } });
    send({ type: "result", result: "done:" + text });
  } else {
    send({ type: "agent_message", message: "ack:" + text });
    send({ type: "turn.completed", turn });
  }
});
`,
    "utf8"
  );
  return script;
}

async function launchAndPoll(session, launchArgs) {
  const launchResp = await session.request("tools/call", {
    name: "launch_agent",
    arguments: launchArgs,
  });
  const launchText = launchResp.result.content[0].text;
  if (launchResp.result.isError) {
    throw new Error(`launch failed: ${launchText}`);
  }
  const launchPayload = JSON.parse(launchText);
  const agentId = launchPayload.agent_id;

  const pollResp = await session.request("tools/call", {
    name: "poll_agent",
    arguments: { agent_id: agentId },
  });
  const pollPayload = JSON.parse(pollResp.result.content[0].text);
  assertNoRoutingTier(launchPayload, "launch_agent payload");
  assertNoRoutingTier(pollPayload, "poll_agent payload");
  return { agentId, launchPayload, pollPayload };
}

async function killAgent(session, agentId) {
  const killResp = await session.request("tools/call", {
    name: "kill_agent",
    arguments: { agent_id: agentId },
  });
  if (killResp.result?.isError) {
    throw new Error(`kill failed: ${killResp.result.content[0].text}`);
  }

  const waitResp = await session.request("tools/call", {
    name: "wait",
    arguments: {},
  });
  const waitPayload = JSON.parse(waitResp.result.content[0].text);
  assert.ok(
    waitPayload.finished.some((agent) => agent.id === agentId),
    `wait after kill must observe ${agentId} as terminal`
  );
}

// The server resolves routing-table.json and the ruleset scaffold as siblings
// of the compiled module, so a private dist/ copy is the only way to feed a
// spawned server the fixture table. node_modules is symlinked alongside so
// dist/index.js can still resolve @modelcontextprotocol/sdk and zod.
function makeFixtureDist(tempRoot) {
  const distCopy = join(tempRoot, "dist");
  cpSync(join(repoRoot, "dist"), distCopy, { recursive: true });
  copyFileSync(fixtureTablePath, join(distCopy, "routing-table.json"));
  symlinkSync(
    join(repoRoot, "node_modules"),
    join(tempRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  return join(distCopy, "index.js");
}

function makeRulesetTempEnv(initialMode) {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-ruleset-handler-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFakePathTools(fakeBin);
  const mockDriverScript = writeMockDriverScript(tempRoot);
  const entrypoint = makeFixtureDist(tempRoot);
  const modeFile = join(tempRoot, "ruleset-mode.txt");
  const logFile = join(tempRoot, "ruleset-log.txt");
  writeFileSync(modeFile, initialMode);
  writeFileSync(logFile, "");
  const env = prependPath(
    {
      ...process.env,
      FAKE_NPM_PREFIX: fakePrefix,
      // Mock provider drivers keep this suite independent of real CLIs;
      // failover.test.mjs owns post-spawn grace-window behavior.
      SUBAGENT_SPAWN_GRACE_MS: "0",
      SUBAGENT_MOCK_CLAUDE_DRIVER: "jsonl",
      SUBAGENT_MOCK_CODEX_DRIVER: "jsonl",
      SUBAGENT_MOCK_DRIVER_SCRIPT: mockDriverScript,
      SUBAGENT_RULESET_PYTHON: process.execPath,
      // Forward slashes: node's NODE_OPTIONS parser treats backslash as an
      // escape inside double quotes, which would mangle a win32 path.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${preloadPath.replace(/\\/g, "/")}"`]
        .filter(Boolean)
        .join(" "),
      FAKE_RULESET_MODE_FILE: modeFile,
      FAKE_RULESET_LOG: logFile,
    },
    fakeBin
  );
  return { tempRoot, workDir, env, entrypoint, modeFile, logFile };
}

function logLines(logFile) {
  return readFileSync(logFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

function assertNoRulesetFields(payload, label) {
  assert.equal(payload.ruleset_applied, undefined,
    `${label} must not carry ruleset_applied when the ruleset did not alter the decision`);
  assert.equal(payload.ruleset_original_selection, undefined,
    `${label} must not carry ruleset_original_selection when the ruleset did not alter the decision`);
}

// ---------------------------------------------------------------------------
// 1. Env-check gate ordering + once-per-process latch (ok-disabled).
//    WHY: the env check must run lazily at the FIRST launch_agent call and
//    never again after success — and with load-rules false the entire feature
//    must be invisible: success payload byte-shape identical to pre-feature.
// ---------------------------------------------------------------------------
await test("gate runs once per process: 3 launches → exactly 1 env-check; payload shape unchanged", async () => {
  const { tempRoot, workDir, env, entrypoint, logFile } = makeRulesetTempEnv("ok-disabled");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    for (let i = 0; i < 3; i++) {
      const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
        task_category: "coding",
        prompt: `gate-once launch ${i + 1}`,
      });
      assert.equal(launchPayload.provider, CE_RANK1.provider);
      assert.equal(launchPayload.model, CE_RANK1.model);
      assert.equal(launchPayload.effort, CE_RANK1.effort);
      assertNoRulesetFields(launchPayload, "launch_agent payload");
      assertNoRulesetFields(pollPayload, "poll_agent payload");
      await killAgent(session, agentId);
    }
    assert.deepEqual(logLines(logFile), ["env-check"],
      "the env check must run exactly once per server process (success latches) and routing mode never (disabled)");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. load-rules false = silent no-op disable for the process lifetime.
//    WHY: the shipped scaffold defaults to load-rules false; a user who never
//    edits it must see zero behavior change and zero routing executions.
// ---------------------------------------------------------------------------
await test("load-rules false: ruleset silently disabled — no route execution, no error, no fields", async () => {
  const { tempRoot, workDir, env, entrypoint, logFile } = makeRulesetTempEnv("ok-disabled");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "disabled ruleset launch",
    });
    assertNoRulesetFields(launchPayload, "launch payload");
    assertNoRulesetFields(pollPayload, "poll_agent payload");
    assert.equal(logLines(logFile).filter((l) => l === "route").length, 0,
      "a disabled ruleset must never run routing mode");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Routing override honored verbatim + visibility fields (reorder).
//    WHY: the ruleset has FINAL authority — the attempt loop must consume the
//    returned order, and when the decision was altered both the launch payload
//    and poll_agent must expose ruleset_applied + the pre-ruleset rank-1.
// ---------------------------------------------------------------------------
await test("routing override: reorder honored verbatim; original vs final exposed in launch + poll", async () => {
  const { tempRoot, workDir, env, entrypoint, logFile } = makeRulesetTempEnv("ok-enabled-reorder");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "reorder launch",
    });
    // Fixture rank-1 is claude/sonnet/medium; the reversed list launches codex first.
    assert.equal(launchPayload.provider, CE_RANK2.provider,
      "the attempt loop must consume the ruleset's order — final selection is the ruleset's rank-1");
    assert.equal(launchPayload.model, CE_RANK2.model);
    assert.equal(launchPayload.effort, CE_RANK2.effort);
    assert.equal(launchPayload.ruleset_applied, true,
      "an altered decision must surface ruleset_applied in the launch payload");
    assert.deepEqual(launchPayload.ruleset_original_selection, CE_RANK1,
      "ruleset_original_selection must be the PRE-ruleset rank-1 candidate");
    assert.equal(pollPayload.ruleset_applied, true,
      "poll_agent must persist the altered-decision visibility");
    assert.deepEqual(pollPayload.ruleset_original_selection, CE_RANK1);
    assert.deepEqual(logLines(logFile), ["env-check", "route"],
      "routing mode runs ONCE per launch_agent call, never per failover attempt");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Ran-but-passthrough is invisible.
//    WHY: visibility fields appear ONLY when the ruleset ALTERED the decision;
//    a passthrough run must look identical to disabled (and to pre-feature).
// ---------------------------------------------------------------------------
await test("passthrough: ruleset ran but did not alter — visibility fields ABSENT", async () => {
  const { tempRoot, workDir, env, entrypoint, logFile } = makeRulesetTempEnv("ok-enabled-passthrough");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "passthrough launch",
    });
    assert.equal(launchPayload.provider, CE_RANK1.provider, "passthrough keeps the table's rank-1");
    assertNoRulesetFields(launchPayload, "launch payload");
    assertNoRulesetFields(pollPayload, "poll_agent payload");
    assert.equal(logLines(logFile).filter((l) => l === "route").length, 1,
      "the ruleset DID run — invisibility must come from the unaltered list, not from skipping");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Explicit-mode override: the ruleset may replace even an explicitly
//    requested provider+model+effort.
//    WHY: final authority applies to ALL selection modes — explicit included —
//    and the visibility fields are how the caller learns its request was
//    overridden.
// ---------------------------------------------------------------------------
await test("explicit-mode override: ruleset replaces the requested triple; routing_tier absent", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeRulesetTempEnv("ok-enabled-replace");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    await enableManualSelection(session);
    const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "explicit launch to be overridden",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    assert.equal(launchPayload.provider, "claude");
    assert.equal(launchPayload.model, "opus",
      "the launched model must be the ruleset's replacement, not the explicit request");
    assert.equal(launchPayload.effort, "medium");
    assert.equal(launchPayload.ruleset_applied, true);
    assert.deepEqual(launchPayload.ruleset_original_selection,
      { provider: "claude", model: "sonnet", effort: "medium" },
      "original selection must be the caller's explicit triple");
    assert.equal(pollPayload.ruleset_applied, true);
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5b. Explicit haiku + passthrough ruleset: a verbatim echo must NOT hard-fail.
//     WHY: explicit efforts are normalized in buildCandidates before the stdin
//     payload is built (haiku -> "none"), so the list fed to the script is
//     always validator-legal — passthrough == no-op, and the hard fail stays
//     reserved for actual script malfunction (regression: an un-normalized
//     haiku@high row made every explicit haiku launch return the verbatim
//     admin hard-fail message despite zero script malfunction).
// ---------------------------------------------------------------------------
await test("explicit haiku + passthrough: effort normalized to 'none'; no hard fail, fields absent", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeRulesetTempEnv("ok-enabled-passthrough");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    await enableManualSelection(session);
    const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "explicit haiku passthrough launch",
      provider: "claude",
      model: "haiku",
      effort: "high",
    });
    assert.equal(launchPayload.model, "haiku");
    assert.equal(launchPayload.effort, "none",
      "explicit haiku effort must be normalized to the 'none' sentinel before the ruleset payload");
    assertNoRulesetFields(launchPayload, "launch payload");
    assertNoRulesetFields(pollPayload, "poll_agent payload");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. Env-check failure → EXACT hard-fail string; NON-LATCHING recovery in the
//    same session (mode file flipped between calls, no restart).
//    WHY: the owner contract demands the verbatim message AND that an admin
//    fix recovers without restarting the MCP server.
// ---------------------------------------------------------------------------
await test("env-check failure: exact hard-fail string; recovery in the same session (never latches)", async () => {
  const { tempRoot, workDir, env, entrypoint, modeFile, logFile } = makeRulesetTempEnv("exit1");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();

    const fail1 = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "first failing launch" },
    });
    assert.equal(fail1.result.isError, true, "ruleset failure must fail launch_agent");
    assert.equal(fail1.result.content[0].text, HARD_FAIL,
      "the hard-fail text must be byte-exact — no hints, no additions");

    const fail2 = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "second failing launch" },
    });
    assert.equal(fail2.result.content[0].text, HARD_FAIL,
      "a still-broken script must fail again — proving the env-check re-ran");

    // Admin fixes the script mid-session: the next launch must succeed.
    writeFileSync(modeFile, "ok-enabled-passthrough");
    const { agentId } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "recovered launch",
    });
    assert.equal(logLines(logFile).filter((l) => l === "env-check").length, 3,
      "failure must never latch: two failed env-checks + the recovering one = 3 executions");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. ready:false is a failure with the same exact string.
//    WHY: a script that self-reports unready has no defined safe behavior;
//    the owner contract folds it into the hard-fail path.
// ---------------------------------------------------------------------------
await test("ready:false env-check: exact hard-fail string", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeRulesetTempEnv("ready-false");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "ready-false launch" },
    });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, HARD_FAIL,
      "ready:false must produce the identical verbatim hard-fail message");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. Routing-mode failure (invalid output): same exact string, and the
//    ENABLED latch survives — recovery re-runs routing only, not the env check.
//    WHY: per-process scoping means a flaky rule must not force a fresh env
//    check, while the failure itself still never latches.
// ---------------------------------------------------------------------------
await test("route failure (bad-model): exact hard-fail string; enabled latch survives recovery", async () => {
  const { tempRoot, workDir, env, entrypoint, modeFile, logFile } = makeRulesetTempEnv("bad-model");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();

    const fail = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "bad-model launch" },
    });
    assert.equal(fail.result.isError, true);
    assert.equal(fail.result.content[0].text, HARD_FAIL,
      "invalid routing output must produce the identical verbatim hard-fail message");

    writeFileSync(modeFile, "ok-enabled-passthrough");
    const { agentId } = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "recovered after bad-model",
    });
    const lines = logLines(logFile);
    assert.equal(lines.filter((l) => l === "env-check").length, 1,
      "a routing-mode failure must NOT unlatch the enabled state (no env-check re-run)");
    assert.equal(lines.filter((l) => l === "route").length, 2,
      "the failed and the recovering routing runs = 2 route executions");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 9. Empty list = deliberate veto with its own exact error — NOT the hard
//    fail, NOT a silent no-op.
//    WHY: filtering to zero is the limit case of the allowed filter operation;
//    a policy veto must read as policy, not as a system malfunction.
// ---------------------------------------------------------------------------
await test("empty list: exact veto error text (clean isError, not the hard-fail string)", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeRulesetTempEnv("empty");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "vetoed launch" },
    });
    assert.equal(response.result.isError, true, "a veto must fail the launch");
    assert.equal(response.result.content[0].text, VETO_ERROR,
      "the veto error must be byte-exact (with AUTO_HINT) and distinct from the hard-fail message");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 10. Deadlock window is never consumed by a ruleset failure (window-walk
//     variant of the index-handler walk).
//     WHY: consume() fires only on a successful performance-branch launch; a
//     ruleset hard-fail mid-window must leave the remaining budget intact or
//     deadlock escalation silently loses launches.
// ---------------------------------------------------------------------------
await test("deadlock window: ruleset failure does not consume a window counter", async () => {
  const { tempRoot, workDir, env, entrypoint, modeFile } = makeRulesetTempEnv("ok-enabled-passthrough");
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();

    // 1. deadlock=true → arm(3), consume(→2). Performance.
    const r1 = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "deadlock trigger",
      deadlock: true,
    });
    assertSelection(r1.launchPayload, PERF_RANK1, "deadlock=true must arm and route performance");
    await killAgent(session, r1.agentId);

    // 2. Ruleset breaks → pure-auto launch hard-fails. Window must stay at 2.
    writeFileSync(modeFile, "bad-model");
    const failResp = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "failing mid-window" },
    });
    assert.equal(failResp.result.isError, true);
    assert.equal(failResp.result.content[0].text, HARD_FAIL);

    // 3+4. Ruleset fixed → exactly TWO more performance launches must remain.
    //      If the failed launch had consumed a counter, launch 4 would already
    //      be cost_efficiency.
    writeFileSync(modeFile, "ok-enabled-passthrough");
    const r3 = await launchAndPoll(session, { task_category: "coding", prompt: "post-failure one" });
    assertSelection(r3.launchPayload, PERF_RANK1, "window must still hold 2 counters after the ruleset failure");
    await killAgent(session, r3.agentId);

    const r4 = await launchAndPoll(session, { task_category: "coding", prompt: "post-failure two" });
    assertSelection(r4.launchPayload, PERF_RANK1,
      "the ruleset hard-fail must NOT have consumed a window counter");
    await killAgent(session, r4.agentId);

    // 5. Window exhausted → back to cost_efficiency.
    const r5 = await launchAndPoll(session, { task_category: "coding", prompt: "after exhaustion" });
    assertSelection(r5.launchPayload, CE_RANK1, "window depleted after exactly 3 successful consumes");
    await killAgent(session, r5.agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
