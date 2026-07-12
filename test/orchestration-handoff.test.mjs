/**
 * orchestration-handoff.test.mjs - Unit tests for context handoff state.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HANDOFF_CONTENT_LIMIT,
  HANDOFF_OVERFLOW_LIMIT,
  OVERSIZE_CONTENT,
  OVERSIZE_OVERFLOW,
  clearHandoff,
  handoffPath,
  markRead,
  readHandoff,
  writeHandoff,
} from "../dist/orchestration/handoff.js";

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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
