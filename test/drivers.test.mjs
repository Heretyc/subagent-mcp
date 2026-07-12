import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import {
  ClaudeSdkDriver,
  CodexAppServerDriver,
  MockJsonlDriver,
  createProviderDriver,
  killProviderChildProcess,
  providerChildSpawnOptions,
} from "../dist/drivers.js";

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

async function waitFor(predicate, label, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function collect(stream) {
  let text = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    text += chunk;
  });
  return () => text;
}

function options(provider) {
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

function writeFakeAppServer(tempRoot, logFile) {
  const script = join(tempRoot, "fake-codex-app-server.mjs");
  writeFileSync(
    script,
    `
import fs from "node:fs";
import readline from "node:readline";

const logFile = process.env.APP_SERVER_LOG;
const holdFirstMs = Number(process.env.HOLD_FIRST_MS || "0");
let turn = 0;
let pendingElicitation = null;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

function log(obj) {
  if (logFile) fs.appendFileSync(logFile, JSON.stringify(obj) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  log(msg);
  if (pendingElicitation && msg.id === pendingElicitation.requestId && msg.result) {
    send({
      method: "turn/completed",
      params: {
        turn: {
          id: pendingElicitation.turnId,
          items: [{ type: "agentMessage", text: "answered:" + JSON.stringify(msg.result) }],
        },
      },
    });
    pendingElicitation = null;
    return;
  }
  if (msg.method === "initialize") {
    if (process.env.FAIL_INIT === "1") {
      send({ id: msg.id, error: { message: "init failed" } });
    } else {
      send({ id: msg.id, result: { protocolVersion: "test" } });
    }
    return;
  }
  if (msg.method === "initialized") return;
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: "thread-1" } } });
    send({ method: "thread/started", params: { thread: { id: "thread-1" } } });
    return;
  }
  if (msg.method === "turn/start") {
    turn += 1;
    const turnId = "turn-" + turn;
    const text = msg.params?.input?.[0]?.text || "";
    send({ id: msg.id, result: { turn: { id: turnId } } });
    send({ method: "turn/started", params: { turn: { id: turnId } } });
    send({ method: "item/agentMessage/delta", params: { delta: "ack:" + text } });
    if (process.env.ELICIT_AFTER_FIRST_TURN === "1" && turn === 1) {
      pendingElicitation = { requestId: 900, turnId };
      send({
        id: pendingElicitation.requestId,
        method: "requestUserInput",
        params: {
          prompt: "Pick one",
          options: [
            { id: "yes-id", label: "Yes" },
            { id: "no-id", label: "No" },
          ],
        },
      });
      return;
    }
    const delay = turn === 1 ? holdFirstMs : 0;
    setTimeout(() => {
      send({
        method: "turn/completed",
        params: { turn: { id: turnId, items: [{ type: "agentMessage", text: "done:" + text }] } },
      });
    }, delay);
  }
});
`,
    "utf8"
  );
  writeFileSync(logFile, "");
  return script;
}

function spawnFakeAppServer(script, env = {}) {
  return spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function readTurnStarts(logFile) {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((msg) => msg.method === "turn/start");
}

function readLog(logFile) {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

await test("provider child spawn options create POSIX process groups only", async () => {
  const base = {
    cwd: process.cwd(),
    env: { TEST_PROVIDER_SPAWN_OPTIONS: "1" },
  };

  assert.deepEqual(providerChildSpawnOptions(base, "linux"), {
    cwd: base.cwd,
    env: base.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: true,
  });
  assert.deepEqual(providerChildSpawnOptions(base, "darwin"), {
    cwd: base.cwd,
    env: base.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: true,
  });
  assert.deepEqual(providerChildSpawnOptions(base, "win32"), {
    cwd: base.cwd,
    env: base.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });
});

await test("provider child kill signals POSIX process group before direct child fallback", async () => {
  const calls = [];
  const child = {
    pid: 123,
    kill(signal) {
      calls.push(["child", signal]);
      return true;
    },
  };
  const ok = killProviderChildProcess(child, "SIGKILL", "linux", (pid, signal) => {
    calls.push(["group", pid, signal]);
    return true;
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, [["group", -123, "SIGKILL"]]);
});

await test("provider child kill falls back to direct child on Windows or missing POSIX group", async () => {
  const windowsCalls = [];
  const windowsChild = {
    pid: 123,
    kill(signal) {
      windowsCalls.push(["child", signal]);
      return true;
    },
  };
  assert.equal(
    killProviderChildProcess(windowsChild, "SIGKILL", "win32", () => {
      throw new Error("must not signal group on Windows");
    }),
    true
  );
  assert.deepEqual(windowsCalls, [["child", "SIGKILL"]]);

  const fallbackCalls = [];
  const fallbackChild = {
    pid: 123,
    kill(signal) {
      fallbackCalls.push(["child", signal]);
      return true;
    },
  };
  assert.equal(
    killProviderChildProcess(fallbackChild, "SIGTERM", "linux", (pid, signal) => {
      fallbackCalls.push(["group", pid, signal]);
      throw new Error("ESRCH");
    }),
    true
  );
  assert.deepEqual(fallbackCalls, [
    ["group", -123, "SIGTERM"],
    ["child", "SIGTERM"],
  ]);
});

await test("Claude SDK driver launches, sends multiple turns, and kills", async () => {
  const seen = [];
  let sdkOptions;
  async function* query(params) {
    sdkOptions = params.options;
    for await (const msg of params.prompt) {
      seen.push(msg);
      const text = msg.message.content;
      yield { type: "assistant", message: { content: [{ type: "text", text: `ack:${text}` }] } };
      yield { type: "result", result: `done:${text}` };
    }
  }

  const driver = new ClaudeSdkDriver(query);
  const stdout = collect(driver.process.stdout);
  driver.open(options("claude"));
  await once(driver.process, "spawn");

  await driver.start("first");
  await waitFor(() => seen.length === 1, "first Claude SDK input");
  await driver.send("second");
  await waitFor(() => seen.length === 2, "second Claude SDK input");
  await waitFor(() => stdout().includes("done:second"), "second Claude SDK result");

  assert.equal(sdkOptions.permissionMode, "default");
  assert.equal(sdkOptions.allowDangerouslySkipPermissions, false);
  assert.match(stdout(), /done:first/);
  assert.match(stdout(), /done:second/);
  driver.kill();
  assert.equal(driver.closed, true);
  assert.equal(driver.process.killed, true);
  await assert.rejects(() => driver.send("after kill"), /closed/);
});

await test("Claude SDK driver maps Opus launch ids to the full SDK model id", async () => {
  // The Claude Agent SDK rejects the short launch ids "opus" / "opus-4-8" with
  // model_not_found (404). The driver must hand the SDK full Claude ids.
  async function openWith(model) {
    let sdkOptions;
    async function* query(params) {
      sdkOptions = params.options;
      for await (const _msg of params.prompt) {
        yield { type: "result", result: "ok" };
      }
    }
    const driver = new ClaudeSdkDriver(query);
    driver.open({ ...options("claude"), model });
    await once(driver.process, "spawn");
    await driver.start("hi");
    await waitFor(() => sdkOptions !== undefined, "Claude SDK options captured");
    driver.kill();
    return sdkOptions.model;
  }

  assert.equal(await openWith("opus"), "claude-opus-4-8");
  assert.equal(await openWith("opus-4-8"), "claude-opus-4-8");
  assert.equal(await openWith("fable"), "claude-fable-5");
  assert.equal(await openWith("sonnet"), "claude-sonnet-4-6");
  assert.equal(await openWith("haiku"), "claude-haiku-4-5");
});

await test("mock driver script seam requires test env or explicit opt-in", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-driver-mock-seam-"));
  const oldEnv = {
    NODE_ENV: process.env.NODE_ENV,
    SUBAGENT_MOCK_CODEX_DRIVER: process.env.SUBAGENT_MOCK_CODEX_DRIVER,
    SUBAGENT_MOCK_DRIVER_SCRIPT: process.env.SUBAGENT_MOCK_DRIVER_SCRIPT,
    SUBAGENT_MCP_ENABLE_TEST_SEAMS: process.env.SUBAGENT_MCP_ENABLE_TEST_SEAMS,
  };
  try {
    const mockScript = join(tempRoot, "mock-driver.mjs");
    writeFileSync(mockScript, "setInterval(() => {}, 1000);\n", "utf8");
    process.env.NODE_ENV = "production";
    process.env.SUBAGENT_MOCK_CODEX_DRIVER = "jsonl";
    process.env.SUBAGENT_MOCK_DRIVER_SCRIPT = mockScript;
    delete process.env.SUBAGENT_MCP_ENABLE_TEST_SEAMS;
    const prodDriver = await createProviderDriver({ ...options("codex"), command: process.execPath });
    assert.ok(!(prodDriver instanceof MockJsonlDriver), "production env must not use mock seam");
    prodDriver.kill();

    process.env.SUBAGENT_MCP_ENABLE_TEST_SEAMS = "1";
    const testDriver = await createProviderDriver({ ...options("codex"), command: process.execPath });
    assert.ok(testDriver instanceof MockJsonlDriver, "explicit opt-in should enable mock seam");
    testDriver.kill();
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Codex app-server driver starts a thread, sends turns, and kills", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-driver-codex-"));
  try {
    const logFile = join(tempRoot, "app-server.log");
    const script = writeFakeAppServer(tempRoot, logFile);
    const child = spawnFakeAppServer(script, { APP_SERVER_LOG: logFile });
    const driver = new CodexAppServerDriver(child, options("codex"));
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("first");
    await waitFor(() => stdout().includes("done:first"), "first Codex completion");
    assert.equal(driver.closed, false);
    assert.equal(driver.process.exitCode, null);

    await driver.send("second");
    await waitFor(() => stdout().includes("done:second"), "second Codex completion");
    assert.equal(readTurnStarts(logFile).length, 2);

    driver.kill();
    assert.equal(driver.closed, true);
    assert.equal(driver.process.killed, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Codex send enqueues behind an active turn without blocking for output", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-driver-codex-queue-"));
  try {
    const logFile = join(tempRoot, "app-server.log");
    const script = writeFakeAppServer(tempRoot, logFile);
    const child = spawnFakeAppServer(script, { APP_SERVER_LOG: logFile, HOLD_FIRST_MS: "250" });
    const driver = new CodexAppServerDriver(child, options("codex"));
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("first");
    await waitFor(() => stdout().includes("ack:first"), "first Codex delta");
    assert.equal(readTurnStarts(logFile).length, 1);

    const started = Date.now();
    await driver.send("second");
    assert.ok(Date.now() - started < 100, "send must return after enqueue, not after turn output");
    assert.equal(readTurnStarts(logFile).length, 1, "second turn must wait for first completion");

    await waitFor(() => readTurnStarts(logFile).length === 2, "queued second turn/start");
    await waitFor(() => stdout().includes("done:second"), "queued second completion");
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Codex requestUserInput is answered fail-closed without starting an extra turn", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-driver-codex-elicit-option-"));
  try {
    const logFile = join(tempRoot, "app-server.log");
    const script = writeFakeAppServer(tempRoot, logFile);
    const child = spawnFakeAppServer(script, {
      APP_SERVER_LOG: logFile,
      ELICIT_AFTER_FIRST_TURN: "1",
    });
    const driver = new CodexAppServerDriver(child, options("codex"));
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("first");
    await waitFor(() => stdout().includes('"method":"requestUserInput"'), "requestUserInput output");
    assert.equal(readTurnStarts(logFile).length, 1);

    await waitFor(() => stdout().includes("answered:"), "elicitation completion");
    const log = readLog(logFile);
    const reply = log.find((msg) => msg.id === 900 && msg.result);
    assert.deepEqual(reply, { jsonrpc: "2.0", id: 900, result: { action: "decline" } });
    assert.equal(readTurnStarts(logFile).length, 1, "auto-answer must not issue turn/start");

    await driver.send("second");
    await waitFor(() => readTurnStarts(logFile).length === 2, "normal send resumes");
    await waitFor(() => stdout().includes("done:second"), "second completion");
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Codex requestUserInput free text path is answered fail-closed", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-driver-codex-elicit-text-"));
  try {
    const logFile = join(tempRoot, "app-server.log");
    const script = writeFakeAppServer(tempRoot, logFile);
    const child = spawnFakeAppServer(script, {
      APP_SERVER_LOG: logFile,
      ELICIT_AFTER_FIRST_TURN: "1",
    });
    const driver = new CodexAppServerDriver(child, options("codex"));
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");

    await driver.start("first");
    await waitFor(() => stdout().includes('"method":"requestUserInput"'), "requestUserInput output");
    assert.equal(readTurnStarts(logFile).length, 1);

    await waitFor(() => stdout().includes("answered:"), "elicitation completion");
    const log = readLog(logFile);
    const reply = log.find((msg) => msg.id === 900 && msg.result);
    assert.deepEqual(reply, {
      jsonrpc: "2.0",
      id: 900,
      result: { action: "decline" },
    });
    assert.equal(readTurnStarts(logFile).length, 1, "auto-answer must not issue turn/start");

    await driver.send("second");
    await waitFor(() => readTurnStarts(logFile).length === 2, "normal send resumes");
    await waitFor(() => stdout().includes("done:second"), "second completion");
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("Codex app-server startup failure rejects loudly", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-driver-codex-fail-"));
  try {
    const logFile = join(tempRoot, "app-server.log");
    const script = writeFakeAppServer(tempRoot, logFile);
    const child = spawnFakeAppServer(script, { APP_SERVER_LOG: logFile, FAIL_INIT: "1" });
    const driver = new CodexAppServerDriver(child, options("codex"));
    await once(driver.process, "spawn");

    await assert.rejects(() => driver.start("first"), /init failed/);
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
