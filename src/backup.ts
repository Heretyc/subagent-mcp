import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getConfigHome } from "./config-home.js";

export type BackupFileStatus = "present" | "absent";

export interface BackupManifestFile {
  key: string;
  source: string;
  backup: string;
  status: BackupFileStatus;
}

export interface BackupManifest {
  created_at: string;
  timestamp: string;
  files: BackupManifestFile[];
}

export interface RestoreResult {
  timestamp: string;
  restored: string[];
  warnings: string[];
}

export const BACKUP_RELATIVE_FILES = [
  ".claude/settings.json",
  ".claude.json",
  ".claude/mcp.json",
  ".codex/hooks.json",
  ".subagent-mcp/providers.jsonc",
] as const;

const MANIFEST = "manifest.json";
const SNAPSHOT_RE = /^\d{8}-\d{6}$/;

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    p(date.getMonth() + 1),
    p(date.getDate()),
    "-",
    p(date.getHours()),
    p(date.getMinutes()),
    p(date.getSeconds()),
  ].join("");
}

export function backupRoot(): string {
  return join(getConfigHome(), "backups");
}

export function backupFiles(home = homedir()): BackupManifestFile[] {
  return BACKUP_RELATIVE_FILES.map((rel) => ({
    key: rel,
    source: join(home, ...rel.split("/")),
    backup: rel,
    status: "absent" as BackupFileStatus,
  }));
}

function snapshotDirs(root = backupRoot()): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SNAPSHOT_RE.test(d.name))
    .map((d) => d.name)
    .sort();
}

function pruneSnapshots(root = backupRoot(), keep = 5): void {
  for (const name of snapshotDirs(root).slice(0, Math.max(0, snapshotDirs(root).length - keep))) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
}

export function createBackup(now = new Date()): BackupManifest {
  const root = backupRoot();
  mkdirSync(root, { recursive: true });
  let timestamp = stamp(now);
  while (existsSync(join(root, timestamp))) {
    now = new Date(now.getTime() + 1000);
    timestamp = stamp(now);
  }
  const dir = join(root, timestamp);
  mkdirSync(dir, { recursive: true });
  const files = backupFiles().map((f) => {
    if (!existsSync(f.source)) return f;
    const target = join(dir, ...f.backup.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(f.source, target);
    return { ...f, status: "present" as BackupFileStatus };
  });
  const manifest = { created_at: now.toISOString(), timestamp, files };
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2), "utf8");
  pruneSnapshots(root);
  return manifest;
}

export function latestBackupTimestamp(root = backupRoot()): string | null {
  return snapshotDirs(root).at(-1) ?? null;
}

export function readBackupManifest(timestamp: string): BackupManifest {
  return JSON.parse(readFileSync(join(backupRoot(), timestamp, MANIFEST), "utf8")) as BackupManifest;
}

export function restoreBackup(
  timestamp: string,
  opts: { injectFailureAfterStage?: boolean } = {}
): RestoreResult {
  const dir = join(backupRoot(), timestamp);
  const manifest = readBackupManifest(timestamp);
  const warnings: string[] = [];
  const staged: { temp: string; dest: string; original: string | null }[] = [];
  const committed: { dest: string; original: string | null }[] = [];
  try {
    for (const f of manifest.files) {
      if (f.status === "absent") {
        if (existsSync(f.source)) warnings.push(`left existing file unchanged: ${f.source}`);
        continue;
      }
      const src = join(dir, ...f.backup.split("/"));
      if (!existsSync(src)) throw new Error(`snapshot file missing: ${src}`);
      mkdirSync(dirname(f.source), { recursive: true });
      const temp = join(dirname(f.source), `.${basename(f.source)}.rollback-${process.pid}-${staged.length}.tmp`);
      const original = existsSync(f.source)
        ? join(dirname(f.source), `.${basename(f.source)}.rollback-${process.pid}-${staged.length}.orig`)
        : null;
      copyFileSync(src, temp);
      if (original) copyFileSync(f.source, original);
      staged.push({ temp, dest: f.source, original });
    }
    if (opts.injectFailureAfterStage) throw new Error("injected rollback failure");
    for (const f of staged) {
      renameSync(f.temp, f.dest);
      committed.push({ dest: f.dest, original: f.original });
    }
    for (const f of staged) if (f.original) rmSync(f.original, { force: true });
    return { timestamp, restored: staged.map((f) => f.dest), warnings };
  } catch (e) {
    for (const f of staged) rmSync(f.temp, { force: true });
    for (const f of committed.reverse()) {
      rmSync(f.dest, { force: true });
      if (f.original) renameSync(f.original, f.dest);
    }
    for (const f of staged) if (f.original) rmSync(f.original, { force: true });
    throw e;
  }
}

export function restoreLatestBackup(opts: { injectFailureAfterStage?: boolean } = {}): RestoreResult {
  const timestamp = latestBackupTimestamp();
  if (!timestamp) throw new Error(`no backups found in ${backupRoot()}`);
  return restoreBackup(timestamp, opts);
}

async function askProceed(timestamp: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`Proceed with rollback from ${timestamp}? [Y/n] `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function runRollback(): Promise<number> {
  try {
    const timestamp = latestBackupTimestamp();
    if (!timestamp) throw new Error(`no backups found in ${backupRoot()}`);
    const manifest = readBackupManifest(timestamp);
    if (!process.stdin.isTTY) {
      console.log(`Rollback from ${timestamp} would restore:`);
      for (const f of manifest.files) console.log(`  ${f.status.padEnd(7)} ${f.source}`);
      console.log("non-TTY: no changes made");
      return 0;
    }
    if (!(await askProceed(timestamp))) {
      console.log("rollback cancelled");
      return 0;
    }
    const result = restoreBackup(timestamp);
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    console.log(`restored ${result.restored.length} file(s) from ${timestamp}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
