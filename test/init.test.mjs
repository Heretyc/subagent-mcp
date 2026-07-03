/**
 * init.test.mjs - Unit tests for `subagent-mcp init`.
 *
 * WHY (Rule 9): `init` writes durable instruction files in consumer repos.
 * The tests pin the safety-critical contract: only the managed marker block is
 * replaced/removed, user content and line endings survive, dry-run does not
 * write, and the source repo guard prevents accidental self-mutation.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { INIT_BLOCK, runInit, upsertInitBlock } from "../dist/init.js";

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

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "subagent-init-"));
}

async function withCapturedConsole(fn) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => out.push(args.join(" "));
  console.error = (...args) => err.push(args.join(" "));
  try {
    const value = await fn();
    return { value, out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

await test("upsert: inserts after first H1 and is idempotent", () => {
  const root = tempRoot();
  try {
    const file = join(root, "AGENTS.md");
    writeFileSync(file, "# Project\n\nExisting rules.\n", "utf8");

    const first = upsertInitBlock(file);
    assert.equal(first.status, "added");
    assert.equal(first.changed, true);
    const body = readFileSync(file, "utf8");
    assert.match(body, /^# Project\n\n<!-- subagent-mcp:managed:begin schema=2 -->/);
    assert.match(body, /\nExisting rules\.\n$/);
    assert.equal(readdirSync(root).filter((f) => f.includes(".bak-init-")).length, 1);

    const second = upsertInitBlock(file);
    assert.equal(second.status, "ok");
    assert.equal(second.changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("upsert: replaces older managed block without changing user content", () => {
  const root = tempRoot();
  try {
    const file = join(root, "CLAUDE.md");
    writeFileSync(
      file,
      [
        "# Project",
        "",
        "<!-- subagent-mcp:begin old-version -->",
        "old text",
        "<!-- subagent-mcp:end -->",
        "",
        "Keep me.",
        "",
      ].join("\n"),
      "utf8"
    );

    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    const body = readFileSync(file, "utf8");
    assert.match(body, /<!-- subagent-mcp:managed:begin schema=2 -->/);
    // legacy marker fully migrated away
    assert.doesNotMatch(body, /subagent-mcp:begin old-version/);
    assert.doesNotMatch(body, /old text/);
    assert.match(body, /\nKeep me\.\n$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("upsert: preserves BOM and CRLF endings", () => {
  const root = tempRoot();
  try {
    const file = join(root, "GEMINI.md");
    writeFileSync(
      file,
      "\ufeff# Project\r\n\r\n<!-- subagent-mcp:begin v0 -->\r\nstale\r\n<!-- subagent-mcp:end -->\r\n",
      "utf8"
    );

    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    const body = readFileSync(file, "utf8");
    assert.equal(body.charCodeAt(0), 0xfeff);
    assert.match(body, /\r\n<!-- subagent-mcp:managed:begin schema=2 -->\r\n/);
    assert.doesNotMatch(body, /(?<!\r)\n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("remove: deletes only the managed block", () => {
  const root = tempRoot();
  try {
    const file = join(root, "AGENTS.md");
    writeFileSync(file, `${INIT_BLOCK}\n\nUser rule.\n`, "utf8");

    const result = upsertInitBlock(file, { remove: true });
    assert.equal(result.status, "removed");
    assert.equal(readFileSync(file, "utf8"), "User rule.\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("runInit: dry-run reports targets but writes nothing", async () => {
  const root = tempRoot();
  try {
    const { value: code, out } = await withCapturedConsole(() =>
      runInit(["--root", root, "--dry-run"])
    );
    assert.equal(code, 0);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(existsSync(join(root, "CLAUDE.md")), false);
    assert.equal(existsSync(join(root, "GEMINI.md")), false);
    assert.match(out.join("\n"), /created .*AGENTS\.md/);
    assert.match(out.join("\n"), /\(dry-run: no files written\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("runInit: refuses the source repo without --force", async () => {
  const root = tempRoot();
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "@heretyc/subagent-mcp" }),
      "utf8"
    );
    const { value: code, err } = await withCapturedConsole(() =>
      runInit(["--root", root, "--dry-run"])
    );
    assert.equal(code, 1);
    assert.match(err.join("\n"), /Refusing to run init inside the subagent-mcp source repo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("runInit: rejects --files targets outside --root", async () => {
  const root = tempRoot();
  try {
    const { value: code, err } = await withCapturedConsole(() =>
      runInit(["--root", root, "--files", "../outside.md"])
    );
    assert.equal(code, 1);
    assert.match(err.join("\n"), /escapes --root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
