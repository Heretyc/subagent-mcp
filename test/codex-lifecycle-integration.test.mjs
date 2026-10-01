/**
 * Codex lifecycle MCP integration regression (public entrypoint coverage).
 *
 * Covers the real CodexAppServerDriver corrective race, approval, liveness, and
 * current-turn output composition through src/index.ts's public MCP tools. The
 * test drives the driver against the fake Codex app-server race and approval
 * pattern through the compiled dist/index.js stdio MCP surface.
 *
 * Seam (test-only, no production hook, no compiler, cross-platform): a TEST-ONLY
 * ESM preload is passed via --import ONLY to the owned MCP child's NODE_OPTIONS.
 * It monkeypatches child_process.spawn to redirect the single Codex `app-server
 * --stdio` spawn to `process.execPath` + the fake fixture (all other spawns and
 * args forwarded unchanged), then syncBuiltinESMExports() so dist/drivers.js's
 * `import { spawn }` binding sees the patch before it loads. The fixture node
 * process IS the direct child CodexAppServerDriver holds, so child.kill() reaps
 * it with no orphan. Existing dist is treated as the frozen runtime candidate
 * (no build).
 *
 * Flow: finish turn A -> send turn B -> fixture injects stale + missing-id
 * completions and parks B on a Bash approval -> assert poll_agent / list_agents
 * / wait status + liveness + non-commentary current-turn output -> respond to the
 * permission -> assert only B finishes and verbose poll returns B's real final.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = join(repoRoot, "dist", "index.js");
const rulesetPreload = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e && e.stack ? e.stack : e}`);
    failed++;
  }
}

function withTimeout(promise, ms, label, getDetails) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.${getDetails ? " " + getDetails() : ""}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The fake Codex app-server (FOLLOWUP_RACE): identical message choreography to
// test/drivers.test.mjs's writeFakeAppServer, plus a PID file, a sent-event log,
// and a stdin-EOF exit so the owned child reaps cleanly on Windows.
function writeFixture(dir) {
  const script = join(dir, "fake-codex-app-server.mjs");
  const body = [
    'import fs from "node:fs";',
    'import readline from "node:readline";',
    "const NL = String.fromCharCode(10);",
    "const events = process.env.FAKE_CODEX_EVENTS;",
    'const followupRace = process.env.FOLLOWUP_RACE === "1";',
    "if (process.env.FAKE_CODEX_PID_FILE) fs.writeFileSync(process.env.FAKE_CODEX_PID_FILE, String(process.pid));",
    "let turn = 0;",
    "function send(obj) { process.stdout.write(JSON.stringify(obj) + NL); }",
    "function ev(name) { if (events) fs.appendFileSync(events, name + NL); }",
    "const rl = readline.createInterface({ input: process.stdin });",
    'rl.on("close", () => process.exit(0));',
    'rl.on("line", (line) => {',
    "  if (!line.trim()) return;",
    "  let msg; try { msg = JSON.parse(line); } catch { return; }",
    "  if (followupRace && msg.id === 701 && msg.result) {",
    '    send({ method: "item/completed", params: { turnId: "turn-2", item: { type: "agentMessage", text: "actual B final", phase: "final_answer" } } });',
    '    send({ method: "turn/completed", params: { turn: { id: "turn-2", items: [] } } });',
    '    send({ method: "turn/completed", params: { turn: { id: "turn-1", items: [] } } });',
    '    send({ method: "turn/completed", params: { turn: { items: [] } } });',
    '    send({ method: "test/postBInvalidCompletionsSent" });',
    '    ev("postBInvalidCompletionsSent");',
    "    return;",
    "  }",
    '  if (msg.method === "initialize") { send({ id: msg.id, result: { protocolVersion: "test" } }); return; }',
    '  if (msg.method === "initialized") return;',
    '  if (msg.method === "thread/start") {',
    '    send({ id: msg.id, result: { thread: { id: "thread-1" } } });',
    '    send({ method: "thread/started", params: { thread: { id: "thread-1" } } });',
    "    return;",
    "  }",
    '  if (msg.method === "turn/start") {',
    "    turn += 1;",
    '    const turnId = "turn-" + turn;',
    '    const text = (msg.params && msg.params.input && msg.params.input[0] && msg.params.input[0].text) || "";',
    "    if (followupRace && turn === 2) {",
    '      send({ method: "turn/completed", params: { turn: { id: "turn-1", items: [] } } });',
    '      send({ method: "turn/completed", params: { turn: { items: [] } } });',
    '      send({ method: "test/preIdInvalidCompletionsSent" });',
    '      ev("preIdInvalidCompletionsSent");',
    "    }",
    '    send({ id: msg.id, result: { turn: { id: turnId } } });',
    '    send({ method: "turn/started", params: { turn: { id: turnId } } });',
    "    if (followupRace && turn === 2) {",
    '      send({ method: "item/completed", params: { turnId, item: { type: "agentMessage", text: "B commentary", phase: "commentary" } } });',
    '      send({ id: 701, method: "execCommandApproval", params: { turnId, command: "echo guarded" } });',
    '      ev("approvalRequested");',
    "      setTimeout(() => {",
    '        send({ method: "turn/completed", params: { turn: { id: "turn-1", items: [] } } });',
    '        send({ method: "turn/completed", params: { turn: { items: [] } } });',
    '        send({ method: "test/lateCompletionSent" });',
    '        ev("lateCompletionSent");',
    "      }, 25);",
    "      return;",
    "    }",
    '    send({ method: "item/agentMessage/delta", params: { delta: "ack:" + text } });',
    "    setTimeout(() => {",
    '      send({ method: "turn/completed", params: { turn: { id: turnId, items: [{ type: "agentMessage", text: "done:" + text }] } } });',
    "    }, 0);",
    "  }",
    "});",
    "",
  ].join("\n");
  writeFileSync(script, body, "utf8");
  return script;
}

// Test-only --import preload: redirect ONLY the codex app-server spawn.
function writePreload(dir) {
  const script = join(dir, "codex-spawn-preload.mjs");
  const body = [
    'import { syncBuiltinESMExports } from "node:module";',
    'import cp from "node:child_process";',
    "const realSpawn = cp.spawn;",
    "cp.spawn = function (command, args, options) {",
    "  const argv = Array.isArray(args) ? args : [];",
    '  if (argv.includes("app-server") && argv.includes("--stdio")) {',
    "    const fixture = process.env.FAKE_CODEX_FIXTURE;",
    "    const baseEnv = options && options.env ? options.env : process.env;",
    "    const extra = {",
    '      FAKE_CODEX_EVENTS: process.env.FAKE_CODEX_EVENTS || "",',
    '      FOLLOWUP_RACE: process.env.FAKE_CODEX_FOLLOWUP_RACE || "",',
    '      FAKE_CODEX_PID_FILE: process.env.FAKE_CODEX_PID_FILE || "",',
    '      NODE_OPTIONS: "",',
    "    };",
    "    const nextOptions = Object.assign({}, options || {}, { env: Object.assign({}, baseEnv, extra) });",
    "    return realSpawn(process.execPath, [fixture], nextOptions);",
    "  }",
    "  return realSpawn(command, args, options);",
    "};",
    "syncBuiltinESMExports();",
    "",
  ].join("\n");
  writeFileSync(script, body, "utf8");
  return script;
}

function makeTempEnv() {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-codex-integ-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const homeDir = join(tempRoot, "home");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(homeDir);
  mkdirSync(fakePrefix);
  mkdirSync(join(workDir, ".claude"), { recursive: true });
  // Force the Codex Bash approval to PARK (non-yolo ceiling asks on Bash).
  writeFileSync(join(workDir, ".claude", "settings.json"), JSON.stringify({ permissions: { ask: ["Bash"] } }));

  // Fake `npm` so getNpmPrefix()'s `npm prefix -g` yields an empty prefix (so
  // resolveExe falls back to the bare "codex" name, which our preload intercepts).
  if (process.platform === "win32") {
    writeFileSync(join(fakeBin, "npm.cmd"), "@echo off\r\necho %FAKE_NPM_PREFIX%\r\n");
  } else {
    const npmPath = join(fakeBin, "npm");
    writeFileSync(npmPath, '#!/bin/sh\nprintf "%s\\n" "$FAKE_NPM_PREFIX"\n');
    chmodSync(npmPath, 0o755);
  }

  const modeFile = join(tempRoot, "ruleset-mode.txt");
  writeFileSync(modeFile, "ok-disabled");
  const fixture = writeFixture(tempRoot);
  const preload = writePreload(tempRoot);
  const eventsFile = join(tempRoot, "fixture-events.log");
  writeFileSync(eventsFile, "");
  const pidFile = join(tempRoot, "fixture.pid");

  const env = { ...process.env };
  // The spawned MCP server must be a PARENT orchestrator (respond_permission is
  // gated off for subagents); our own process carries the subagent marker.
  delete env.SUBAGENT_MCP_SUBAGENT;
  delete env.SUBAGENT_MCP_DEPTH;
  env.USERPROFILE = homeDir;
  env.HOME = homeDir;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
  env[pathKey] = `${fakeBin}${delimiter}${env[pathKey] || ""}`;
  if (process.platform === "win32") env.PATHEXT = env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  env.FAKE_NPM_PREFIX = fakePrefix;
  env.SUBAGENT_SPAWN_GRACE_MS = "0";
  env.SUBAGENT_RULESET_PYTHON = process.execPath;
  env.FAKE_RULESET_MODE_FILE = modeFile;
  env.SUBAGENT_MCP_ENABLE_TEST_SEAMS = "1";
  env.FAKE_CODEX_FIXTURE = fixture;
  env.FAKE_CODEX_EVENTS = eventsFile;
  env.FAKE_CODEX_FOLLOWUP_RACE = "1";
  env.FAKE_CODEX_PID_FILE = pidFile;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require "${rulesetPreload.replace(/\\/g, "/")}"`, `--import "${pathToFileURL(preload).href}"`]
    .filter(Boolean)
    .join(" ");
  return { tempRoot, workDir, env, eventsFile, pidFile };
}

function createMcpSession(entrypoint, options = {}) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const closed = new Promise((resolveClose) => child.once("close", resolveClose));
  let nextId = 1;
  let stdout = "";
  let stderr = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    while (true) {
      const nl = stdout.indexOf("\n");
      if (nl === -1) break;
      const line = stdout.slice(0, nl).replace(/\r$/, "");
      stdout = stdout.slice(nl + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("exit", (code, signal) => {
    for (const { reject } of pending.values()) reject(new Error(`server exited (code=${code}, signal=${signal}) stderr=${stderr}`));
    pending.clear();
  });
  function request(method, params) {
    const id = nextId++;
    const response = new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return withTimeout(response, 12000, `${method} response`, () => `stderr=${stderr.slice(-800)}`);
  }
  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
  async function initialize() {
    const r = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "codex-integ-test", version: "0.0.0" } });
    notify("notifications/initialized");
    return r;
  }
  async function close() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await withTimeout(closed, 3000, "server close", () => `stderr=${stderr.slice(-400)}`);
  }
  return { request, initialize, close, stderrTail: () => stderr };
}

async function callTool(session, name, args) {
  const r = await session.request("tools/call", { name, arguments: args });
  return r.result;
}
async function launch(session, args) {
  const r = await callTool(session, "launch_agent", args);
  const text = r.content[0].text;
  assert.notEqual(r.isError, true, `launch failed: ${text}`);
  return JSON.parse(text);
}
async function poll(session, agentId, verbose = true) {
  const r = await callTool(session, "poll_agent", { agent_id: agentId, verbose });
  return JSON.parse(r.content[0].text);
}
async function pollUntil(session, agentId, predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await poll(session, agentId);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`${label} timed out; last poll=${JSON.stringify(last)}`);
}
async function waitForEvent(eventsFile, name, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readFileSync(eventsFile, "utf8").includes(name)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`fixture event "${name}" not observed within ${timeoutMs}ms`);
}
async function ensureFixtureReaped(pidFile, timeoutMs = 4000) {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (e) { if (e && e.code === "ESRCH") return true; }
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

await test("Codex corrective race/approval/liveness composes through dist/index.js MCP handlers", async () => {
  const { tempRoot, workDir, env, eventsFile, pidFile } = makeTempEnv();
  const session = createMcpSession(distIndex, { cwd: workDir, env });
  let agentId;
  let failure;
  try {
    await session.initialize();
    const sel = await callTool(session, "model-selection-mode", { mode: "user-approved-overrides" });
    assert.notEqual(sel.isError, true, `model-selection-mode failed: ${sel.content[0].text}`);

    // Turn A launches the real CodexAppServerDriver redirected to the fixture.
    const payload = await launch(session, {
      task_category: "coding",
      provider: "codex",
      model: "gpt-5.5",
      effort: "medium",
      cwd: workDir,
      prompt: "first",
    });
    agentId = payload.agent_id;
    assert.equal(payload.provider, "codex", "launch must report codex provider");
    // launch_agent upserts the parent-process marker as prompt line 1, so the
    // echoed turn text is "done:<marker>\nfirst"; key on the turn-finished state
    // plus the "done:" completion prefix rather than a contiguous prompt echo.
    const afterA = await pollUntil(
      session,
      agentId,
      (p) => p.status === "finished" && JSON.stringify(p.final_output ?? "").includes("done:"),
      "turn A completion"
    );
    assert.ok(JSON.stringify(afterA.final_output ?? "").includes("done:"), "turn A final must surface through poll_agent");

    // Turn B injects stale and missing-id completions, then parks on approval.
    const send = await callTool(session, "send_message", { agent_id: agentId, message: "second" });
    assert.notEqual(send.isError, true, `send_message failed: ${send.content[0].text}`);

    const parked = await pollUntil(
      session,
      agentId,
      (p) => p.status === "permission_requested" && Array.isArray(p.pending_permissions) && p.pending_permissions.length >= 1,
      "turn B parks on permission_requested"
    );
    // Stale + missing-id completions were injected before/at the park.
    await waitForEvent(eventsFile, "preIdInvalidCompletionsSent");
    const stillParked = await pollUntil(
      session,
      agentId,
      (p) => (p.stdout_tail ?? "").includes("test/lateCompletionSent"),
      "late stale completion marker"
    );

    // poll_agent: status + liveness + non-commentary current-turn output.
    assert.equal(stillParked.status, "permission_requested", "stale/missing-id completions must not finish parked B");
    assert.equal(stillParked.alive, true, "liveness must stay truthful (alive) while parked on approval");
    assert.ok(stillParked.pending_permissions.length >= 1, "pending_permissions must surface the parked request");
    const parkedFinal = JSON.stringify(stillParked.final_output ?? "");
    assert.ok(!parkedFinal.includes("done:"), "turn A output must not leak while B is parked");
    assert.ok(!parkedFinal.includes("B commentary"), "commentary phase must be excluded from current-turn output");
    assert.ok(!parkedFinal.includes("actual B final"), "B's real final must not leak before approval resolves");

    // list_agents: status + liveness surfaced for the parked agent.
    const listRes = await callTool(session, "list_agents", {});
    const listed = JSON.parse(listRes.content[0].text).agents.find((a) => a.id === agentId);
    assert.ok(listed, "list_agents must include the agent");
    assert.equal(listed.status, "permission_requested", "list_agents status must be permission_requested");
    assert.equal(listed.alive, true, "list_agents liveness must be truthful (alive)");
    assert.ok(listed.pending_permission_count >= 1, "list_agents must report the pending permission count");

    // wait: reports B as permission_requested (non-yolo), never as finished.
    const waitRes = await callTool(session, "wait", { verbose: true });
    const waitPayload = JSON.parse(waitRes.content[0].text);
    const inFinished = (waitPayload.finished || []).some((a) => a.id === agentId);
    const inPermission = (waitPayload.permission_requested || []).some((a) => a.id === agentId && a.status === "permission_requested");
    assert.ok(!inFinished, `wait must NOT report parked B as finished: ${waitRes.content[0].text}`);
    assert.ok(inPermission, `wait must report B as permission_requested: ${waitRes.content[0].text}`);

    // Resolve the permission. Only B's real final may appear.
    const respond = await callTool(session, "respond_permission", { agent_id: agentId, decision: "allow", reason: "integration approval" });
    assert.notEqual(respond.isError, true, `respond_permission failed: ${respond.content[0].text}`);
    assert.equal(JSON.parse(respond.content[0].text).decision, "allow", "respond_permission must record the allow decision");

    const finishedPoll = await pollUntil(
      session,
      agentId,
      (p) => p.status === "finished" && JSON.stringify(p.final_output ?? "").includes("actual B final"),
      "B final after approval"
    );
    assert.equal(finishedPoll.status, "finished", "B must finish after approval");
    await pollUntil(
      session,
      agentId,
      (p) => (p.stdout_tail ?? "").includes("test/postBInvalidCompletionsSent"),
      "post-B invalid completion marker"
    );
    const finalPoll = await poll(session, agentId);
    assert.equal(finalPoll.status, "finished", "post-B invalid completions must not change finished status");
    const finalOutput = String(finalPoll.final_output ?? "");
    assert.deepEqual(finalOutput.split("\n").slice(1, -1), ["actual B final"], "verbose poll must return exactly B's real final");
    const finalStr = JSON.stringify(finalOutput);
    assert.ok(!finalStr.includes("B commentary"), "commentary must never become the final output");
    assert.ok(!finalStr.includes("done:"), "turn A output (done:...) must not leak as turn B's final");

    await callTool(session, "kill_agent", { agent_id: agentId }).catch(() => {});
  } catch (error) {
    failure = error;
  } finally {
    try {
      await session.close();
    } catch (error) {
      failure ??= error;
    }
    try {
      assert.equal(await ensureFixtureReaped(pidFile), true, "owned provider child must exit");
    } catch (error) {
      failure ??= error;
    }
    // Windows releases file/cwd handles asynchronously after the owned children
    // exit; retry removal, but a lingering-handle EPERM is an environment
    // artifact (all assertions already ran) and must never fail this regression.
    for (let i = 0; i < 30; i++) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
  if (failure) throw failure;
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
