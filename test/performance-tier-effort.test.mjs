/**
 * performance-tier-effort.test.mjs — Owner directive (2026-06-11, FINAL AND
 * BINDING — NO EXCEPTIONS): the performance branch of src/routing-table.json
 * must contain ZERO pairings below 'high' on the effort ladder
 * (null/none/min/light/low/medium).
 *
 * WHY (Rule 9): the performance branch is what routing selects for
 * performance/deadlock situations — exactly where a low/medium-effort variant
 * is a widely-bad choice. The builder filters AND hard-asserts on every build
 * (blocks new entries, purges existing ones on rebuild); this test pins the
 * COMMITTED artifact so a hand-edited or stale table fails CI even without a
 * rebuild. cost_efficiency is intentionally unaffected by the floor.
 *
 * The separate policy-wide rule is narrower: `low` is no longer a valid
 * emitted effort in either branch.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tablePath = join(__dirname, "..", "src", "routing-table.json");
const table = JSON.parse(readFileSync(tablePath, "utf8").replace(/^﻿/, ""));

const EFFORT_LADDER = [
  "null", "none", "min", "light", "low", "medium",
  "high", "xhigh", "max", "pro", "ultracode",
];
const EFFORT_INDEX = new Map(EFFORT_LADDER.map((e, i) => [e, i]));
const PERFORMANCE_MIN_EFFORT = "high";
const FLOOR = EFFORT_INDEX.get(PERFORMANCE_MIN_EFFORT);
const effortKey = (effort) => (effort === null ? "null" : String(effort));

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

test("performance branch carries ZERO below-'high' effort pairings (owner directive, FINAL)", () => {
  assert.ok(table.performance && typeof table.performance === "object",
    "src/routing-table.json must carry a performance branch");
  const violations = [];
  for (const [category, entries] of Object.entries(table.performance)) {
    for (const entry of entries) {
      const ek = effortKey(entry.effort);
      const idx = EFFORT_INDEX.get(ek);
      assert.ok(idx !== undefined,
        `performance.${category}: unknown effort tier '${ek}' on ${entry.model}`);
      if (idx < FLOOR) {
        violations.push(`performance.${category}: ${entry.model}@${ek} (rank ${entry.rank})`);
      }
    }
  }
  assert.equal(violations.length, 0,
    `below-'${PERFORMANCE_MIN_EFFORT}' efforts are banned from the performance branch — ` +
    `found:\n  ${violations.join("\n  ")}`);
});

test("the floor purge never empties a performance category", () => {
  for (const [category, entries] of Object.entries(table.performance)) {
    assert.ok(Array.isArray(entries) && entries.length > 0,
      `performance.${category} must still rank at least one >=high pairing`);
  }
});

test("no branch carries low-effort pairings", () => {
  const violations = [];
  for (const branch of ["performance", "cost_efficiency"]) {
    for (const [category, entries] of Object.entries(table[branch])) {
      for (const entry of entries) {
        if (effortKey(entry.effort) === "low") {
          violations.push(`${branch}.${category}: ${entry.model}@low (rank ${entry.rank})`);
        }
      }
    }
  }
  assert.equal(violations.length, 0,
    `low effort is removed policy-wide and must not be ranked:\n  ${violations.join("\n  ")}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
