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
  UNAVAILABLE_NO_METERING,
  checkHandoffWriteAvailable,
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

// LOCKED (context-coaching): the handoff-write unlock is a hard-coded 20% and is
// never configurable. Boundaries under test are 19 / 20 / 21, and the gate stays
// open well past the (now user-configurable, default 60) wind-down warn point.
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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
