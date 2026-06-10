/**
 * Unit tests for src/deadlock.ts (compiled to dist/deadlock.js).
 *
 * Tests the createDeadlockWindow factory in isolation — pure counter state
 * machine, no spawning, no I/O.
 *
 * Why each case matters is encoded in the assertion comment (Rule 9: tests
 * verify intent, not just behavior).
 */

import assert from "node:assert/strict";
import { createDeadlockWindow } from "../dist/deadlock.js";

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

// ---------------------------------------------------------------------------
// 1. fresh window is inactive
//    WHY: arming on construction would force callers to track initialization
//    order and would make the window active before deadlock has been declared.
// ---------------------------------------------------------------------------
test("fresh window is inactive", () => {
  const w = createDeadlockWindow();
  assert.equal(
    w.active(),
    false,
    "fresh window must be inactive; if true, a new server process would start with the window already armed"
  );
});

// ---------------------------------------------------------------------------
// 2. arm → active
//    WHY: arm() is the trigger; without it activating the window, the branch
//    switch in index.ts would never select performance.
// ---------------------------------------------------------------------------
test("arm makes window active", () => {
  const w = createDeadlockWindow();
  w.arm();
  assert.equal(
    w.active(),
    true,
    "arm() must activate the window so the next pure-auto call selects the performance branch"
  );
});

// ---------------------------------------------------------------------------
// 3. three consumes → inactive
//    WHY: the window must expire after exactly 3 pure-auto launches so routing
//    reverts to cost_efficiency automatically without requiring any explicit
//    disable. If active() stays true after 3, the window never expires.
// ---------------------------------------------------------------------------
test("3 consumes exhaust the window (active → false)", () => {
  const w = createDeadlockWindow();
  w.arm();
  w.consume();
  assert.equal(w.active(), true, "after 1 consume: 2 remaining, must still be active");
  w.consume();
  assert.equal(w.active(), true, "after 2 consumes: 1 remaining, must still be active");
  w.consume();
  assert.equal(
    w.active(),
    false,
    "after 3 consumes: window must be inactive; if still active the window never expires"
  );
});

// ---------------------------------------------------------------------------
// 4. consume floors at 0 (no underflow)
//    WHY: a consume below 0 could wrap around or produce negative counts that
//    make active() truthy, re-arming the window unintentionally.
// ---------------------------------------------------------------------------
test("consume below 0 floors at 0 and does not reactivate window", () => {
  const w = createDeadlockWindow();
  w.arm();
  w.consume(); w.consume(); w.consume(); // exhaust
  assert.equal(w.active(), false, "window must be inactive after 3 consumes");
  w.consume(); // extra consume — must not underflow
  assert.equal(
    w.active(),
    false,
    "extra consume after exhaustion must not underflow or reactivate the window"
  );
});

// ---------------------------------------------------------------------------
// 5. re-arm resets to 3 mid-window
//    WHY: a second deadlock=true call while the window still has counters
//    remaining must reset to the full budget of 3, not add to the current
//    count. Without reset, the window could expire at a different count than
//    expected, making the window walk non-deterministic.
// ---------------------------------------------------------------------------
test("re-arm mid-window resets counter to 3", () => {
  const w = createDeadlockWindow();
  w.arm();
  w.consume(); // 2 remaining
  w.arm();     // re-arm: must reset to 3, not become 5
  assert.equal(w.active(), true, "re-arm mid-window must keep the window active");
  w.consume(); // 2
  w.consume(); // 1
  w.consume(); // 0
  assert.equal(
    w.active(),
    false,
    "re-arm must reset to exactly 3; if inactive after 2 post-rearm consumes, reset went to 2 not 3"
  );
});

// ---------------------------------------------------------------------------
// Print summary and fail if any test failed
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
