import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  clampCap,
  countSlots,
  parseConcurrencyConfig,
  releaseSlot,
  reserveSlot,
} from "../dist/concurrency.js";

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

function tmpSlotDir() {
  return join(tmpdir(), `subagent-global-cap-${randomUUID()}`);
}

function seedSlots(dir, count) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `slot-fake-${i}.json`), "{}");
  }
}

let releaseFixture = null;

test("clampCap applies the forced validation table", () => {
  assert.equal(clampCap(1), 10);
  assert.equal(clampCap(5), 10);
  assert.equal(clampCap(9), 10);
  assert.equal(clampCap(10), 10);
  assert.equal(clampCap(20), 20);
  assert.equal(clampCap(25), 25);
  assert.equal(clampCap(0), 20);
  assert.equal(clampCap(-3), 20);
  assert.equal(clampCap(undefined), 20);
  assert.equal(clampCap(null), 20);
  assert.equal(clampCap(3.5), 20);
  assert.equal(clampCap(NaN), 20);
  assert.equal(clampCap("20"), 20);
});

test("parseConcurrencyConfig handles shipped template, clamp, missing, malformed, and comments", () => {
  const template = readFileSync("dist/global-concurrency.jsonc", "utf8");
  assert.equal(parseConcurrencyConfig(template), 20);
  assert.equal(parseConcurrencyConfig('{"globalConcurrentSubagents":4}'), 10);
  assert.equal(parseConcurrencyConfig("{}"), 20);
  assert.equal(parseConcurrencyConfig("{not json"), 20);
  assert.equal(parseConcurrencyConfig('// c\n{"globalConcurrentSubagents":50}'), 50);
});

test("reserveSlot rejects at cap and rolls back its own marker", () => {
  const dir = tmpSlotDir();
  const max = 3;
  try {
    seedSlots(dir, max);
    const result = reserveSlot("x", max, dir);
    assert.equal(result.ok, false);
    assert.equal(result.current, max);
    assert.equal(countSlots(dir), max);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reserveSlot succeeds under cap and creates a new slot file", () => {
  const dir = tmpSlotDir();
  const max = 3;
  seedSlots(dir, max - 1);
  const result = reserveSlot("y", max, dir);
  assert.equal(result.ok, true);
  assert.equal(existsSync(result.slotPath), true);
  assert.equal(countSlots(dir), max);
  releaseFixture = { dir, slotPath: result.slotPath, max };
});

test("releaseSlot drops the reserved slot count and is idempotent", () => {
  assert.ok(releaseFixture, "reserve under cap test must provide a slotPath");
  try {
    releaseSlot(releaseFixture.slotPath);
    assert.equal(countSlots(releaseFixture.dir), releaseFixture.max - 1);
    assert.doesNotThrow(() => releaseSlot(releaseFixture.slotPath));
  } finally {
    rmSync(releaseFixture.dir, { recursive: true, force: true });
    releaseFixture = null;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
