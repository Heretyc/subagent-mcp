import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertInitBlock, INIT_BLOCK } from "../dist/init.js";

const SCHEMA2_BEGIN = "<!-- subagent-mcp:managed:begin schema=2 -->";
const SCHEMA3_BEGIN = "<!-- subagent-mcp:managed:begin schema=3 -->";
const MANAGED_END = "<!-- subagent-mcp:managed:end -->";
const LEGACY_BEGIN = "<!-- subagent-mcp:begin -->";
const LEGACY_END = "<!-- subagent-mcp:end -->";

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// A v1 legacy managed block (pre-schema=2 markers).
const LEGACY_BLOCK = [LEGACY_BEGIN, "## old managed content", "do not edit", LEGACY_END].join("\n");
const SCHEMA2_BLOCK = [
  SCHEMA2_BEGIN,
  "## stale schema 2 managed content",
  "old invariant text",
  MANAGED_END,
].join("\n");

function withTempFile(initialContent, fn) {
  const dir = mkdtempSync(join(tmpdir(), "subagent-init-mig-"));
  const file = join(dir, "CLAUDE.md");
  try {
    writeFileSync(file, initialContent, "utf8");
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("legacy v1 block migrates to exactly one schema=3 block, legacy markers gone", () => {
  const content = `# Project\n\nIntro text.\n\n${LEGACY_BLOCK}\n\nTrailing text.\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.changed, true);
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA3_BEGIN), 1, "exactly one schema=3 begin marker");
    assert.equal(count(out, MANAGED_END), 1, "exactly one managed end marker");
    assert.equal(count(out, LEGACY_BEGIN), 0, "legacy begin marker removed");
    assert.equal(count(out, LEGACY_END), 0, "legacy end marker removed");
    assert.ok(out.includes(INIT_BLOCK), "canonical schema=3 block present");
    assert.ok(out.includes("Trailing text."), "surrounding content preserved");
  });
});

test("existing schema=2 managed block migrates to exactly one schema=3 block", () => {
  const content = `# Project\n\nIntro text.\n\n${SCHEMA2_BLOCK}\n\nTrailing text.\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    assert.equal(result.changed, true);
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA3_BEGIN), 1, "exactly one schema=3 begin marker");
    assert.equal(count(out, MANAGED_END), 1, "exactly one managed end marker");
    assert.equal(count(out, SCHEMA2_BEGIN), 0, "schema=2 begin marker removed");
    assert.doesNotMatch(out, /stale schema 2 managed content/);
    assert.ok(out.includes(INIT_BLOCK), "canonical schema=3 block present");
    assert.ok(out.includes("Trailing text."), "surrounding content preserved");
  });
});

test("two managed blocks collapse to exactly one schema=3 block", () => {
  const content = `# Project\n\n${LEGACY_BLOCK}\n\nmiddle\n\n${INIT_BLOCK}\n\nend\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA3_BEGIN), 1, "collapsed to one schema=3 begin");
    assert.equal(count(out, MANAGED_END), 1, "collapsed to one managed end");
    assert.equal(count(out, LEGACY_BEGIN), 0, "legacy begin marker removed");
    assert.equal(count(out, LEGACY_END), 0, "legacy end marker removed");
  });
});

test("existing schema=3 block is idempotent across repeated runs", () => {
  const content = `# Project\n\n${INIT_BLOCK}\n\nbody\n`;
  withTempFile(content, (file) => {
    const first = upsertInitBlock(file);
    assert.equal(first.status, "ok", "already-canonical block needs no change");
    assert.equal(first.changed, false);
    const afterFirst = readFileSync(file, "utf8");

    const second = upsertInitBlock(file);
    assert.equal(second.status, "ok");
    const afterSecond = readFileSync(file, "utf8");

    assert.equal(afterFirst, afterSecond, "content unchanged on re-run");
    assert.equal(count(afterSecond, SCHEMA3_BEGIN), 1, "exactly one block remains");
    assert.equal(count(afterSecond, MANAGED_END), 1);
  });
});
