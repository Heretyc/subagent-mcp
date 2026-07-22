/**
 * Integration tests for same-call provider failover in launch_agent.
 *
 * The suite owns the failover surface only: launch_agent should advance through
 * candidate launch failures in a single call, expose failover metadata on
 * success, and let override requests fall back to de-duped auto candidates.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { classifyFailureReason } from "../dist/index.js";
import { terminalTurnFailure } from "../dist/stream-helpers.js";
import { slotDir } from "../dist/concurrency.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");
const fixtureTablePath = join(repoRoot, "test", "fixtures", "ruleset-routing-table.fixture.json");

const AUTO_HINT =
  "Tip: omit provider/model/effort entirely and the server auto-selects the best provider/model/effort for this task_category, with automatic silent fallback.";

const GRACE_MS = 600;
const CE_RANK1 = { provider: "claude", model: "sonnet", effort: "medium" };
const CE_RANK2 = { provider: "codex", model: "gpt-5.5", effort: "xhigh" };

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

function cleanupSharedSlotMarkers() {
  try {
    const dir = slotDir();
    for (const file of readdirSync(dir)) {
      if (file.startsWith("slot-") && file.endsWith(".json")) {
        try {
          unlinkSync(join(dir, file));
        } catch {}
      }
    }
  } catch {}
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
      clientInfo: { name: "failover-test", version: "0.0.0" },
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

function writeFailoverPathTools(fakeBin, codexMode) {
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
  writeFileSync(claudePath, "#!/bin/sh\nexit 1\n");
  writeFileSync(codexPath, codexMode === "stall" ? "#!/bin/sh\nexec sleep 30\n" : "#!/bin/sh\nexit 1\n");
  chmodSync(npmPath, 0o755);
  chmodSync(claudePath, 0o755);
  chmodSync(codexPath, 0o755);
}

function writeMockDriverScript(tempRoot) {
  const script = join(tempRoot, "mock-provider-driver.mjs");
  writeFileSync(
    script,
    `
import { setTimeout as sleep } from "node:timers/promises";

const provider = process.argv[2] || "claude";
const mode = provider === "claude"
  ? process.env.FAKE_CLI_CLAUDE_MODE
  : process.env.FAKE_CLI_CODEX_MODE;

if (mode === "die") {
  process.stderr.write("fake " + provider + ": deliberate instant death\\n");
  process.exit(1);
}

if (mode === "clean-exit") {
  await new Promise((resolveInput) => process.stdin.once("data", resolveInput));
  await sleep(20);
  process.exit(0);
}

if (mode === "stall") {
  await sleep(30000);
  process.exit(0);
}
`,
    "utf8"
  );
  return script;
}

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

function writeMockHookImport(tempRoot, mode) {
  if (!mode) return null;
  const hookPath = join(tempRoot, "mock-driver-hooks.mjs");
  const driversUrl = pathToFileURL(join(tempRoot, "dist", "drivers.js")).href;
  const script = `
const drivers = await import(${JSON.stringify(driversUrl)});
const { MockJsonlDriver } = drivers;
const mode = ${JSON.stringify(mode)};
if (mode === "transient-once") {
  MockJsonlDriver.transientPreStartHook = () => {
    MockJsonlDriver.transientPreStartHook = null;
  };
} else if (mode === "transient-always") {
  MockJsonlDriver.transientPreStartHook = () => {};
} else if (mode === "post-start-once") {
  MockJsonlDriver.postStartErrorHook = () => {
    MockJsonlDriver.postStartErrorHook = null;
  };
} else if (mode === "turn-complete-once") {
  MockJsonlDriver.turnCompletePreStartHook = () => {
    MockJsonlDriver.turnCompletePreStartHook = null;
  };
} else if (mode === "first-turn-fail-once") {
  MockJsonlDriver.firstTurnFailureHook = () => {
    MockJsonlDriver.firstTurnFailureHook = null;
  };
}
`;
  writeFileSync(hookPath, script);
  return hookPath;
}

function makeFailoverEnv(codexMode, graceMs, options = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-failover-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFailoverPathTools(fakeBin, codexMode);
  const mockDriverScript = writeMockDriverScript(tempRoot);
  const entrypoint = makeFixtureDist(tempRoot);
  const modeFile = join(tempRoot, "ruleset-mode.txt");
  writeFileSync(modeFile, options.rulesetMode || "ok-disabled");
  const hookImport = writeMockHookImport(tempRoot, options.mockHookMode);
  const nodeOptions = [
    process.env.NODE_OPTIONS,
    `--require "${preloadPath.replace(/\\/g, "/")}"`,
    hookImport ? `--import ${pathToFileURL(hookImport).href}` : "",
  ].filter(Boolean).join(" ");
  const env = prependPath(
    {
      ...process.env,
      FAKE_NPM_PREFIX: fakePrefix,
      SUBAGENT_SPAWN_GRACE_MS: String(graceMs),
      SUBAGENT_MOCK_CLAUDE_DRIVER: "jsonl",
      SUBAGENT_MOCK_CODEX_DRIVER: "jsonl",
      SUBAGENT_MCP_ENABLE_TEST_SEAMS: "1",
      SUBAGENT_MOCK_DRIVER_SCRIPT: mockDriverScript,
      SUBAGENT_RULESET_PYTHON: process.execPath,
      NODE_OPTIONS: nodeOptions,
      FAKE_RULESET_MODE_FILE: modeFile,
      FAKE_CLI_CLAUDE_MODE: options.claudeMode || "die",
      FAKE_CLI_CODEX_MODE: codexMode,
    },
    fakeBin
  );
  return { tempRoot, workDir, env, entrypoint, modeFile };
}

function textOf(response) {
  return response.result.content[0].text;
}

async function callTool(session, name, args) {
  return session.request("tools/call", { name, arguments: args });
}

async function launch(session, args) {
  return callTool(session, "launch_agent", args);
}

async function killAgent(session, agentId) {
  const killResp = await callTool(session, "kill_agent", { agent_id: agentId });
  assert.notEqual(killResp.result?.isError, true, "cleanup kill must succeed");
}

function assertNoFailoverFields(payload, label) {
  assert.equal(payload.failover_occurred, undefined, `${label} must not expose failover_occurred`);
  assert.equal(payload.failover_from, undefined, `${label} must not expose failover_from`);
  assert.equal(payload.failover_note, undefined, `${label} must not expose failover_note`);
}

function assertFailoverFrom(entry, expected, failureType) {
  assert.equal(entry.provider, expected.provider);
  assert.equal(entry.model, expected.model);
  assert.equal(entry.effort, expected.effort);
  assert.equal(entry.failure_type, failureType);
}

async function withEnv(codexMode, graceMs, options, fn) {
  const { tempRoot, workDir, env, entrypoint, modeFile } = makeFailoverEnv(codexMode, graceMs, options);
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    cleanupSharedSlotMarkers();
    await session.initialize();
    await fn({ session, modeFile });
  } finally {
    await session.close();
    cleanupSharedSlotMarkers();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

await test("silent advance: candidate 1 dies within the window, candidate 2 survives and reports failover", async () => {
  await withEnv("stall", GRACE_MS, {}, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "failover advance launch" });
    const text = textOf(response);
    assert.notEqual(response.result.isError, true, `a surviving candidate 2 must make the launch succeed: ${text}`);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, CE_RANK2.provider);
    assert.equal(payload.model, CE_RANK2.model);
    assert.equal(payload.effort, CE_RANK2.effort);
    assert.equal(payload.failover_occurred, true);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "permanent");
    assert.equal(typeof payload.failover_note, "string");
    assert.equal(payload.ruleset_applied, undefined);
    await killAgent(session, payload.agent_id);
  });
});

await test("exit code 0 within the armed grace window is a launch failure", async () => {
  await withEnv("stall", GRACE_MS, { claudeMode: "clean-exit" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "clean early exit" });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK2.provider);
    assert.equal(payload.failover_occurred, true);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "permanent");
    await killAgent(session, payload.agent_id);
  });
});

await test("turn-completed fast exit 0 is a successful launch", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "turn-complete-once", claudeMode: "stall" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "fast completed turn" });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK1.provider);
    assertNoFailoverFields(payload, "fast completion");
    const pollPayload = JSON.parse(textOf(await callTool(session, "poll_agent", { agent_id: payload.agent_id })));
    assert.equal(pollPayload.status, "finished");
  });
});

await test("exhaustion: ALL candidates die in the window -> ERR_ALL_FAILED with typed reasons", async () => {
  await withEnv("die", GRACE_MS, {}, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "exhaustion launch" });
    assert.equal(response.result.isError, true, "only full exhaustion may fail the launch");
    const text = textOf(response);
    assert.ok(text.startsWith("Error: all 2 candidate launches failed for task_category coding:"));
    assert.match(text, new RegExp(`  1\\. sonnet@medium \\(claude\\) \\[permanent\\]: process exited \\(code \\d+\\) within ${GRACE_MS}ms of spawn`));
    assert.match(text, new RegExp(`  2\\. gpt-5\\.5@xhigh \\(codex\\) \\[permanent\\]: process exited \\(code \\d+\\) within ${GRACE_MS}ms of spawn`));
    assert.doesNotMatch(text, /failover_occurred/);
    assert.ok(text.includes(AUTO_HINT));
  });
});

await test("grace 0: detection disabled, startup-write winner is reported with no failover fields", async () => {
  await withEnv("die", 0, {}, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "legacy grace-off launch" });
    const text = textOf(response);
    assert.notEqual(response.result.isError, true, `grace 0 must preserve the startup-write race seam: ${text}`);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, CE_RANK1.provider);
    assert.equal(payload.model, CE_RANK1.model);
    assertNoFailoverFields(payload, "first-candidate success");
  });
});

await test("transient pre-start hook: quota/429 class failure fails over with transient_provider metadata", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-once", claudeMode: "stall" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "transient quota failover" });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.failover_occurred, true);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "transient_provider");
    assert.match(payload.failover_note, /transient provider error/);
    await killAgent(session, payload.agent_id);
  });
});

await test("first-turn terminal provider error advances to the next candidate and reports failover", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "first-turn-fail-once", claudeMode: "stall" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "first turn terminal failover" });
    const text = textOf(response);
    assert.notEqual(response.result.isError, true, `a surviving candidate 2 must make the launch succeed: ${text}`);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, CE_RANK2.provider);
    assert.equal(payload.model, CE_RANK2.model);
    assert.equal(payload.effort, CE_RANK2.effort);
    assert.equal(payload.failover_occurred, true);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "permanent");
    await killAgent(session, payload.agent_id);
  });
});

await test("terminalTurnFailure detects codex/claude first-turn errors but not normal completions", () => {
  assert.equal(
    terminalTurnFailure("codex", JSON.stringify({ method: "turn/completed", params: { turn: { status: "failed", items: [] } } })),
    "codex turn failed"
  );
  assert.match(
    terminalTurnFailure("codex", JSON.stringify({ method: "error", params: { willRetry: false, message: "gpt-5.6 model not supported" } })) || "",
    /gpt-5\.6 model not supported/
  );
  assert.match(
    terminalTurnFailure("codex", JSON.stringify({ method: "error", params: { willRetry: false }, error: { message: "unsupported model gpt-5.6" } })) || "",
    /unsupported model gpt-5\.6/
  );
  assert.equal(
    terminalTurnFailure("codex", JSON.stringify({ method: "thread/status/changed", params: { status: "systemError" } })),
    "codex thread status systemError"
  );
  assert.equal(
    terminalTurnFailure("codex", JSON.stringify({ method: "thread/status/changed", params: { thread: { status: "systemError" } } })),
    "codex thread status systemError"
  );
  assert.match(
    terminalTurnFailure("codex", JSON.stringify({ method: "thread/systemError", params: { message: "unsupported model" } })) || "",
    /unsupported model/
  );
  assert.match(
    terminalTurnFailure("codex", JSON.stringify({ method: "turn/failed", params: { error: { message: "unsupported model" } } })) || "",
    /unsupported model/
  );
  assert.match(
    terminalTurnFailure("codex", JSON.stringify({ method: "turn/error", params: { message: "unsupported model" } })) || "",
    /unsupported model/
  );
  assert.match(
    terminalTurnFailure("claude", JSON.stringify({ type: "result", is_error: true, error: "model unavailable" })) || "",
    /model unavailable/
  );
  // A retryable error, a successful turn, and a normal result are NOT terminal.
  assert.equal(terminalTurnFailure("codex", JSON.stringify({ method: "error", params: { willRetry: true } })), null);
  assert.equal(terminalTurnFailure("codex", JSON.stringify({ method: "turn/completed", params: { turn: { status: "completed" } } })), null);
  assert.equal(terminalTurnFailure("claude", JSON.stringify({ type: "result", is_error: false })), null);
});

await test("transient classification: HTTP 5xx launch failures are transient_provider", async () => {
  assert.equal(classifyFailureReason("process exited (code 1) within 600ms of spawn: HTTP 500 server error", ""), "transient_provider");
  assert.equal(classifyFailureReason("process exited (code 1) within 600ms of spawn: HTTP 503 service unavailable", ""), "transient_provider");
  assert.equal(classifyFailureReason("provider failed with status 502", ""), "transient_provider");
  assert.equal(classifyFailureReason("log line 523 in worker output", ""), "permanent");
});

await test("transient classification: auth-like launch failures are transient_provider", async () => {
  assert.equal(classifyFailureReason("HTTP 403 forbidden", ""), "transient_provider");
  assert.equal(classifyFailureReason("provider failed with status 401 unauthorized", ""), "transient_provider");
  assert.equal(classifyFailureReason("authentication failed", ""), "transient_provider");
});

await test("transient classification: network timeout and reset launch failures are transient_provider", async () => {
  assert.equal(classifyFailureReason("spawn failed ETIMEDOUT", ""), "transient_provider");
  assert.equal(classifyFailureReason("spawn failed ECONNRESET", ""), "transient_provider");
});

await test("permanent classification: ENOENT advances with permanent failure_type and no transient note", async () => {
  assert.equal(classifyFailureReason("CLI executable not found: /usr/bin/claude", ""), "permanent");
  assert.equal(classifyFailureReason("spawn ENOENT", ""), "permanent");
});

await test("poll_agent reports actual final provider/model plus failover metadata", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-once" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "poll after failover" });
    const launchPayload = JSON.parse(textOf(response));
    const pollResp = await callTool(session, "poll_agent", { agent_id: launchPayload.agent_id });
    const pollPayload = JSON.parse(textOf(pollResp));
    assert.equal(pollPayload.provider, CE_RANK2.provider);
    assert.equal(pollPayload.model, CE_RANK2.model);
    assert.equal(pollPayload.failover_occurred, true);
    assertFailoverFrom(pollPayload.failover_from[0], CE_RANK1, "transient_provider");
    await killAgent(session, launchPayload.agent_id);
  });
});

await test("first-candidate success: no failover_occurred, failover_from, or failover_note", async () => {
  await withEnv("stall", 0, {}, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "first candidate success" });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK1.provider);
    assert.equal(payload.model, CE_RANK1.model);
    assertNoFailoverFields(payload, "plain success");
  });
});

await test("explicit provider/model/effort failure falls back to de-duped auto candidates", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-once", claudeMode: "stall" }, async ({ session }) => {
    const modeResp = await callTool(session, "model-selection-mode", { mode: "user-approved-overrides" });
    assert.notEqual(modeResp.result.isError, true);
    const response = await launch(session, {
      task_category: "coding",
      prompt: "explicit transient failure",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK2.provider);
    assert.equal(payload.model, CE_RANK2.model);
    assert.equal(payload.effort, CE_RANK2.effort);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "transient_provider");
    await killAgent(session, payload.agent_id);
  });
});

await test("explicit fallback does not retry the same triple from auto candidates", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-always" }, async ({ session }) => {
    const modeResp = await callTool(session, "model-selection-mode", { mode: "user-approved-overrides" });
    assert.notEqual(modeResp.result.isError, true);
    const response = await launch(session, {
      task_category: "coding",
      prompt: "explicit override transient failure",
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    const text = textOf(response);
    assert.equal(response.result.isError, true);
    assert.ok(text.startsWith("Error: all 2 candidate launches failed for task_category coding:"));
    assert.match(text, /  1\. sonnet@medium \(claude\) \[transient_provider\]:/);
    assert.match(text, /  2\. gpt-5\.5@xhigh \(codex\) \[transient_provider\]:/);
    assert.doesNotMatch(text, /  3\. sonnet@medium/);
  });
});

await test("user-approved-overrides provider selector falls back after requested candidates", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-once", claudeMode: "stall" }, async ({ session }) => {
    const modeResp = await callTool(session, "model-selection-mode", { mode: "user-approved-overrides" });
    assert.notEqual(modeResp.result.isError, true);
    const response = await launch(session, {
      task_category: "coding",
      prompt: "provider override transient failure",
      provider: "claude",
    });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK2.provider);
    assert.equal(payload.model, CE_RANK2.model);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "transient_provider");
    await killAgent(session, payload.agent_id);
  });
});

await test("single-call exclusion: second launch retries failed provider from scratch", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-once", claudeMode: "stall" }, async ({ session }) => {
    const firstResp = await launch(session, { task_category: "coding", prompt: "first call fails over" });
    const first = JSON.parse(textOf(firstResp));
    assert.equal(first.provider, CE_RANK2.provider);
    assert.equal(first.failover_occurred, true);
    await killAgent(session, first.agent_id);

    const secondResp = await launch(session, { task_category: "coding", prompt: "second call retries rank one" });
    const second = JSON.parse(textOf(secondResp));
    assert.equal(second.provider, CE_RANK1.provider);
    assert.equal(second.model, CE_RANK1.model);
    assertNoFailoverFields(second, "second launch");
  });
});

await test("advanced ruleset order is respected during fallback and ruleset_applied is preserved", async () => {
  await withEnv("stall", GRACE_MS, { rulesetMode: "ok-enabled-reorder", mockHookMode: "transient-once", claudeMode: "stall" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "ruleset failover launch" });
    const payload = JSON.parse(textOf(response));
    assert.equal(payload.provider, CE_RANK1.provider);
    assert.equal(payload.model, CE_RANK1.model);
    assert.equal(payload.ruleset_applied, true);
    assert.equal(payload.failover_occurred, true);
    assertFailoverFrom(payload.failover_from[0], CE_RANK2, "transient_provider");
  });
});

await test("all candidates exhausted on transient failures -> ERR_ALL_FAILED lists all and no success failover field", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-always" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "all transient failures" });
    const text = textOf(response);
    assert.equal(response.result.isError, true);
    assert.ok(text.startsWith("Error: all 2 candidate launches failed for task_category coding:"));
    assert.match(text, /  1\. sonnet@medium \(claude\) \[transient_provider\]:/);
    assert.match(text, /  2\. gpt-5\.5@xhigh \(codex\) \[transient_provider\]:/);
    assert.doesNotMatch(text, /failover_occurred/);
  });
});

await test("error after definitelyStarted is not failover and leaves the agent registered errored", async () => {
  await withEnv("stall", 2000, { mockHookMode: "post-start-once" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "post start error" });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK1.provider);
    assertNoFailoverFields(payload, "post-start outcome");
    const pollResp = await callTool(session, "poll_agent", { agent_id: payload.agent_id });
    const pollPayload = JSON.parse(textOf(pollResp));
    assert.match(pollPayload.status, /^(errored|finished|processing)$/);
    assertNoFailoverFields(pollPayload, "post-start poll");
  });
});

await test("failover_note identifies rank-1 failure and selected winner", async () => {
  await withEnv("stall", GRACE_MS, { mockHookMode: "transient-once" }, async ({ session }) => {
    const response = await launch(session, { task_category: "coding", prompt: "failover note" });
    const payload = JSON.parse(textOf(response));
    assert.match(payload.failover_note, /sonnet@medium \(claude\)/);
    assert.match(payload.failover_note, /gpt-5\.5@xhigh \(codex\)/);
    await killAgent(session, payload.agent_id);
  });
});

await test("classifyFailureReason covers transient and permanent patterns", () => {
  assert.equal(classifyFailureReason("process exited with 429", ""), "transient_provider");
  assert.equal(classifyFailureReason("process exited with 403", ""), "transient_provider");
  assert.equal(classifyFailureReason("process exited with status 503", ""), "transient_provider");
  assert.equal(classifyFailureReason("quota exceeded", ""), "transient_provider");
  assert.equal(classifyFailureReason("rate limit", ""), "transient_provider");
  assert.equal(classifyFailureReason("capacity overloaded", ""), "transient_provider");
  assert.equal(classifyFailureReason("ETIMEDOUT", ""), "transient_provider");
  assert.equal(classifyFailureReason("ECONNRESET", ""), "transient_provider");
  assert.equal(classifyFailureReason("CLI executable not found: /usr/bin/claude", ""), "permanent");
  assert.equal(classifyFailureReason("Maximum 5 concurrent claude agents already running", ""), "permanent");
  assert.equal(classifyFailureReason("process exited (code 1) within 600ms of spawn", "bad option"), "permanent");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
