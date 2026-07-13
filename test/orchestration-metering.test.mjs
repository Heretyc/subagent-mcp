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
  DEFAULT_CONTEXT_WINDOW,
  HANDOFF_UNLOCK_THRESHOLD_PCT,
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
  assert.equal(resolveContextWindow("claude", "not-claude"), null);
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
  assert.equal(resolveContextWindow("codex", "unknown-model"), null);
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

test("phaseFor thresholds are inclusive at 15 and 50", () => {
  assert.equal(phaseFor(null), "normal");
  assert.equal(phaseFor(14.99), "normal");
  assert.equal(phaseFor(15), "plan");
  assert.equal(phaseFor(49.99), "plan");
  assert.equal(phaseFor(50), "handoff");
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
    window: null,
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
  assert.equal(phaseFor(caseA.used_percentage), "plan");
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

test("unknown non-claude and contradictions persist unknown percentages", () => {
  const unknown = buildMeteringRecord({
    session_id: "s-unknown-codex",
    harness: "codex",
    model: "gpt-new-unknown",
    source_ref: "rollout.jsonl",
    usage: { input: 1, output: 1 },
    event: "UserPromptSubmit",
  });
  assert.equal(unknown.context_window_size, null);
  assert.equal(unknown.used_percentage, null);

  const contradiction = buildMeteringRecord({
    session_id: "s-contradiction",
    harness: "claude",
    model: "claude-fable-5",
    source_ref: "transcript.jsonl",
    usage: { input: 1200000, output: 1, cache_creation: 0, cache_read: 0 },
    event: "UserPromptSubmit",
    longContextHint: true,
  });
  assert.equal(contradiction.context_window_size, null);
  assert.equal(contradiction.window_source, "contradiction");
  assert.equal(contradiction.used_percentage, null);
});

test("missing or corrupt context window asset fails safe to null", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-metering-map-"));
  const bad = join(dir, "bad.json");
  try {
    writeFileSync(bad, "{", "utf8");
    setContextWindowsPathForTest(bad);
    assert.equal(resolveContextWindow("claude", "claude-fable-5"), null);
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
