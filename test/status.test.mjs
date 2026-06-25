import assert from "node:assert/strict";
import {
  HEARTBEAT_TIMEOUT_MS,
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

// --- HEARTBEAT_TIMEOUT_MS ---
// WHY: the visible-stream heartbeat window is 10 minutes. A live agent only
// flips to `stalled` after 10 min with NO parsed visible provider stream item
// (raw stdout/stderr bytes do not refresh the heartbeat).

test("HEARTBEAT_TIMEOUT_MS is 600000 (10 minutes)", () => {
  assert.equal(HEARTBEAT_TIMEOUT_MS, 600000);
});

// --- computeStatusTransition: heartbeat-driven live transitions ---
// WHY: processing/stalled derive purely from the visible-stream heartbeat. A
// quiet-but-alive agent must be labeled `stalled`, never killed as dead.

test("processing -> stalled after >10min with no visible activity", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: null,
    lastActivity: NOW - (600000 + 1),
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "stalled");
  assert.equal(r.exitedAt, null, "live transition must not stamp exitedAt");
});

test("processing stays processing at exactly 10min heartbeat (boundary, not >)", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: null,
    lastActivity: NOW - 600000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "processing");
});

test("stalled -> processing when visible activity resumes (heartbeat <= 10min)", () => {
  const r = computeStatusTransition({
    status: "stalled",
    exitCode: null,
    lastActivity: NOW - 5000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "processing");
});

test("stalled stays stalled while still quiet (>10min heartbeat)", () => {
  const r = computeStatusTransition({
    status: "stalled",
    exitCode: null,
    lastActivity: NOW - 1_200_000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "stalled");
});

// --- computeStatusTransition: exit reconciliation is FIRST/authoritative ---
// WHY: an exited process must report finished/errored regardless of heartbeat
// age, killing the up-to-10s monitor lag.

test("processing -> finished when exitCode 0", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: 0,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "finished");
  assert.equal(r.exitedAt, NOW, "exitedAt stamped to now when first reconciled");
});

test("processing -> errored when exitCode != 0", () => {
  const r = computeStatusTransition({
    status: "processing",
    exitCode: 1,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "errored");
  assert.equal(r.exitedAt, NOW);
});

test("stalled -> finished when exitCode 0 (overrides heartbeat)", () => {
  const r = computeStatusTransition({
    status: "stalled",
    exitCode: 0,
    lastActivity: NOW - 999999,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "finished", "exit reconcile must win over stalled->processing");
});

test("stalled -> errored when exitCode != 0", () => {
  const r = computeStatusTransition({
    status: "stalled",
    exitCode: 137,
    lastActivity: NOW - 999999,
    now: NOW,
    exitedAt: null,
  });
  assert.equal(r.status, "errored");
});

test("existing exitedAt is preserved, not overwritten with now", () => {
  const earlier = NOW - 50000;
  const r = computeStatusTransition({
    status: "processing",
    exitCode: 0,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: earlier,
  });
  assert.equal(r.exitedAt, earlier);
});

// --- terminal states are inert (the helper never resurrects them) ---

test("finished stays finished (terminal, not live)", () => {
  const r = computeStatusTransition({
    status: "finished",
    exitCode: 0,
    lastActivity: NOW - 999999,
    now: NOW,
    exitedAt: NOW - 10,
  });
  assert.equal(r.status, "finished");
  assert.equal(r.exitedAt, NOW - 10);
});

test("stopped stays stopped even with exitCode set", () => {
  const r = computeStatusTransition({
    status: "stopped",
    exitCode: -1,
    lastActivity: NOW - 1000,
    now: NOW,
    exitedAt: NOW - 10,
  });
  assert.equal(r.status, "stopped");
});

// --- buildLivenessFields: output shape for poll_agent + list_agents ---
// WHY: callers need `alive` + `idle_seconds` always, and a `hint` ONLY when
// stalled so they wait/poll instead of killing a live-but-quiet agent.

test("buildLivenessFields: processing has alive=true, idle_seconds, no hint", () => {
  const f = buildLivenessFields("processing", null, NOW - 12000, NOW);
  assert.equal(f.alive, true);
  assert.equal(f.idle_seconds, 12);
  assert.equal(f.hint, undefined, "no hint unless stalled");
});

test("buildLivenessFields: stalled has alive=true and a hint mentioning idle seconds", () => {
  const f = buildLivenessFields("stalled", null, NOW - 700000, NOW);
  assert.equal(f.alive, true);
  assert.equal(f.idle_seconds, 700);
  assert.ok(typeof f.hint === "string" && f.hint.length > 0, "hint must be present when stalled");
  assert.ok(f.hint.includes("700s"), `hint must embed idle_seconds: ${f.hint}`);
  assert.ok(/wait/.test(f.hint), "hint should steer caller to wait/re-poll");
});

// WHY: list_agents opts out of the hint to stay token-efficient; the same live
// stalled agent must yield NO hint when includeHint=false.
test("buildLivenessFields: stalled with includeHint=false omits the hint", () => {
  const f = buildLivenessFields("stalled", null, NOW - 700000, NOW, false);
  assert.equal(f.alive, true);
  assert.equal(f.hint, undefined, "list_agents must not carry the verbose hint");
});

test("buildLivenessFields: finished has alive=false and no hint", () => {
  const f = buildLivenessFields("finished", 0, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: errored has alive=false and no hint", () => {
  const f = buildLivenessFields("errored", 1, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: stopped has alive=false and no hint", () => {
  const f = buildLivenessFields("stopped", -1, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: zombie_killed has alive=false and no hint", () => {
  const f = buildLivenessFields("zombie_killed", -1, NOW - 1000, NOW);
  assert.equal(f.alive, false);
  assert.equal(f.hint, undefined);
});

test("buildLivenessFields: alive is false if exitCode set even on live label", () => {
  // Defensive: status reconcile runs first, but exitCode is the source of truth.
  const f = buildLivenessFields("processing", 0, NOW, NOW);
  assert.equal(f.alive, false, "exitCode !== null means not alive");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
