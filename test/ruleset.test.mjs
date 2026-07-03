/**
 * Unit tests for src/ruleset.ts (compiled to dist/ruleset.js).
 *
 * These tests target the PURE layer — no spawning, no real interpreters. The
 * gate's latch semantics are exercised with an injected exec fn so every
 * state transition (success latches, FAILURE NEVER LATCHES) is observable as
 * an exact exec call count.
 *
 * Why each case matters is encoded in the assertion comment. Rule 9: tests
 * verify intent, not just behavior.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Import from compiled output — the run order is: build, then test.
import {
  createRulesetGate,
  interpreterCandidates,
  validateRulesetOutput,
  RULESET_TIMEOUT_MS,
  RULESET_HARD_FAIL_MSG,
} from "../dist/ruleset.js";
import { RULESET_SCAFFOLD } from "../dist/ruleset-scaffold.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Verbatim duplicate of the spec'd hard-fail string (house convention: tests
// duplicate exact strings so source drift fails loudly).
const HARD_FAIL =
  "subagent ruleset erroring. Please ask the system administrator to debug before continuing. It is highly discouraged to continue use of this chat session as the system is now operating outside safe parameters.";

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

// A pre-existing stub script file so the gate's ensureScaffold() is a no-op —
// these tests must never write into the repo dist/.
const stubDir = mkdtempSync(join(tmpdir(), "subagent-ruleset-unit-"));
const stubScript = join(stubDir, "advanced-ruleset.py");
writeFileSync(stubScript, "# stub — never executed (exec fn is injected)\n");

// ---------------------------------------------------------------------------
// 1. validateRulesetOutput — accepts every legal (provider, model, effort)
//    shape, strips rank/extra keys, allows duplicates and the empty array.
//    WHY: the returned list is consumed VERBATIM by the attempt loop, so the
//    accept set must be exactly the launchable enums — no more, no less.
// ---------------------------------------------------------------------------
await test("validateRulesetOutput: accepts all legal triples; strips rank/extra keys", () => {
  const result = validateRulesetOutput([
    { provider: "claude", model: "sonnet", effort: "high", rank: 1, note: "extra ignored" },
    { provider: "codex", model: "gpt-5.5", effort: "xhigh", rank: 2 },
    { provider: "claude", model: "haiku", effort: "none" },
    { provider: "claude", model: "fable", effort: "max" },
    { provider: "claude", model: "opus", effort: "ultracode" },
    { provider: "claude", model: "opus-4-8", effort: "max" },
  ]);
  assert.equal(result.ok, true, "all five triples are launchable and must validate");
  assert.deepEqual(result.candidates, [
    { provider: "claude", model: "sonnet", effort: "high" },
    { provider: "codex", model: "gpt-5.5", effort: "xhigh" },
    { provider: "claude", model: "haiku", effort: "none" },
    { provider: "claude", model: "fable", effort: "max" },
    { provider: "claude", model: "opus", effort: "ultracode" },
    { provider: "claude", model: "opus-4-8", effort: "max" },
  ], "candidates must carry exactly provider/model/effort — rank and extra keys stripped");
});

await test("validateRulesetOutput: empty array is VALID (veto is index.ts's job, not a validation failure)", () => {
  const result = validateRulesetOutput([]);
  assert.equal(result.ok, true,
    "empty array is the limit case of the allowed filter operation and must validate");
  assert.deepEqual(result.candidates, []);
});

await test("validateRulesetOutput: duplicates are allowed (attempt loop just tries them in order)", () => {
  const dup = { provider: "claude", model: "sonnet", effort: "medium" };
  const result = validateRulesetOutput([dup, dup]);
  assert.equal(result.ok, true, "duplicate triples are harmless and must not be rejected");
  assert.equal(result.candidates.length, 2);
});

// ---------------------------------------------------------------------------
// 2. validateRulesetOutput rejection matrix.
//    WHY: resolveEffort (effort.ts) has a lenient default that silently
//    coerces junk efforts to "high", so the validator must do its OWN
//    membership checks — anything that escapes here launches verbatim.
// ---------------------------------------------------------------------------
await test("validateRulesetOutput: rejection matrix (per-model effort legality, provider↔model, shape)", () => {
  const bad = [
    [{ provider: "codex", model: "gpt-5.5", effort: "max" }, "codex max is unlaunchable (resolveEffort throws)"],
    [{ provider: "codex", model: "gpt-5.5", effort: "ultracode" }, "ultracode is opus-only"],
    [{ provider: "claude", model: "sonnet", effort: "ultracode" }, "ultracode is opus-only, sonnet must reject"],
    [{ provider: "claude", model: "sonnet", effort: "low" }, "low effort is banned policy-wide"],
    [{ provider: "claude", model: "fable", effort: "ultracode" }, "ultracode is opus-only, fable must reject"],
    [{ provider: "claude", model: "haiku", effort: "high" }, "haiku effort must be exactly \"none\""],
    [{ provider: "claude", model: "sonnet", effort: "banana" }, "junk effort that effort.ts's lenient default would have coerced to high"],
    [{ provider: "claude", model: "banana", effort: "high" }, "unknown model"],
    [{ provider: "gemini", model: "sonnet", effort: "high" }, "unknown provider"],
    [{ provider: "claude", model: "gpt-5.5", effort: "high" }, "provider↔model mismatch (claude cannot run gpt-5.5)"],
    [{ provider: "codex", model: "sonnet", effort: "high" }, "provider↔model mismatch (codex only runs gpt-5.5)"],
    [{ provider: "claude", model: "sonnet" }, "missing effort key (non-string)"],
  ];
  for (const [el, why] of bad) {
    const result = validateRulesetOutput([el]);
    assert.equal(result.ok, false, `must reject: ${why}`);
  }

  // Top-level / element shape failures.
  assert.equal(validateRulesetOutput({}).ok, false, "non-array top level must be rejected");
  assert.equal(validateRulesetOutput("[]").ok, false, "a JSON string is not a bare array");
  assert.equal(validateRulesetOutput(null).ok, false, "null is not an array");
  assert.equal(validateRulesetOutput([42]).ok, false, "non-object element must be rejected");
  assert.equal(validateRulesetOutput([null]).ok, false, "null element must be rejected");
  assert.equal(validateRulesetOutput([[]]).ok, false, "array element must be rejected");
});

// ---------------------------------------------------------------------------
// 3. interpreterCandidates — auto-detect order and override exclusivity.
//    WHY: SUBAGENT_RULESET_PYTHON must be EXCLUSIVE (a wrong override has to
//    surface as the hard fail, never be masked by PATH luck), and the walk
//    order is the documented py → python3 → python contract.
// ---------------------------------------------------------------------------
await test("interpreterCandidates: win32 walk is py, python3, python; POSIX drops py", () => {
  assert.deepEqual(interpreterCandidates({}, "win32"), ["py", "python3", "python"],
    "win32 must try the py launcher first");
  assert.deepEqual(interpreterCandidates({}, "linux"), ["python3", "python"],
    "the py launcher is Windows-only");
  assert.deepEqual(interpreterCandidates({}, "darwin"), ["python3", "python"],
    "darwin uses the POSIX order");
});

await test("interpreterCandidates: SUBAGENT_RULESET_PYTHON is exclusive; empty string means unset", () => {
  assert.deepEqual(
    interpreterCandidates({ SUBAGENT_RULESET_PYTHON: "/custom/python" }, "win32"),
    ["/custom/python"],
    "a non-empty override must be the ONLY candidate — no fallback past it"
  );
  assert.deepEqual(
    interpreterCandidates({ SUBAGENT_RULESET_PYTHON: "" }, "linux"),
    ["python3", "python"],
    "an empty override must fall back to the auto-detect walk"
  );
});

// ---------------------------------------------------------------------------
// 4. Exported constants.
//    WHY: the 2-minute timeout is hardcoded by the owner spec, and the
//    hard-fail string must never drift by a byte (no trailing-period changes,
//    no appended hints).
// ---------------------------------------------------------------------------
await test("RULESET_TIMEOUT_MS is exactly 120000 (hardcoded 2-minute owner contract)", () => {
  assert.equal(RULESET_TIMEOUT_MS, 120000);
});

await test("RULESET_HARD_FAIL_MSG is byte-exact (verbatim owner string, no hints appended)", () => {
  assert.equal(RULESET_HARD_FAIL_MSG, HARD_FAIL);
});

// ---------------------------------------------------------------------------
// 5. Scaffold drift guard.
//    WHY: dist/advanced-ruleset.py and the embedded RULESET_SCAFFOLD string
//    are both mechanically derived from src/advanced-ruleset.py per build;
//    this guard makes any manual divergence fail loudly. The scaffold must
//    also ship inert (LOAD_RULES = False).
// ---------------------------------------------------------------------------
await test("scaffold drift guard: src/advanced-ruleset.py === RULESET_SCAFFOLD; ships LOAD_RULES = False", () => {
  const canonical = readFileSync(join(repoRoot, "src", "advanced-ruleset.py"), "utf8");
  assert.equal(RULESET_SCAFFOLD, canonical,
    "embedded scaffold string must be byte-identical to the canonical src/advanced-ruleset.py");
  assert.ok(RULESET_SCAFFOLD.includes("LOAD_RULES = False"),
    "the shipped scaffold must be inert by default (load-rules false)");
});

// ---------------------------------------------------------------------------
// Gate harness: an injectable exec fn that records calls and answers from a
// mutable behavior slot — flipping the slot between calls is how non-latching
// is proven at this layer.
// ---------------------------------------------------------------------------
function makeExecRecorder(behavior) {
  const calls = [];
  const slot = { behavior };
  const exec = async (interpreter, scriptPath, argvExtra, stdinText, timeoutMs) => {
    calls.push({ interpreter, scriptPath, argvExtra, stdinText, timeoutMs });
    return slot.behavior(interpreter, argvExtra, stdinText);
  };
  return { exec, calls, slot };
}

const okDisabled = () => ({ kind: "ok", stdout: '{"ready":true,"load-rules":false}' });
const okEnabled = () => ({ kind: "ok", stdout: '{"ready":true,"load-rules":true}' });

const PAYLOAD = {
  candidates: [{ provider: "claude", model: "sonnet", effort: "medium", rank: 1 }],
  context: {
    task_category: "coding",
    cwd: "/work",
    selection_mode: "auto",
    provider: null,
    model: null,
    effort: null,
  },
};

// ---------------------------------------------------------------------------
// 6. Gate: env-check SUCCESS latches for the process lifetime.
//    WHY: the gate must run exactly once per process on success — load-rules
//    false silently disables the ruleset with zero further executions.
// ---------------------------------------------------------------------------
await test("gate: {ready:true, load-rules:false} latches disabled — exec runs exactly once", async () => {
  const { exec, calls } = makeExecRecorder(okDisabled);
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "linux", exec });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false });
  assert.equal(calls.length, 1,
    "success must latch: three ensureReady calls may run the env-check only once");
  assert.deepEqual(calls[0].argvExtra, [], "env-check mode is the NO-ARG invocation");
  assert.equal(calls[0].stdinText, null, "env-check gets no stdin payload");
});

await test("gate: {ready:true, load-rules:true} latches enabled; applyRules sends route argv + stdin payload", async () => {
  const { exec, calls, slot } = makeExecRecorder(okEnabled);
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "linux", exec });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: true });

  slot.behavior = () => ({
    kind: "ok",
    stdout: '[{"provider":"codex","model":"gpt-5.5","effort":"medium"}]',
  });
  const applied = await gate.applyRules(PAYLOAD);
  assert.deepEqual(applied, {
    ok: true,
    candidates: [{ provider: "codex", model: "gpt-5.5", effort: "medium" }],
  }, "validated route output must come back as launchable candidates");

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].argvExtra, ["route"], "routing mode is the `route` argv invocation");
  assert.equal(calls[1].stdinText, JSON.stringify(PAYLOAD),
    "the exact JSON payload must be written to the script's stdin");
  assert.equal(calls[1].interpreter, calls[0].interpreter,
    "the interpreter latched by the env-check must be reused for routing mode");
});

// ---------------------------------------------------------------------------
// 7. Gate: FAILURE NEVER LATCHES — every failure flavor leaves state unknown
//    and re-runs the env-check on the next call, so an admin fix recovers
//    without a server restart.
// ---------------------------------------------------------------------------
await test("gate: env-check failures (exit, bad JSON, missing keys, ready:false) never latch", async () => {
  const failures = [
    [() => ({ kind: "failed", detail: "exit code 1" }), "non-zero exit"],
    [() => ({ kind: "ok", stdout: "not json {{{" }), "unparseable stdout"],
    [() => ({ kind: "ok", stdout: '{"ready":true}' }), "missing load-rules key"],
    [() => ({ kind: "ok", stdout: '{"ready":"yes","load-rules":true}' }), "non-boolean ready"],
    [() => ({ kind: "ok", stdout: '{"ready":false,"load-rules":true}' }), "ready:false self-report"],
  ];
  for (const [behavior, why] of failures) {
    const { exec, calls, slot } = makeExecRecorder(behavior);
    const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "linux", exec });
    assert.deepEqual(await gate.ensureReady(), { ok: false }, `${why} must fail the gate`);
    assert.deepEqual(await gate.ensureReady(), { ok: false }, `${why} must fail again (re-ran)`);
    assert.equal(calls.length, 2,
      `${why}: failure must NOT latch — the second ensureReady must exec again`);

    // Admin fixes the script: the very next call recovers without a restart.
    slot.behavior = okDisabled;
    assert.deepEqual(await gate.ensureReady(), { ok: true, active: false },
      `${why}: a fixed script must recover on the next call`);
    assert.equal(calls.length, 3);
  }
});

// ---------------------------------------------------------------------------
// 8. Gate: interpreter walk — no-spawn advances, first spawnable wins and is
//    remembered only on success; exhaustion fails and the next call re-walks.
//    WHY: a missing interpreter must hard-fail (owner contract), but an admin
//    installing python afterwards must recover without a restart.
// ---------------------------------------------------------------------------
await test("gate: interpreter walk advances past no-spawn; first spawnable wins", async () => {
  const { exec, calls } = makeExecRecorder((interpreter) => {
    if (interpreter === "py" || interpreter === "python3") {
      return { kind: "no-spawn", detail: "ENOENT" };
    }
    return okDisabled();
  });
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "win32", exec });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false });
  assert.deepEqual(calls.map((c) => c.interpreter), ["py", "python3", "python"],
    "the walk must try the documented win32 order and stop at the first spawnable");
});

await test("gate: all interpreters unspawnable fails; next call re-walks (no latch)", async () => {
  const { exec, calls, slot } = makeExecRecorder(() => ({ kind: "no-spawn", detail: "ENOENT" }));
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "win32", exec });
  assert.deepEqual(await gate.ensureReady(), { ok: false },
    "a python-less machine is a ruleset failure (owner contract)");
  assert.equal(calls.length, 3, "all three win32 candidates must have been tried");

  slot.behavior = okDisabled;
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: false },
    "installing an interpreter must recover on the next call — the walk repeats");
  assert.equal(calls.length, 4, "the repeated walk stops at the first (now spawnable) candidate");
});

await test("gate: SUBAGENT_RULESET_PYTHON is exclusive — never falls back past a broken override", async () => {
  const { exec, calls } = makeExecRecorder(() => ({ kind: "no-spawn", detail: "ENOENT" }));
  const gate = createRulesetGate({
    scriptPath: stubScript,
    env: { SUBAGENT_RULESET_PYTHON: "/broken/python" },
    platform: "win32",
    exec,
  });
  assert.deepEqual(await gate.ensureReady(), { ok: false });
  assert.equal(calls.length, 1, "the override must be the only candidate tried");
  assert.equal(calls[0].interpreter, "/broken/python");
});

await test("gate: script-level failure on a spawnable interpreter does NOT walk on", async () => {
  const { exec, calls } = makeExecRecorder((interpreter) =>
    interpreter === "py"
      ? { kind: "failed", detail: "exit code 2" }
      : okDisabled()
  );
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "win32", exec });
  assert.deepEqual(await gate.ensureReady(), { ok: false },
    "a broken script under the first spawnable interpreter must surface, not be masked by python3");
  assert.equal(calls.length, 1, "the walk must STOP at the first interpreter that spawned");
});

// ---------------------------------------------------------------------------
// 9. Gate: routing-mode failure keeps the enabled latch (re-run routing only),
//    and invalid route output (bad JSON, bad model, empty=valid) is classified
//    exactly like the spec says.
//    WHY: a flaky rule must not force a fresh env-check, and an empty list is
//    a deliberate veto — never a validation failure.
// ---------------------------------------------------------------------------
await test("gate: applyRules failure leaves state enabled; recovery without env-check re-run", async () => {
  const { exec, calls, slot } = makeExecRecorder(okEnabled);
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "linux", exec });
  assert.deepEqual(await gate.ensureReady(), { ok: true, active: true });

  slot.behavior = () => ({ kind: "failed", detail: "exit code 3" });
  assert.deepEqual(await gate.applyRules(PAYLOAD), { ok: false });

  assert.deepEqual(await gate.ensureReady(), { ok: true, active: true },
    "a routing failure must NOT unlatch the enabled state");
  const envChecks = calls.filter((c) => c.argvExtra.length === 0).length;
  assert.equal(envChecks, 1, "no second env-check may run after a routing-mode failure");

  slot.behavior = () => ({ kind: "ok", stdout: '[{"provider":"claude","model":"haiku","effort":"none"}]' });
  const applied = await gate.applyRules(PAYLOAD);
  assert.equal(applied.ok, true, "the next routing run must recover without any restart");
});

await test("gate: applyRules classifies bad JSON / invalid model as failure, empty array as valid", async () => {
  const { exec, slot } = makeExecRecorder(okEnabled);
  const gate = createRulesetGate({ scriptPath: stubScript, env: {}, platform: "linux", exec });
  await gate.ensureReady();

  slot.behavior = () => ({ kind: "ok", stdout: "not json at all" });
  assert.deepEqual(await gate.applyRules(PAYLOAD), { ok: false }, "unparseable stdout is a ruleset failure");

  slot.behavior = () => ({ kind: "ok", stdout: '[{"provider":"claude","model":"banana","effort":"high"}]' });
  assert.deepEqual(await gate.applyRules(PAYLOAD), { ok: false }, "an unlaunchable model is a ruleset failure");

  slot.behavior = () => ({ kind: "ok", stdout: "[]" });
  assert.deepEqual(await gate.applyRules(PAYLOAD), { ok: true, candidates: [] },
    "the empty list is VALID — the veto decision belongs to the handler, not the gate");
});

rmSync(stubDir, { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
