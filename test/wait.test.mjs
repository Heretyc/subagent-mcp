import assert from "node:assert/strict";
import { formatLocalIso, selectUnreported } from "../dist/wait-helpers.js";

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

// --- formatLocalIso tests ---

const FIXED_MS = new Date("2024-03-15T10:30:45.000Z").getTime();

test("formatLocalIso matches required regex pattern", () => {
  const result = formatLocalIso(FIXED_MS);
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \(.+\)$/;
  assert.ok(re.test(result), `Pattern mismatch: ${result}`);
});

test("formatLocalIso date/time components match local Date getters", () => {
  const d = new Date(FIXED_MS);
  const pad2 = (n) => String(n).padStart(2, "0");
  const expected = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const result = formatLocalIso(FIXED_MS);
  assert.ok(
    result.startsWith(expected),
    `Expected to start with ${expected}, got ${result}`
  );
});

test("formatLocalIso zone name is non-empty string in parens", () => {
  const result = formatLocalIso(FIXED_MS);
  const match = result.match(/\((.+)\)$/);
  assert.ok(match, `No zone in parens: ${result}`);
  assert.ok(match[1].length > 0, "Zone name is empty");
});

// --- selectUnreported tests ---
// Invariant: agent is reportable ONLY when terminal AND exitedAt !== null AND !waitReported

function makeAgent(id, status, waitReported, exitedAt = null) {
  return { id, status, waitReported, exitedAt };
}

// killed with exitedAt=null → NOT selected (close hasn't fired yet)
test("selectUnreported: killed+exitedAt=null -> NOT selected", () => {
  const agents = [makeAgent("a", "killed", false, null)];
  const result = selectUnreported(agents);
  assert.equal(result.length, 0, "killed+exitedAt=null must NOT be selected");
});

// killed with exitedAt set → selected
test("selectUnreported: killed+exitedAt set -> selected", () => {
  const agents = [makeAgent("a", "killed", false, Date.now())];
  const result = selectUnreported(agents);
  assert.equal(result.length, 1, "killed+exitedAt set must be selected");
  assert.equal(result[0].id, "a");
});

// completed with exitedAt set → selected
test("selectUnreported: completed+exitedAt set -> selected", () => {
  const agents = [makeAgent("b", "completed", false, Date.now())];
  const result = selectUnreported(agents);
  assert.equal(result.length, 1, "completed+exitedAt set must be selected");
  assert.equal(result[0].id, "b");
});

// completed with exitedAt=null → NOT selected
test("selectUnreported: completed+exitedAt=null -> NOT selected", () => {
  const agents = [makeAgent("b", "completed", false, null)];
  const result = selectUnreported(agents);
  assert.equal(result.length, 0, "completed+exitedAt=null must NOT be selected");
});

// failed with exitedAt set → selected; failed with exitedAt=null → NOT selected
test("selectUnreported: failed+exitedAt set -> selected; failed+exitedAt=null -> NOT selected", () => {
  const agents = [
    makeAgent("c1", "failed", false, Date.now()),
    makeAgent("c2", "failed", false, null),
  ];
  const result = selectUnreported(agents);
  const ids = result.map((a) => a.id);
  assert.deepEqual(ids, ["c1"], `Expected [c1] got [${ids}]`);
});

// after marking waitReported=true, re-select returns [] for it
test("selectUnreported: after marking waitReported=true, re-select returns []", () => {
  const agents = [
    makeAgent("x", "completed", false, Date.now()),
    makeAgent("y", "failed", false, Date.now()),
  ];
  const first = selectUnreported(agents);
  assert.equal(first.length, 2);
  for (const a of first) a.waitReported = true;
  const second = selectUnreported(agents);
  assert.equal(second.length, 0, "Expected empty after marking reported");
});

// running/processing never selected
test("selectUnreported: running/processing never selected", () => {
  const agents = [
    makeAgent("p", "running", false, null),
    makeAgent("q", "processing", false, null),
    makeAgent("r", "running", false, Date.now()),
  ];
  const result = selectUnreported(agents);
  assert.equal(result.length, 0, "running/processing must never be selected");
});

// mixed: only those meeting all three criteria are selected
test("selectUnreported: full mixed set - only terminal+exitedAt+!reported", () => {
  const now = Date.now();
  const agents = [
    makeAgent("a", "running",   false, null),   // no
    makeAgent("b", "completed", false, now),     // yes
    makeAgent("c", "failed",    false, now),     // yes
    makeAgent("d", "killed",    false, now),     // yes
    makeAgent("e", "processing", false, null),   // no
    makeAgent("f", "completed", true,  now),     // no (reported)
    makeAgent("g", "failed",    true,  now),     // no (reported)
    makeAgent("h", "killed",    true,  now),     // no (reported)
    makeAgent("i", "killed",    false, null),    // no (exitedAt=null)
    makeAgent("j", "completed", false, null),    // no (exitedAt=null)
  ];
  const result = selectUnreported(agents);
  const ids = result.map((a) => a.id).sort();
  assert.deepEqual(ids, ["b", "c", "d"], `Expected [b,c,d] got [${ids}]`);
});

// empty input
test("selectUnreported: empty input returns []", () => {
  const result = selectUnreported([]);
  assert.equal(result.length, 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
