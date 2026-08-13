/**
 * context-coaching-config.test.mjs — Mandatory unit coverage for the
 * context-coaching settings surface (LOCKED semantics).
 *
 * Locked contract under test:
 *   - `contextCoaching` (user-level ONLY, camelCase): default true. Any
 *     non-boolean sanitizes to true. This is the ONLY user-facing coaching
 *     knob; there is no percentage setting.
 *   - The `handoffWarnThreshold` knob and wind-down warning are unsupported:
 *     no default/band constants, sanitizer field, or config key exists.
 *     Any `handoffWarnThreshold` value in a settings object is an unknown key —
 *     it is ignored and never widens the resolved shape.
 *   - An existing settings file MISSING the key resolves to the silent default
 *     (coaching on). A blank file or syntactically broken JSON must NOT crash
 *     metering — it degrades to the same default (concurrency.ts parse-failure
 *     precedent).
 *   - The handoff-write/read/clear unlock is a hard-coded 20% and is NEVER
 *     configurable. This is the voluntary handoff availability contract and it
 *     is preserved unchanged.
 *   - Lifecycle constants are fixed in code: `CODEX_AUTOCOMPACT_PCT` = 90,
 *     `HANDOFF_REQUIRED_THRESHOLD_PCT` (H) = 80 = CODEX_AUTOCOMPACT_PCT - 10,
 *     `COMPACTION_DROP_THRESHOLD_PCT` = 10. H is the mandatory fresh-write
 *     lifecycle transition, independent of the 20% availability gate.
 *
 * The production surfaces are bound to their exact named exports: the coaching
 * sanitizer/reader live in dist/concurrency.js, the setup prompt helper in
 * dist/setup.js, and the lifecycle constants in dist/orchestration/metering.js
 * (with the 20% unlock mirrored in dist/orchestration/handoff.js). Assertions
 * are hard and exact.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { sanitizeCoachingSettings, readContextCoachingSettings } from "../dist/concurrency.js";
import { ensureSetupContextCoaching } from "../dist/setup.js";
import * as meteringMod from "../dist/orchestration/metering.js";
import * as handoffMod from "../dist/orchestration/handoff.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
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

// The one locked field on every resolved coaching-settings shape.
function coachingOf(result) {
  assert.ok(result && typeof result === "object", "resolver must return an object");
  return result.contextCoaching;
}

// No warn-threshold field may appear under any known alias.
function assertNoThreshold(result, where) {
  for (const alias of ["handoffWarnThreshold", "warnThreshold", "handoffWarnThresholdPct"]) {
    assert.equal(
      result?.[alias],
      undefined,
      `${where}: the unsupported ${alias} field must not be present on the resolved settings`
    );
  }
}

// ---------------------------------------------------------------------------
// Locked constants.
// ---------------------------------------------------------------------------
test("voluntary handoff availability: unlock is a hard-coded 20", () => {
  assert.equal(
    meteringMod.HANDOFF_UNLOCK_THRESHOLD_PCT,
    20,
    "handoff unlock must be a hard-coded 20 (voluntary availability)"
  );
  assert.equal(handoffMod.HANDOFF_THRESHOLD_PCT, 20, "handoff module must mirror the 20% unlock");
  assert.equal(meteringMod.PLAN_LATCH_THRESHOLD_PCT, 15, "plan latch stays at 15");
});

test("lifecycle constants: auto-compact 90, handoff-required 80, drop 10", () => {
  assert.equal(meteringMod.CODEX_AUTOCOMPACT_PCT, 90, "CODEX_AUTOCOMPACT_PCT must be 90");
  assert.equal(
    meteringMod.COMPACTION_DROP_THRESHOLD_PCT,
    10,
    "the auto-compaction drop threshold must be 10 points"
  );
  assert.equal(meteringMod.HANDOFF_REQUIRED_THRESHOLD_PCT, 80, "H must be 80");
  assert.equal(
    meteringMod.HANDOFF_REQUIRED_THRESHOLD_PCT,
    meteringMod.CODEX_AUTOCOMPACT_PCT - meteringMod.COMPACTION_DROP_THRESHOLD_PCT,
    "H must be CODEX_AUTOCOMPACT_PCT - COMPACTION_DROP_THRESHOLD_PCT"
  );
});

test("H (80) is the write-lifecycle gate, distinct from the 20% availability unlock", () => {
  assert.equal(meteringMod.HANDOFF_REQUIRED_THRESHOLD_PCT, 80, "H must be exported as 80");
  assert.notEqual(
    meteringMod.HANDOFF_REQUIRED_THRESHOLD_PCT,
    meteringMod.HANDOFF_UNLOCK_THRESHOLD_PCT,
    "H must NOT collapse into the 20% voluntary availability gate"
  );
});

test("the warn-threshold surface is absent (constant + hard-coded 50)", () => {
  assert.equal(
    meteringMod.HANDOFF_WARNING_THRESHOLD_PCT,
    undefined,
    "the hard-coded 50% warn constant must be absent"
  );
  const FORBIDDEN_WARN_CONSTANTS = [
    "DEFAULT_HANDOFF_WARN_THRESHOLD_PCT",
    "DEFAULT_WARN_THRESHOLD_PCT",
    "DEFAULT_HANDOFF_WARN_THRESHOLD",
    "DEFAULT_CONTEXT_COACHING_THRESHOLD_PCT",
    "WARN_THRESHOLD_MIN",
    "WARN_THRESHOLD_MAX",
    "MIN_WARN_THRESHOLD_PCT",
    "MAX_WARN_THRESHOLD_PCT",
    "MIN_HANDOFF_WARN_THRESHOLD",
    "MAX_HANDOFF_WARN_THRESHOLD",
  ];
  for (const name of FORBIDDEN_WARN_CONSTANTS) {
    assert.equal(meteringMod[name], undefined, `metering must not export ${name}`);
    assert.equal(handoffMod[name], undefined, `handoff must not export ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Phase boundaries 19 / 20 / 21 (the 20% unlock is threshold-independent).
// ---------------------------------------------------------------------------
test("phase boundaries: 19 is plan, 20 and 21 are handoff", () => {
  assert.equal(meteringMod.phaseFor(19), "plan");
  assert.equal(meteringMod.phaseFor(19.99), "plan");
  assert.equal(meteringMod.phaseFor(20), "handoff");
  assert.equal(meteringMod.phaseFor(21), "handoff");
});

test("handoff-write gate boundaries: 19 locked, 20 and 21 unlocked (voluntary availability)", () => {
  assert.equal(handoffMod.checkHandoffWriteAvailable({ used_percentage: 19 }).ok, false);
  assert.equal(handoffMod.checkHandoffWriteAvailable({ used_percentage: 20 }).ok, true);
  assert.equal(handoffMod.checkHandoffWriteAvailable({ used_percentage: 21 }).ok, true);
});

// ---------------------------------------------------------------------------
// contextCoaching sanitizer matrix (MANDATORY).
// ---------------------------------------------------------------------------
const ABSENT = Symbol("absent");

const COACHING_CASES = [
  ["absent", ABSENT, true],
  ["true", true, true],
  ["false", false, false],
  ['"junk"', "junk", true],
  ["0", 0, true],
  ["null", null, true],
  ["1", 1, true],
];

test("sanitizer: contextCoaching sanitizes to a boolean, non-bool => true", () => {
  for (const [label, raw, expected] of COACHING_CASES) {
    const input = raw === ABSENT ? {} : { contextCoaching: raw };
    const result = sanitizeCoachingSettings(input);
    const coaching = coachingOf(result);

    assert.equal(
      typeof coaching,
      "boolean",
      `contextCoaching=${label} must sanitize to a boolean, got ${typeof coaching}`
    );
    assert.equal(coaching, expected, `contextCoaching=${label} must sanitize to ${expected}, got ${coaching}`);
    assertNoThreshold(result, `contextCoaching=${label}`);
  }
});

test("sanitizer tolerates hostile top-level input without throwing", () => {
  for (const raw of [null, undefined, "", 0, false, [], "a string", { nested: { a: 1 } }]) {
    const result = sanitizeCoachingSettings(raw);
    assert.equal(coachingOf(result), true, `top-level ${JSON.stringify(raw)} must default coaching ON`);
    assertNoThreshold(result, `top-level ${JSON.stringify(raw)}`);
  }
});

test("handoffWarnThreshold is an unknown key: ignored, never widens the shape", () => {
  const result = sanitizeCoachingSettings({
    contextCoaching: false,
    handoffWarnThreshold: 75,
    warnThreshold: 45,
    handoffUnlockThreshold: 5,
    permissions: { allow: ["*"] },
    bogus: true,
  });
  assert.equal(coachingOf(result), false, "the legitimate contextCoaching value still resolves");
  assertNoThreshold(result, "settings carrying an unknown handoffWarnThreshold");
});

// ---------------------------------------------------------------------------
// File-level degradation: blank file, broken JSON, existing-file-missing-key.
// ---------------------------------------------------------------------------
const homes = [];
function withSettingsFile(contents) {
  const home = mkdtempSync(join(tmpdir(), "coach-cfg-"));
  homes.push(home);
  if (contents !== null) writeFileSync(join(home, "settings.json"), contents, "utf8");
  const previous = process.env.SUBAGENT_CONFIG_HOME;
  process.env.SUBAGENT_CONFIG_HOME = home;
  try {
    return readContextCoachingSettings({ configHome: home, home });
  } finally {
    if (previous === undefined) delete process.env.SUBAGENT_CONFIG_HOME;
    else process.env.SUBAGENT_CONFIG_HOME = previous;
  }
}
process.on("exit", () => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

test("settings file: absent entirely => silent default (coaching on)", () => {
  const result = withSettingsFile(null);
  assert.equal(coachingOf(result), true);
  assertNoThreshold(result, "absent settings file");
});

test("settings file: exists but lacks the key => silent default, no prompt", () => {
  const result = withSettingsFile(JSON.stringify({ permissions: { allow: [] } }));
  assert.equal(coachingOf(result), true);
  assertNoThreshold(result, "settings file missing contextCoaching");
});

test("settings file: blank file must not crash metering => default", () => {
  for (const blank of ["", "   ", "\n\n"]) {
    const result = withSettingsFile(blank);
    assert.equal(coachingOf(result), true, `blank content ${JSON.stringify(blank)}`);
  }
});

test("settings file: syntactically broken JSON must not crash metering => default", () => {
  for (const broken of ["{", "{ not json", '{"contextCoaching": }', "[[[", "null"]) {
    const result = withSettingsFile(broken);
    assert.equal(coachingOf(result), true, `broken content ${JSON.stringify(broken)}`);
  }
});

test("settings file: an explicit contextCoaching:false is honoured", () => {
  const result = withSettingsFile(JSON.stringify({ contextCoaching: false }));
  assert.equal(coachingOf(result), false);
});

test("settings file: an unknown handoffWarnThreshold key is ignored, coaching still resolves", () => {
  const result = withSettingsFile(JSON.stringify({ contextCoaching: false, handoffWarnThreshold: 45 }));
  assert.equal(coachingOf(result), false);
  assertNoThreshold(result, "settings file carrying an unknown handoffWarnThreshold");
});

test("settings are user-level ONLY: a project settings file must not override", () => {
  const home = mkdtempSync(join(tmpdir(), "coach-cfg-user-"));
  const project = mkdtempSync(join(tmpdir(), "coach-cfg-proj-"));
  homes.push(home, project);
  writeFileSync(join(home, "settings.json"), JSON.stringify({ contextCoaching: false }), "utf8");
  writeFileSync(join(project, "settings.json"), JSON.stringify({ contextCoaching: true }), "utf8");
  const result = readContextCoachingSettings({ configHome: home, home, cwd: project });
  assert.equal(coachingOf(result), false, "the user-level value must win; project files are not consulted");
});

// ---------------------------------------------------------------------------
// Setup prompt behaviour (MANDATORY): ONE question only, no threshold prompt.
// ---------------------------------------------------------------------------
const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

const promptHome = () => {
  const home = mkdtempSync(join(tmpdir(), "coach-setup-"));
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
  return home;
};

await testAsync("setup prompts: non-TTY defaults to coaching on without asking", async () => {
  const result = await ensureSetupContextCoaching({
    home: promptHome(),
    isTTY: false,
    log: () => {},
    dryRun: true,
  });
  assert.equal(coachingOf(result), true);
  assertNoThreshold(result, "non-TTY setup result");
});

await testAsync("setup prompts: --unattended defaults to coaching on without asking", async () => {
  const result = await ensureSetupContextCoaching({
    home: promptHome(),
    unattended: true,
    log: () => {},
    dryRun: true,
  });
  assert.equal(coachingOf(result), true);
  assertNoThreshold(result, "unattended setup result");
});

await testAsync("setup prompts: a blank answer accepts the default (coaching on)", async () => {
  const result = await ensureSetupContextCoaching({
    home: promptHome(),
    isTTY: true,
    input: Readable.from(["\n"]),
    output: sink(),
    log: () => {},
    dryRun: true,
  });
  assert.equal(coachingOf(result), true);
});

await testAsync("setup prompts: invalid input re-prompts until valid", async () => {
  const lines = [];
  const result = await ensureSetupContextCoaching({
    home: promptHome(),
    isTTY: true,
    // coaching: junk, junk, then "n".
    input: Readable.from(["maybe\n", "42\n", "n\n"]),
    output: sink(),
    log: (l) => lines.push(l),
    dryRun: true,
  });
  assert.equal(coachingOf(result), false, "the third coaching answer (n) must be taken");
  assert.ok(lines.length > 0, "invalid input must emit a re-prompt hint");
});

await testAsync("setup prompts: asks the coaching question and NEVER a threshold question", async () => {
  const asked = [];
  const result = await ensureSetupContextCoaching({
    home: promptHome(),
    isTTY: true,
    input: Readable.from(["n\n"]),
    output: new Writable({
      write(chunk, _e, cb) {
        asked.push(String(chunk));
        cb();
      },
    }),
    log: () => {},
    dryRun: true,
  });
  const prose = asked.join("");
  assert.match(prose, /coach/i, "the coaching on/off question must be asked");
  assert.doesNotMatch(
    prose,
    /threshold|percent|handoffWarn|wind[- ]?down/i,
    "no threshold / wind-down question may be asked"
  );
  assertNoThreshold(result, "single-question setup result");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
