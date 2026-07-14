/**
 * Lifecycle matrix tests for src/index.ts handlers.
 *
 * Coverage the routing/driver unit tests cannot give:
 *   1. Every registered launch model (haiku, sonnet, opus, opus-4-8, fable, gpt-5.5, gpt-5.6)
 *      launches at medium/default effort and round-trips a ping -> pong through
 *      its provider driver. This is the regression net for the model-id bug:
 *      if a model id is rejected by its provider, its row fails here.
 *   2. Per provider (claude, codex): send_message works on a live session
 *      mid-execution, and kill_agent force-terminates it.
 *
 * Like the sibling handler suite, these spawn the compiled dist/index.js MCP
 * server and talk newline JSON-RPC over stdio, with a mock provider driver
 * swapped in via SUBAGENT_MOCK_*_DRIVER so no real model is contacted.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = join(repoRoot, "dist", "index.js");
const preloadPath = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");

// Registered launch models and their provider + a representative effort. haiku
// has no effort dimension (the server normalizes any effort to its sentinel);
// medium is the representative default for every effort-capable model.
const MODEL_MATRIX = [
  { provider: "claude", model: "haiku", effort: "medium" },
  { provider: "claude", model: "sonnet", effort: "medium" },
  { provider: "claude", model: "opus", effort: "medium" },
  { provider: "claude", model: "opus-4-8", effort: "medium" },
  { provider: "claude", model: "fable", effort: "medium" },
  { provider: "codex", model: "gpt-5.5", effort: "medium" },
  { provider: "codex", model: "gpt-5.6", effort: "medium" },
];

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

// Mock provider driver: echoes ack:<text> for every turn so a launch prompt or a
// send_message both produce an observable pong. Stays alive between turns so a
// session can be sent to and then killed.
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

function makeTempEnv() {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-lifecycle-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFakePathTools(fakeBin);
  const mockDriverScript = writeMockDriverScript(tempRoot);
  // Neutralize the advanced-ruleset gate (host may have no python) and the spawn
  // grace window (fake PATH CLIs exit instantly by design), mirroring the sibling
  // handler suite so launches succeed deterministically.
  const modeFile = join(tempRoot, "ruleset-mode.txt");
  writeFileSync(modeFile, "ok-disabled");
  const env = prependPath(
    {
      ...process.env,
      FAKE_NPM_PREFIX: fakePrefix,
      SUBAGENT_SPAWN_GRACE_MS: "0",
      SUBAGENT_MOCK_CLAUDE_DRIVER: "jsonl",
      SUBAGENT_MOCK_CODEX_DRIVER: "jsonl",
      SUBAGENT_MCP_ENABLE_TEST_SEAMS: "1",
      SUBAGENT_MOCK_DRIVER_SCRIPT: mockDriverScript,
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
      clientInfo: { name: "lifecycle-matrix-test", version: "0.0.0" },
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

async function callTool(session, name, args) {
  const response = await session.request("tools/call", { name, arguments: args });
  return response.result;
}

async function enableManualSelection(session) {
  const result = await callTool(session, "model-selection-mode", { mode: "user-approved-overrides" });
  assert.notEqual(result.isError, true, `model-selection-mode failed: ${result.content[0].text}`);
}

async function launch(session, args) {
  const result = await callTool(session, "launch_agent", args);
  const text = result.content[0].text;
  assert.notEqual(result.isError, true, `launch failed: ${text}`);
  return JSON.parse(text);
}

async function pollAgent(session, agentId) {
  const result = await callTool(session, "poll_agent", { agent_id: agentId, verbose: true });
  return JSON.parse(result.content[0].text);
}

async function waitForOutput(session, agentId, needle, label) {
  const deadline = Date.now() + 3000;
  let payload;
  while (Date.now() < deadline) {
    payload = await pollAgent(session, agentId);
    if (JSON.stringify(payload).includes(needle)) return payload;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${label} timed out; last poll=${JSON.stringify(payload)}`);
}

// 1. Model matrix: every registered model launches and pings -> pongs.
for (const { provider, model, effort } of MODEL_MATRIX) {
  await test(`model ${model} (${provider}) launches at ${effort} effort and ping->pong`, async () => {
    const { tempRoot, workDir, env } = makeTempEnv();
    const session = createMcpSession(distIndex, { cwd: workDir, env });
    try {
      await session.initialize();
      await enableManualSelection(session);
      const payload = await launch(session, {
        task_category: "coding",
        provider,
        model,
        effort,
        prompt: "ping",
      });
      assert.equal(payload.provider, provider, "launch payload provider must match requested");
      assert.equal(payload.model, model, "launch payload model must echo the requested launch id");
      assert.ok(payload.agent_id, "launch must return an agent_id");

      // The launch prompt is the first turn; the mock answers ack:ping (pong).
      await waitForOutput(session, payload.agent_id, "ping", `${model} ping->pong`);

      await callTool(session, "kill_agent", { agent_id: payload.agent_id });
    } finally {
      await session.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

// 2. Per-provider: send_message mid-session, then force-terminate.
for (const { provider, model, effort } of [
  { provider: "claude", model: "sonnet", effort: "medium" },
  { provider: "codex", model: "gpt-5.5", effort: "medium" },
]) {
  await test(`${provider}: send_message mid-session then kill_agent force-terminates`, async () => {
    const { tempRoot, workDir, env } = makeTempEnv();
    const session = createMcpSession(distIndex, { cwd: workDir, env });
    try {
      await session.initialize();
      await enableManualSelection(session);
      const payload = await launch(session, {
        task_category: "coding",
        provider,
        model,
        effort,
        prompt: "first",
      });
      const agentId = payload.agent_id;
      await waitForOutput(session, agentId, "first", `${provider} initial turn`);

      // send_message on the live interactive session — accepted by the driver.
      const sendResult = await callTool(session, "send_message", {
        agent_id: agentId,
        message: "second",
      });
      assert.notEqual(sendResult.isError, true, `send_message failed: ${sendResult.content[0].text}`);
      const sendPayload = JSON.parse(sendResult.content[0].text);
      assert.equal(sendPayload.status, "sent", "send_message must report status sent on a live session");
      await waitForOutput(session, agentId, "ack:second", `${provider} second turn`);

      // Force-terminate.
      const killResult = await callTool(session, "kill_agent", { agent_id: agentId });
      assert.notEqual(killResult.isError, true, `kill_agent failed: ${killResult.content[0].text}`);
      assert.equal(JSON.parse(killResult.content[0].text).status, "stopped", "kill must report stopped");

      // wait must observe the agent as terminal.
      const waitResult = await callTool(session, "wait", {});
      const waitPayload = JSON.parse(waitResult.content[0].text);
      assert.ok(
        Array.isArray(waitPayload.finished) && waitPayload.finished.some((a) => a.id === agentId),
        `wait after kill must observe ${agentId} terminal: ${waitResult.content[0].text}`
      );

      // send_message after termination must be rejected loudly.
      const afterKill = await callTool(session, "send_message", { agent_id: agentId, message: "late" });
      assert.equal(afterKill.isError, true, "send_message after kill must be an error");
    } finally {
      await session.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
