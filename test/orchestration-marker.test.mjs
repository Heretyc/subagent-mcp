/**
 * orchestration-marker.test.mjs — Unit tests for the shared marker module.
 *
 * Exercises the REAL compiled dist/orchestration/marker.js (single source of
 * truth for orchestration on/off state). Covers:
 *   - normalizeCwd determinism (two spellings of the same path collapse equal;
 *     on win32 'C:\\X\\' and 'c:/x' must normalize identically).
 *   - markerPath stability (same cwd -> same path across calls).
 *   - enable/disable/isActive/clearForCwd roundtrip against a temp cwd, plus
 *     readMarker/writeMarker persistence.
 *
 * WHY (Rule 9): these encode the invariant the hook depends on — absence of the
 * marker MUST mean OFF, and re-enable MUST re-baseline (owner/baseline null).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeCwd,
  cwdHash,
  markerPath,
  enable,
  disable,
  isActive,
  readMarker,
  writeMarker,
  clearForCwd,
} from "../dist/orchestration/marker.js";

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

const isWin = process.platform === "win32";

// ---------------------------------------------------------------------------
// normalizeCwd determinism
// ---------------------------------------------------------------------------
test("normalizeCwd: trailing slash is stripped (same hash with/without)", () => {
  const a = "C:\\Some\\Project";
  const b = "C:\\Some\\Project\\";
  assert.equal(normalizeCwd(a), normalizeCwd(b),
    "trailing slash must not change the normalized path");
  assert.equal(cwdHash(a), cwdHash(b), "trailing slash must not change the hash");
});

if (isWin) {
  test("normalizeCwd (win32): 'C:\\\\X\\\\' and 'c:/x' normalize equal", () => {
    // Backslash-vs-forward-slash AND case differences both collapse on win32.
    assert.equal(normalizeCwd("C:\\X\\"), normalizeCwd("c:/x"),
      "win32 normalization must be case- and separator-insensitive");
    assert.equal(cwdHash("C:\\X\\"), cwdHash("c:/x"),
      "equal normalized paths must produce equal hashes");
  });

  test("normalizeCwd (win32): \\\\?\\ extended-length prefix and plain form hash equal", () => {
    // The extended-length prefix must be stripped BEFORE resolve() (resolve
    // canonicalizes it away), so an extended-length cwd and its plain spelling
    // must collapse to the same normalized path and hash. Regression guard:
    // stripping after resolve was dead code and these would diverge.
    const plain = "C:\\Some\\Project";
    const extended = "\\\\?\\C:\\Some\\Project";
    assert.equal(normalizeCwd(extended), normalizeCwd(plain),
      "extended-length prefix must not change the normalized path");
    assert.equal(cwdHash(extended), cwdHash(plain),
      "extended-length and plain spellings must produce equal hashes");
    assert.ok(!normalizeCwd(extended).includes("?"),
      "the \\\\?\\ prefix must be stripped, not carried into the hash input");
  });

  test("normalizeCwd (win32): output uses forward slashes and lowercase", () => {
    const n = normalizeCwd("C:\\Foo\\Bar");
    assert.ok(!n.includes("\\"), "no backslashes remain after normalization");
    assert.equal(n, n.toLowerCase(), "win32 normalized path is lowercased");
  });
}

test("cwdHash: 16 hex chars, stable for the same input", () => {
  const h1 = cwdHash("/some/dir");
  const h2 = cwdHash("/some/dir");
  assert.equal(h1, h2, "hash must be deterministic");
  assert.match(h1, /^[0-9a-f]{16}$/, "hash is a 16-char hex slice of sha256");
});

test("cwdHash: different paths produce different hashes", () => {
  assert.notEqual(cwdHash("/a/one"), cwdHash("/a/two"));
});

// ---------------------------------------------------------------------------
// markerPath stability
// ---------------------------------------------------------------------------
test("markerPath: stable across calls and lives under tmp/subagent-mcp", () => {
  const cwd = "/stable/project";
  const p1 = markerPath(cwd);
  const p2 = markerPath(cwd);
  assert.equal(p1, p2, "markerPath must be deterministic for the same cwd");
  assert.ok(p1.includes("subagent-mcp"), "marker lives under the subagent-mcp tmp dir");
  assert.ok(p1.endsWith(".flag"), "marker file uses the .flag suffix");
  assert.ok(p1.includes("orch-"), "marker file uses the orch- prefix");
});

// ---------------------------------------------------------------------------
// enable / disable / isActive / clearForCwd roundtrip (temp cwd)
// ---------------------------------------------------------------------------
test("enable -> isActive true; disable -> isActive false (roundtrip)", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    assert.equal(isActive(dir), false, "fresh temp cwd starts inactive (no marker)");
    enable(dir);
    assert.equal(isActive(dir), true, "after enable the marker exists -> active");
    assert.ok(existsSync(markerPath(dir)), "marker file physically exists after enable");
    disable(dir);
    assert.equal(isActive(dir), false, "after disable the marker is gone -> inactive");
    assert.equal(existsSync(markerPath(dir)), false, "marker file removed after disable");
  } finally {
    disable(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enable writes an unclaimed, un-baselined marker (re-enable re-baselines)", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    enable(dir);
    const m = readMarker(dir);
    assert.equal(m.owner_session, null, "fresh enable has no owner_session yet");
    assert.equal(m.baseline_turn, null, "fresh enable has no baseline yet");

    // Simulate a hook claiming + baselining the marker.
    writeMarker(dir, { owner_session: "sess-1", baseline_turn: 7 });
    const claimed = readMarker(dir);
    assert.equal(claimed.owner_session, "sess-1");
    assert.equal(claimed.baseline_turn, 7);

    // Re-enable must overwrite back to null/null (re-baseline on next turn).
    enable(dir);
    const reenabled = readMarker(dir);
    assert.equal(reenabled.owner_session, null, "re-enable clears owner_session");
    assert.equal(reenabled.baseline_turn, null, "re-enable clears baseline_turn");
  } finally {
    disable(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearForCwd removes the marker (used by the tool's enabled:false path)", () => {
  // NOTE: the server NO LONGER calls clearForCwd on startup — orchestration mode
  // now persists across sessions. clearForCwd remains an alias for disable and is
  // exercised here for its retained behavior, not for any startup reset.
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    enable(dir);
    assert.equal(isActive(dir), true);
    clearForCwd(dir);
    assert.equal(isActive(dir), false, "clearForCwd must leave the cwd OFF");
  } finally {
    disable(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readMarker on a missing marker returns safe defaults (no throw)", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    const m = readMarker(dir);
    assert.deepEqual(m, { owner_session: null, baseline_turn: null, provenance: null, carryover_ack: false },
      "missing marker reads as unclaimed/un-baselined/no-provenance/un-acked, never throws");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("disable on an absent marker is a no-op (fail-safe)", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    // Must not throw even though no marker exists.
    disable(dir);
    assert.equal(isActive(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
