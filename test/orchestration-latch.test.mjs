/**
 * orchestration-latch.test.mjs - Unit tests for persistent orchestration latch state.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import {
  clearLatch,
  isLatchActive,
  latchPath,
  LATCH_REV,
  tripLatch,
} from "../dist/orchestration/latch.js";
import { anonKey } from "../dist/orchestration/marker.js";

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

function cleanup(sessionKey) {
  rmSync(latchPath(sessionKey), { force: true });
}

test("fresh session is not latched", () => {
  const sessionKey = "latch-fresh-session";
  cleanup(sessionKey);
  try {
    assert.equal(isLatchActive(sessionKey, 1000), false);
    assert.equal(existsSync(latchPath(sessionKey)), false);
  } finally {
    cleanup(sessionKey);
  }
});

test("tripLatch is idempotent and preserves original latched_at", () => {
  const sessionKey = "latch-idempotent-session";
  cleanup(sessionKey);
  try {
    tripLatch(sessionKey, 1111);
    const first = JSON.parse(readFileSync(latchPath(sessionKey), "utf8"));
    tripLatch(sessionKey, 9999);
    const second = JSON.parse(readFileSync(latchPath(sessionKey), "utf8"));

    assert.equal(first.latched, true);
    assert.equal(first.rev, LATCH_REV);
    assert.equal(first.latched_at, 1111);
    assert.equal(first.session_id, sessionKey);
    assert.equal(second.latched_at, 1111);
    assert.deepEqual(second, first);
  } finally {
    cleanup(sessionKey);
  }
});

test("latch remains active regardless of future now value", () => {
  const sessionKey = "latch-never-expires-session";
  cleanup(sessionKey);
  try {
    tripLatch(sessionKey, 2000);
    assert.equal(isLatchActive(sessionKey, 2000), true);
    assert.equal(isLatchActive(sessionKey, Number.MAX_SAFE_INTEGER), true);
  } finally {
    cleanup(sessionKey);
  }
});

test("revless bug-era latch is inactive and unlinked lazily", () => {
  const sessionKey = "latch-revless-session";
  cleanup(sessionKey);
  try {
    writeFileSync(latchPath(sessionKey), JSON.stringify({
      latched: true,
      latched_at: 1234,
      session_id: sessionKey,
    }), "utf8");
    assert.equal(isLatchActive(sessionKey, 1234), false);
    assert.equal(existsSync(latchPath(sessionKey)), false);
  } finally {
    cleanup(sessionKey);
  }
});

test("revless bug-era latch under anon cwd key is inactive and unlinked", () => {
  const sessionKey = anonKey(process.cwd(), "claude");
  cleanup(sessionKey);
  try {
    writeFileSync(latchPath(sessionKey), JSON.stringify({
      latched: true,
      latched_at: 1234,
      session_id: sessionKey,
    }), "utf8");
    assert.equal(isLatchActive(sessionKey, 1234), false);
    assert.equal(existsSync(latchPath(sessionKey)), false);
  } finally {
    cleanup(sessionKey);
  }
});

test("clearLatch resets latch state", () => {
  const sessionKey = "latch-clear-session";
  cleanup(sessionKey);
  try {
    tripLatch(sessionKey, 3000);
    assert.equal(isLatchActive(sessionKey, 3000), true);
    clearLatch(sessionKey);
    assert.equal(isLatchActive(sessionKey, 3000), false);
    assert.equal(existsSync(latchPath(sessionKey)), false);
  } finally {
    cleanup(sessionKey);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
