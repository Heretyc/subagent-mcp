import assert from "node:assert/strict";

import {
  ZOMBIE_TERMINAL_IDLE_MS,
  shouldReapTerminalButAlive,
} from "../dist/zombie.js";

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

function agent(overrides = {}) {
  return {
    status: "finished",
    exitedAt: 1_000_000,
    lastActivity: 1_000_000,
    driver: { closed: false },
    ...overrides,
  };
}

test("shouldReapTerminalButAlive waits six idle minutes from latest terminal activity", () => {
  const now = 2_000_000;

  assert.equal(ZOMBIE_TERMINAL_IDLE_MS, 6 * 60 * 1000);
  assert.equal(
    shouldReapTerminalButAlive(agent({
      exitedAt: now - 31_000,
      lastActivity: now - 1_000,
    }), now, ZOMBIE_TERMINAL_IDLE_MS),
    false,
    "recent activity keeps an old 30s terminal process alive"
  );
  assert.equal(
    shouldReapTerminalButAlive(agent({
      exitedAt: now - ZOMBIE_TERMINAL_IDLE_MS - 10_000,
      lastActivity: now - 1_000,
    }), now, ZOMBIE_TERMINAL_IDLE_MS),
    false,
    "lastActivity, not exitedAt alone, anchors the idle clock"
  );
  assert.equal(
    shouldReapTerminalButAlive(agent({
      exitedAt: now - ZOMBIE_TERMINAL_IDLE_MS - 10_000,
      lastActivity: now - ZOMBIE_TERMINAL_IDLE_MS,
    }), now, ZOMBIE_TERMINAL_IDLE_MS),
    false,
    "exactly six idle minutes is still inside the grace window"
  );
  assert.equal(
    shouldReapTerminalButAlive(agent({
      exitedAt: now - ZOMBIE_TERMINAL_IDLE_MS - 10_000,
      lastActivity: now - ZOMBIE_TERMINAL_IDLE_MS - 1,
    }), now, ZOMBIE_TERMINAL_IDLE_MS),
    true,
    "terminal process reaps after more than six idle minutes"
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
