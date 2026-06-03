import assert from "node:assert/strict";
import {
  STALL_THRESHOLD,
  computeStatusTransition,
  buildLivenessFields,
} from "../dist/status-helpers.js";

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

const NOW = 1_000_000_000_000;

// --- STALL_THRESHOLD ---

test("STALL_THRESHOLD is 60000", () => {
  assert.equal(STALL_THRESHOLD, 60000);
});

// --- computeStatusTransition: idle-driven live transitions ---
// WHY: a quiet-but-alive agent must be labeled `processing`, not killed as dead.

test("running -> processing after >60s idle while alive (exitCode null)", () => {
  const r = computeStatusTransition({
    status: "running",
    exitCode: null,
    lastActivity: NOW - 61000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "processing");
  assert.equal(r.exitedAt, null, "live transition must not stamp exitedAt");
});

test("running stays running at exactly 60s idle (boundary, not >)", () => {
  const r = computeStatusTransition({
    status: "running",
    exitCode: null,
    lastActivity: NOW - 60000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "running");
});

test("processing -> running when output resumes (idle <= 60s)", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: null,
    lastActivity: NOW - 5000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "running");
});

test("processing stays processing while still quiet (>60s idle)", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: null,
    lastActivity: NOW - 120000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "processing");
});

// --- computeStatusTransition: exit reconciliation is FIRST/authoritative ---
// WHY: an exited process must report completed/failed regardless of idle time,
// killing the up-to-10s monitor lag.

test("running -> completed when exitCode 0", () => {
  const r = computeStatusTransition({
    status: "running",
    exitCode: 0,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "completed");
  assert.equal(r.exitedAt, NOW, "exitedAt stamped to now when first reconciled");
});

test("running -> failed when exitCode != 0", () => {
  const r = computeStatusTransition({
    status: "running",
    exitCode: 1,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "failed");
  assert.equal(r.exitedAt, NOW);
});

test("processing -> completed when exitCode 0 (overrides idle)", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: 0,
    lastActivity: NOW - 999999,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "completed", "exit reconcile must win over idle->running");
});

test("processing -> failed when exitCode != 0", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: 137,
    lastActivity: NOW - 999999,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "failed");
});

test("existing exitedAt is preserved, not overwritten with now", () => {
  const earlier = NOW - 50000;
  const r = computeStatusTransition({
    status: "running",
    exitCode: 0,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: earlier,
  });
  assert.equal(r.exitedAt, earlier);
});

// --- terminal states are inert (the helper never resurrects them) ---

test("completed stays completed (terminal, not live)", () => {
  const r = computeStatusTransition({
    status: "completed",
    exitCode: 0,
    lastActivity: NOW - 999999,
    now: NOW,
    exitedAt: NOW - 10,
  });
  assert.equal(r.status, "completed");
  assert.equal(r.exitedAt, NOW - 10);
});

test("killed stays killed even with exitCode set", () => {
  const r = computeStatusTransition({
    status: "killed",
    exitCode: -1,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: NOW - 10,
  });
  assert.equal(r.status, "killed");
});

// --- buildLivenessFields: output shape for poll_agent + list_agents ---
// WHY: callers need `alive` + `idle_seconds` always, and a `hint` ONLY when
// processing so they wait/poll instead of killing a live-but-quiet agent.

test("buildLivenessFields: running has alive=true, idle_seconds, no hint", () => {
  const f = buildLivenessFields("running", null, NOW - 12000, NOW);
  assert.equal(f.alive, true);
  assert.equal(f.idle_seconds, 12);
  assert.equal(f.hint, undefined, "no hint unless processing");
});

test("buildLivenessFields: processing has alive=true and a hint mentioning idle seconds", () => {
  const f = buildLivenessFields("processing", null, NOW - 90000, NOW);
  assert.equal(f.alive, true);
  assert.equal(f.idle_seconds, 90);
  assert.ok(typeof f.hint === "string" && f.hint.length > 0, "hint must be present when processing");
  assert.ok(f.hint.includes("90s"), `hint must embed idle_seconds: ${f.hint}`);
  assert.ok(/wait/.test(f.hint), "hint should steer caller to wait/re-poll");
});

test("buildLivenessFields: completed has alive=false and no hint", () => {
  const f = buildLivenessFields("completed", 0, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: failed has alive=false and no hint", () => {
  const f = buildLivenessFields("failed", 1, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: killed has alive=false and no hint", () => {
  const f = buildLivenessFields("killed", -1, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: alive is false if exitCode set even on live label", () => {
  // Defensive: status reconcile runs first, but exitCode is the source of truth.
  const f = buildLivenessFields("running", 0, NOW, NOW);
  assert.equal(f.alive, false, "exitCode !== null means not alive");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
