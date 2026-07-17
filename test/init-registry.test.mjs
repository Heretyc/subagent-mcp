import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { INIT_BLOCK, managedBlockHash, runInit } from "../dist/init.js";
import {
  applyRegistryAfterUpdate,
  prepareRegistryForUpdate,
  pruneBackupsMostRecentOnly,
  readInitRegistry,
  registryPath,
  registerInitRun,
  writeInitRegistry,
} from "../dist/init-registry.js";
import { runUninstall } from "../dist/uninstall.js";

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), "subagent-init-registry-"));
  const home = join(root, "home");
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn({ root, home, project: join(root, "project") });
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

function mkdirp(file) {
  mkdirSync(dirname(file), { recursive: true });
}

test("read/write registry is BOM-safe and preserves autoUpdate", () => withHome(({ home }) => {
  const file = registryPath(home);
  mkdirp(file);
  writeFileSync(file, '\ufeff{"globalInit":true,"autoUpdate":true,"entries":[]}\n', "utf8");
  const registry = readInitRegistry(home);
  assert.equal(registry.globalInit, true);
  assert.equal(registry.autoUpdate, true);
  writeInitRegistry(registry, home);
  assert.notEqual(readFileSync(file, "utf8").charCodeAt(0), 0xfeff);
}));

test("runInit registers root, files, scope, timestamp, and blockHash", async () => withHome(async ({ home, project }) => {
  assert.equal(await runInit(["--root", project, "--copilot", "--cursor"]), 0);
  const registry = readInitRegistry(home);
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].root, project);
  assert.equal(registry.entries[0].scope, "project");
  assert.equal(registry.entries[0].files.length, 5);
  assert.equal(registry.entries[0].blockHash, managedBlockHash());
  assert.ok(Date.parse(registry.entries[0].timestamp) > 0);
}));

test("blockHash ignores managed delimiters and hashes content only", () => {
  const changedMarkers = INIT_BLOCK
    .replace(/^<!-- subagent-mcp:managed:begin schema=4 -->/, "<!-- changed begin -->")
    .replace(/<!-- subagent-mcp:managed:end -->$/, "<!-- changed end -->");
  assert.equal(managedBlockHash(changedMarkers), managedBlockHash());
});

test("clean update prunes backups to newest snapshot", () => withHome(({ home }) => {
  const backups = join(home, ".subagent-mcp", "backups");
  for (const name of ["20260101-000001", "20260101-000002", "20260101-000003"]) {
    mkdirSync(join(backups, name), { recursive: true });
  }
  pruneBackupsMostRecentOnly(home);
  assert.deepEqual(readdirSync(backups), ["20260101-000003"]);
}));

test("stale registered dirs are kept and warned in non-TTY update", async () => withHome(async ({ home, root }) => {
  const missing = join(root, "missing");
  registerInitRun({ root: missing, files: [join(missing, "AGENTS.md")], scope: "project", home });
  const out = [];
  const registry = await prepareRegistryForUpdate({ home, isTTY: false, log: (line) => out.push(line) });
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].root, missing);
  assert.match(out.join("\n"), /warning: keeping stale init registry path/);
}));

test("update --force reapplies global and registered project blocks", () => withHome(({ home, project }) => {
  const file = join(project, "AGENTS.md");
  mkdirp(file);
  writeFileSync(file, "user\n", "utf8");
  registerInitRun({ root: project, files: [file], scope: "project", home });
  applyRegistryAfterUpdate(readInitRegistry(home), { home, force: true });
  assert.match(readFileSync(file, "utf8"), /subagent-mcp:managed:begin/);
  assert.match(readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8"), /subagent-mcp:managed:begin/);
  assert.equal(readInitRegistry(home).globalInit, true);
}));

test("init --remove deregisters and uninstall clears registry", async () => withHome(async ({ home, project }) => {
  assert.equal(await runInit(["--root", project]), 0);
  assert.equal(readInitRegistry(home).entries.length, 1);
  assert.equal(await runInit(["--root", project, "--remove"]), 0);
  assert.equal(readInitRegistry(home).entries.length, 0);

  registerInitRun({ root: project, files: [join(project, "AGENTS.md")], scope: "project", home });
  assert.equal(readInitRegistry(home).entries.length, 1);
  assert.equal(await runUninstall({
    home,
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_c, _e, cb) { cb(); } }),
    backup: () => {},
    log: () => {},
  }), 0);
  assert.deepEqual(readInitRegistry(home), { globalInit: false, autoUpdate: false, entries: [] });
}));

for (const t of tests) {
  try {
    await t.fn();
    console.log(`  PASS: ${t.name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${t.name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
