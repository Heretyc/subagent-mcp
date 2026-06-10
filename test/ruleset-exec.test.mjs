/**
 * Execution-layer tests for dist/ruleset.js — real child-process plumbing,
 * no MCP server.
 *
 * The interpreter is faked with zero production seams: SUBAGENT_RULESET_PYTHON
 * is set to node itself and NODE_OPTIONS preloads
 * test/fixtures/fake-ruleset-preload.cjs, which impersonates the .py script
 * (behavior driven by a mode FILE) and exits before node parses the .py.
 * This proves the real spawn / stdin / stdout / timeout / kill path works,
 * not just the injected-exec state machine covered by ruleset.test.mjs.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Import from compiled output — the run order is: build, then test.
import { createRulesetGate, ensureScaffold } from "../dist/ruleset.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "dist", "advanced-ruleset.py");
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

// The gate spawns its children with the CURRENT process env, so installing the
// fake-interpreter preload here makes every gate-spawned node child act as the
// fake advanced-ruleset.py. Real pythons (smoke test below) ignore NODE_OPTIONS.
// Forward slashes: node's NODE_OPTIONS parser treats backslash as an escape
// inside double quotes, which would mangle a win32 path.
const tempRoot = mkdtempSync(join(tmpdir(), "subagent-ruleset-exec-"));
const modeFile = join(tempRoot, "ruleset-mode.txt");
const logFile = join(tempRoot, "ruleset-log.txt");
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require "${preloadPath.replace(/\\/g, "/")}"`]
  .filter(Boolean)
  .join(" ");
process.env.FAKE_RULESET_MODE_FILE = modeFile;
process.env.FAKE_RULESET_LOG = logFile;

// Gate env only feeds interpreterCandidates — node IS the (fake) interpreter.
const fakeInterpreterEnv = { SUBAGENT_RULESET_PYTHON: process.execPath };

function setMode(mode) {
  writeFileSync(modeFile, mode);
}

function resetLog() {
  writeFileSync(logFile, "");
}

function logLines() {
  return readFileSync(logFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 1. Env-check JSON round-trip through a real child process, and the latch
//    observed at the spawn level (exactly one execution).
//    WHY: this is the no-arg contract end to end — spawn, closed stdin, JSON
//    on stdout, hyphenated load-rules key parsed.
// ---------------------------------------------------------------------------
await test("env-check round-trip: ok-disabled → {ok, active:false}; latch = exactly 1 spawn", async () => {
  setMode("ok-disabled");
  resetLog();
  const gate = createRulesetGate({ scriptPath, env: fakeInterpreterEnv });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false });
  assert.deepEqual(logLines(), ["env-check"],
    "success must latch: the second ensureReady may not spawn the interpreter again");
});

// ---------------------------------------------------------------------------
// 2. Routing mode: the stdin payload must arrive at the script byte-intact and
//    the validated output must round-trip back.
//    WHY: the script's whole authority rests on seeing the exact candidate
//    list + context the server built — any mangling breaks the contract.
// ---------------------------------------------------------------------------
await test("routing mode: stdin payload delivered intact; passthrough output validated back", async () => {
  setMode("ok-enabled-passthrough");
  resetLog();
  const captureFile = join(tempRoot, "stdin-capture.json");
  process.env.FAKE_RULESET_STDIN_CAPTURE = captureFile;
  try {
    const gate = createRulesetGate({ scriptPath, env: fakeInterpreterEnv });
    assert.deepEqual(await gate.ensureReady(), { ok: true, active: true });

    const payload = {
      candidates: [
        { provider: "claude", model: "sonnet", effort: "medium", rank: 1 },
        { provider: "codex", model: "gpt-5.5", effort: "xhigh", rank: 2 },
      ],
      context: {
        task_category: "coding",
        cwd: join(tempRoot, "some-cwd"),
        selection_mode: "auto",
        provider: null,
        model: null,
        effort: null,
      },
    };
    const applied = await gate.applyRules(payload);
    assert.equal(applied.ok, true);
    assert.deepEqual(applied.candidates, [
      { provider: "claude", model: "sonnet", effort: "medium" },
      { provider: "codex", model: "gpt-5.5", effort: "xhigh" },
    ], "passthrough must return the same triples (rank stripped by validation)");

    assert.deepEqual(JSON.parse(readFileSync(captureFile, "utf8")), payload,
      "the script must receive the exact stdin payload the server serialized");
    assert.deepEqual(logLines(), ["env-check", "route"],
      "one env-check then one route execution — routing is never re-run per call");
  } finally {
    delete process.env.FAKE_RULESET_STDIN_CAPTURE;
  }
});

// ---------------------------------------------------------------------------
// 3. Timeout: a hung script is killed and reported as failure — without
//    waiting the production 2 minutes (injected timeoutMs seam) — and the
//    failure does not latch.
//    WHY: the timeout is part of the hard-fail contract; the kill must settle
//    the promise promptly or every launch_agent would hang with it.
// ---------------------------------------------------------------------------
await test("timeout: hung env-check killed at injected 500ms; failure does not latch", async () => {
  setMode("sleep");
  const gate = createRulesetGate({ scriptPath, env: fakeInterpreterEnv, timeoutMs: 500 });
  const t0 = Date.now();
  assert.deepEqual(await gate.ensureReady(), { ok: false }, "a hung script is a ruleset failure");
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 10000,
    `the child must be killed at the timeout, not awaited to natural exit (took ${elapsed}ms)`);
  assert.ok(elapsed >= 450, `the timeout must actually elapse (took ${elapsed}ms)`);

  setMode("ok-disabled");
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false },
    "a fixed script must recover on the next call — timeout failures never latch");
});

await test("timeout: hung routing mode killed; enabled latch survives and recovers", async () => {
  setMode("ok-enabled-passthrough");
  resetLog();
  const gate = createRulesetGate({ scriptPath, env: fakeInterpreterEnv, timeoutMs: 500 });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: true });

  const payload = {
    candidates: [{ provider: "claude", model: "haiku", effort: "none", rank: 1 }],
    context: { task_category: "mechanical", cwd: tempRoot, selection_mode: "auto", provider: null, model: null, effort: null },
  };
  setMode("sleep");
  assert.deepEqual(await gate.applyRules(payload), { ok: false }, "hung routing run is a failure");

  setMode("ok-enabled-passthrough");
  const applied = await gate.applyRules(payload);
  assert.equal(applied.ok, true, "routing must recover next call without a restart");
  assert.equal(logLines().filter((l) => l === "env-check").length, 1,
    "the routing-mode timeout must NOT unlatch the enabled state (no env-check re-run)");
});

// ---------------------------------------------------------------------------
// 4. Non-zero exit and invalid JSON through real children.
//    WHY: these are the two most likely real-world user-script bugs; both must
//    be failures (→ hard fail upstream) and both must stay non-latching.
// ---------------------------------------------------------------------------
await test("non-zero exit: failure, then recovery on the same gate (non-latching)", async () => {
  setMode("exit1");
  const gate = createRulesetGate({ scriptPath, env: fakeInterpreterEnv });
  assert.deepEqual(await gate.ensureReady(), { ok: false });
  setMode("ok-enabled-passthrough");
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: true },
    "the same gate instance must recover once the script is fixed");
});

await test("invalid JSON on stdout: failure (env-check shape is strictly parsed)", async () => {
  setMode("invalid-json");
  const gate = createRulesetGate({ scriptPath, env: fakeInterpreterEnv });
  assert.deepEqual(await gate.ensureReady(), { ok: false });
});

// ---------------------------------------------------------------------------
// 5. Missing interpreter: an override pointing at nothing exhausts the
//    (exclusive) walk via the async ENOENT path.
//    WHY: goal lists "missing interpreter" explicitly as a hard-fail flavor;
//    the ENOENT arrives async after spawn() returns, so this exercises the
//    spawn-vs-error race in execRuleset.
// ---------------------------------------------------------------------------
await test("missing interpreter: nonexistent SUBAGENT_RULESET_PYTHON fails the gate", async () => {
  const gate = createRulesetGate({
    scriptPath,
    env: { SUBAGENT_RULESET_PYTHON: join(tempRoot, "definitely-not-a-python") },
  });
  assert.deepEqual(await gate.ensureReady(), { ok: false },
    "an unspawnable exclusive override must surface as a ruleset failure");
});

// ---------------------------------------------------------------------------
// 6. ensureScaffold: recreates a deleted scaffold byte-identically and NEVER
//    touches an existing file.
//    WHY: runtime recreate is the recovery path for a deleted file, but user
//    edits are sacred — an overwrite here would defeat the entire feature.
// ---------------------------------------------------------------------------
await test("ensureScaffold: recreates deleted file byte-identical; never overwrites user edits", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagent-scaffold-"));
  try {
    const p = join(dir, "advanced-ruleset.py");
    ensureScaffold(p);
    const canonical = readFileSync(join(repoRoot, "src", "advanced-ruleset.py"), "utf8");
    assert.equal(readFileSync(p, "utf8"), canonical,
      "a recreated scaffold must be byte-identical to the canonical source");

    writeFileSync(p, "# user edits are sacred\n");
    ensureScaffold(p);
    assert.equal(readFileSync(p, "utf8"), "# user edits are sacred\n",
      "ensureScaffold must be a strict no-op when the file exists");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Conditional real-python smoke test (Rule 12: skipped LOUDLY, never
//    silently). The shipped scaffold under a real interpreter must report
//    {"ready": true, "load-rules": false} — i.e. installed-but-inert.
// ---------------------------------------------------------------------------
function findRealPython() {
  const candidates = process.platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];
  for (const cand of candidates) {
    try {
      const probe = spawnSync(cand, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 15000 });
      if (probe.status === 0) return cand;
    } catch {
      // not present/runnable — try the next
    }
  }
  return null;
}

const realPython = findRealPython();
if (realPython === null) {
  console.log("  SKIP: real-python smoke test — no python interpreter found on PATH (install py/python3/python to cover it)");
} else {
  await test(`real-python smoke (${realPython}): shipped scaffold env-checks ready + load-rules false`, async () => {
    const gate = createRulesetGate({ scriptPath, env: { SUBAGENT_RULESET_PYTHON: realPython } });
    assert.deepEqual(await gate.ensureReady(), { ok: true, active: false },
      "the shipped scaffold must be ready (stdlib-only) and inert (LOAD_RULES = False) under a real python");
  });
}

rmSync(tempRoot, { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
