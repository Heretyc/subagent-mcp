/**
 * Entry/handler integration tests for src/index.ts.
 *
 * These spawn the compiled MCP server as a child process and talk newline JSON-RPC
 * over stdio. They cover behaviors that pure routing tests cannot see: the
 * entrypoint gate, the executable fast-fail gate, and handler-only fallback text.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = join(repoRoot, "dist", "index.js");
const preloadPath = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");

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
      clientInfo: { name: "index-handler-test", version: "0.0.0" },
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

function completeLater(fn) {
  const delayMs = Number(process.env.MOCK_DELAY_TURN_COMPLETE_MS || 0);
  const finish = () => {
    fn();
    if (process.env.MOCK_EXIT_AFTER_TURN === "1") {
      setTimeout(() => process.exit(0), 20);
    }
  };
  delayMs > 0 ? setTimeout(finish, delayMs) : finish();
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type !== "turn.start") return;
  turn += 1;
  const text = msg.message || "";
  if (provider === "claude") {
    send({ type: "assistant", message: { content: [{ type: "text", text: "ack:" + text }] } });
    if (process.env.MOCK_NO_TURN_COMPLETE === "1") return;
    completeLater(() => send({ type: "result", result: "done:" + text }));
  } else {
    send({ type: "agent_message", message: "ack:" + text });
    if (process.env.MOCK_NO_TURN_COMPLETE === "1") return;
    completeLater(() => send({ type: "turn.completed", turn }));
  }
});
`,
    "utf8"
  );
  return script;
}

await test("symlinked dist/index.js connects as the main entrypoint", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-index-symlink-"));
  let linkPath;
  if (process.platform === "win32") {
    const linkedDist = join(tempRoot, "dist-link");
    symlinkSync(dirname(distIndex), linkedDist, "junction");
    linkPath = join(linkedDist, "index.js");
  } else {
    linkPath = join(tempRoot, "linked-index.js");
    symlinkSync(distIndex, linkPath, "file");
  }

  const session = createMcpSession(linkPath);
  try {
    const response = await session.initialize();
    assert.equal(response.result.serverInfo.name, "subagent-mcp");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("server exposes orchestration guidance via MCP instructions (no ultracode)", async () => {
  // The heavy operating-model + governance guidance migrated OFF the per-turn
  // hook and ONTO the server `instructions` field, read once at initialize. This
  // asserts the channel is actually emitted, names both provider permission
  // tools, and carries zero "ultracode" wording.
  //
  // Run explicitly as a TOP-LEVEL host: strip any inherited SUBAGENT_MCP_SUBAGENT
  // (e.g. when this suite itself runs inside a subagent-mcp child) so the server
  // emits ORCHESTRATION_INSTRUCTIONS, not the neutral subagent variant. Mirrors
  // the sibling test below, which explicitly SETS the marker for the child case.
  const topLevelEnv = { ...process.env };
  delete topLevelEnv.SUBAGENT_MCP_SUBAGENT;
  const session = createMcpSession(distIndex, { env: topLevelEnv });
  try {
    const response = await session.initialize();
    const instructions = response.result.instructions;
    assert.equal(typeof instructions, "string",
      "initialize result must carry an instructions string");
    assert.match(instructions, /CANONICAL OPERATING MODEL/,
      "instructions must expose the orchestration operating-model guidance");
    assert.match(instructions, /delegate-ONLY orchestrator/,
      "instructions must carry the delegate operating model");
    assert.match(instructions, /AskUserQuestion/,
      "instructions must name the Claude permission tool");
    assert.match(instructions, /request-user-input/,
      "instructions must name the Codex permission tool");
    assert.ok(!/ultracode/i.test(instructions),
      "instructions must not reference \"ultracode\"");
  } finally {
    await session.close();
  }
});

await test("subagent child server exposes neutral instructions", async () => {
  // WHY: subagent-mcp-launched child processes inherit their own MCP server
  // connection. They must not receive top-level orchestrator instructions.
  const session = createMcpSession(distIndex, {
    env: { ...process.env, SUBAGENT_MCP_SUBAGENT: "1" },
  });
  try {
    const response = await session.initialize();
    const instructions = response.result.instructions;
    assert.match(instructions, /SUB-AGENT SESSION/);
    assert.doesNotMatch(instructions, /CANONICAL OPERATING MODEL/);
  } finally {
    await session.close();
  }
});

await test("bare PATH executable is not rejected before spawn", async () => {
  // makeTempEnv carries the ruleset-disabled fake + grace-window off — this
  // test launches for real, so it needs the same neutralization as 4b-4f.
  const { tempRoot, workDir, env } = makeTempEnv();

  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
    await enableManualSelection(session);
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: {
        task_category: "coding",
        provider: "claude",
        model: "sonnet",
        prompt: "return compact JSON only",
      },
    });

    const text = response.result.content[0].text;
    assert.equal(response.error, undefined, text);
    assert.equal(response.result.isError, undefined, text);
    assert.doesNotMatch(text, /CLI executable not found: claude/);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, "claude");
    assert.equal(payload.model, "sonnet");
    assert.equal(
      payload.candidates_skipped,
      undefined,
      "candidates_skipped must be absent from success payload per the contract update"
    );
    assert.equal(
      payload.selection_mode,
      undefined,
      "selection_mode must be absent from success payload per the contract update"
    );
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("fallback_default handler returns SPLIT_HINT, not profiler guidance", async () => {
  const session = createMcpSession(distIndex);
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: {
        task_category: "fallback_default",
        prompt: "mixed underspecified work",
      },
    });

    assert.equal(response.error, undefined);
    assert.equal(response.result.isError, true);
    const text = response.result.content[0].text;
    assert.match(text, /break the work into smaller atomic steps/);
    assert.doesNotMatch(text, /model-profiler/);
    assert.doesNotMatch(text, /routing table not populated/);
  } finally {
    await session.close();
  }
});

const COST_EFFICIENCY_ARCHITECTURE = {
  provider: "codex",
  model: "gpt-5.4-mini",
  effort: "medium",
};
const PERFORMANCE_ARCHITECTURE = {
  provider: "claude",
  model: "claude-fable-5",
  effort: "max",
};
const EXPLICIT_CLAUDE_SONNET = {
  provider: "claude",
  model: "sonnet",
  effort: "medium",
};

function assertNoRoutingTier(payload, label) {
  assert.equal(payload.routing_tier, undefined, `${label} must not expose routing_tier`);
}

function assertSelection(payload, expected, label) {
  assert.equal(payload.provider, expected.provider, `${label} provider`);
  assert.equal(payload.model, expected.model, `${label} model`);
  assert.equal(payload.effort, expected.effort, `${label} effort`);
}

function selectionOf(payload) {
  return { provider: payload.provider, model: payload.model, effort: payload.effort };
}

// ---------------------------------------------------------------------------
// Helpers for routing e2e tests (4b-4f)
// ---------------------------------------------------------------------------
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
  const waitText = waitResp.result.content[0].text;
  const waitPayload = JSON.parse(waitText);
  assert.ok(
    Array.isArray(waitPayload.finished),
    `wait after kill must return a finished list: ${waitText}`
  );
  assert.ok(
    waitPayload.finished.some((agent) => agent.id === agentId),
    `wait after kill must observe ${agentId} as terminal: ${waitText}`
  );
}

async function pollAgent(session, agentId, extraArgs = {}) {
  const pollResp = await session.request("tools/call", {
    name: "poll_agent",
    arguments: { agent_id: agentId, ...extraArgs },
  });
  return JSON.parse(pollResp.result.content[0].text);
}

async function waitForPoll(session, agentId, predicate, label, extraArgs = {}) {
  const deadline = Date.now() + 2000;
  let payload;
  while (Date.now() < deadline) {
    payload = await pollAgent(session, agentId, extraArgs);
    if (predicate(payload)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out; last poll=${JSON.stringify(payload)}`);
}

function makeTempEnv() {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-index-tier-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  const slotDir = join(tempRoot, "slots");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  mkdirSync(slotDir);
  writeFakePathTools(fakeBin);
  const mockDriverScript = writeMockDriverScript(tempRoot);
  // Advanced-ruleset + grace-window neutralization, so every legacy assertion
  // stays valid unchanged: SUBAGENT_RULESET_PYTHON=node plus the preload make
  // the env-check answer load-rules:false deterministically (the host may have
  // no python at all — without this the whole suite would hard-fail), and
  // SUBAGENT_SPAWN_GRACE_MS=0 keeps spawn-event-only success because the fake
  // PATH CLIs above exit instantly by design (failover.test.mjs owns the
  // grace-window behavior). Forward slashes: node's NODE_OPTIONS parser treats
  // backslash as an escape inside double quotes.
  const modeFile = join(tempRoot, "ruleset-mode.txt");
  writeFileSync(modeFile, "ok-disabled");
  const env = prependPath(
    {
      ...process.env,
      FAKE_NPM_PREFIX: fakePrefix,
      SUBAGENT_SPAWN_GRACE_MS: "0",
      SUBAGENT_MOCK_CLAUDE_DRIVER: "jsonl",
      SUBAGENT_MOCK_CODEX_DRIVER: "jsonl",
      SUBAGENT_MOCK_DRIVER_SCRIPT: mockDriverScript,
      SUBAGENT_RULESET_PYTHON: process.execPath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${preloadPath.replace(/\\/g, "/")}"`]
        .filter(Boolean)
        .join(" "),
      FAKE_RULESET_MODE_FILE: modeFile,
      SUBAGENT_SLOT_DIR: slotDir,
    },
    fakeBin
  );
  return { tempRoot, workDir, env, slotDir };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findSlotForAgent(slotDir, agentId) {
  for (const file of readdirSync(slotDir)) {
    if (!file.startsWith("slot-") || !file.endsWith(".json")) continue;
    const path = join(slotDir, file);
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    if (metadata.agent_id === agentId) return { path, metadata };
  }
  throw new Error(`slot for ${agentId} not found in ${slotDir}`);
}

function rewriteSlot(slotDir, agentId, patch) {
  const { path, metadata } = findSlotForAgent(slotDir, agentId);
  writeFileSync(path, JSON.stringify({ ...metadata, ...patch }));
  return path;
}

function writeZombieIntent(slotDir, agentId) {
  const { path, metadata } = findSlotForAgent(slotDir, agentId);
  const record = {
    kind: "zombie_killed",
    agent_id: agentId,
    child_pid: metadata.child_pid,
    server_pid: metadata.server_pid,
    slot_path: path,
    reason: "stale_live",
    detected_at_ms: Date.now(),
    last_activity_ms: metadata.last_activity_ms,
    message: `zombies: culled stale subagent ${agentId}`,
  };
  writeFileSync(join(slotDir, "zombie-intents.jsonl"), `${JSON.stringify(record)}\n`);
  return record;
}

async function launchManualCodex(session, prompt, extraArgs = {}) {
  await enableManualSelection(session);
  const { agentId, launchPayload, pollPayload } = await launchAndPoll(session, {
    task_category: "coding",
    provider: "codex",
    model: "gpt-5.5",
    prompt,
    ...extraArgs,
  });
  return { agentId, launchPayload, pollPayload };
}

await test("zombie maintenance: live owned stale slot is refreshed, not killed", async () => {
  const { tempRoot, workDir, env, slotDir } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: {
      ...env,
      MOCK_NO_TURN_COMPLETE: "1",
      SUBAGENT_ZOMBIE_LIVE_IDLE_MS: "10000",
      SUBAGENT_ZOMBIE_FORCE_GRACE_MS: "10",
    },
  });
  try {
    await session.initialize();
    const { agentId } = await launchManualCodex(session, "live stale owned slot");
    await waitForPoll(
      session,
      agentId,
      (payload) => payload.stdout_tail.includes("live stale owned slot"),
      "mock output capture before live stale refresh",
      { verbose: true }
    );
    const staleActivity = Date.now() - 20000;
    rewriteSlot(slotDir, agentId, { last_activity_ms: staleActivity, status: "processing" });
    const listResp = await session.request("tools/call", { name: "list_agents", arguments: {} });
    const listPayload = JSON.parse(listResp.result.content[0].text);
    assert.equal(listPayload.zombie_report, undefined);

    const pollPayload = await pollAgent(session, agentId, { verbose: true });
    assert.notEqual(pollPayload.status, "zombie_killed");
    assert.equal(pollPayload.alive, true);
    assert.ok(pollPayload.stdout_tail.includes("live stale owned slot"));
    const { metadata } = findSlotForAgent(slotDir, agentId);
    assert.ok(metadata.last_activity_ms > staleActivity);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("wait loop refreshes live stale slot metadata while blocked", async () => {
  const { tempRoot, workDir, env, slotDir } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: {
      ...env,
      MOCK_DELAY_TURN_COMPLETE_MS: "900",
      SUBAGENT_ZOMBIE_LIVE_IDLE_MS: "1000",
      SUBAGENT_ZOMBIE_FORCE_GRACE_MS: "10",
    },
  });
  try {
    await session.initialize();
    const { agentId } = await launchManualCodex(session, "wait stale refresh target");
    await waitForPoll(
      session,
      agentId,
      (payload) => payload.stdout_tail.includes("wait stale refresh target"),
      "mock output capture before wait refresh",
      { verbose: true }
    );
    const waitPromise = session.request("tools/call", { name: "wait", arguments: {} });
    await sleep(100);
    const staleActivity = Date.now() - 2000;
    rewriteSlot(slotDir, agentId, { last_activity_ms: staleActivity, status: "processing" });

    const waitResp = await waitPromise;
    const waitPayload = JSON.parse(waitResp.result.content[0].text);
    assert.ok(waitPayload.finished.some((a) => a.id === agentId && a.status === "finished"));
    const { metadata } = findSlotForAgent(slotDir, agentId);
    assert.equal(metadata.status, "finished");
    assert.ok(metadata.last_activity_ms > staleActivity);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("zombie culling: terminal-but-alive driver becomes zombie_killed and wait reports it", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, SUBAGENT_ZOMBIE_TERMINAL_IDLE_MS: "500" },
  });
  try {
    await session.initialize();
    const { agentId } = await launchManualCodex(session, "terminal idle cull");
    await waitForPoll(
      session,
      agentId,
      (payload) => payload.status === "finished" && payload.exit_code === null,
      "turn completion before terminal cull"
    );
    await sleep(650);
    const listResp = await session.request("tools/call", { name: "list_agents", arguments: {} });
    const listPayload = JSON.parse(listResp.result.content[0].text);
    assert.equal(listPayload.zombie_report, `zombies: ${agentId}`);

    const waitResp = await session.request("tools/call", { name: "wait", arguments: {} });
    const waitPayload = JSON.parse(waitResp.result.content[0].text);
    assert.ok(waitPayload.finished.some((a) => a.id === agentId && a.status === "zombie_killed"));
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("zombie culling: wait reaps without surfacing zombie_report", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, SUBAGENT_ZOMBIE_TERMINAL_IDLE_MS: "500" },
  });
  try {
    await session.initialize();
    const { agentId } = await launchManualCodex(session, "terminal idle wait cull");
    await waitForPoll(
      session,
      agentId,
      (payload) => payload.status === "finished" && payload.exit_code === null,
      "turn completion before wait cull"
    );
    await sleep(650);

    const waitResp = await session.request("tools/call", { name: "wait", arguments: {} });
    const waitText = waitResp.result.content[0].text;
    const waitPayload = JSON.parse(waitText);
    assert.equal(waitPayload.zombie_report, undefined);
    assert.doesNotMatch(waitText, /zombies:/);
    assert.ok(waitPayload.finished.some((a) => a.id === agentId && a.status === "zombie_killed"));
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("zombie culling: hook intent marks agent zombie_killed with tail retention", async () => {
  const { tempRoot, workDir, env, slotDir } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, MOCK_NO_TURN_COMPLETE: "1" },
  });
  try {
    await session.initialize();
    const { agentId } = await launchManualCodex(session, "hook intent cull");
    await waitForPoll(
      session,
      agentId,
      (payload) => payload.stdout_tail.includes("hook intent cull"),
      "mock output capture before intent cull",
      { verbose: true }
    );
    const record = writeZombieIntent(slotDir, agentId);
    const pollResp = await session.request("tools/call", {
      name: "poll_agent",
      arguments: { agent_id: agentId, verbose: true },
    });
    const pollPayload = JSON.parse(pollResp.result.content[0].text);
    assert.equal(pollPayload.zombie_report, `zombies: ${agentId}`);
    assert.equal(pollPayload.status, "zombie_killed");
    assert.ok(pollPayload.stdout_tail.includes("hook intent cull"));
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("zombie culling: launch_agent reaps without surfacing zombie_report", async () => {
  const { tempRoot, workDir, env, slotDir } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, MOCK_NO_TURN_COMPLETE: "1" },
  });
  try {
    await session.initialize();
    const { agentId } = await launchManualCodex(session, "launch silent cull target");
    await waitForPoll(
      session,
      agentId,
      (payload) => payload.stdout_tail.includes("launch silent cull target"),
      "mock output capture before launch cull",
      { verbose: true }
    );
    writeZombieIntent(slotDir, agentId);

    await enableManualSelection(session);
    const launchResp = await session.request("tools/call", {
      name: "launch_agent",
      arguments: {
        task_category: "coding",
        provider: "codex",
        model: "gpt-5.5",
        prompt: "launch after silent cull",
      },
    });
    const launchText = launchResp.result.content[0].text;
    const launchPayload = JSON.parse(launchText);
    assert.equal(launchPayload.zombie_report, undefined);
    assert.doesNotMatch(launchText, /zombies:/);

    const culled = await pollAgent(session, agentId);
    assert.equal(culled.status, "zombie_killed");
    assert.equal(culled.zombie_report, undefined);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("zombie culling: kill_agent and send_message reap without surfacing zombie_report", async () => {
  const { tempRoot, workDir, env, slotDir } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, MOCK_NO_TURN_COMPLETE: "1" },
  });
  try {
    await session.initialize();
    const first = await launchManualCodex(session, "kill silent cull target");
    await waitForPoll(
      session,
      first.agentId,
      (payload) => payload.stdout_tail.includes("kill silent cull target"),
      "mock output capture before kill cull",
      { verbose: true }
    );
    writeZombieIntent(slotDir, first.agentId);
    const killResp = await session.request("tools/call", {
      name: "kill_agent",
      arguments: { agent_id: first.agentId },
    });
    const killText = killResp.result.content[0].text;
    assert.doesNotMatch(killText, /zombies:/);
    assert.equal(JSON.parse(killText).zombie_report, undefined);

    const second = await launchManualCodex(session, "send silent cull target");
    await waitForPoll(
      session,
      second.agentId,
      (payload) => payload.stdout_tail.includes("send silent cull target"),
      "mock output capture before send cull",
      { verbose: true }
    );
    writeZombieIntent(slotDir, second.agentId);
    const sendResp = await session.request("tools/call", {
      name: "send_message",
      arguments: { agent_id: second.agentId, message: "after cull" },
    });
    const sendText = sendResp.result.content[0].text;
    assert.doesNotMatch(sendText, /zombies:/);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("zombie culling: mode tools reap without surfacing zombie_report", async () => {
  const { tempRoot, workDir, env, slotDir } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, MOCK_NO_TURN_COMPLETE: "1" },
  });
  try {
    await session.initialize();
    const first = await launchManualCodex(session, "orchestration mode silent cull target");
    await waitForPoll(
      session,
      first.agentId,
      (payload) => payload.stdout_tail.includes("orchestration mode silent cull target"),
      "mock output capture before orchestration-mode cull",
      { verbose: true }
    );
    writeZombieIntent(slotDir, first.agentId);
    const orchResp = await session.request("tools/call", {
      name: "orchestration-mode",
      arguments: {},
    });
    const orchText = orchResp.result.content[0].text;
    assert.equal(JSON.parse(orchText).zombie_report, undefined);
    assert.doesNotMatch(orchText, /zombies:/);

    const second = await launchManualCodex(session, "model mode silent cull target");
    await waitForPoll(
      session,
      second.agentId,
      (payload) => payload.stdout_tail.includes("model mode silent cull target"),
      "mock output capture before model-selection-mode cull",
      { verbose: true }
    );
    writeZombieIntent(slotDir, second.agentId);
    const modeResp = await session.request("tools/call", {
      name: "model-selection-mode",
      arguments: {},
    });
    const modeText = modeResp.result.content[0].text;
    assert.equal(JSON.parse(modeText).zombie_report, undefined);
    assert.doesNotMatch(modeText, /zombies:/);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4b. pure-auto launch uses cost_efficiency internally without exposing it.
//     WHY: with no deadlock window active, pure-auto must route through
//     cost_efficiency (the default branch). If "performance" is returned, the
//     default branch is wrong.
// ---------------------------------------------------------------------------
await test("pure-auto launch: cost_efficiency selection, routing_tier absent", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
    const { launchPayload } = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "test pure-auto routing",
    });
    assert.ok(launchPayload.agent_id, "pure-auto launch should still succeed");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("completed interactive turn that later exits is finished but not alive", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, {
    cwd: workDir,
    env: { ...env, MOCK_EXIT_AFTER_TURN: "1" },
  });
  try {
    await session.initialize();
    await enableManualSelection(session);
    const { agentId } = await launchAndPoll(session, {
      task_category: "coding",
      provider: "codex",
      model: "gpt-5.5",
      prompt: "finish then exit",
    });
    const pollPayload = await waitForPoll(
      session,
      agentId,
      (payload) => payload.exit_code === 0,
      "clean driver exit after turn completion"
    );
    assert.equal(pollPayload.status, "finished");
    assert.equal(pollPayload.alive, false, "closed driver must not report alive=true");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4c. window walk
//     deadlock=true arms to 3 and consumes 1 (→ 2 remaining, performance).
//     pure-auto consumes another (→ 1, performance).
//     provider-override does NOT consume (→ still 1, cost_efficiency because
//       override calls never switch branch).
//     pure-auto exhausts window (→ 0, performance — 3rd total consume).
//     next pure-auto: window inactive → cost_efficiency.
//     WHY: verifies the consume ordering and that override calls are fully
//     excluded from window management.
// ---------------------------------------------------------------------------
await test("window walk: deadlock arms window; override does not consume; 3 pure-auto depletes", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();

    // 1. deadlock=true → arm(3), consume(→2). Performance.
    const r1 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "deadlock trigger",
      deadlock: true,
    });
    const performanceSelection = selectionOf(r1.launchPayload);
    await killAgent(session, r1.agentId);

    // 2. pure-auto → consume(→1). Performance.
    const r2 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto one",
    });
    assert.deepEqual(selectionOf(r2.launchPayload), performanceSelection,
      "pure-auto with active window (2 remaining) must use performance branch");
    await killAgent(session, r2.agentId);

    // 3. provider+model override → no consume (window stays 1). cost_efficiency.
    await enableManualSelection(session);
    const r3 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "override mid-window",
      provider: "claude",
      model: "sonnet",
    });
    assertSelection(r3.launchPayload, EXPLICIT_CLAUDE_SONNET,
      "override launch must honor the override selection");
    await killAgent(session, r3.agentId);

    // 4. pure-auto → consume(→0). Performance (3rd and final consume).
    const r4 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "third consume",
    });
    assert.deepEqual(selectionOf(r4.launchPayload), performanceSelection,
      "pure-auto on last window counter must still route performance before depleting");
    await killAgent(session, r4.agentId);

    // 5. pure-auto → window inactive(0). cost_efficiency.
    const r5 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "after window exhausted",
    });
    assert.notDeepEqual(selectionOf(r5.launchPayload), performanceSelection,
      "pure-auto after window exhausted must revert to cost_efficiency branch");
    await killAgent(session, r5.agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4d. re-arm: second deadlock=true resets window to 3, allowing exactly three
//     more performance launches before reverting to cost_efficiency.
//     WHY: re-arm must reset the counter, not add to it. Without a full reset
//     the remaining budget is unpredictable when callers re-trigger deadlock.
// ---------------------------------------------------------------------------
await test("re-arm: second deadlock=true resets window for 3 more performance launches", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();

    // Seed: arm + 1 consume → 2 remaining.
    const r1 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "first deadlock",
      deadlock: true,
    });
    const performanceSelection = selectionOf(r1.launchPayload);
    await killAgent(session, r1.agentId);

    const r2 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto before re-arm",
    });
    assert.deepEqual(selectionOf(r2.launchPayload), performanceSelection, "pure auto before re-arm");
    await killAgent(session, r2.agentId);

    // Re-arm with 1 remaining → resets to 3. This call itself is launch 1 of 3.
    const r3 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "second deadlock re-arm",
      deadlock: true,
    });
    assert.deepEqual(selectionOf(r3.launchPayload), performanceSelection,
      "re-arm must produce performance (first of 3 new launches after re-arm)");
    await killAgent(session, r3.agentId);

    const r4 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto post-rearm one",
    });
    assert.deepEqual(selectionOf(r4.launchPayload), performanceSelection, "second of 3 performance launches after re-arm");
    await killAgent(session, r4.agentId);

    const r5 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto post-rearm two",
    });
    assert.deepEqual(selectionOf(r5.launchPayload), performanceSelection, "third of 3 performance launches after re-arm");
    await killAgent(session, r5.agentId);

    // Window now exhausted.
    const r6 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "after re-arm window exhausted",
    });
    assert.notDeepEqual(selectionOf(r6.launchPayload), performanceSelection,
      "after 3 performance launches from re-arm, must revert to cost_efficiency");
    await killAgent(session, r6.agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4e. deadlock=true + provider → isError true with the deadlock error text
//     WHY: validation rejects this combination; the caller must get a clear
//     error identifying the deadlock constraint, not an effort or model error.
// ---------------------------------------------------------------------------
await test("deadlock=true + provider: isError true with deadlock error text", async () => {
  const session = createMcpSession(distIndex);
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: {
        task_category: "coding",
        prompt: "test deadlock+provider rejection",
        deadlock: true,
        provider: "claude",
      },
    });
    assert.equal(response.result.isError, true,
      "deadlock+provider must produce isError:true");
    const text = response.result.content[0].text;
    assert.ok(
      text.startsWith(
        "Error: deadlock cannot be combined with provider, model, or effort."
      ),
      "error text must start with the exact deadlock constraint message"
    );
    assert.ok(
      !text.includes("effort requires both provider and model"),
      "deadlock error must fire before effort-needs-both (effort message must not appear)"
    );
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------------------
// 4f. explicit provider+model+effort stays manual internally, but the tier is hidden.
//     deadlock:false is identical to omitting deadlock (no change to routing).
//     WHY: explicit launches bypass the branch selection entirely without
//     exposing the internal routing tier to callers.
// ---------------------------------------------------------------------------
await test("explicit launch: selection honored; deadlock:false identical to omitted", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
    await enableManualSelection(session);

    // Explicit (provider+model+effort) stays manual internally.
    const r1 = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "explicit launch",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    assertSelection(r1.launchPayload, EXPLICIT_CLAUDE_SONNET,
      "explicit provider+model+effort launch");
    await killAgent(session, r1.agentId);

    // deadlock:false + explicit → same result as omitting deadlock.
    const r2 = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "explicit with deadlock false",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
      deadlock: false,
    });
    assertSelection(r2.launchPayload, EXPLICIT_CLAUDE_SONNET,
      "deadlock:false explicit launch");
    await killAgent(session, r2.agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("explicit fable launch: zod enum accepts model and selection is honored", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
    await enableManualSelection(session);
    const { agentId, launchPayload } = await launchAndPoll(session, {
      task_category: "debugging",
      prompt: "explicit fable launch",
      provider: "claude",
      model: "fable",
      effort: "max",
    });
    assertSelection(launchPayload, { provider: "claude", model: "fable", effort: "max" },
      "explicit fable launch");
    await killAgent(session, agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
