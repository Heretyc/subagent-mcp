import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  ClaudeSdkDriver,
  CodexAppServerDriver,
} from "../dist/drivers.js";

const repo = new URL("..", import.meta.url);

function collect(stream) {
  let text = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    text += chunk;
  });
  return () => text;
}

async function waitFor(predicate, label, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function permissionSnapshot(overrides = {}) {
  return {
    ceiling: "auto",
    escalation: "irreversible-only",
    rules: { allow: [], deny: [], ask: [] },
    additionalDirectories: [],
    repoConfigChangedSinceFirstSeen: false,
    ...overrides,
  };
}

function options(provider, overrides = {}) {
  return {
    provider,
    command: provider,
    args: [],
    cwd: process.cwd(),
    env: process.env,
    model: provider === "claude" ? "sonnet" : "gpt-5.5",
    effort: "high",
    agentId: "driver-guard-agent",
    permissionSnapshot: permissionSnapshot(),
    ...overrides,
  };
}

function writeApprovalServer(tempRoot, logFile) {
  const script = join(tempRoot, "approval-server.mjs");
  writeFileSync(
    script,
    `
import fs from "node:fs";
import readline from "node:readline";

const logFile = process.env.APP_SERVER_LOG;
let turn = 0;
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }
function log(obj) { fs.appendFileSync(logFile, JSON.stringify(obj) + "\\n"); }

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  log(msg);
  if (msg.method === "initialize") return send({ id: msg.id, result: { protocolVersion: "test" } });
  if (msg.method === "initialized") return;
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: "thread-1" } } });
    send({ method: "thread/started", params: { thread: { id: "thread-1" } } });
    return;
  }
  if (msg.method === "turn/start") {
    turn += 1;
    const turnId = "turn-" + turn;
    send({ id: msg.id, result: { turn: { id: turnId } } });
    send({ method: "turn/started", params: { turn: { id: turnId } } });
    send({ id: 101, method: "execCommandApproval", params: { command: "rm guarded-a" } });
    send({ id: 102, method: "execCommandApproval", params: { command: "rm guarded-b" } });
    return;
  }
  if (msg.id === 101 && msg.result) send({ method: "item/agentMessage/delta", params: { delta: "reply101" } });
  if (msg.id === 102 && msg.result) {
    send({ method: "item/agentMessage/delta", params: { delta: "reply102" } });
    send({ method: "turn/completed", params: { turn: { id: "turn-1" } } });
  }
});
`,
    "utf8"
  );
  writeFileSync(logFile, "");
  return script;
}

function spawnServer(script, logFile) {
  return spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, APP_SERVER_LOG: logFile },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function testCodexApprovalRepliesByJsonRpcId() {
  const tempRoot = mkdtempSync(join(tmpdir(), "drivers-guard-codex-"));
  try {
    const logFile = join(tempRoot, "app-server.log");
    const script = writeApprovalServer(tempRoot, logFile);
    const child = spawnServer(script, logFile);
    const driver = new CodexAppServerDriver(
      child,
      options("codex", {
        permissionSnapshot: permissionSnapshot({
          rules: { allow: [], deny: ["Bash"], ask: [] },
        }),
      })
    );
    const stdout = collect(driver.process.stdout);
    await once(driver.process, "spawn");
    await driver.start("first");
    await waitFor(() => stdout().includes("reply102"), "both approval replies");

    const replies = readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((msg) => msg.result && (msg.id === 101 || msg.id === 102));
    assert.deepEqual(
      replies.map((msg) => [msg.id, msg.result]),
      [
        [101, { decision: "denied" }],
        [102, { decision: "denied" }],
      ],
      "Codex approvals should be tracked and answered independently by JSON-RPC id"
    );
    driver.kill();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testClaudePreToolUseAndCanUseToolShareGateBehavior() {
  let sdkOptions;
  async function* query(params) {
    sdkOptions = params.options;
    for await (const msg of params.prompt) {
      yield { type: "assistant", message: { content: [{ type: "text", text: msg.message.content }] } };
    }
  }

  const driver = new ClaudeSdkDriver(query);
  driver.open(options("claude", {
    permissionSnapshot: permissionSnapshot({
      rules: { allow: [], deny: ["Bash"], ask: [] },
    }),
  }));
  await once(driver.process, "spawn");
  await driver.start("first");
  await waitFor(() => sdkOptions !== undefined, "Claude SDK options");

  const request = {
    tool_name: "Bash",
    tool_input: { command: "rm guarded" },
    tool_use_id: "tool-1",
  };
  const canUseTool = await sdkOptions.canUseTool(request);
  assert.equal(canUseTool.behavior, "deny");

  const hook = sdkOptions.hooks.PreToolUse[0].hooks[0];
  const hookResult = await hook(request);
  assert.deepEqual(hookResult.hookSpecificOutput, {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: canUseTool.message,
  });
  driver.kill();

  let yoloOptions;
  async function* yoloQuery(params) {
    yoloOptions = params.options;
    for await (const _msg of params.prompt) {
      yield { type: "result", result: "ok" };
    }
  }
  const yolo = new ClaudeSdkDriver(yoloQuery);
  yolo.open(options("claude", {
    permissionSnapshot: permissionSnapshot({
      ceiling: "yolo",
      rules: { allow: [], deny: ["Bash"], ask: [] },
    }),
  }));
  await once(yolo.process, "spawn");
  await yolo.start("first");
  await waitFor(() => yoloOptions !== undefined, "yolo Claude SDK options");
  assert.equal(yoloOptions.hooks, undefined, "yolo launches should stay hook-free");
  yolo.kill();
}

async function testClaudeNotifyTaskCompleteDebouncesResumeTurns() {
  const seen = [];
  async function* query(params) {
    for await (const msg of params.prompt) {
      seen.push(msg.message.content);
      if (seen.length === 1) {
        yield { type: "assistant", message: { content: [{ type: "text", text: "started" }] } };
      }
    }
  }

  const driver = new ClaudeSdkDriver(query);
  driver.open(options("claude"));
  await once(driver.process, "spawn");
  await driver.start("first");
  await waitFor(() => seen.length === 1, "initial Claude turn");
  await driver.notifyTaskComplete("resume once");
  await driver.notifyTaskComplete("resume twice");
  await waitFor(() => seen.length === 2, "first resume turn");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(seen, ["first", "resume once"]);
  driver.kill();
}

function assertPrivateTextualContracts() {
  const source = readFileSync(new URL("src/drivers.ts", repo), "utf8");
  assert.match(source, /maxPendingApprovals\s*=\s*16/, "pending approval cap is private; keep semantic source guard");
  assert.doesNotMatch(source, /pendingServerRequest/, "deleted single-slot pendingServerRequest must not return");
}

try {
  await testCodexApprovalRepliesByJsonRpcId();
  await testClaudePreToolUseAndCanUseToolShareGateBehavior();
  await testClaudeNotifyTaskCompleteDebouncesResumeTurns();
  assertPrivateTextualContracts();
  console.log("drivers-guard: OK (behavioral LB-2/LB-3/permission-gate guards plus private cap text guard)");
} catch (error) {
  console.error(error);
  process.exit(1);
}
