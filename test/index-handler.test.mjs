/**
 * Entry/handler integration tests for src/index.ts.
 *
 * These spawn the compiled MCP server as a child process and talk newline JSON-RPC
 * over stdio. They cover behaviors that pure routing tests cannot see: the
 * entrypoint gate, the executable fast-fail gate, and handler-only fallback text.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
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
    child.kill();
    await withTimeout(
      new Promise((resolveClose) => child.once("exit", resolveClose)),
      2000,
      "server close",
      () => `stderr=${stderr}`
    ).catch(() => {});
  }

  return { request, initialize, close };
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
  const session = createMcpSession(distIndex);
  try {
    const response = await session.initialize();
    const instructions = response.result.instructions;
    assert.equal(typeof instructions, "string",
      "initialize result must carry an instructions string");
    assert.match(instructions, /ORCHESTRATION MODE/,
      "instructions must explain orchestration mode");
    assert.match(instructions, /DELEGATE/,
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

await test("bare PATH executable is not rejected before spawn", async () => {
  // makeTempEnv carries the ruleset-disabled fake + grace-window off — this
  // test launches for real, so it needs the same neutralization as 4b-4f.
  const { tempRoot, workDir, env } = makeTempEnv();

  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
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

// ---------------------------------------------------------------------------
// Helpers for routing-tier e2e tests (4b-4f)
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
  return { agentId, launchPayload, pollPayload, tier: pollPayload.routing_tier };
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

function makeTempEnv() {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-index-tier-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFakePathTools(fakeBin);
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
      SUBAGENT_RULESET_PYTHON: process.execPath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${preloadPath.replace(/\\/g, "/")}"`]
        .filter(Boolean)
        .join(" "),
      FAKE_RULESET_MODE_FILE: modeFile,
    },
    fakeBin
  );
  return { tempRoot, workDir, env };
}

// ---------------------------------------------------------------------------
// 4b. pure-auto launch → routing_tier === "cost_efficiency"
//     WHY: with no deadlock window active, pure-auto must route through
//     cost_efficiency (the default branch). If "performance" is returned, the
//     default branch is wrong.
// ---------------------------------------------------------------------------
await test("pure-auto launch: routing_tier is cost_efficiency (no window active)", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
    const { tier } = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "test pure-auto routing",
    });
    assert.equal(
      tier,
      "cost_efficiency",
      "pure-auto with no active window must route through cost_efficiency branch"
    );
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
    assert.equal(r1.tier, "performance",
      "deadlock=true must arm window and route through performance branch");
    await killAgent(session, r1.agentId);

    // 2. pure-auto → consume(→1). Performance.
    const r2 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto one",
    });
    assert.equal(r2.tier, "performance",
      "pure-auto with active window (2 remaining) must use performance branch");
    await killAgent(session, r2.agentId);

    // 3. provider+model override → no consume (window stays 1). cost_efficiency.
    const r3 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "override mid-window",
      provider: "claude",
      model: "sonnet",
    });
    assert.equal(r3.tier, "cost_efficiency",
      "override launch must not switch branch even when window active, and must not consume a counter");
    await killAgent(session, r3.agentId);

    // 4. pure-auto → consume(→0). Performance (3rd and final consume).
    const r4 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "third consume",
    });
    assert.equal(r4.tier, "performance",
      "pure-auto on last window counter (1→0) must still route performance before depleting");
    await killAgent(session, r4.agentId);

    // 5. pure-auto → window inactive(0). cost_efficiency.
    const r5 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "after window exhausted",
    });
    assert.equal(r5.tier, "cost_efficiency",
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
    assert.equal(r1.tier, "performance");
    await killAgent(session, r1.agentId);

    const r2 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto before re-arm",
    });
    assert.equal(r2.tier, "performance");
    await killAgent(session, r2.agentId);

    // Re-arm with 1 remaining → resets to 3. This call itself is launch 1 of 3.
    const r3 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "second deadlock re-arm",
      deadlock: true,
    });
    assert.equal(r3.tier, "performance",
      "re-arm must produce performance (first of 3 new launches after re-arm)");
    await killAgent(session, r3.agentId);

    const r4 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto post-rearm one",
    });
    assert.equal(r4.tier, "performance", "second of 3 performance launches after re-arm");
    await killAgent(session, r4.agentId);

    const r5 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "pure auto post-rearm two",
    });
    assert.equal(r5.tier, "performance", "third of 3 performance launches after re-arm");
    await killAgent(session, r5.agentId);

    // Window now exhausted.
    const r6 = await launchAndPoll(session, {
      task_category: "architecture",
      prompt: "after re-arm window exhausted",
    });
    assert.equal(r6.tier, "cost_efficiency",
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
// 4f. explicit provider+model+effort → routing_tier === "manual"
//     deadlock:false is identical to omitting deadlock (no change to routing).
//     WHY: explicit launches bypass the branch selection entirely; routing_tier
//     must always be "manual" so callers can distinguish auto from override.
// ---------------------------------------------------------------------------
await test("explicit launch: routing_tier is manual; deadlock:false identical to omitted", async () => {
  const { tempRoot, workDir, env } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();

    // Explicit (provider+model+effort) → routing_tier="manual".
    const r1 = await launchAndPoll(session, {
      task_category: "coding",
      prompt: "explicit launch",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    assert.equal(r1.tier, "manual",
      "explicit provider+model+effort launch must have routing_tier='manual'");
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
    assert.equal(r2.tier, "manual",
      "deadlock:false must be identical to omitting deadlock; explicit launches still route as 'manual'");
    await killAgent(session, r2.agentId);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
