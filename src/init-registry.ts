import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFile } from "./orchestration/atomic-write.js";
import { extractManagedBlock, globalTargetFiles, managedBlockHash, targetFiles, parseArgs, upsertInitBlock } from "./init.js";
import { askLine, askYesNo, type PromptOptions } from "./prompt.js";
import { readPendingUpdateNotice, readUpdateCheckStatus } from "./orchestration/update-check.js";

export type InitScope = "project" | "global";

export interface InitRegistryEntry {
  root: string;
  files: string[];
  scope: InitScope;
  timestamp: string;
  blockHash: string;
}

export interface InitRegistry {
  globalInit: boolean;
  autoUpdate: boolean;
  entries: InitRegistryEntry[];
}

export interface UpdateRegistryOptions extends PromptOptions {
  home?: string;
  isTTY?: boolean;
  quiet?: boolean;
  force?: boolean;
  log?: (line: string) => void;
}

const EMPTY: InitRegistry = { globalInit: false, autoUpdate: false, entries: [] };
const SNAPSHOT_RE = /^\d{8}-\d{6}$/;

export function registryPath(home = homedir()): string {
  return join(home, ".subagent-mcp", "init-registry.json");
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function cleanRegistry(raw: Partial<InitRegistry> | null | undefined): InitRegistry {
  return {
    globalInit: raw?.globalInit === true,
    autoUpdate: raw?.autoUpdate === true,
    entries: Array.isArray(raw?.entries)
      ? raw.entries.filter((e): e is InitRegistryEntry =>
          !!e &&
          typeof e.root === "string" &&
          Array.isArray(e.files) &&
          e.files.every((f) => typeof f === "string") &&
          (e.scope === "project" || e.scope === "global") &&
          typeof e.timestamp === "string" &&
          typeof e.blockHash === "string")
      : [],
  };
}

export function readInitRegistry(home = homedir()): InitRegistry {
  const file = registryPath(home);
  if (!existsSync(file)) return { ...EMPTY, entries: [] };
  try {
    return cleanRegistry(JSON.parse(stripBom(readFileSync(file, "utf8"))) as Partial<InitRegistry>);
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

export function initRegistryHasAutoUpdate(home = homedir()): boolean {
  try {
    const raw = JSON.parse(stripBom(readFileSync(registryPath(home), "utf8"))) as Partial<InitRegistry>;
    return Object.prototype.hasOwnProperty.call(raw, "autoUpdate");
  } catch {
    return false;
  }
}

export function writeInitRegistry(registry: InitRegistry, home = homedir()): void {
  const file = registryPath(home);
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFile(file, `${JSON.stringify(cleanRegistry(registry), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function registerInitRun(input: { root: string; files: string[]; scope: InitScope; global?: boolean; home?: string }): void {
  const home = input.home ?? homedir();
  const registry = readInitRegistry(home);
  const root = resolve(input.root);
  const entry: InitRegistryEntry = {
    root,
    files: input.files.map((f) => resolve(f)),
    scope: input.scope,
    timestamp: new Date().toISOString(),
    blockHash: managedBlockHash(),
  };
  registry.entries = [...registry.entries.filter((e) => !(e.root === root && e.scope === input.scope)), entry];
  if (input.global) registry.globalInit = true;
  writeInitRegistry(registry, home);
}

export function deregisterInitRun(input: { root: string; scope: InitScope; global?: boolean; home?: string }): void {
  const home = input.home ?? homedir();
  const registry = readInitRegistry(home);
  const root = resolve(input.root);
  registry.entries = registry.entries.filter((e) => !(e.root === root && e.scope === input.scope));
  if (input.global) registry.globalInit = false;
  writeInitRegistry(registry, home);
}

export function clearInitRegistry(home = homedir()): void {
  writeInitRegistry({ ...EMPTY, entries: [] }, home);
}

function entryOutOfDate(entry: InitRegistryEntry): boolean {
  return entry.files.some((file) => {
    try {
      const block = extractManagedBlock(readFileSync(file, "utf8"));
      return !block || managedBlockHash(block) !== entry.blockHash || entry.blockHash !== managedBlockHash();
    } catch {
      return true;
    }
  });
}

export function inspectInitRegistry(home = homedir()) {
  const registry = readInitRegistry(home);
  const stalePaths = registry.entries.filter((e) => !existsSync(e.root)).map((e) => e.root);
  const outOfDate = registry.entries.filter((e) => existsSync(e.root) && entryOutOfDate(e)).map((e) => e.root);
  const pending = readPendingUpdateNotice();
  const check = readUpdateCheckStatus();
  return {
    globalInit: registry.globalInit,
    autoUpdate: registry.autoUpdate,
    entryCount: registry.entries.length,
    stalePaths,
    outOfDate,
    lastUpdateCheck: check?.checked_at ?? pending?.checked_at ?? "none",
    pendingVersion: pending?.latest_version ?? "none",
  };
}

export function pruneBackupsMostRecentOnly(home = homedir()): void {
  const root = join(home, ".subagent-mcp", "backups");
  if (!existsSync(root)) return;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SNAPSHOT_RE.test(d.name))
    .map((d) => d.name)
    .sort();
  for (const name of dirs.slice(0, -1)) rmSync(join(root, name), { recursive: true, force: true });
}

function scanExistingBlocks(home: string, cwd = process.cwd()): InitRegistryEntry[] {
  const roots = [cwd, join(home, ".claude"), join(home, ".codex"), join(home, ".gemini")];
  const files = [
    ...targetFiles(cwd, parseArgs(["--root", cwd])),
    ...globalTargetFiles(home),
  ];
  const byRoot = new Map<string, string[]>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const block = extractManagedBlock(readFileSync(file, "utf8"));
    if (!block) continue;
    const root = roots.find((r) => resolve(file).startsWith(resolve(r))) ?? cwd;
    byRoot.set(resolve(root), [...(byRoot.get(resolve(root)) ?? []), resolve(file)]);
  }
  return [...byRoot.entries()].map(([root, found]) => ({
    root,
    files: found,
    scope: root === resolve(cwd) ? "project" : "global",
    timestamp: new Date().toISOString(),
    blockHash: managedBlockHash(),
  }));
}

async function maybeBackfill(registry: InitRegistry, opts: UpdateRegistryOptions): Promise<InitRegistry> {
  if (registry.entries.length || registry.globalInit) return registry;
  const tty = opts.isTTY ?? process.stdin.isTTY;
  if (!tty) return registry;
  if (!(await askYesNo(opts, "Init registry is empty. Scan cwd and provider dirs for managed blocks? [Y/n] "))) return registry;
  const entries = scanExistingBlocks(opts.home ?? homedir());
  return { ...registry, globalInit: entries.some((e) => e.scope === "global"), entries };
}

async function handleStale(registry: InitRegistry, opts: UpdateRegistryOptions): Promise<InitRegistry> {
  const stale = registry.entries.filter((e) => !existsSync(e.root));
  if (stale.length === 0) return registry;
  const tty = opts.isTTY ?? process.stdin.isTTY;
  const log = opts.log ?? console.log;
  if (!tty) {
    log(`warning: keeping stale init registry path(s): ${stale.map((e) => e.root).join(", ")}`);
    return registry;
  }
  let entries = registry.entries;
  for (const entry of stale) {
    const answer = await askLine(opts, `Registered path missing: ${entry.root}. Keep or remove? [K/r] `);
    if (answer === "r" || answer === "remove") entries = entries.filter((e) => e !== entry);
  }
  return { ...registry, entries };
}

export async function prepareRegistryForUpdate(opts: UpdateRegistryOptions = {}): Promise<InitRegistry> {
  const home = opts.home ?? homedir();
  const log = opts.log ?? console.log;
  let registry = await maybeBackfill(readInitRegistry(home), { ...opts, home });
  registry = await handleStale(registry, { ...opts, home });
  writeInitRegistry(registry, home);
  if (!opts.quiet) {
    const dirs = registry.entries.filter((e) => e.scope === "project").map((e) => e.root);
    log(`Registered init project dirs: ${dirs.length ? dirs.join(", ") : "(none)"}`);
  }
  return registry;
}

export function applyRegistryAfterUpdate(registry: InitRegistry, opts: UpdateRegistryOptions = {}): void {
  const home = opts.home ?? homedir();
  if (registry.globalInit || opts.force) {
    for (const file of globalTargetFiles(home)) upsertInitBlock(file, { force: opts.force });
    registerInitRun({ root: home, files: globalTargetFiles(home), scope: "global", global: true, home });
  }
  if (opts.force) {
    for (const entry of registry.entries.filter((e) => e.scope === "project" && existsSync(e.root))) {
      for (const file of entry.files) upsertInitBlock(file, { force: true });
      registerInitRun({ root: entry.root, files: entry.files, scope: "project", home });
    }
  }
  pruneBackupsMostRecentOnly(home);
}
