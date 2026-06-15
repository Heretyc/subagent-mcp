/**
 * fake-ruleset-preload.cjs — NODE_OPTIONS --require shim that turns a plain
 * node binary into (a) a fake advanced-ruleset.py interpreter and (b) fake
 * claude/codex CLI behavior variants, with ZERO production test seams.
 *
 * Roles (checked in order; anything else is a strict no-op, so the MCP server
 * child and the legacy fake CLIs behave exactly as before):
 *
 * 1. Fake python interpreter — tests set SUBAGENT_RULESET_PYTHON=node; the
 *    server then spawns node with the scaffold path as argv[1]. When argv[1]
 *    ends with ".py" this shim impersonates the script and process.exit()s
 *    BEFORE node ever tries to parse the .py as JavaScript. Behavior is driven
 *    by the FILE named in FAKE_RULESET_MODE_FILE — a file rather than an env
 *    var so a single MCP session can flip behavior between launch_agent calls
 *    (that is what proves the gate's failure paths never latch). Every
 *    execution appends "env-check" or "route" to FAKE_RULESET_LOG when set;
 *    route mode also mirrors the raw stdin payload to
 *    FAKE_RULESET_STDIN_CAPTURE when set.
 *
 * 2. Fake CLI variants — when basename(process.execPath) is claude(.exe) or
 *    codex(.exe) (the node-copy PATH fixtures), FAKE_CLI_CLAUDE_MODE /
 *    FAKE_CLI_CODEX_MODE select "die" (exit 1 instantly) or "stall" (stay
 *    alive ~30s, then exit) so the post-spawn grace window has deterministic
 *    victims and survivors. NOTE: on win32 the claude fixture never reaches
 *    this shim — node rejects the claude-style argv ("--model") as a bad
 *    option and exits (code 9) before preloads run — which is itself a
 *    perfect spawn-then-instant-death specimen. With neither mode var set the
 *    shim falls through to node's legacy behavior (instant bad-option /
 *    module-not-found death), keeping the pre-feature fixtures intact.
 *
 * All stdout goes through fs.writeSync(1, ...): pipe stdout is asynchronous on
 * Windows, so a stream write followed by process.exit() could be truncated.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function emit(text, code) {
  fs.writeSync(1, text);
  process.exit(code);
}

function sleepBlocking(ms) {
  // Atomics.wait is permitted on the node main thread; it blocks without
  // needing a live event loop (process.kill from the server still works).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const argv1 = process.argv[1] || "";

if (argv1.toLowerCase().endsWith(".py")) {
  // --- Role 1: fake advanced-ruleset.py interpreter -------------------------
  const modeFile = process.env.FAKE_RULESET_MODE_FILE;
  const mode = modeFile ? fs.readFileSync(modeFile, "utf8").trim() : "ok-disabled";
  const isRoute = process.argv[2] === "route";

  if (process.env.FAKE_RULESET_LOG) {
    fs.appendFileSync(process.env.FAKE_RULESET_LOG, `${isRoute ? "route" : "env-check"}\n`);
  }

  // Failure modes that apply identically to both invocation modes.
  if (mode === "exit1") {
    fs.writeSync(2, "fake ruleset: deliberate exit 1\n");
    process.exit(1);
  }
  if (mode === "invalid-json") emit("this is not json {{{", 0);
  if (mode === "sleep") {
    sleepBlocking(30000);
    process.exit(0);
  }

  if (!isRoute) {
    // Env-check mode: {"ready": bool, "load-rules": bool} (hyphenated key).
    if (mode === "ready-false") emit(JSON.stringify({ ready: false, "load-rules": true }), 0);
    emit(JSON.stringify({ ready: true, "load-rules": mode !== "ok-disabled" }), 0);
  }

  // Routing mode: the server writes the payload to stdin and ends the stream.
  const raw = fs.readFileSync(0, "utf8");
  if (process.env.FAKE_RULESET_STDIN_CAPTURE) {
    fs.writeFileSync(process.env.FAKE_RULESET_STDIN_CAPTURE, raw);
  }
  const candidates = (JSON.parse(raw).candidates) || [];
  if (mode === "empty") emit("[]", 0);
  if (mode === "bad-model") {
    emit(JSON.stringify([{ provider: "claude", model: "banana", effort: "high" }]), 0);
  }
  if (mode === "ok-enabled-replace") {
    // Replaces whatever came in (incl. an explicit single-candidate list) with
    // a fixed, distinct, launchable triple.
    emit(JSON.stringify([{ provider: "claude", model: "opus", effort: "medium", rank: 1 }]), 0);
  }
  if (mode === "ok-enabled-reorder") emit(JSON.stringify([...candidates].reverse()), 0);
  // ok-enabled-passthrough (and any other ok-*): echo unchanged.
  emit(JSON.stringify(candidates), 0);
}

// --- Role 2: fake CLI variants (node copies named claude/codex) --------------
const exe = path.basename(process.execPath).toLowerCase();
if (exe === "claude" || exe === "claude.exe" || exe === "codex" || exe === "codex.exe") {
  const mode = exe.startsWith("claude")
    ? process.env.FAKE_CLI_CLAUDE_MODE
    : process.env.FAKE_CLI_CODEX_MODE;
  if (mode === "die") {
    fs.writeSync(2, `fake ${exe}: deliberate instant death\n`);
    process.exit(1);
  }
  if (mode === "stall") {
    sleepBlocking(30000);
    process.exit(0);
  }
  // No mode set: fall through to legacy node behavior (instant death).
}
