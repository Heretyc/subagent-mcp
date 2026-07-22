import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as meteringModule from "../dist/orchestration/metering.js";
import {
  DEFAULT_CONTEXT_WINDOW,
  HANDOFF_UNLOCK_THRESHOLD_PCT,
  PLAN_LATCH_THRESHOLD_PCT,
  LONG_CONTEXT_WINDOW,
  buildMeteringRecord,
  computeUsedPercentage,
  meteringPath,
  phaseFor,
  readMetering,
  resolveContextWindowDetailed,
  setContextWindowsPathForTest,
  resolveContextWindow,
  writeMetering,
} from "../dist/orchestration/metering.js";
import { ORCH_DISABLE_TTL_MS } from "../dist/orchestration/marker.js";

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

test("resolveContextWindow covers claude and codex known/unknown branches", () => {
  assert.equal(resolveContextWindow("claude", "not-claude"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("claude", "claude-sonnet-4-5"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("claude", "claude-sonnet-4-5[1m]"), LONG_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("claude", "Claude-Fable-5"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("claude", "claude-haiku-4-5-20251001"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("claude", "claude-haiku-4-5[1m]"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-brand-new-model",
  }).source, "family-default");
  assert.equal(resolveContextWindow("claude", "claude-brand-new-model"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("codex", "unknown-model"), DEFAULT_CONTEXT_WINDOW);
  assert.equal(resolveContextWindow("codex", "gpt-5"), 258400);
  assert.equal(resolveContextWindow("codex", "gpt-5.3-codex-spark"), 121600);
});

test("computeUsedPercentage prefers harness percentage, falls back, and propagates null", () => {
  assert.equal(computeUsedPercentage({
    context_window_size: DEFAULT_CONTEXT_WINDOW,
    used_tokens: 10,
    harnessPercentage: 12.5,
  }), 12.5);
  assert.equal(computeUsedPercentage({
    context_window_size: DEFAULT_CONTEXT_WINDOW,
    used_tokens: 10000,
  }), 5);
  assert.equal(computeUsedPercentage({
    context_window_size: null,
    used_tokens: 10000,
  }), null);
  assert.equal(computeUsedPercentage({
    context_window_size: DEFAULT_CONTEXT_WINDOW,
    used_tokens: null,
  }), null);
});

test("harness percentage and window override computed ladder", () => {
  const record = buildMeteringRecord({
    session_id: "s-harness-override",
    harness: "claude",
    model: "claude-sonnet-4-5",
    source_ref: "transcript.jsonl",
    usage: { input: 10000, output: 0, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
    harnessPercentage: 37.5,
    harnessContextWindow: LONG_CONTEXT_WINDOW,
  });
  assert.equal(record.used_percentage, 37.5);
  assert.equal(record.context_window_size, LONG_CONTEXT_WINDOW);
  assert.equal(record.window_source, "harness");
});

test("harnessContextWindow prevents false 100% clamp when usage exceeds static map (NEWI-001)", () => {
  // Regression: a Codex turn whose prompt-side tokens exceed the static-map
  // window (gpt-5 default 258400, long=null) would otherwise resolve to
  // window_source="contradiction" and clamp used_percentage to 100% (Remaining
  // Context=0%). Forwarding the harness-reported window fixes both.
  const usage = { input: 300000, output: 10000, cache_creation: 0, cache_read: 0 };

  // Without a harness window: static map contradicts and clamps to 100%.
  const staticRecord = buildMeteringRecord({
    session_id: "s-newi-static",
    harness: "codex",
    model: "gpt-5",
    source_ref: "rollout.jsonl",
    usage,
    event: "UserPromptSubmit",
  });
  assert.equal(staticRecord.window_source, "contradiction");
  assert.equal(staticRecord.used_percentage, 100);

  // With the harness window forwarded: window_source="harness", no false clamp.
  const harnessRecord = buildMeteringRecord({
    session_id: "s-newi-harness",
    harness: "codex",
    model: "gpt-5",
    source_ref: "rollout.jsonl",
    usage,
    event: "UserPromptSubmit",
    harnessContextWindow: 400000,
  });
  assert.equal(harnessRecord.window_source, "harness");
  assert.equal(harnessRecord.context_window_size, 400000);
  assert.equal(harnessRecord.used_percentage, 77.5);
  assert.ok(harnessRecord.used_percentage < 100);
});

// LOCKED (context-coaching): the plan latch stays at 15; the handoff unlock drops
// 40 -> 20 and stays hard-coded (never configurable). The old
// HANDOFF_WARNING_THRESHOLD_PCT=50 constant is replaced by a resolved user
// setting (default 60, valid 40-90) and so is asserted via the config surface in
// test/context-coaching-config.test.mjs, not as a frozen constant here.
test("phaseFor thresholds are inclusive at 15 and 20", () => {
  assert.equal(phaseFor(null), "normal");
  assert.equal(phaseFor(14.99), "normal");
  assert.equal(phaseFor(15), "plan");
  assert.equal(phaseFor(19), "plan");
  assert.equal(phaseFor(19.99), "plan");
  assert.equal(phaseFor(20), "handoff");
  assert.equal(phaseFor(21), "handoff");
  assert.equal(phaseFor(40), "handoff");
  assert.equal(phaseFor(100), "handoff");
  assert.equal(PLAN_LATCH_THRESHOLD_PCT, 15);
  assert.equal(HANDOFF_UNLOCK_THRESHOLD_PCT, 20);
});

test("buildMeteringRecord assembles shape and near_limit", () => {
  const before = Date.now();
  const record = buildMeteringRecord({
    session_id: "s1",
    harness: "codex",
    model: "gpt-5",
    source_ref: "rollout.jsonl",
    usage: {
      input: 60000,
      output: 30000,
      cache_creation: 5000,
      cache_read: 5000,
    },
    event: "UserPromptSubmit",
  });
  assert.equal(record.session_id, "s1");
  assert.equal(record.harness, "codex");
  assert.equal(record.model, "gpt-5");
  assert.equal(record.source_ref, "rollout.jsonl");
  assert.equal(record.context_window_size, 258400);
  assert.deepEqual(record.usage, {
    input: 60000,
    output: 30000,
    cache_creation: 5000,
    cache_read: 5000,
  });
  assert.equal(record.used_tokens, 100000);
  assert.equal(Math.round(record.used_percentage * 100) / 100, 38.7);
  assert.equal(record.near_limit, false);
  assert.equal(record.event, "UserPromptSubmit");
  assert.ok(record.updated_at >= before);
});

// The wind-down warn threshold is a resolved USER SETTING now (default 60, valid
// 40-90), so this test derives it from the production surface rather than
// hardcoding 50. That keeps the boundary assertions meaningful whether the
// machine running the suite has a settings file or not.
function effectiveWarnThresholdPct() {
  const resolver =
    meteringModule.resolveWarnThresholdPct ??
    meteringModule.warnThresholdPct ??
    meteringModule.resolveHandoffWarnThreshold;
  if (typeof resolver === "function") return resolver();
  const constant =
    meteringModule.HANDOFF_WARNING_THRESHOLD_PCT ??
    meteringModule.DEFAULT_HANDOFF_WARN_THRESHOLD_PCT;
  if (typeof constant === "number") return constant;
  return 60;
}

// claude-sonnet-4-5 resolves to the 200000-token default window, so
// used_percentage === input / 2000.
function recordAtPct(label, pct) {
  return buildMeteringRecord({
    session_id: `s-band-${label}`,
    harness: "claude",
    model: "claude-sonnet-4-5",
    source_ref: "transcript.jsonl",
    usage: { input: pct * 2000, output: 0, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
  });
}

test("handoff band unlocks at 20 but near_limit waits until the warn threshold", () => {
  const below = recordAtPct("below", 19);
  assert.equal(below.used_percentage, 19);
  assert.equal(phaseFor(below.used_percentage), "plan");
  assert.equal(below.near_limit, false);

  const unlocked = recordAtPct("unlocked", 20);
  assert.equal(unlocked.used_percentage, 20);
  assert.equal(phaseFor(unlocked.used_percentage), "handoff");
  assert.equal(unlocked.near_limit, false, "20% unlocks handoff but must NOT warn");

  const above = recordAtPct("above", 21);
  assert.equal(above.used_percentage, 21);
  assert.equal(phaseFor(above.used_percentage), "handoff");
  assert.equal(above.near_limit, false);

  // The retired 40%/50% points are now ordinary in-band values: 40 must not warn
  // under the default-60 threshold, and nothing special happens at 50.
  const warn = effectiveWarnThresholdPct();
  if (warn > 40) {
    assert.equal(recordAtPct("legacy-unlock", 40).near_limit, false,
      "40% must no longer trip near_limit under the default warn threshold");
  }
});

test("near_limit flips exactly at the resolved warn threshold boundary", () => {
  const warn = effectiveWarnThresholdPct();
  assert.ok(warn >= 40 && warn <= 90,
    `resolved warn threshold ${warn} must sit inside the locked 40-90 band`);

  assert.equal(recordAtPct("warn-minus-1", warn - 1).near_limit, false,
    `threshold-1 (${warn - 1}%) must not trip near_limit`);
  assert.equal(recordAtPct("warn-exact", warn).near_limit, true,
    `threshold (${warn}%) must trip near_limit inclusively`);
  assert.equal(recordAtPct("warn-plus-1", warn + 1).near_limit, true,
    `threshold+1 (${warn + 1}%) must stay tripped`);

  // Phase is independent of the warn threshold: everything at/above 20 is handoff.
  for (const pct of [warn - 1, warn, warn + 1]) {
    assert.equal(phaseFor(pct), "handoff");
  }
});

test("resolveContextWindowDetailed applies hint, ratchet, prior floor, and contradiction rules", () => {
  assert.deepEqual(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-fable-5",
    longContextHint: true,
  }), {
    window: LONG_CONTEXT_WINDOW,
    source: "hint",
    window_floor: null,
    contradiction: false,
  });
  assert.equal(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-haiku-4-5",
    longContextHint: true,
  }).window, DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-fable-5",
    promptSideTokens: 505000,
  }), {
    window: LONG_CONTEXT_WINDOW,
    source: "ratchet",
    window_floor: 505000,
    contradiction: false,
  });
  assert.equal(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-fable-5",
    promptSideTokens: DEFAULT_CONTEXT_WINDOW,
  }).window, DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-haiku-4-5",
    promptSideTokens: 250000,
  }), {
    window: DEFAULT_CONTEXT_WINDOW,
    source: "contradiction",
    window_floor: 250000,
    contradiction: true,
  });
  assert.deepEqual(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-fable-5",
    promptSideTokens: 90000,
    priorWindow: LONG_CONTEXT_WINDOW,
    priorWindowSource: "ratchet",
    priorWindowFloor: 505000,
  }), {
    window: LONG_CONTEXT_WINDOW,
    source: "prior",
    window_floor: 505000,
    contradiction: false,
  });
  assert.equal(resolveContextWindowDetailed({
    harness: "claude",
    modelId: "claude-fable-5",
    promptSideTokens: 90000,
    priorWindow: LONG_CONTEXT_WINDOW,
    priorWindowSource: "hint",
  }).window, DEFAULT_CONTEXT_WINDOW);
});

test("507437 regression ratchets claude-fable-5 to 1M instead of clamping to 100", () => {
  const record = buildMeteringRecord({
    session_id: "s-regression-507437",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: {
      input: 1000,
      cache_creation: 2437,
      cache_read: 495000,
      output: 9000,
    },
    event: "UserPromptSubmit",
  });
  assert.equal(record.context_window_size, LONG_CONTEXT_WINDOW);
  assert.equal(record.window_source, "ratchet");
  assert.equal(record.used_tokens, 507437);
  assert.ok(record.used_percentage > 50 && record.used_percentage < 51);
  assert.ok(record.used_percentage < 100);
  assert.equal(phaseFor(record.used_percentage), "handoff");
});

test("field cases with 1M hint meter at real 1M percentages", () => {
  const caseA = buildMeteringRecord({
    session_id: "s-field-a",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: { input: 220000, output: 0, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
    longContextHint: true,
  });
  assert.equal(caseA.context_window_size, LONG_CONTEXT_WINDOW);
  assert.equal(Math.round(caseA.used_percentage), 22);
  assert.equal(phaseFor(caseA.used_percentage), "handoff");
  assert.equal(caseA.near_limit, false);

  const caseB = buildMeteringRecord({
    session_id: "s-field-b",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: { input: 120000, output: 0, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
    longContextHint: true,
  });
  assert.equal(caseB.context_window_size, LONG_CONTEXT_WINDOW);
  assert.equal(Math.round(caseB.used_percentage), 12);
  assert.equal(phaseFor(caseB.used_percentage), "normal");
  assert.equal(caseB.near_limit, false);
});

test("full 200k prompt plus output clamps honestly without false ratchet", () => {
  const record = buildMeteringRecord({
    session_id: "s-full-200k",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: { input: 196000, output: 8000, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
  });
  assert.equal(record.context_window_size, DEFAULT_CONTEXT_WINDOW);
  assert.equal(record.window_source, "mapping");
  assert.equal(record.used_percentage, 100);
});

test("unknown non-claude and contradictions produce numeric percentages", () => {
  const unknown = buildMeteringRecord({
    session_id: "s-unknown-codex",
    harness: "codex",
    model: "gpt-new-unknown",
    source_ref: "rollout.jsonl",
    usage: { input: 1, output: 1 },
    event: "UserPromptSubmit",
  });
  assert.equal(unknown.context_window_size, DEFAULT_CONTEXT_WINDOW);
  assert.equal(unknown.window_source, "assumed-default");
  assert.equal(unknown.used_percentage, 0.001);

  const contradiction = buildMeteringRecord({
    session_id: "s-contradiction",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: { input: 1200000, output: 1, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
    longContextHint: true,
  });
  assert.equal(contradiction.context_window_size, LONG_CONTEXT_WINDOW);
  assert.equal(contradiction.window_source, "contradiction");
  assert.equal(contradiction.used_percentage, 100);
});

test("unknown model with large floor promotes assumed default to floor", () => {
  const record = buildMeteringRecord({
    session_id: "s-unknown-floor",
    harness: "codex",
    model: "gpt-new-unknown",
    source_ref: "rollout.jsonl",
    usage: { input: 1, output: 1 },
    event: "UserPromptSubmit",
    priorWindowFloor: 500000,
  });
  assert.equal(record.context_window_size, 500000);
  assert.equal(record.window_source, "assumed-default+floor");
  assert.equal(record.window_floor, 500000);
  assert.ok(Math.abs(record.used_percentage - 0.0004) < 1e-12);
});

test("current claude-fable session regression ratchets from prior floor to 1M", () => {
  const record = buildMeteringRecord({
    session_id: "s-current-fable-regression",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: {
      input: 2,
      output: 60,
      cache_creation: 6894,
      cache_read: 669235,
    },
    event: "UserPromptSubmit",
    priorWindowFloor: 641173,
  });
  assert.equal(record.context_window_size, LONG_CONTEXT_WINDOW);
  assert.equal(record.window_source, "ratchet");
  assert.ok(record.used_percentage > 60 && record.used_percentage < 70);
});

test("haiku above top known tier resolves contradiction to 200k and clamps", () => {
  const record = buildMeteringRecord({
    session_id: "s-haiku-contradiction",
    harness: "claude",
    model: "claude-haiku-4-5",
    source_ref: "transcript.jsonl",
    usage: { input: 250000, output: 1, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
    longContextHint: true,
  });
  assert.equal(record.context_window_size, DEFAULT_CONTEXT_WINDOW);
  assert.equal(record.window_source, "contradiction");
  assert.equal(record.used_percentage, 100);
});

test("missing or corrupt context window asset falls back to assumed default", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-metering-map-"));
  const bad = join(dir, "bad.json");
  try {
    writeFileSync(bad, "{", "utf8");
    setContextWindowsPathForTest(bad);
    assert.equal(resolveContextWindow("claude", "claude-fable-5"), DEFAULT_CONTEXT_WINDOW);
  } finally {
    setContextWindowsPathForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read/write metering round-trips through an override stateDir", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "orch-metering-"));
  const session = "session-roundtrip";
  try {
    const record = buildMeteringRecord({
      session_id: session,
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: "transcript.jsonl",
      usage: { input: 10, output: 5, cache_creation: 3, cache_read: 2 },
      event: "UserPromptSubmit",
    });
    assert.equal(writeMetering(session, record, stateDir), true);
    assert.deepEqual(readMetering(session, stateDir), record);
    assert.equal(existsSync(meteringPath(session, stateDir)), true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("stale metering records beyond ORCH_DISABLE_TTL_MS return null and self-delete", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "orch-metering-"));
  const session = "session-stale";
  try {
    const record = buildMeteringRecord({
      session_id: session,
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: "transcript.jsonl",
      usage: { input: 1, output: 1 },
      event: "UserPromptSubmit",
    });
    record.updated_at = Date.now() - ORCH_DISABLE_TTL_MS - 1;
    assert.equal(writeMetering(session, record, stateDir), true);
    const path = meteringPath(session, stateDir);
    assert.equal(readMetering(session, stateDir), null);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
