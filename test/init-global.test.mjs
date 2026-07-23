/**
 * init-global.test.mjs - Unit tests for `subagent-mcp init --global`.
 *
 * WHY: global init targets durable per-tool home instruction files. These tests
 * pin the target list, argument exclusions, and direct upsert behavior against a
 * fake home so real user files are never touched.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  globalTargetFiles,
  parseArgs,
  runInit,
  upsertInitBlock,
} from "../dist/init.js";

const BEGIN_MARKER = "<!-- subagent-mcp:managed:begin schema=5 -->";

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

await test("runInit --global writes native-agent guards only in fake home", async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "sm-init-global-run-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    const code = await runInit(["--global"]);
    assert.equal(code, 0);
    assert.match(readFileSync(join(fakeHome, ".codex", "config.toml"), "utf8"), /multi_agent = false/);
    const settings = JSON.parse(readFileSync(join(fakeHome, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(settings.permissions.deny, ["Agent"], "global init writes only the canonical deny rule");
    assert.match(readFileSync(join(fakeHome, ".gemini", "settings.json"), "utf8"), /"enableAgents": false/);
    assert.equal(existsSync(join(fakeHome, ".gemini", "policies", "subagent-mcp-native-agents.toml")), true);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

await test("runInit --global migrates a legacy deny list in place", async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "sm-init-global-legacy-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    const settingsFile = join(fakeHome, ".claude", "settings.json");
    mkdirSync(dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify({
      theme: "dark",
      permissions: { allow: ["Read(*)"], deny: ["Task", "Agent", "Explore", "Agent(Explore)", "Write(secret)"] },
    }, null, 2)}\n`, "utf8");

    assert.equal(await runInit(["--global"]), 0);

    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    for (const legacy of ["Task", "Explore", "Agent(Explore)"]) {
      assert.equal(settings.permissions.deny.includes(legacy), false, `${legacy} must be removed`);
    }
    assert.equal(settings.permissions.deny.includes("Agent"), true);
    assert.equal(settings.permissions.deny.includes("Write(secret)"), true, "user entry preserved");
    assert.equal(settings.theme, "dark");
    assert.deepEqual(settings.permissions.allow, ["Read(*)"]);

    const body = readFileSync(settingsFile, "utf8");
    assert.equal(await runInit(["--global"]), 0);
    assert.equal(readFileSync(settingsFile, "utf8"), body, "second --global run is a no-op");
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
