/**
 * orchestration-marker.test.mjs - Unit tests for the shared marker module.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeCwd,
  cwdHash,
  markerPath,
  disablePath,
  enablePath,
  sessionPointerPath,
  serverSessionPointerPath,
  enable,
  writeDisable,
  removeDisable,
  writeEnable,
  removeEnable,
  writeCurrentSession,
  readCurrentSession,
  isActive,
  readMarker,
  writeMarker,
  anonKey,
  isSessionScopedKey,
  ORCH_DISABLE_TTL_MS,
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

test("normalizeCwd: trailing slash is stripped (same hash with/without)", () => {
  const a = "C:\\Some\\Project";
  const b = "C:\\Some\\Project\\";
  assert.equal(normalizeCwd(a), normalizeCwd(b));
  assert.equal(cwdHash(a), cwdHash(b));
});

if (isWin) {
  test("normalizeCwd (win32): 'C:\\\\X\\\\' and 'c:/x' normalize equal", () => {
    assert.equal(normalizeCwd("C:\\X\\"), normalizeCwd("c:/x"));
    assert.equal(cwdHash("C:\\X\\"), cwdHash("c:/x"));
  });

  test("normalizeCwd (win32): \\\\?\\ extended-length prefix and plain form hash equal", () => {
    const plain = "C:\\Some\\Project";
    const extended = "\\\\?\\C:\\Some\\Project";
    assert.equal(normalizeCwd(extended), normalizeCwd(plain));
    assert.equal(cwdHash(extended), cwdHash(plain));
    assert.ok(!normalizeCwd(extended).includes("?"));
  });

  test("normalizeCwd (win32): output uses forward slashes and lowercase", () => {
    const n = normalizeCwd("C:\\Foo\\Bar");
    assert.ok(!n.includes("\\"));
    assert.equal(n, n.toLowerCase());
  });
}

test("cwdHash: 16 hex chars, stable for the same input", () => {
  const h1 = cwdHash("/some/dir");
  const h2 = cwdHash("/some/dir");
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{16}$/);
});

test("cwdHash: different paths produce different hashes", () => {
  assert.notEqual(cwdHash("/a/one"), cwdHash("/a/two"));
});

test("markerPath: stable across calls and lives under tmp/subagent-mcp", () => {
  const cwd = "/stable/project";
  const p1 = markerPath(cwd);
  const p2 = markerPath(cwd);
  assert.equal(p1, p2);
  assert.ok(p1.includes("subagent-mcp"));
  assert.ok(p1.endsWith(".flag"));
  assert.ok(p1.includes("orch-"));
});

test("default OFF; session disable records are isolated and TTL-GC'd", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  const sessA = `sessA-${cwdHash(dir)}`;
  const sessB = `sessB-${cwdHash(dir)}`;
  const expiredSess = `expired-${cwdHash(dir)}`;
  try {
    assert.equal(isActive(dir), true, "fresh keyless check is active");
    assert.equal(isActive(dir, sessA), false, "fresh session key starts inactive");
    writeEnable(sessA);
    writeEnable(sessB);
    assert.equal(isActive(dir, sessA), true, "enabled session key starts active");
    writeDisable(sessA);
    assert.equal(isActive(dir, sessA), false, "session-keyed disable affects that session");
    assert.equal(isActive(dir, sessB), true, "different session key remains active");

    assert.equal(ORCH_DISABLE_TTL_MS, 2 * 60 * 60 * 1000);
    writeFileSync(disablePath(expiredSess), JSON.stringify({
      disabled_at: Date.now() - ORCH_DISABLE_TTL_MS - 1,
    }));
    writeEnable(expiredSess);
    assert.equal(isActive(dir, expiredSess), true, "expired disable record is ignored when enable is active");
    assert.equal(existsSync(disablePath(expiredSess)), false, "expired disable record is GC'd");
  } finally {
    removeDisable(sessA);
    removeDisable(sessB);
    removeDisable(expiredSess);
    removeEnable(sessA);
    removeEnable(sessB);
    removeEnable(expiredSess);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session enable records activate, expire, and are removable", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  const sessA = `sessA-${cwdHash(dir)}`;
  const sessB = `sessB-${cwdHash(dir)}`;
  const expiredSess = `expired-enable-${cwdHash(dir)}`;
  try {
    assert.equal(isActive(dir, sessA), false, "fresh session key starts inactive");
    writeEnable(sessA);
    assert.equal(isActive(dir, sessA), true, "session-keyed enable affects that session");
    assert.equal(isActive(dir, sessB), false, "different session key remains inactive");

    removeEnable(sessA);
    assert.equal(isActive(dir, sessA), false, "removed enable record returns session to inactive");

    writeFileSync(enablePath(expiredSess), JSON.stringify({
      enabled_at: Date.now() - ORCH_DISABLE_TTL_MS - 1,
    }));
    assert.equal(isActive(dir, expiredSess), false, "expired enable record is ignored");
    assert.equal(existsSync(enablePath(expiredSess)), false, "expired enable record is GC'd");
  } finally {
    removeEnable(sessA);
    removeEnable(sessB);
    removeEnable(expiredSess);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("disable record wins over enable record", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  const sess = `sess-${cwdHash(dir)}`;
  try {
    writeEnable(sess);
    assert.equal(isActive(dir, sess), true, "enable activates the session");
    writeDisable(sess);
    assert.equal(isActive(dir, sess), false, "disable wins when both records are present");
  } finally {
    removeDisable(sess);
    removeEnable(sess);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anonymous owner keys are cadence-only and cannot disable orchestration", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    const anon = anonKey(dir, "codex");
    assert.match(anon, /^anon-codex-[0-9a-f]{16}$/);
    assert.equal(isSessionScopedKey(anon), false);
    assert.equal(isSessionScopedKey("session-1"), true);
    writeDisable(anon);
    assert.equal(existsSync(disablePath(anon)), false, "writeDisable ignores anonymous keys");
    assert.equal(isActive(dir, anon), true, "isActive ignores anonymous disable authority");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("current-session pointer is scoped by server key with legacy cwd fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    writeCurrentSession(dir, "session-A", "server-A");
    writeCurrentSession(dir, "session-B", "server-B");
    assert.equal(readCurrentSession(dir, "server-A"), "session-A");
    assert.equal(readCurrentSession(dir, "server-B"), "session-B");
    assert.equal(readCurrentSession(dir, "server-C"), "session-B");
    assert.notEqual(serverSessionPointerPath(dir, "server-A"), serverSessionPointerPath(dir, "server-B"));
    assert.notEqual(serverSessionPointerPath(dir, "server-A"), sessionPointerPath(dir));
  } finally {
    rmSync(serverSessionPointerPath(dir, "server-A"), { force: true });
    rmSync(serverSessionPointerPath(dir, "server-B"), { force: true });
    rmSync(serverSessionPointerPath(dir, "server-C"), { force: true });
    rmSync(sessionPointerPath(dir), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enable writes an unclaimed, un-baselined marker (re-enable re-baselines)", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    enable(dir);
    const m = readMarker(dir);
    assert.equal(m.owner_session, null);
    assert.equal(m.baseline_turn, null);
    assert.equal(m.claimed_at, null);
    assert.deepEqual(m.owners, {});

    writeMarker(dir, {
      owner_session: "sess-1",
      baseline_turn: 7,
      claimed_at: 123,
      provenance: null,
      carryover_ack: false,
      owners: { "sess-1": { baseline_turn: 7, claimed_at: 123 } },
    });
    assert.equal(readMarker(dir).owner_session, "sess-1");

    enable(dir);
    const reenabled = readMarker(dir);
    assert.equal(reenabled.owner_session, null);
    assert.equal(reenabled.baseline_turn, null);
    assert.deepEqual(reenabled.owners, {});
  } finally {
    rmSync(markerPath(dir), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readMarker synthesizes owners map from legacy owner fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    writeMarker(dir, {
      owner_session: "legacy-owner",
      baseline_turn: 4,
      claimed_at: 123,
      provenance: null,
      carryover_ack: false,
    });
    assert.deepEqual(readMarker(dir).owners, {
      "legacy-owner": { baseline_turn: 4, claimed_at: 123 },
    });
  } finally {
    rmSync(markerPath(dir), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readMarker on a missing marker returns safe defaults (no throw)", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-cwd-"));
  try {
    assert.deepEqual(readMarker(dir), {
      owner_session: null,
      baseline_turn: null,
      claimed_at: null,
      owners: {},
      provenance: null,
      carryover_ack: false,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
