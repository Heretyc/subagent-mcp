import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureParentMarker, hasParentMarker, MARKER } from "../dist/launch-prompt.js";

// Count non-overlapping occurrences of MARKER in s.
function countMarker(s) {
  let n = 0;
  let i = s.indexOf(MARKER);
  while (i !== -1) {
    n++;
    i = s.indexOf(MARKER, i + MARKER.length);
  }
  return n;
}

// A7 case 1: marker absent -> prepended as literal first line.
test("A7-1: marker absent -> prepended as literal first line", () => {
  const out = ensureParentMarker("do the thing");
  assert.equal(out, MARKER + "\n" + "do the thing");
  assert.equal(out.slice(0, out.indexOf("\n")), MARKER);
  assert.equal(countMarker(out), 1);
});

// A7 case 2: marker already first line -> unchanged, not duplicated.
test("A7-2: marker already first line -> unchanged, not duplicated", () => {
  const input = MARKER + "\nbody";
  const out = ensureParentMarker(input);
  assert.equal(out, input);
  assert.equal(countMarker(out), 1);
});

// A7 case 3: marker present but NOT first line -> correct marker prepended,
// so it becomes the true first line.
test("A7-3: marker present but not first line -> prepended", () => {
  const input = "preamble\n" + MARKER + "\nbody";
  const out = ensureParentMarker(input);
  assert.equal(out, MARKER + "\n" + input);
  assert.equal(out.slice(0, out.indexOf("\n")), MARKER);
  assert.equal(countMarker(out), 2);
});

// A7 case 4: CRLF prompt handled (trailing \r stripped for comparison only).
test("A7-4: CRLF prompt with marker first line -> unchanged", () => {
  const input = MARKER + "\r\nbody";
  const out = ensureParentMarker(input);
  assert.equal(out, input);
  assert.equal(countMarker(out), 1);
});

// A7 case 5: empty prompt -> marker prepended.
test("A7-5: empty prompt -> marker prepended", () => {
  const out = ensureParentMarker("");
  assert.equal(out, MARKER + "\n");
  assert.equal(countMarker(out), 1);
});

// A7 case 6: leading BOM treated as marker-present when marker follows.
test("A7-6: leading BOM + marker -> treated as present, unchanged", () => {
  const input = "﻿" + MARKER + "\nbody";
  const out = ensureParentMarker(input);
  assert.equal(out, input);
  assert.equal(countMarker(out), 1);
});

// A7 case 7: idempotent (twice == once).
test("A7-7: idempotent", () => {
  const inputs = ["do the thing", MARKER + "\nbody", "pre\n" + MARKER, "", MARKER + "\r\nx"];
  for (const input of inputs) {
    const once = ensureParentMarker(input);
    const twice = ensureParentMarker(once);
    assert.equal(twice, once);
  }
});

test("hasParentMarker and ensureParentMarker are coherent", () => {
  const inputs = [
    "do the thing",
    MARKER + "\nbody",
    "pre\n" + MARKER,
    "",
    MARKER + "\r\nx",
    "\n" + MARKER,
    "this is a request from a parent process",
  ];
  for (const input of inputs) {
    const ensured = ensureParentMarker(input);
    assert.equal(hasParentMarker(ensured), true);
    if (hasParentMarker(input)) {
      assert.equal(ensured, input);
    }
    assert.equal(ensureParentMarker(ensured), ensured);
  }
});
