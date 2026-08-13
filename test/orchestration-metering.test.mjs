import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CODEX_AUTOCOMPACT_PCT,
  COMPACTION_DROP_THRESHOLD_PCT,
  COMPACTION_SAMPLE_MAX_AGE_MS,
  DEFAULT_CONTEXT_WINDOW,
  HANDOFF_REQUIRED_THRESHOLD_PCT,
  HANDOFF_UNLOCK_THRESHOLD_PCT,
  PLAN_LATCH_THRESHOLD_PCT,
  LONG_CONTEXT_WINDOW,
  buildMeteringRecord,
  computeUsedPercentage,
  detectCompaction,
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

test("harnessContextWindow prevents false 100% clamp when usage exceeds static map", () => {
  // A Codex turn whose prompt-side tokens exceed the static-map
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

// The plan latch is fixed at 15 and the voluntary handoff unlock is fixed at 20.
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

test("buildMeteringRecord assembles the metering record shape", () => {
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
  assert.equal(record.event, "UserPromptSubmit");
  assert.ok(record.updated_at >= before);
});

// ---------------------------------------------------------------------------
// Shared #370 constants are the single source of truth. Compaction is preceded
// by a mandatory fresh handoff write at H = CODEX_AUTOCOMPACT_PCT - 10, ten points before the
// host auto-compacts, and detected by a single >= COMPACTION_DROP_THRESHOLD_PCT
// point drop between two adjacent samples.
// ---------------------------------------------------------------------------
test("host auto-compaction constant is a hard-coded 90 (Codex 0.147.0 parity)", () => {
  assert.equal(CODEX_AUTOCOMPACT_PCT, 90,
    "CODEX_AUTOCOMPACT_PCT must be the fixed 90% host auto-compact point");
});

test("mandatory handoff-write threshold H is 80 = autocompact - 10", () => {
  assert.equal(HANDOFF_REQUIRED_THRESHOLD_PCT, 80,
    "H must induce fresh writes 10 points before host auto-compaction");
  assert.equal(HANDOFF_REQUIRED_THRESHOLD_PCT, CODEX_AUTOCOMPACT_PCT - 10,
    "H must be derived from the autocompact constant, not a free literal");
});

test("compaction drop threshold is a hard-coded 10 points", () => {
  assert.equal(COMPACTION_DROP_THRESHOLD_PCT, 10,
    "a >= 10-point utilization drop between adjacent samples IS auto-compaction");
});

test("the mandatory-handoff threshold sits strictly above the voluntary 20% unlock", () => {
  // Preserve the two-tier design: 20% opens the VOLUNTARY goal-capture write; 80%
  // is the MANDATORY fresh-write lifecycle transition. They must not collapse.
  assert.equal(HANDOFF_UNLOCK_THRESHOLD_PCT, 20);
  assert.ok(HANDOFF_REQUIRED_THRESHOLD_PCT > HANDOFF_UNLOCK_THRESHOLD_PCT,
    "the mandatory H (80) must stay above the voluntary unlock (20)");
});

// ---------------------------------------------------------------------------
// Compaction detection — ONE adjacent previous/current sample comparison against
// the exact CompactionSample shape (sample_seq / sample_kind /
// compaction_generation). Every call passes an explicit options.now
// so freshness is deterministic, and every assertion reads result.detected /
// result.reason / result.drop_pct directly. NOW is well past the max sample age
// so the canonical pair is fresh; each rejection row breaks exactly ONE
// precondition and pins the EXACT reason the detector must return, so no row can
// pass vacuously.
// ---------------------------------------------------------------------------
const NOW = 10_000_000;

// The canonical accepted pair: same session/harness/model/source/window,
// monotonic adjacent sample_seq, monotonic fresh timestamps, both percentages
// known, previous >= 80, current dropped 45 points, current per-turn sample, a
// fresh provider generation fingerprint on the current sample.
function basePair() {
  const previous = {
    session_id: "s-compaction",
    harness: "claude",
    model: "claude-sonnet-4-5",
    source_ref: "transcript.jsonl",
    context_window_size: DEFAULT_CONTEXT_WINDOW,
    used_percentage: 85,
    sample_seq: 10,
    sample_kind: "current",
    updated_at: NOW - 60_000,
  };
  const current = {
    ...previous,
    used_percentage: 40,
    sample_seq: 11,
    compaction_generation: "gen-cur",
    updated_at: NOW - 1_000,
  };
  return { previous, current };
}

test("a fresh proof detects an adjacent >= 10-point drop from >= 80%", () => {
  const { previous, current } = basePair();
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, true, "the canonical adjacent >= 10-point drop with new proof is a compaction");
  assert.equal(result.reason, null, "an accepted pair carries no rejection reason");
  assert.equal(result.drop_pct, 45, "drop_pct is previous - current utilization");
});

// [label, expected reason, expected drop_pct, mutate(previous, current)].
// Each mutation makes the TARGET guard the FIRST one to fail, so the reason
// asserted is the one that guard produces.
const REJECTIONS = [
  ["session mismatch", "session-mismatch", null, (p, c) => { c.session_id = "other-session"; }],
  ["harness mismatch", "harness-mismatch", null, (p, c) => { c.harness = "codex"; }],
  ["model change", "model-change", null, (p, c) => { c.model = "claude-haiku-4-5"; }],
  ["source mismatch", "source-mismatch", null, (p, c) => { c.source_ref = "other.jsonl"; }],
  ["context-window change", "context-window-change", null, (p, c) => { c.context_window_size = LONG_CONTEXT_WINDOW; }],
  ["cumulative-token artifact", "cumulative-sample", null, (p, c) => { c.sample_kind = "cumulative"; }],
  ["cumulative previous sample with fresh proof", "cumulative-sample", null, (p) => { p.sample_kind = "cumulative"; }],
  ["out-of-order (equal) sample sequence", "non-monotonic-sequence", null, (p, c) => { c.sample_seq = p.sample_seq; }],
  ["non-numeric sample sequence", "non-monotonic-sequence", null, (p, c) => { c.sample_seq = Number.NaN; }],
  ["non-adjacent sample sequence", "non-adjacent-sequence", null, (p, c) => { c.sample_seq = p.sample_seq + 2; }],
  ["out-of-order timestamp", "non-monotonic-timestamp", null, (p, c) => { c.updated_at = p.updated_at - 1; }],
  ["current sample exceeds the age limit", "stale-sample", null, (p, c) => {
    c.updated_at = NOW - (COMPACTION_SAMPLE_MAX_AGE_MS + 1);
    p.updated_at = c.updated_at - 500;
  }],
  ["stale gap between adjacent samples", "stale-sample", null, (p, c) => {
    c.updated_at = NOW - 1_000;
    p.updated_at = c.updated_at - (COMPACTION_SAMPLE_MAX_AGE_MS + 1);
  }],
  ["unknown current percentage", "unknown-percentage", null, (p, c) => { c.used_percentage = null; }],
  ["unknown previous percentage", "unknown-percentage", null, (p, c) => { p.used_percentage = null; }],
  ["previous below the 80% required floor", "previous-below-threshold", null, (p, c) => { p.used_percentage = 70; }],
  ["normal small decrease below the drop threshold", "insufficient-drop", 5, (p, c) => { c.used_percentage = p.used_percentage - 5; }],
];

for (const [label, reason, drop, mutate] of REJECTIONS) {
  test(`compaction detection rejects: ${label} -> ${reason}`, () => {
    const { previous, current } = basePair();
    mutate(previous, current);
    const result = detectCompaction(previous, current, { now: NOW });
    assert.equal(result.detected, false, `${label} must NOT be a compaction`);
    assert.equal(result.reason, reason, `${label} must reject with reason "${reason}"`);
    assert.equal(result.drop_pct, drop, `${label} drop_pct must be ${JSON.stringify(drop)}`);
  });
}

test("compaction detection rejects a missing previous sample -> no-previous", () => {
  const { current } = basePair();
  const result = detectCompaction(null, current, { now: NOW });
  assert.equal(result.detected, false);
  assert.equal(result.reason, "no-previous");
  assert.equal(result.drop_pct, null);
});

// ---------------------------------------------------------------------------
// Practical proof requires a current string fingerprint. The adjacent
// pre-compaction sample naturally omits it. Missing/null current proof is
// rejected, and the persisted proof makes replay reject as same-generation.
// ---------------------------------------------------------------------------
test("a fresh proof is accepted when the pre-compaction sample omits generation", () => {
  const { previous, current } = basePair();
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, true);
  assert.equal(result.reason, null);
  assert.equal(result.drop_pct, 45);
});

test("a fresh proof is accepted when the pre-compaction sample has null generation", () => {
  const { previous, current } = basePair();
  previous.compaction_generation = null;
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, true);
  assert.equal(result.reason, null);
  assert.equal(result.drop_pct, 45);
});

test("an undefined current generation never triggers -> no-generation-proof", () => {
  const { previous, current } = basePair();
  delete current.compaction_generation;
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, false, "an unbaselined current sample carries no proof");
  assert.equal(result.reason, "no-generation-proof");
  assert.equal(result.drop_pct, null);
});

test("no proof (null generation) never triggers -> no-generation-proof", () => {
  const { previous, current } = basePair();
  current.compaction_generation = null; // provider found no eligible proof
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, false, "an explicit null proof is not a generation fingerprint");
  assert.equal(result.reason, "no-generation-proof");
  assert.equal(result.drop_pct, null);
});

test("same proof (unchanged generation) never triggers -> same-generation", () => {
  const { previous, current } = basePair();
  previous.compaction_generation = current.compaction_generation;
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, false, "an unchanged fingerprint is the same generation, not a compaction");
  assert.equal(result.reason, "same-generation");
  assert.equal(result.drop_pct, null);
});

test("a proof different from the prior persisted proof is detected", () => {
  const { previous, current } = basePair();
  previous.compaction_generation = "gen-prior";
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, true, "a changed fingerprint with a >= 10-point drop from >= 80% is a compaction");
  assert.equal(result.reason, null);
  assert.equal(result.drop_pct, 45);
});

test("replay of the detected proof is rejected exactly once", () => {
  const first = basePair();
  const detected = detectCompaction(first.previous, first.current, { now: NOW });
  assert.equal(detected.detected, true);

  const replay = {
    ...first.current,
    sample_seq: first.current.sample_seq + 1,
    updated_at: first.current.updated_at + 500,
  };
  const result = detectCompaction(first.current, replay, { now: NOW });
  assert.equal(result.detected, false);
  assert.equal(result.reason, "same-generation");
});

// A new generation fingerprint is NECESSARY but NOT SUFFICIENT: the adjacent
// drop still gates. Both harnesses are accepted only when the drop qualifies,
// and rejected on an insufficient drop even though the proof changed.
test("Claude and Codex generation accepted only with a qualifying adjacent drop", () => {
  for (const [harness, model, window] of [
    ["claude", "claude-sonnet-4-5", DEFAULT_CONTEXT_WINDOW],
    ["codex", "gpt-5", 258400],
  ]) {
    const { previous, current } = basePair();
    previous.harness = current.harness = harness;
    previous.model = current.model = model;
    previous.context_window_size = current.context_window_size = window;
    current.compaction_generation = harness === "claude"
      ? "claude:0193f8a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b"
      : "codex-window:7";

    // Qualifying drop (85 -> 40) with a new generation -> detected.
    const detected = detectCompaction(previous, current, { now: NOW });
    assert.equal(detected.detected, true, `${harness}: new generation + 45-point drop is a compaction`);
    assert.equal(detected.reason, null);

    // Same generation, same drop -> the drop alone never fires.
    const sameGen = basePair();
    sameGen.previous.harness = sameGen.current.harness = harness;
    sameGen.previous.model = sameGen.current.model = model;
    sameGen.previous.context_window_size = sameGen.current.context_window_size = window;
    sameGen.previous.compaction_generation = sameGen.current.compaction_generation =
      current.compaction_generation;
    const sameResult = detectCompaction(sameGen.previous, sameGen.current, { now: NOW });
    assert.equal(sameResult.detected, false, `${harness}: an unchanged generation never fires on drop alone`);
    assert.equal(sameResult.reason, "same-generation");

    // New generation but an insufficient drop -> still rejected on the drop gate.
    const small = basePair();
    small.previous.harness = small.current.harness = harness;
    small.previous.model = small.current.model = model;
    small.previous.context_window_size = small.current.context_window_size = window;
    small.current.used_percentage = small.previous.used_percentage - 5;
    const smallResult = detectCompaction(small.previous, small.current, { now: NOW });
    assert.equal(smallResult.detected, false, `${harness}: a new generation without a qualifying drop does not fire`);
    assert.equal(smallResult.reason, "insufficient-drop");
    assert.equal(smallResult.drop_pct, 5);
  }
});

// Codex Practical proof accepts an exact compacted generation plus the guarded
// adjacent drop; the rollout does not label the compacted record's trigger.
test("Codex Practical proof qualifies with an exact compacted generation", () => {
  const { previous, current } = basePair();
  previous.harness = current.harness = "codex";
  previous.model = current.model = "gpt-5";
  previous.context_window_size = current.context_window_size = 258400;
  previous.used_percentage = 82;
  current.used_percentage = 30;
  current.compaction_generation = "codex-window:8";
  const result = detectCompaction(previous, current, { now: NOW });
  assert.equal(result.detected, true);
  assert.equal(result.reason, null);
  assert.equal(result.drop_pct, 52);
});

// A NEW generation proof does NOT rescue a pair that breaks a structural guard:
// model and window changes still reject even when the fingerprint changed.
test("model and window changes reject even with a new generation proof", () => {
  const modelChange = basePair();
  modelChange.current.model = "claude-haiku-4-5"; // still a fresh generation fingerprint
  const modelResult = detectCompaction(modelChange.previous, modelChange.current, { now: NOW });
  assert.equal(modelResult.detected, false, "a model change is rejected before the proof can apply");
  assert.equal(modelResult.reason, "model-change");

  const windowChange = basePair();
  windowChange.current.context_window_size = LONG_CONTEXT_WINDOW;
  const windowResult = detectCompaction(windowChange.previous, windowChange.current, { now: NOW });
  assert.equal(windowResult.detected, false, "a window change is rejected before the proof can apply");
  assert.equal(windowResult.reason, "context-window-change");
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

test("507437 tokens ratchet claude-fable-5 to 1M instead of clamping to 100", () => {
  const record = buildMeteringRecord({
    session_id: "s-ratchet-507437",
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

test("claude-fable session ratchets from prior floor to 1M", () => {
  const record = buildMeteringRecord({
    session_id: "s-current-fable-ratchet",
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
