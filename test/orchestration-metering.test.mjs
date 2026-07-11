import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
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
  assert.equal(resolveContextWindow("codex", "unknown-model"), null);
  assert.equal(resolveContextWindow("codex", "gpt-5"), DEFAULT_CONTEXT_WINDOW);
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
  assert.equal(record.context_window_size, DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(record.usage, {
    input: 60000,
    output: 30000,
    cache_creation: 5000,
    cache_read: 5000,
  });
  assert.equal(record.used_tokens, 100000);
  assert.equal(record.used_percentage, HANDOFF_UNLOCK_THRESHOLD_PCT);
  assert.equal(record.near_limit, true);
  assert.equal(record.event, "UserPromptSubmit");
  assert.ok(record.updated_at >= before);
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
