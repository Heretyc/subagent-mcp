import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  ClaudeSdkDriver,
  ProviderTransientError,
  claudeMessageText,
  isClaudeSessionLimit,
} from "../dist/drivers.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");
const fixtureTablePath = join(repoRoot, "test", "fixtures", "ruleset-routing-table.fixture.json");

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

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function deferred() {
  let resolveDeferred;
  let rejectDeferred;
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

async function waitFor(predicate, label, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${label}`);
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

function collect(stream) {
  let text = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    text += chunk;
  });
  return () => text;
}

function driverOptions(provider) {
  return {
    provider,
    command: provider,
    args: [],
    cwd: process.cwd(),
    env: process.env,
    model: provider === "claude" ? "sonnet" : "gpt-5.5",
    effort: "high",
  };
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
      clientInfo: { name: "claude-session-limit-test", version: "0.0.0" },
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

function writeFailoverPathTools(fakeBin) {
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
  writeFileSync(claudePath, "#!/bin/sh\nexec sleep 30\n");
  writeFileSync(codexPath, "#!/bin/sh\nexec sleep 30\n");
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

await sleep(30000);
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

function writeSessionLimitHookImport(tempRoot, delayMs) {
  const hookPath = join(tempRoot, "mock-driver-session-limit-hook.mjs");
  const driversUrl = pathToFileURL(join(tempRoot, "dist", "drivers.js")).href;
  const script = `
const { MockJsonlDriver } = await import(${JSON.stringify(driversUrl)});
MockJsonlDriver.sessionLimitPreStartHook = (provider) => {
  if (provider !== "claude") return;
  MockJsonlDriver.sessionLimitPreStartHook = null;
  return ${delayMs};
};
`;
  writeFileSync(hookPath, script, "utf8");
  return hookPath;
}

function makeFailoverEnv(sessionLimitDelayMs = 0) {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-session-limit-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFailoverPathTools(fakeBin);
  const mockDriverScript = writeMockDriverScript(tempRoot);
  const entrypoint = makeFixtureDist(tempRoot);
  const modeFile = join(tempRoot, "ruleset-mode.txt");
  writeFileSync(modeFile, "ok-disabled");
  const hookImport = writeSessionLimitHookImport(tempRoot, sessionLimitDelayMs);
  const nodeOptions = [
    process.env.NODE_OPTIONS,
    `--require "${preloadPath.replace(/\\/g, "/")}"`,
    `--import ${pathToFileURL(hookImport).href}`,
  ].filter(Boolean).join(" ");
  const env = prependPath(
    {
      ...process.env,
      FAKE_NPM_PREFIX: fakePrefix,
      SUBAGENT_SPAWN_GRACE_MS: String(GRACE_MS),
      SUBAGENT_MOCK_CLAUDE_DRIVER: "jsonl",
      SUBAGENT_MOCK_CODEX_DRIVER: "jsonl",
      SUBAGENT_MCP_ENABLE_TEST_SEAMS: "1",
      SUBAGENT_MOCK_DRIVER_SCRIPT: mockDriverScript,
      SUBAGENT_RULESET_PYTHON: process.execPath,
      NODE_OPTIONS: nodeOptions,
      FAKE_RULESET_MODE_FILE: modeFile,
    },
    fakeBin
  );
  return { tempRoot, workDir, env, entrypoint };
}

function textOf(response) {
  return response.result.content[0].text;
}

async function callTool(session, name, args) {
  return session.request("tools/call", { name, arguments: args });
}

async function withFailoverSession(fn, sessionLimitDelayMs = 0) {
  const { tempRoot, workDir, env, entrypoint } = makeFailoverEnv(sessionLimitDelayMs);
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    await fn(session);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertFailoverFrom(entry, expected, failureType) {
  assert.equal(entry.provider, expected.provider);
  assert.equal(entry.model, expected.model);
  assert.equal(entry.effort, expected.effort);
  assert.equal(entry.failure_type, failureType);
}

await test("detector accepts Claude session-limit reset messages", () => {
  assert.equal(isClaudeSessionLimit("You've hit your session limit · resets 7:10pm (America/Los_Angeles)"), true);
  assert.equal(isClaudeSessionLimit("You've hit your session limit - resets 7:10pm (America/Los_Angeles)"), true);
  assert.equal(isClaudeSessionLimit("You’ve hit your session limit · resets 7:10pm (America/Los_Angeles)"), true);
  assert.equal(isClaudeSessionLimit("\n  You've hit your session limit · resets 7:10pm (America/Los_Angeles)"), true);
  assert.equal(isClaudeSessionLimit("You've hit your session limit · resets 04:32 UTC"), true);
  assert.equal(isClaudeSessionLimit("you've hit your session limit · resets 7:10pm (america/los_angeles)"), true);
});

await test("detector rejects non-session-limit and non-anchored messages", () => {
  assert.equal(isClaudeSessionLimit("You've hit your rate limit · resets 7:10pm"), false);
  assert.equal(isClaudeSessionLimit("You've hit your usage limit · resets 7:10pm"), false);
  assert.equal(isClaudeSessionLimit("You've hit your session limit"), false);
  assert.equal(isClaudeSessionLimit("I think you've hit your session limit · resets 7pm"), false);
  assert.equal(isClaudeSessionLimit("Your session limit has been reached."), false);
  assert.equal(isClaudeSessionLimit("Sure — here is the result."), false);
  assert.equal(isClaudeSessionLimit(""), false);
});

await test("claudeMessageText extracts assistant and result text only", () => {
  assert.equal(
    claudeMessageText({
      type: "assistant",
      message: { content: [{ type: "text", text: "assistant text" }] },
    }),
    "assistant text"
  );
  assert.equal(claudeMessageText({ type: "result", result: "result text" }), "result text");
  assert.equal(claudeMessageText({ type: "system", subtype: "init" }), null);
});

await test("Claude SDK driver rejects pre-start session-limit output as transient", async () => {
  const continueAfterSystem = deferred();
  const stdout = { value: "" };
  async function* query() {
    yield { type: "system", subtype: "init" };
    await continueAfterSystem.promise;
    yield {
      type: "result",
      result: "You've hit your session limit · resets 7:10pm (America/Los_Angeles)",
    };
  }

  const driver = new ClaudeSdkDriver(query);
  const out = collect(driver.process.stdout);
  driver.open(driverOptions("claude"));
  await once(driver.process, "spawn");
  await driver.start("start");
  await waitFor(() => out().includes('"type":"system"'), "system message");
  stdout.value = out();
  assert.equal(await Promise.race([driver.definitelyStarted.then(() => "resolved"), delay(40).then(() => "pending")]), "pending");
  assert.match(stdout.value, /"type":"system"/);

  const rejected = assert.rejects(driver.definitelyStarted, (error) => {
    assert.ok(error instanceof ProviderTransientError);
    assert.equal(error.isTransient, true);
    assert.match(error.message, /session limit/);
    return true;
  });
  continueAfterSystem.resolve();
  await rejected;
});

await test("Claude SDK driver resolves startup on first non-system assistant message", async () => {
  const continueAfterSystem = deferred();
  async function* query() {
    yield { type: "system", subtype: "init" };
    await continueAfterSystem.promise;
    yield { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } };
  }

  const driver = new ClaudeSdkDriver(query);
  const out = collect(driver.process.stdout);
  driver.open(driverOptions("claude"));
  await once(driver.process, "spawn");
  await driver.start("start");
  await waitFor(() => out().includes('"type":"system"'), "system message");
  assert.equal(await Promise.race([driver.definitelyStarted.then(() => "resolved"), delay(40).then(() => "pending")]), "pending");

  continueAfterSystem.resolve();
  await driver.definitelyStarted;
  assert.match(out(), /"text":"hi"/);
  driver.kill();
});

await test("session-limit before the grace deadline fails over with transient_provider metadata", async () => {
  await withFailoverSession(async (session) => {
    const response = await callTool(session, "launch_agent", {
      task_category: "coding",
      prompt: "session limit failover",
    });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK2.provider);
    assert.equal(payload.model, CE_RANK2.model);
    assert.equal(payload.effort, CE_RANK2.effort);
    assert.equal(payload.failover_occurred, true);
    assertFailoverFrom(payload.failover_from[0], CE_RANK1, "transient_provider");
    assert.match(payload.failover_note, /transient provider error/);

    const pollResp = await callTool(session, "poll_agent", { agent_id: payload.agent_id });
    const pollPayload = JSON.parse(textOf(pollResp));
    assert.equal(pollPayload.provider, CE_RANK2.provider);
    assert.equal(pollPayload.model, CE_RANK2.model);
    assert.equal(pollPayload.failover_occurred, true);
    assertFailoverFrom(pollPayload.failover_from[0], CE_RANK1, "transient_provider");

    const killResp = await callTool(session, "kill_agent", { agent_id: payload.agent_id });
    assert.notEqual(killResp.result?.isError, true, "cleanup kill must succeed");
  }, Math.floor(GRACE_MS / 2));
});

await test("session-limit after the grace deadline remains a registered task outcome", async () => {
  await withFailoverSession(async (session) => {
    const response = await callTool(session, "launch_agent", {
      task_category: "coding",
      prompt: "late session limit",
    });
    const payload = JSON.parse(textOf(response));
    assert.notEqual(response.result.isError, true);
    assert.equal(payload.provider, CE_RANK1.provider);
    assert.equal(payload.failover_occurred, undefined);

    await delay(350);
    const pollResp = await callTool(session, "poll_agent", { agent_id: payload.agent_id });
    const pollPayload = JSON.parse(textOf(pollResp));
    assert.equal(pollPayload.provider, CE_RANK1.provider);
    assert.equal(pollPayload.status, "errored");
    assert.equal(pollPayload.failover_occurred, undefined);
  }, GRACE_MS + 250);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
