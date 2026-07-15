import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  BACKUP_RELATIVE_FILES,
  createBackup,
  restoreLatestBackup,
} from "../dist/backup.js";

let passed = 0;
let failed = 0;
let measuredRestoreMs = 0;

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

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), "subagent-backup-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  try {
    fn(root);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

function userPath(home, rel) {
  return join(home, ...rel.split("/"));
}

function writeUserFile(home, rel, text) {
  const file = userPath(home, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return file;
}

function backupDirs(home) {
  return readdirSync(join(home, ".subagent-mcp", "backups")).sort();
}

test("createBackup snapshots five files and prunes to newest five", () => withHome((home) => {
  for (const rel of BACKUP_RELATIVE_FILES) writeUserFile(home, rel, `${rel}\n`);
  const first = createBackup(new Date(2026, 0, 1, 0, 0, 0));
  assert.equal(first.files.length, 5);
  assert.equal(first.files.every((f) => f.status === "present"), true);
  for (let i = 1; i < 7; i++) createBackup(new Date(2026, 0, 1, 0, 0, i));
  assert.deepEqual(backupDirs(home), [
    "20260101-000002",
    "20260101-000003",
    "20260101-000004",
    "20260101-000005",
    "20260101-000006",
  ]);
  assert.equal(existsSync(join(home, ".subagent-mcp", "backups", "20260101-000006", ".claude", "settings.json")), true);
}));

test("missing sources are recorded as absent", () => withHome((home) => {
  writeUserFile(home, ".claude/settings.json", "{}\n");
  const manifest = createBackup(new Date(2026, 0, 2, 0, 0, 0));
  assert.equal(manifest.files.filter((f) => f.status === "present").length, 1);
  assert.equal(manifest.files.filter((f) => f.status === "absent").length, 4);
}));

test("restoreLatestBackup round-trips present files and leaves absent files", () => withHome((home) => {
  writeUserFile(home, ".claude/settings.json", "old claude\n");
  writeUserFile(home, ".claude.json", "old root\n");
  createBackup(new Date(2026, 0, 3, 0, 0, 0));
  writeUserFile(home, ".claude/settings.json", "new claude\n");
  writeUserFile(home, ".claude.json", "new root\n");
  writeUserFile(home, ".codex/hooks.json", "created after backup\n");
  const start = performance.now();
  const result = restoreLatestBackup();
  measuredRestoreMs = Math.max(measuredRestoreMs, performance.now() - start);
  assert.equal(result.restored.length, 2);
  assert.equal(readFileSync(userPath(home, ".claude/settings.json"), "utf8"), "old claude\n");
  assert.equal(readFileSync(userPath(home, ".claude.json"), "utf8"), "old root\n");
  assert.equal(readFileSync(userPath(home, ".codex/hooks.json"), "utf8"), "created after backup\n");
  assert.equal(result.warnings.length, 1);
}));

test("injected restore failure aborts before originals change", () => withHome((home) => {
  writeUserFile(home, ".claude/settings.json", "snapshot\n");
  createBackup(new Date(2026, 0, 4, 0, 0, 0));
  writeUserFile(home, ".claude/settings.json", "current\n");
  assert.throws(() => restoreLatestBackup({ injectFailureAfterStage: true }), /injected rollback failure/);
  assert.equal(readFileSync(userPath(home, ".claude/settings.json"), "utf8"), "current\n");
}));

test("CLI rollback is dry in non-TTY mode", () => withHome((home) => {
  writeUserFile(home, ".claude/settings.json", "snapshot\n");
  createBackup(new Date(2026, 0, 5, 0, 0, 0));
  writeUserFile(home, ".claude/settings.json", "current\n");
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
  const result = spawnSync(process.execPath, [bin, "rollback"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /non-TTY: no changes made/);
  assert.equal(readFileSync(userPath(home, ".claude/settings.json"), "utf8"), "current\n");
}));

console.log(`\nMeasured restore time: ${measuredRestoreMs.toFixed(2)}ms`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
