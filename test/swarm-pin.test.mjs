/**
 * Unit tests for the swarm performance pin in src/swarm.ts (dist/swarm.js).
 *
 * The pin is the ONLY new way to reach the performance routing band outside
 * manual/profiler paths, so its bounds are the security-relevant part of the
 * swarm feature: armed only by a genuine start, RESTARTED ONLY BY AN ACCEPTED
 * FORWARD ADVANCE, force-cleared when handoff becomes the next stage, and dead
 * after 1 hour regardless. Pure state + injected `now`; no timers, no I/O.
 *
 * Why each case matters is encoded in the assertion comment (Rule 9: tests
 * verify intent, not just behavior).
 */

import assert from "node:assert/strict";
import { SWARM_PIN_WINDOW_MS, createSwarmSession, resolveBranch } from "../dist/swarm.js";

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

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;

// ---------------------------------------------------------------------------
// (a) arm on start, lazy strict-boundary expiry
//     WHY: expiry is evaluated lazily at read time (no timer), so it must hold
//     with NO intervening call. "Active strictly before expiry" is the contract:
//     at exactly +1h the pin is off, so the window can never be off-by-one long.
// ---------------------------------------------------------------------------
test("idle never pins; start arms a window that dies exactly at +1h", () => {
  const s = createSwarmSession();
  assert.equal(
    s.pinActive(T0),
    false,
    "a fresh session must not pin; if it did, every pure-auto launch would route performance with no swarm at all"
  );
  s.handleCall(null, T0);
  assert.equal(s.pinActive(T0), true, "the start call must arm the pin for stage 1");
  assert.equal(
    s.pinActive(T0 + SWARM_PIN_WINDOW_MS - 1),
    true,
    "the pin must stay active up to the last millisecond before expiry"
  );
  assert.equal(
    s.pinActive(T0 + SWARM_PIN_WINDOW_MS),
    false,
    "at exactly +1h the pin must be off with no intervening call; lazy expiry is the only auto-off clock"
  );
});

// ---------------------------------------------------------------------------
// (b) accepted forward advances RESTART the window
//     WHY: each pre-handoff stage is real work, so an accepted advance replaces
//     the expiry rather than extending it. Replacement keeps the bound at 1h
//     from the last genuine advance, never a growing sum.
// ---------------------------------------------------------------------------
test("accepted swarm(1)/swarm(2)/swarm(3) restart the window from the call time", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0 + 50 * MIN); // stage 2, expiry restarted to +110min
  assert.equal(
    s.pinActive(T0 + 100 * MIN),
    true,
    "an accepted advance must restart the window; without restart the pin would already be dead at +100min"
  );
  assert.equal(
    s.pinActive(T0 + 110 * MIN),
    false,
    "the restarted window must still be exactly 1h from the advance, not an extension of the old one"
  );

  const s2 = createSwarmSession();
  s2.handleCall(null, T0);
  s2.handleCall(1, T0 + 10 * MIN);
  s2.handleCall(2, T0 + 20 * MIN);
  s2.handleCall(3, T0 + 30 * MIN); // stage 4, expiry +90min
  assert.equal(s2.pinActive(T0 + 89 * MIN), true, "swarm(2)/swarm(3) must restart the window the same way");
  assert.equal(s2.pinActive(T0 + 90 * MIN), false, "the last restart must still expire exactly 1h after it");
});

// ---------------------------------------------------------------------------
// (c) ANTI-GAMING: rejected calls never touch the window
//     WHY: this is the documented rule that makes the pin unfarmable. If a
//     repeated stage report (or any out-of-order call) restarted the window, an
//     orchestrator could hold performance routing open indefinitely by spamming
//     one number — no real work required.
// ---------------------------------------------------------------------------
test("repeat and out-of-order calls do NOT restart the pin window", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0); // stage 2, expiry T0 + 1h
  s.handleCall(1, T0 + 59 * MIN); // repeat of the just-reported stage
  s.handleCall(7, T0 + 59 * MIN); // far out-of-order
  s.handleCall(null, T0 + 59 * MIN); // already-active
  s.handleCall(1.5, T0 + 59 * MIN); // unknown stage
  assert.equal(
    s.pinActive(T0 + SWARM_PIN_WINDOW_MS - 1),
    true,
    "rejected calls must leave the original window intact"
  );
  assert.equal(
    s.pinActive(T0 + SWARM_PIN_WINDOW_MS),
    false,
    "the pin must still expire at the stage-2 restart time; any later expiry means a rejected call armed it"
  );
});

// ---------------------------------------------------------------------------
// (d) handoff-next auto-off
//     WHY: stage 5 is the handoff, after which the session ends. Clearing the
//     pin the moment handoff becomes next means the pin cannot outlive the
//     pre-handoff work even if the 1h clock has time left.
// ---------------------------------------------------------------------------
test("accepted swarm(4) clears the pin immediately (handoff is next)", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  s.handleCall(1, T0);
  s.handleCall(2, T0);
  s.handleCall(3, T0);
  assert.equal(s.pinActive(T0), true, "stage 4 is still pre-handoff, so the pin must be live before swarm(4)");
  s.handleCall(4, T0); // stage 5 = handoff
  assert.equal(
    s.pinActive(T0 + 1),
    false,
    "swarm(4) must force-clear the pin; a live pin here would survive into the handoff with ~1h left"
  );
  assert.equal(
    s.snapshot(T0 + 1).pin_expires_at,
    null,
    "the expiry itself must be cleared, not merely ignored, so get_status cannot report a phantom window"
  );
});

// ---------------------------------------------------------------------------
// (e) whichever auto-off comes first wins
//     WHY: a swarm abandoned mid-stage (handoff never reached) must not keep
//     the pin forever. The 1h clock is the backstop for that case.
// ---------------------------------------------------------------------------
test("an abandoned swarm still loses the pin at +1h without ever reaching handoff", () => {
  const s = createSwarmSession();
  s.handleCall(null, T0);
  assert.equal(s.snapshot(T0 + SWARM_PIN_WINDOW_MS).current_stage, 1, "the stage pointer legitimately survives");
  assert.equal(
    s.pinActive(T0 + SWARM_PIN_WINDOW_MS),
    false,
    "the 1h backstop must fire even though handoff never became next"
  );
});

// ---------------------------------------------------------------------------
// (f) post-handoff stages never pin
//     WHY: stages 5-7 (handoff, dispatch, test) are delegation-heavy and out of
//     scope for the pin, and cold re-entry has no verified swarm start behind
//     it — adopting a pin there would be a free performance lever.
// ---------------------------------------------------------------------------
test("cold swarm(5) re-entry and stages 6-7 never arm the pin", () => {
  const s = createSwarmSession();
  s.handleCall(5, T0); // cold re-entry -> stage 6
  assert.equal(s.pinActive(T0), false, "cold re-entry must not arm the pin; it is the one unverified adoption path");
  s.handleCall(6, T0); // stage 7
  assert.equal(s.pinActive(T0), false, "stage 7 must not pin either");
  s.handleCall(0, T0);
  const snap = s.snapshot(T0);
  assert.equal(snap.pin_active, false, "after reset the snapshot must report no pin");
  assert.equal(snap.pin_expires_at, null, "after reset the snapshot must report no expiry");
});

// ---------------------------------------------------------------------------
// (g) resolveBranch truth table
//     WHY: the pin sits INSIDE the pure-auto guard exactly like the deadlock
//     window. If it escaped that guard, provider/provider_model launches would
//     stop always reading cost_efficiency and break the documented invariant.
// ---------------------------------------------------------------------------
test("resolveBranch selects performance only for pure-auto with a live pin or deadlock window", () => {
  assert.equal(resolveBranch(true, false, true), "performance", "pure auto + swarm pin must route performance");
  assert.equal(resolveBranch(true, true, false), "performance", "pure auto + deadlock window must stay performance");
  assert.equal(resolveBranch(true, true, true), "performance", "both signals together must stay performance");
  assert.equal(
    resolveBranch(false, false, true),
    "cost_efficiency",
    "a pinned swarm must NOT flip provider/provider_model launches off cost_efficiency"
  );
  assert.equal(
    resolveBranch(false, true, false),
    "cost_efficiency",
    "the deadlock window keeps its existing pure-auto-only behavior"
  );
  assert.equal(
    resolveBranch(false, false, false),
    "cost_efficiency",
    "the default branch must be unchanged when nothing is active"
  );
  assert.equal(
    resolveBranch(true, false, false),
    "cost_efficiency",
    "an unpinned pure-auto launch must reproduce today's cost_efficiency routing exactly"
  );
});

// ---------------------------------------------------------------------------
// Print summary and fail if any test failed
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
