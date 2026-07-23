/**
 * Unit tests for the stage machine in src/swarm.ts (compiled to dist/swarm.js).
 *
 * Tests createSwarmSession's transition table in isolation — pure in-memory
 * state, injected `now`, no spawning, no I/O. The pin window has its own file
 * (test/swarm-pin.test.mjs); here we only assert that state and TEXT are right.
 *
 * Why each case matters is encoded in the assertion comment (Rule 9: tests
 * verify intent, not just behavior).
 */

import assert from "node:assert/strict";
import {
  STAGE_COACHING,
  SWARM_COMPLETE_TEXT,
  SWARM_REENTRY_PREFIX,
  SWARM_RESET_TEXT,
  alreadyActiveText,
  createSwarmSession,
  invalidStageText,
  notActiveResetText,
  notActiveText,
  outOfOrderText,
  repeatText,
} from "../dist/swarm.js";

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

// Fixed clock: the stage machine never reads a wall clock of its own, so every
// call in this file can share one timestamp.
const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// (a) idle swarm(null) starts the swarm at stage 1
//     WHY: swarm()/swarm(null) is the documented start call. If it returned
//     anything but stage-1 coaching, the orchestrator would have no entry point
//     into the workflow at all.
// ---------------------------------------------------------------------------
test("idle swarm(null) returns stage-1 coaching and activates stage 1", () => {
  const s = createSwarmSession();
  const reply = s.handleCall(null, T0);
  assert.equal(
    reply.text,
    STAGE_COACHING[1],
    "start must return STAGE_COACHING[1] verbatim; any wrapper text would drift from the hardcoded contract"
  );
  const snap = s.snapshot(T0);
  assert.equal(snap.active, true, "a started swarm must report active");
  assert.equal(snap.current_stage, 1, "start must land on stage 1, not stage 0 or 2");
  assert.equal(
    snap.stage_name,
    "planning-team",
    "stage_name must track current_stage so get_status is readable without the stage table"
  );
});

// ---------------------------------------------------------------------------
// (b) full walk null,1..7
//     WHY: swarm(N) means "stage N is DONE", so each accepted call must return
//     the NEXT stage's coaching. An off-by-one here would coach the stage the
//     orchestrator just finished and stall the workflow forever.
// ---------------------------------------------------------------------------
test("walk null,1..7 returns each next stage's coaching then completes and resets", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  for (let k = 1; k <= 6; k++) {
    assert.equal(
      s.handleCall(k, T0).text,
      STAGE_COACHING[k + 1],
      `swarm(${k}) must return STAGE_COACHING[${k + 1}]; returning stage ${k} would loop the caller on finished work`
    );
    assert.equal(s.snapshot(T0).current_stage, k + 1, `swarm(${k}) must advance state to ${k + 1}`);
  }
  assert.equal(
    s.handleCall(7, T0).text,
    SWARM_COMPLETE_TEXT,
    "swarm(7) must return the terminal completion text, not an eighth stage"
  );
  assert.equal(
    s.snapshot(T0).active,
    false,
    "swarm(7) must reset to idle; a stuck ACTIVE(7) would block the next swarm in this session"
  );
  assert.equal(
    s.handleCall(null, T0).text,
    STAGE_COACHING[1],
    "after completion, swarm() must start a fresh swarm at stage 1"
  );
});

// ---------------------------------------------------------------------------
// (c) out-of-order calls are corrective, never advancing
//     WHY: a skipped or jumped stage must not silently move the machine. The
//     reply has to name the real current stage and carry its coaching, or the
//     orchestrator has no way back onto the sequence.
// ---------------------------------------------------------------------------
test("out-of-order calls return corrective coaching and change nothing", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0); // now at stage 2
  assert.equal(
    s.handleCall(3, T0).text,
    outOfOrderText(3, 2),
    "swarm(3) at stage 2 must return OUT-OF-ORDER text naming stage 2"
  );
  assert.equal(
    s.handleCall(7, T0).text,
    outOfOrderText(7, 2),
    "a far-ahead swarm(7) at stage 2 must also be corrective, never a completion"
  );
  assert.ok(
    s.handleCall(7, T0).text.endsWith(STAGE_COACHING[2]),
    "corrective replies must embed the CURRENT stage's coaching so the caller keeps working"
  );
  assert.equal(s.snapshot(T0).current_stage, 2, "corrective calls must leave state untouched");
  assert.equal(
    s.handleCall(2, T0).text,
    STAGE_COACHING[3],
    "the in-order call must still advance after any number of corrective calls"
  );
});

// ---------------------------------------------------------------------------
// (d) repeating the just-reported stage
//     WHY: a duplicate report is a common mistake, not an error. It gets its
//     own text (so the caller learns the report already landed) and must not
//     advance — double-advancing would skip a whole stage of real work.
// ---------------------------------------------------------------------------
test("repeating the just-reported stage returns REPEAT text and does not advance", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0); // now at stage 2
  assert.equal(
    s.handleCall(1, T0).text,
    repeatText(1, 2),
    "the second swarm(1) must return REPEAT text, distinct from the out-of-order text"
  );
  assert.equal(
    s.snapshot(T0).current_stage,
    2,
    "a repeat must not advance; if it did, stage 2's work would be skipped entirely"
  );
});

// ---------------------------------------------------------------------------
// (e) idle stage reports and idle reset
//     WHY: swarm state is in-memory and per-session, so a stage report with no
//     live swarm is a real scenario (new session, restarted server). It must
//     explain the recovery path instead of adopting a stage that never started.
// ---------------------------------------------------------------------------
test("idle swarm(3) and idle swarm(0) return NOT-ACTIVE coaching without adopting state", () => {
  const s = createSwarmSession();
  assert.equal(s.handleCall(3, T0).text, notActiveText(3), "idle swarm(3) must return NOT-ACTIVE text");
  assert.equal(
    s.snapshot(T0).active,
    false,
    "a cold stage report must NOT adopt a stage; adopting would arm a swarm that never planned anything"
  );
  assert.equal(
    s.handleCall(0, T0).text,
    notActiveResetText(),
    "idle swarm(0) must report there is nothing to reset rather than the RESET confirmation"
  );
});

// ---------------------------------------------------------------------------
// (f) post-handoff re-entry is swarm(5) and ONLY swarm(5)
//     WHY: the handoff starts a NEW session whose server holds no swarm state,
//     so exactly one cold call may adopt. Cold 6/7 must not adopt, or an
//     orchestrator could claim dispatch was done without any dispatch.
// ---------------------------------------------------------------------------
test("idle swarm(5) re-enters at stage 6; idle swarm(6)/swarm(7) do not adopt", () => {
  const s = createSwarmSession();
  assert.equal(
    s.handleCall(5, T0).text,
    `${SWARM_REENTRY_PREFIX}\n\n${STAGE_COACHING[6]}`,
    "cold swarm(5) must return the re-entry prefix followed by stage-6 coaching"
  );
  assert.equal(s.snapshot(T0).current_stage, 6, "cold swarm(5) must land on stage 6 (stage 5 recorded done)");

  const cold6 = createSwarmSession();
  assert.equal(cold6.handleCall(6, T0).text, notActiveText(6), "cold swarm(6) must be NOT-ACTIVE, never an adoption");
  assert.equal(cold6.snapshot(T0).active, false, "cold swarm(6) must leave the session idle");
  assert.equal(cold6.handleCall(7, T0).text, notActiveText(7), "cold swarm(7) must be NOT-ACTIVE, never a completion");
  assert.equal(cold6.snapshot(T0).active, false, "cold swarm(7) must leave the session idle");
});

// ---------------------------------------------------------------------------
// (g) explicit reset from an active swarm
//     WHY: swarm(0) is the documented escape hatch for an abandoned objective.
//     Without full state clearing, the next swarm() would refuse to start.
// ---------------------------------------------------------------------------
test("active swarm(0) clears stage and pin and returns RESET text", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  assert.equal(s.handleCall(0, T0).text, SWARM_RESET_TEXT, "active swarm(0) must return the RESET confirmation");
  const snap = s.snapshot(T0);
  assert.equal(snap.active, false, "swarm(0) must return the session to idle");
  assert.equal(snap.current_stage, null, "swarm(0) must clear the stage pointer");
  assert.equal(
    snap.pin_expires_at,
    null,
    "swarm(0) must clear the pin expiry too; a stale expiry would outlive the abandoned swarm"
  );
});

// ---------------------------------------------------------------------------
// (h) unknown stage values
//     WHY: validation lives in the handler, not the zod shape, so every bad
//     value gets readable corrective coaching instead of a protocol error the
//     model cannot act on. State must survive untouched.
// ---------------------------------------------------------------------------
test("non-integer and out-of-range stages return UNKNOWN text and change nothing", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0); // at stage 2
  for (const got of [1.5, -1, 8, NaN, Infinity]) {
    assert.equal(
      s.handleCall(got, T0).text,
      invalidStageText(got, 2),
      `swarm(${got}) must return UNKNOWN text naming the expected current call`
    );
    assert.equal(s.snapshot(T0).current_stage, 2, `swarm(${got}) must not disturb the current stage`);
  }
  const idle = createSwarmSession();
  assert.equal(
    idle.handleCall(9, T0).text,
    invalidStageText(9, null),
    "while idle, UNKNOWN text must point at swarm() to start rather than naming a stage"
  );
});

// ---------------------------------------------------------------------------
// (i) swarm(null) while a swarm is already running
//     WHY: a second start must not silently restart the workflow at stage 1 and
//     throw away the plan work already done; it reports and re-coaches instead.
// ---------------------------------------------------------------------------
test("swarm(null) while active returns ALREADY-ACTIVE and does not restart", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0); // at stage 2
  assert.equal(
    s.handleCall(null, T0).text,
    alreadyActiveText(2),
    "a second swarm() must return ALREADY-ACTIVE text embedding stage-2 coaching"
  );
  assert.equal(
    s.snapshot(T0).current_stage,
    2,
    "a second swarm() must not reset to stage 1; that would discard completed stages silently"
  );
});

// ---------------------------------------------------------------------------
// Print summary and fail if any test failed
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
