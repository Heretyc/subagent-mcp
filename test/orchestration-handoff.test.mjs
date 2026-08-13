/**
 * orchestration-handoff.test.mjs - Unit tests for context handoff state.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as handoffModule from "../dist/orchestration/handoff.js";
import {
  HANDOFF_CONTENT_LIMIT,
  HANDOFF_OVERFLOW_LIMIT,
  HANDOFF_THRESHOLD_PCT,
  HANDOFF_RECORD_VERSION,
  UNAVAILABLE_NO_METERING,
  checkHandoffWriteAvailable,
  claimSessionHandoffRead,
  isEligiblePrepared,
  isSessionHandoffRequired,
  isWriteRequired,
  markSessionHandoffRequired,
  OVERSIZE_CONTENT,
  OVERSIZE_OVERFLOW,
  clearHandoff,
  handoffPath,
  markRead,
  readHandoff,
  writeHandoff,
} from "../dist/orchestration/handoff.js";
import { cwdHash, stateDir } from "../dist/orchestration/marker.js";

// The below-unlock error constant is renamed as part of the 40% -> 20% move.
// Accept either spelling so this lane stays green whichever name L1 lands on;
// the ASSERTIONS below still pin the 20% semantics regardless of the symbol.
const UNAVAILABLE_BELOW_UNLOCK =
  handoffModule.UNAVAILABLE_BELOW_UNLOCK ??
  handoffModule.UNAVAILABLE_BELOW_20 ??
  handoffModule.UNAVAILABLE_BELOW_40;

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

function withCwd(fn) {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-cwd-"));
  try {
    clearHandoff(cwd);
    fn(cwd);
  } finally {
    clearHandoff(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("write/read/clear round-trip stores and removes the handoff record", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "handoff body",
      createdBySession: "writer-session",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(readHandoff(cwd), result.record);
    assert.equal(result.record.content, "handoff body");
    assert.equal(result.record.overflow_path, null);
    assert.equal(result.record.created_by_session, "writer-session");
    assert.equal(result.record.read_by_session, null);

    clearHandoff(cwd);
    assert.equal(readHandoff(cwd), null);
    assert.equal(existsSync(handoffPath(cwd)), false);
  });
});

// LOCKED (voluntary write gate): the handoff-write unlock is a hard-coded 20% and
// is never configurable. Boundaries under test are 19 / 20 / 21, and the gate
// stays open at every higher utilization (including the mandatory 80% and 90%
// points), because the voluntary write availability is never re-gated upward.
test("write gate is locked at 19%, unlocked at 20%, and stays unlocked above it", () => {
  // No metering at all stays a DISTINCT error from "below the unlock".
  assert.deepEqual(checkHandoffWriteAvailable(null), {
    ok: false,
    error: UNAVAILABLE_NO_METERING,
  });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 19 }), {
    ok: false,
    error: UNAVAILABLE_BELOW_UNLOCK,
  });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 19.99 }), {
    ok: false,
    error: UNAVAILABLE_BELOW_UNLOCK,
  });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 20 }), { ok: true });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 21 }), { ok: true });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 40 }), { ok: true });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 60 }), { ok: true });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 80 }), { ok: true });
  assert.deepEqual(checkHandoffWriteAvailable({ used_percentage: 90 }), { ok: true });
});

test("handoff unlock threshold constant is a hard-coded 20 and not configurable", () => {
  assert.equal(HANDOFF_THRESHOLD_PCT, 20);
});

test("below-threshold handoff error string names 20 percent, not 40", () => {
  assert.match(UNAVAILABLE_BELOW_UNLOCK, /\b20%/,
    "the below-unlock error must name the new 20% threshold");
  assert.ok(!/\b40%/.test(UNAVAILABLE_BELOW_UNLOCK),
    "the below-unlock error must not still name the retired 40% threshold");
  assert.equal(UNAVAILABLE_BELOW_UNLOCK, "handoff-write is not available until this session reaches 20% context utilization (currently below threshold).");
});

test("oversize content is rejected with exact error string", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "x".repeat(HANDOFF_CONTENT_LIMIT + 1),
      createdBySession: "writer-session",
    });

    assert.deepEqual(result, { ok: false, error: OVERSIZE_CONTENT });
    assert.equal(OVERSIZE_CONTENT, "handoff content exceeds the 4000-character limit; shorten it, or move the excess (up to 8000 additional characters) into a separate file and reference its full path inside the 4000-character content.");
    assert.equal(readHandoff(cwd), null);
  });
});

test("oversize overflow is rejected with exact error string", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "handoff body",
      overflowContent: "x".repeat(HANDOFF_OVERFLOW_LIMIT + 1),
      createdBySession: "writer-session",
    });

    assert.deepEqual(result, { ok: false, error: OVERSIZE_OVERFLOW });
    assert.equal(OVERSIZE_OVERFLOW, "handoff overflow content exceeds the 8000-character limit; shorten the overflow file content and retry.");
    assert.equal(readHandoff(cwd), null);
  });
});

test("overflow content is written and its path is present in the record", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "handoff body",
      overflowContent: "overflow body",
      createdBySession: "writer-session",
    });

    assert.equal(result.ok, true);
    assert.equal(typeof result.record.overflow_path, "string");
    assert.equal(existsSync(result.record.overflow_path), true);
    assert.equal(readFileSync(result.record.overflow_path, "utf8"), "overflow body");
    assert.deepEqual(readHandoff(cwd), result.record);
  });
});

test("markRead reassigns reader on a second different-session read", () => {
  withCwd((cwd) => {
    const written = writeHandoff(cwd, {
      content: "handoff body",
      createdBySession: "writer-session",
    });
    assert.equal(written.ok, true);

    const firstRead = markRead(cwd, "reader-one");
    assert.equal(firstRead?.read_by_session, "reader-one");
    assert.equal(typeof firstRead?.read_at, "number");

    const secondRead = markRead(cwd, "reader-two");
    assert.equal(secondRead?.read_by_session, "reader-two");
    assert.equal(typeof secondRead?.read_at, "number");
    assert.equal(readHandoff(cwd)?.read_by_session, "reader-two");
  });
});

test("clearHandoff removes both record and overflow file", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "handoff body",
      overflowContent: "overflow body",
      createdBySession: "writer-session",
    });
    assert.equal(result.ok, true);
    const overflowPath = result.record.overflow_path;
    assert.equal(existsSync(overflowPath), true);

    clearHandoff(cwd);
    assert.equal(existsSync(handoffPath(cwd)), false);
    assert.equal(existsSync(overflowPath), false);
    assert.equal(readHandoff(cwd), null);
  });
});

test("new write after prior read resets read_by_session to null", () => {
  withCwd((cwd) => {
    const first = writeHandoff(cwd, {
      content: "first handoff",
      createdBySession: "writer-one",
    });
    assert.equal(first.ok, true);
    assert.equal(markRead(cwd, "reader-one")?.read_by_session, "reader-one");

    const second = writeHandoff(cwd, {
      content: "second handoff",
      createdBySession: "writer-two",
    });
    assert.equal(second.ok, true);
    assert.equal(second.record.read_by_session, null);
    assert.equal(readHandoff(cwd)?.read_by_session, null);
  });
});

test("legacy exact-cwd handoff path remains readable and clearable", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-legacy-"));
  const cwd = join(root, "repo");
  try {
    execFileSync("git", ["init", cwd], { stdio: "ignore" });
    clearHandoff(cwd);
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const overflowPath = join(root, "overflow.md");
    const record = {
      content: "legacy handoff body",
      overflow_path: overflowPath,
      created_at: 1,
      created_by_session: "legacy-writer",
      read_by_session: null,
      read_at: null,
    };
    const legacyPath = join(stateDir, "handoff-" + cwdHash(cwd) + ".json");
    writeFileSync(overflowPath, "legacy overflow", "utf8");
    writeFileSync(legacyPath, JSON.stringify(record), "utf8");

    assert.notEqual(handoffPath(cwd), legacyPath,
      "git repos use the new common-dir key, not the legacy cwd hash");
    assert.deepEqual(readHandoff(cwd), record,
      "new readers still find legacy exact-cwd handoffs");

    clearHandoff(cwd);
    assert.equal(existsSync(legacyPath), false, "clear removes the legacy record");
    assert.equal(existsSync(overflowPath), false, "clear removes legacy overflow");
  } finally {
    clearHandoff(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude-write -> Codex-read uses repo identity and cross-harness clear", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-git-"));
  const claudeCwd = join(root, "main");
  const codexCwd = join(root, "linked");
  try {
    execFileSync("git", ["init", claudeCwd], { stdio: "ignore" });
    execFileSync("git", ["-C", claudeCwd, "commit", "--allow-empty", "-m", "init"], {
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });
    execFileSync("git", ["-C", claudeCwd, "worktree", "add", "-b", "codex-linked", codexCwd], {
      stdio: "ignore",
    });

    clearHandoff(claudeCwd);
    const written = writeHandoff(claudeCwd, {
      content: "cross-harness handoff body",
      overflowContent: "cross-harness overflow",
      createdBySession: "claude-session",
    });
    assert.equal(written.ok, true);
    assert.equal(handoffPath(claudeCwd), handoffPath(codexCwd),
      "linked worktrees share one git-common-dir handoff path");

    assert.deepEqual(readHandoff(codexCwd), written.record,
      "Codex cwd reads the exact record written through the Claude cwd");

    clearHandoff(codexCwd);
    assert.equal(readHandoff(claudeCwd), null, "Claude cwd sees absence after Codex clear");
    assert.equal(readHandoff(codexCwd), null, "Codex cwd sees absence after Codex clear");
    assert.equal(existsSync(written.record.overflow_path), false,
      "cross-harness clear removes overflow too");
  } finally {
    clearHandoff(claudeCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Versioned (v2) handoff records + lifecycle/generation.
//
// A fresh handoff-write stamps HANDOFF_RECORD_VERSION; a write at/above the
// mandatory H=80 line additionally mints lifecycle="prepared" and a random UUID
// generation authored by the writing session. Below-80 (or no-utilization)
// writes are v2 but generation-INELIGIBLE. Detected compaction moves only the
// writer's OWN prepared record to session_handoff_required, whose one mandated
// read is claimed exactly once (-> resuming); a completed markRead advances a v2
// record to working. Legacy (v1) records stay readable, ineligible, and are
// never promoted on read or markRead.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A fresh write at/above H stamps prepared + a UUID generation for `session`.
function prepareFor(cwd, session, pct = 85) {
  const result = writeHandoff(cwd, {
    content: "prepared handoff body",
    createdBySession: session,
    usedPercentage: pct,
  });
  assert.equal(result.ok, true);
  return result.record;
}

test("a fresh write at/above H=80 mints a v2 prepared record with a UUID generation", () => {
  withCwd((cwd) => {
    const record = prepareFor(cwd, "writer-at-80", 80);
    assert.equal(record.version, HANDOFF_RECORD_VERSION);
    assert.equal(record.lifecycle, "prepared");
    assert.match(record.generation, UUID_RE);
    assert.equal(isEligiblePrepared(record), true);
    assert.equal(isEligiblePrepared(record, "writer-at-80"), true,
      "eligible for its authoring session");
    assert.equal(isEligiblePrepared(record, "someone-else"), false,
      "a foreign session never owns the prepared record");
    assert.deepEqual(readHandoff(cwd), record,
      "the persisted v2 prepared record round-trips unchanged");
  });
});

test("a successful write only PREPARES; it returns no session-boundary flag", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "prepared, not yet resuming",
      createdBySession: "writer-no-boundary",
      usedPercentage: 82,
    });
    assert.equal(result.ok, true);
    assert.equal(result.record.lifecycle, "prepared");
    // The result is exactly {ok, record}: the session boundary is driven later by
    // detected compaction, never demanded by the successful write.
    assert.deepEqual(Object.keys(result).sort(), ["ok", "record"]);
    for (const flag of ["require_new_session", "session_boundary", "new_session_required", "resume_required"]) {
      assert.equal(flag in result, false, `write result must not raise ${flag}`);
      assert.equal(flag in result.record, false, `prepared record must not raise ${flag}`);
    }
  });
});

test("a below-80 write is v2 but generation-INELIGIBLE (readable, no lifecycle/generation)", () => {
  withCwd((cwd) => {
    const result = writeHandoff(cwd, {
      content: "voluntary early goal-capture write",
      createdBySession: "writer-early",
      usedPercentage: 79,
    });
    assert.equal(result.ok, true);
    assert.equal(result.record.version, HANDOFF_RECORD_VERSION);
    assert.equal(result.record.lifecycle, null, "below-H writes carry no prepared lifecycle");
    assert.equal(result.record.generation, null, "below-H writes mint no generation");
    assert.equal(isEligiblePrepared(result.record), false);
    assert.equal(isEligiblePrepared(result.record, "writer-early"), false);
    assert.deepEqual(readHandoff(cwd), result.record, "an early write is still fully readable");
  });
});

test("a write with no utilization is v2 but ineligible", () => {
  withCwd((cwd) => {
    const record = writeHandoff(cwd, {
      content: "no-utilization write",
      createdBySession: "writer-null-util",
    }).record;
    assert.equal(record.version, HANDOFF_RECORD_VERSION);
    assert.equal(record.lifecycle, null);
    assert.equal(record.generation, null);
    assert.equal(isEligiblePrepared(record, "writer-null-util"), false);
  });
});

test("isWriteRequired is owed at/above H with no eligible prepared, and cleared by a prepared write", () => {
  withCwd((cwd) => {
    // No record yet: at/above H a fresh write is owed; below H (or unknown) it is not.
    assert.equal(isWriteRequired(cwd, "sess", 80), true);
    assert.equal(isWriteRequired(cwd, "sess", 79), false);
    assert.equal(isWriteRequired(cwd, "sess", null), false);
    // After a prepared write for this session the debt clears...
    prepareFor(cwd, "sess", 85);
    assert.equal(isWriteRequired(cwd, "sess", 90), false);
    // ...but a DIFFERENT session does not own it, so it still owes a write.
    assert.equal(isWriteRequired(cwd, "other", 90), true);
  });
});

test("markSessionHandoffRequired only transitions an OWN prepared record", () => {
  withCwd((cwd) => {
    const prepared = prepareFor(cwd, "owner", 85);
    assert.equal(isSessionHandoffRequired(prepared, "owner"), false,
      "a prepared record is not yet awaiting the mandated read");

    // Foreign session cannot transition it.
    assert.equal(markSessionHandoffRequired(cwd, "intruder"), null);
    assert.equal(readHandoff(cwd).lifecycle, "prepared", "a foreign attempt leaves it prepared");

    // The authoring session moves prepared -> session_handoff_required.
    const required = markSessionHandoffRequired(cwd, "owner");
    assert.equal(required?.lifecycle, "session_handoff_required");
    assert.equal(isSessionHandoffRequired(required, "owner"), true);
    assert.equal(isSessionHandoffRequired(required, "someone-else"), false);

    // Only a prepared record may transition: a second attempt is a no-op.
    assert.equal(markSessionHandoffRequired(cwd, "owner"), null,
      "only a prepared record transitions on compaction");
  });
});

test("claimSessionHandoffRead fires exactly once: session_handoff_required -> resuming", () => {
  withCwd((cwd) => {
    prepareFor(cwd, "owner", 85);
    // A prepared (not-yet-required) record cannot be claimed.
    assert.equal(claimSessionHandoffRead(cwd, "owner"), null);

    markSessionHandoffRequired(cwd, "owner");
    // Foreign session cannot claim.
    assert.equal(claimSessionHandoffRead(cwd, "intruder"), null);

    const first = claimSessionHandoffRead(cwd, "owner");
    assert.equal(first?.lifecycle, "resuming", "the single claim moves it to resuming");
    assert.equal(readHandoff(cwd).lifecycle, "resuming");

    // The mandated read is claimed ONCE per generation.
    assert.equal(claimSessionHandoffRead(cwd, "owner"), null,
      "a second claim returns null (exactly-once)");
    assert.equal(readHandoff(cwd).lifecycle, "resuming");
  });
});

test("markRead advances a v2 record to working", () => {
  withCwd((cwd) => {
    prepareFor(cwd, "owner", 85);
    markSessionHandoffRequired(cwd, "owner");
    claimSessionHandoffRead(cwd, "owner"); // -> resuming
    const read = markRead(cwd, "reader");
    assert.equal(read?.read_by_session, "reader");
    assert.equal(read?.lifecycle, "working", "a completed read moves a v2 record to working");
    assert.equal(readHandoff(cwd).lifecycle, "working");
  });
});

test("a legacy v1 record is readable, ineligible, and NOT promoted on read or markRead", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-v1-noPromote-"));
  try {
    clearHandoff(cwd);
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    // A pre-lifecycle record: only the v1 fields, no version/lifecycle/generation.
    const legacy = {
      content: "legacy v1 handoff body",
      overflow_path: null,
      created_at: 1,
      created_by_session: "legacy-writer",
      read_by_session: null,
      read_at: null,
    };
    writeFileSync(handoffPath(cwd), JSON.stringify(legacy), "utf8");

    const read = readHandoff(cwd);
    assert.deepEqual(read, legacy, "a legacy record reads back byte-semantically unchanged");
    assert.equal("version" in read, false, "reading a v1 record adds no version");
    assert.equal("lifecycle" in read, false, "reading a v1 record adds no lifecycle");
    assert.equal("generation" in read, false, "reading a v1 record mints no generation");
    assert.equal(isEligiblePrepared(read, "legacy-writer"), false,
      "a legacy record is never an eligible prepared generation");
    assert.equal(markSessionHandoffRequired(cwd, "legacy-writer"), null,
      "a legacy record never transitions on compaction");

    // markRead stamps the reader but must NOT promote the schema (no lifecycle).
    const afterRead = markRead(cwd, "legacy-reader");
    assert.equal(afterRead?.read_by_session, "legacy-reader");
    assert.equal("lifecycle" in afterRead, false,
      "markRead must not promote a legacy record's schema");
  } finally {
    clearHandoff(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
