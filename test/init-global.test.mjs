/**
 * init-global.test.mjs - Unit tests for `subagent-mcp init --global`.
 *
 * WHY: global init targets durable per-tool home instruction files. These tests
 * pin the target list, argument exclusions, and direct upsert behavior against a
 * fake home so real user files are never touched.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  globalTargetFiles,
  parseArgs,
  upsertInitBlock,
} from "../dist/init.js";

const BEGIN_MARKER = "<!-- subagent-mcp:managed:begin schema=3 -->";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

await test("globalTargetFiles: returns only Claude, Codex, and Gemini home targets", () => {
  const files = globalTargetFiles("/fake/home");

  assert.deepEqual(files, [
    join("/fake/home", ".claude", "CLAUDE.md"),
    join("/fake/home", ".codex", "AGENTS.md"),
    join("/fake/home", ".gemini", "GEMINI.md"),
  ]);
  assert.equal(files.length, 3);
  assert.equal(files.some((f) => /copilot|cursor/i.test(f)), false);
});

await test("parseArgs: --global is set and rejects root/file/editor target modifiers", () => {
  assert.equal(parseArgs(["--global"]).global, true);
  assert.equal(parseArgs([]).global, false);

  assert.throws(() => parseArgs(["--global", "--root", "somedir"]));
  assert.throws(() => parseArgs(["--global", "--files", "AGENTS.md"]));
  assert.throws(() => parseArgs(["--global", "--copilot"]));
  assert.throws(() => parseArgs(["--global", "--cursor"]));
});

await test("global targets: create, idempotent upsert, remove, and dry-run stay in fake home", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "sm-init-global-"));
  try {
    const targets = globalTargetFiles(fakeHome);
    assert.equal(targets.length, 3);

    for (const target of targets) {
      const opts = { dryRun: false, remove: false, force: false };
      const first = upsertInitBlock(target, opts);
      assert.equal(first.status, "created");
      assert.equal(first.changed, true);
      assert.equal(existsSync(dirname(target)), true);
      assert.equal(existsSync(target), true);

      const body = readFileSync(target, "utf8");
      assert.match(body, new RegExp(BEGIN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      const second = upsertInitBlock(target, opts);
      assert.equal(second.status, "ok");
      assert.equal(second.changed, false);
      assert.equal(readFileSync(target, "utf8"), body);

      const removed = upsertInitBlock(target, { dryRun: false, remove: true, force: false });
      assert.equal(removed.status, "removed");
      assert.equal(removed.changed, true);
      assert.equal(readFileSync(target, "utf8").includes(BEGIN_MARKER), false);
    }

    const dryRunTarget = join(fakeHome, ".dry-run", "AGENTS.md");
    const dryRun = upsertInitBlock(dryRunTarget, {
      dryRun: true,
      remove: false,
      force: false,
    });
    assert.equal(dryRun.status, "created");
    assert.equal(dryRun.changed, true);
    assert.equal(existsSync(dryRunTarget), false);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
