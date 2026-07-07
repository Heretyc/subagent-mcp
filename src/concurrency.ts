import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONCURRENCY_SCAFFOLD } from "./config-scaffold.js";
import {
  cullStaleSlots,
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_TERMINAL_IDLE_MS,
  buildProcessTreeKillCommands,
  drainZombieIntents,
  drainZombieReports,
  parseSlotMetadata,
  readSlotMetadata,
  slotPathForAgent,
  writeSlotMetadata,
  type CullDeps,
  type ZombieRecord,
} from "./zombie.js";

export const DEFAULT_CAP: number = 20;
export const MIN_CAP: number = 10;
export const DEFAULT_CHECK_FOR_UPDATES: boolean = true;
export const DEFAULT_PERMISSIONS_CEILING = "auto" as const;
export const DEFAULT_ESCALATION = "irreversible-only" as const;
export const DEFAULT_STRICT_READ_PARITY = "warn" as const;
export const CONFIG_FILENAME: string = "global-subagent-mcp-config.jsonc";
export const LEGACY_CONFIG_FILENAME: string = "global-concurrency.jsonc";

export type PermissionsCeiling = "yolo" | "manual" | "auto";
export type EscalationMode = "irreversible-only" | "off";
export type StrictReadParity = "warn" | "off";
export type ConfigSourceKind =
  | "builtin"
  | "user-settings"
  | "user-settings-local"
  | "repo-claude-settings"
  | "repo-claude-settings-local"
  | "repo-codex-config";

export interface ConfigParseFailure {
  source: ConfigSourceKind;
  path: string;
  error: string;
}

export interface PermissionRulesConfig {
  allow: string[];
  deny: string[];
  ask: string[];
  additionalDirectories: string[];
}

export interface MergedPermissionConfig extends PermissionRulesConfig {
  permissionsCeiling: PermissionsCeiling;
  escalation: EscalationMode;
  strictReadParity: StrictReadParity;
  configParseFailure: ConfigParseFailure[];
  repoConfigChangedSinceFirstSeen: boolean;
  selfProtectionDeny: string[];
}

export interface GlobalConfig {
  globalConcurrentSubagents: number;
  checkForUpdates: boolean;
  permissionsCeiling: PermissionsCeiling;
  escalation: EscalationMode;
  strictReadParity: StrictReadParity;
  path: string;
  usedLegacyPath: boolean;
  parseFailure: string | null;
}

export interface ReservedSlot {
  ok: true;
  slotPath: string | null;
  current: number;
  max: number;
}

export interface RejectedSlot {
  ok: false;
  current: number;
  max: number;
  error?: string;
}

export type SlotReservation = ReservedSlot | RejectedSlot;

export {
  cullStaleSlots,
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_TERMINAL_IDLE_MS,
  buildProcessTreeKillCommands,
  drainZombieIntents,
  drainZombieReports,
  parseSlotMetadata,
  readSlotMetadata,
  slotPathForAgent,
  writeSlotMetadata,
  type CullDeps,
  type ZombieRecord,
};

export function clampCap(raw: unknown): number {
  if (!Number.isInteger(raw)) return DEFAULT_CAP;
  const v = raw as number;
  if (v <= 0) return DEFAULT_CAP;
  if (v < MIN_CAP) return MIN_CAP;
  return v;
}

export function stripJsoncComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(stripJsoncComments(text));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function parseConcurrencyConfig(text: string): number {
  let raw: unknown;
  try {
    raw = (JSON.parse(stripJsoncComments(text)) as Record<string, unknown> | null)?.globalConcurrentSubagents;
  } catch {
    raw = undefined;
  }
  return clampCap(raw);
}

export function parseCheckForUpdatesConfig(text: string): boolean {
  try {
    const raw = (JSON.parse(stripJsoncComments(text)) as Record<string, unknown> | null)
      ?.checkForUpdates;
    return typeof raw === "boolean" ? raw : DEFAULT_CHECK_FOR_UPDATES;
  } catch {
    return DEFAULT_CHECK_FOR_UPDATES;
  }
}

export function parsePermissionsCeilingConfig(text: string): PermissionsCeiling {
  try {
    const raw = parseJsonObject(text).permissionsCeiling;
    if (raw === "yolo" || raw === "manual" || raw === "auto") return raw;
    return raw === undefined ? DEFAULT_PERMISSIONS_CEILING : "manual";
  } catch {
    return "manual";
  }
}

export function parseEscalationConfig(text: string): EscalationMode {
  try {
    const raw = parseJsonObject(text).escalation;
    return raw === "irreversible-only" || raw === "off" ? raw : DEFAULT_ESCALATION;
  } catch {
    return DEFAULT_ESCALATION;
  }
}

export function parseStrictReadParityConfig(text: string): StrictReadParity {
  try {
    const raw = parseJsonObject(text).strictReadParity;
    return raw === "warn" || raw === "off" ? raw : DEFAULT_STRICT_READ_PARITY;
  } catch {
    return DEFAULT_STRICT_READ_PARITY;
  }
}

export function defaultConfigPath(): string {
  return fileURLToPath(new URL("./" + CONFIG_FILENAME, import.meta.url));
}

export function legacyConfigPath(path: string = defaultConfigPath()): string {
  return join(dirname(path), LEGACY_CONFIG_FILENAME);
}

export function resolveGlobalConfigPath(path: string = defaultConfigPath()): {
  path: string;
  usedLegacyPath: boolean;
} {
  if (existsSync(path)) return { path, usedLegacyPath: false };
  const legacyPath = legacyConfigPath(path);
  if (existsSync(legacyPath)) return { path: legacyPath, usedLegacyPath: true };
  return { path, usedLegacyPath: false };
}

export function ensureConcurrencyConfig(path: string = defaultConfigPath()): void {
  try {
    const resolved = resolveGlobalConfigPath(path);
    if (existsSync(resolved.path)) return;
    writeFileSync(path, CONCURRENCY_SCAFFOLD);
  } catch {}
}

export function readGlobalConfig(path: string = defaultConfigPath()): GlobalConfig {
  try {
    ensureConcurrencyConfig(path);
    const resolved = resolveGlobalConfigPath(path);
    const text = readFileSync(resolved.path, "utf8");
    parseJsonObject(text);
    return {
      globalConcurrentSubagents: parseConcurrencyConfig(text),
      checkForUpdates: parseCheckForUpdatesConfig(text),
      permissionsCeiling: parsePermissionsCeilingConfig(text),
      escalation: parseEscalationConfig(text),
      strictReadParity: parseStrictReadParityConfig(text),
      path: resolved.path,
      usedLegacyPath: resolved.usedLegacyPath,
      parseFailure: null,
    };
  } catch (e) {
    return {
      globalConcurrentSubagents: DEFAULT_CAP,
      checkForUpdates: DEFAULT_CHECK_FOR_UPDATES,
      permissionsCeiling: "manual",
      escalation: DEFAULT_ESCALATION,
      strictReadParity: DEFAULT_STRICT_READ_PARITY,
      path,
      usedLegacyPath: false,
      parseFailure: e instanceof Error ? e.message : String(e),
    };
  }
}

export function readGlobalCap(path: string = defaultConfigPath()): number {
  return readGlobalConfig(path).globalConcurrentSubagents;
}

export function readCheckForUpdates(path: string = defaultConfigPath()): boolean {
  return readGlobalConfig(path).checkForUpdates;
}

export function readPermissionsCeiling(path: string = defaultConfigPath()): PermissionsCeiling {
  return readGlobalConfig(path).permissionsCeiling;
}

export function readEscalation(path: string = defaultConfigPath()): EscalationMode {
  return readGlobalConfig(path).escalation;
}

export function readStrictReadParity(path: string = defaultConfigPath()): StrictReadParity {
  return readGlobalConfig(path).strictReadParity;
}

let legacyConfigDeprecationPending = false;
export function noteLegacyConfigIfUsed(path: string = defaultConfigPath()): void {
  if (resolveGlobalConfigPath(path).usedLegacyPath) legacyConfigDeprecationPending = true;
}

export function consumeLegacyConfigDeprecationNotice(): string | null {
  if (!legacyConfigDeprecationPending) return null;
  legacyConfigDeprecationPending = false;
  return `${LEGACY_CONFIG_FILENAME} is deprecated; rename it to ${CONFIG_FILENAME}. The legacy name is still read for one major version when the new file is absent.`;
}

function fileDigest(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

let startupCeilingDigest = fileDigest(resolveGlobalConfigPath().path);
export function checkCeilingIntegrity(path: string = defaultConfigPath()): "changed_since_startup" | null {
  const digest = fileDigest(resolveGlobalConfigPath(path).path);
  if (digest !== startupCeilingDigest) {
    startupCeilingDigest = digest;
    return "changed_since_startup";
  }
  return null;
}

export function configSelfProtectionDenyRules(path: string = defaultConfigPath()): string[] {
  const current = resolve(path);
  const legacy = resolve(legacyConfigPath(path));
  return [current, legacy].flatMap((p) => [`Edit(${p})`, `Write(${p})`, `NotebookEdit(${p})`]);
}

function asStringArray(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) return null;
  return raw as string[];
}

function readClaudePermissions(
  source: ConfigSourceKind,
  path: string,
  userScoped: boolean
): { rules: PermissionRulesConfig; disableBypass: boolean; failure: ConfigParseFailure | null } {
  try {
    const parsed = parseJsonObject(readFileSync(path, "utf8"));
    const permissions = parsed.permissions;
    if (permissions !== undefined && (!permissions || typeof permissions !== "object" || Array.isArray(permissions))) {
      throw new Error("permissions must be an object");
    }
    const p = (permissions ?? {}) as Record<string, unknown>;
    const allow = asStringArray(p.allow);
    const deny = asStringArray(p.deny);
    const ask = asStringArray(p.ask);
    const additionalDirectories = asStringArray(p.additionalDirectories);
    if (!allow || !deny || !ask || !additionalDirectories) {
      throw new Error("permissions arrays must contain only strings");
    }
    const disableBypass = userScoped && parsed.disableBypassPermissionsMode === "disable";
    return {
      rules: { allow, deny, ask, additionalDirectories },
      disableBypass,
      failure: null,
    };
  } catch (e) {
    return {
      rules: blanketMutatingAskRules(),
      disableBypass: false,
      failure: { source, path, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

function blanketMutatingAskRules(): PermissionRulesConfig {
  return {
    allow: [],
    deny: [],
    ask: ["Bash", "Edit", "Write", "NotebookEdit", "MultiEdit"],
    additionalDirectories: [],
  };
}

function mergeRules(target: PermissionRulesConfig, next: PermissionRulesConfig): void {
  target.allow.push(...next.allow);
  target.deny.push(...next.deny);
  target.ask.push(...next.ask);
  target.additionalDirectories.push(...next.additionalDirectories);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function codexTomlValue(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\r\\n#]+)["']?`, "m"));
  return m ? m[1].trim() : null;
}

function codexTomlArray(text: string, key: string): string[] {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
  if (!m) return [];
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((v) => v[1]);
}

function assertBasicTomlParsable(text: string): void {
  let inArray = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (!trimmed) continue;
    if (/^\[[^\]]+\]$/.test(trimmed)) continue;
    if (!trimmed.includes("=") && !inArray) throw new Error(`malformed TOML line: ${trimmed}`);
    const quoteCount = (trimmed.match(/(?<!\\)"/g) ?? []).length + (trimmed.match(/(?<!\\)'/g) ?? []).length;
    if (quoteCount % 2 !== 0) throw new Error(`unbalanced TOML quotes: ${trimmed}`);
    const opens = (trimmed.match(/\[/g) ?? []).length;
    const closes = (trimmed.match(/\]/g) ?? []).length;
    inArray = inArray || opens > closes;
    if (closes > opens) inArray = false;
  }
  if (inArray) throw new Error("unterminated TOML array");
}

function readCodexConfig(path: string): { rules: PermissionRulesConfig; failure: ConfigParseFailure | null } {
  try {
    const text = readFileSync(path, "utf8");
    assertBasicTomlParsable(text);
    const rules: PermissionRulesConfig = { allow: [], deny: [], ask: [], additionalDirectories: [] };
    if (codexTomlValue(text, "sandbox_mode") === "read-only") {
      rules.deny.push("Edit", "Write", "NotebookEdit");
    }
    rules.additionalDirectories.push(...codexTomlArray(text, "writable_roots"));
    for (const m of text.matchAll(/^\s*path\s*=\s*["']([^"']+)["']\s*\r?\n\s*access\s*=\s*["']deny["']/gm)) {
      rules.deny.push(`Edit(${m[1]})`, `Write(${m[1]})`);
    }
    for (const m of text.matchAll(/^\s*domain\s*=\s*["']([^"']+)["']\s*\r?\n\s*access\s*=\s*["']deny["']/gm)) {
      rules.deny.push(`WebFetch(domain:${m[1]})`);
    }
    return { rules, failure: null };
  } catch (e) {
    return {
      rules: blanketMutatingAskRules(),
      failure: { source: "repo-codex-config", path, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

function codexConfigChain(cwd: string): string[] {
  const out: string[] = [];
  let cur = resolve(cwd);
  const root = parsePath(cur).root;
  const dirs: string[] = [];
  while (true) {
    dirs.push(cur);
    if (cur === root) break;
    cur = dirname(cur);
  }
  for (const dir of dirs.reverse()) {
    const cfg = join(dir, ".codex", "config.toml");
    if (existsSync(cfg)) out.push(cfg);
  }
  return out;
}

function repoConfigDigest(cwd: string): string {
  const files = [
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
    ...codexConfigChain(cwd),
  ].filter((p) => existsSync(p));
  const h = createHash("sha256");
  for (const file of files) h.update(file).update("\0").update(readFileSync(file));
  return h.digest("hex");
}

const firstRepoDigests = new Map<string, string>();

export function readMergedPermissionConfig(
  cwd: string,
  path: string = defaultConfigPath()
): MergedPermissionConfig {
  const global = readGlobalConfig(path);
  noteLegacyConfigIfUsed(path);
  const merged: PermissionRulesConfig = { allow: [], deny: [], ask: [], additionalDirectories: [] };
  const failures: ConfigParseFailure[] = [];
  let ceiling = global.permissionsCeiling;
  if (global.parseFailure) {
    failures.push({ source: "builtin", path: global.path, error: global.parseFailure });
    ceiling = "manual";
    mergeRules(merged, blanketMutatingAskRules());
  }
  let disableBypass = false;
  const sources: Array<[ConfigSourceKind, string, boolean]> = [
    ["user-settings", join(homedir(), ".subagent-mcp", "settings.json"), true],
    ["user-settings-local", join(homedir(), ".subagent-mcp", "settings.local.json"), true],
    ["repo-claude-settings", join(cwd, ".claude", "settings.json"), false],
    ["repo-claude-settings-local", join(cwd, ".claude", "settings.local.json"), false],
  ];
  for (const [source, file, userScoped] of sources) {
    if (!existsSync(file)) continue;
    const read = readClaudePermissions(source, file, userScoped);
    mergeRules(merged, read.rules);
    if (read.disableBypass) disableBypass = true;
    if (read.failure) {
      failures.push(read.failure);
      ceiling = "manual";
    }
  }
  for (const file of codexConfigChain(cwd)) {
    const read = readCodexConfig(file);
    mergeRules(merged, read.rules);
    if (read.failure) {
      failures.push(read.failure);
      ceiling = "manual";
    }
  }
  if (disableBypass && ceiling === "yolo") ceiling = "auto";
  const digest = repoConfigDigest(cwd);
  const first = firstRepoDigests.get(cwd);
  const repoConfigChangedSinceFirstSeen = first !== undefined && first !== digest;
  if (first === undefined) firstRepoDigests.set(cwd, digest);
  const selfProtectionDeny = configSelfProtectionDenyRules(path);
  const protectedDirs = new Set([resolve(path), resolve(legacyConfigPath(path))]);
  merged.deny.push(...selfProtectionDeny);
  return {
    allow: unique(merged.allow),
    deny: unique(merged.deny),
    ask: unique(merged.ask),
    additionalDirectories: unique(merged.additionalDirectories).filter((p) => !protectedDirs.has(resolve(p))),
    permissionsCeiling: ceiling,
    escalation: global.escalation,
    strictReadParity: global.strictReadParity,
    configParseFailure: failures,
    repoConfigChangedSinceFirstSeen,
    selfProtectionDeny,
  };
}

export function slotDir(): string {
  if (process.env.SUBAGENT_SLOT_DIR) return process.env.SUBAGENT_SLOT_DIR;
  if (platform() === "win32") {
    return join(
      process.env.ProgramData || process.env.ALLUSERSPROFILE || "C:\\ProgramData",
      "subagent-mcp",
      "slots"
    );
  }
  return "/tmp/subagent-mcp/slots";
}

export function countSlots(dir: string = slotDir()): number {
  try {
    return readdirSync(dir).filter((f) => f.startsWith("slot-")).length;
  } catch {
    return 0;
  }
}

export function scheduleForceKill(ms: number, kill: () => void): void {
  const timer = setTimeout(kill, ms);
  timer.unref();
}

export const NONBLOCKING_CULL_DEPS: CullDeps = {
  scheduleForceKill,
};

export function reserveSlot(
  agentId: string,
  max: number,
  dir: string = slotDir(),
  cullDeps?: CullDeps
): SlotReservation {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o1777 });
    cullStaleSlots(dir, cullDeps);
    const slotPath = slotPathForAgent(dir, agentId);
    const before = countSlots(dir);
    if (before >= max) {
      return { ok: false, current: before, max };
    }
    // ponytail: count->write->recount narrows the TOCTOU; a cross-process lock would close it fully.
    writeSlotMetadata(slotPath, { agent_id: agentId });
    const after = countSlots(dir);
    if (after > max) {
      try {
        unlinkSync(slotPath);
      } catch {}
      return { ok: false, current: countSlots(dir), max };
    }
    return { ok: true, slotPath, current: after, max };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[concurrency] reserve failed, rejecting launch: ${error}`);
    return { ok: false, current: -1, max, error };
  }
}

export function releaseSlot(slotPath: string | null): void {
  if (!slotPath) return;
  try {
    unlinkSync(slotPath);
  } catch {}
}

export function globalCapMessage(
  current: number,
  max: number,
  configPath: string = defaultConfigPath()
): string {
  return `Global concurrent-subagent limit reached: ${current} of ${max} live subagents are already running across all sessions on this machine. This global count includes agents started by OTHER active agentic sessions and the ENTIRE recursive descendant tree, not just this session's direct children. launch_agent was REJECTED — this cap never queues or blocks; no slot frees itself by waiting. Free a slot manually first: call list_agents to see live agents, then kill_agent to terminate ones you no longer need, and retry. The limit is "globalConcurrentSubagents" in ${configPath} (default 20, minimum 10).`;
}
