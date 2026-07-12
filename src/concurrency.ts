import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
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
export const DEFAULT_SANDBOX_NETWORK: boolean = false;
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
  sandboxNetwork: boolean;
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
  sandboxNetwork: boolean;
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
  let out = "";
  let inString = false;
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  for (let i = text.startsWith("\uFEFF") ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = null;
      }
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
      i--;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      if (i < text.length) i++;
      continue;
    }
    out += ch;
  }
  return out;
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

export function parseSandboxNetworkConfig(text: string): boolean {
  try {
    const raw = parseJsonObject(text).sandboxNetwork;
    return typeof raw === "boolean" ? raw : DEFAULT_SANDBOX_NETWORK;
  } catch {
    return DEFAULT_SANDBOX_NETWORK;
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
      sandboxNetwork: parseSandboxNetworkConfig(text),
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
      sandboxNetwork: DEFAULT_SANDBOX_NETWORK,
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

export function readSandboxNetwork(path: string = defaultConfigPath()): boolean {
  return readGlobalConfig(path).sandboxNetwork;
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
      rules: { allow, deny, ask, additionalDirectories, sandboxNetwork: false },
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
    sandboxNetwork: false,
  };
}

function mergeRules(target: PermissionRulesConfig, next: PermissionRulesConfig): void {
  target.allow.push(...next.allow);
  target.deny.push(...next.deny);
  target.ask.push(...next.ask);
  target.additionalDirectories.push(...next.additionalDirectories);
  target.sandboxNetwork ||= next.sandboxNetwork;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

type TomlMultilineQuote = `"""` | "'''" | null;

function codexKeyPattern(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)$`);
}

function scanBasicString(line: string, start: number): number {
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (line[i] === "\"") return i;
  }
  throw new Error(`unbalanced TOML quotes: ${line.trim()}`);
}

function scanLiteralString(line: string, start: number): number {
  const end = line.indexOf("'", start + 1);
  if (end === -1) throw new Error(`unbalanced TOML quotes: ${line.trim()}`);
  return end;
}

function stripTomlCommentsAndMultilineStrings(text: string): string {
  let multiline: TomlMultilineQuote = null;
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let sanitized = "";
    let i = 0;
    if (multiline) {
      const end = line.indexOf(multiline);
      if (end === -1) {
        out.push("");
        continue;
      }
      i = end + 3;
      multiline = null;
    }
    while (i < line.length) {
      if (line.startsWith(`"""`, i) || line.startsWith("'''", i)) {
        const delimiter = line.startsWith(`"""`, i) ? `"""` : "'''";
        sanitized += delimiter === `"""` ? `""` : "''";
        i += 3;
        const end = line.indexOf(delimiter, i);
        if (end === -1) {
          multiline = delimiter;
          break;
        }
        i = end + 3;
        continue;
      }
      if (line[i] === "#") break;
      if (line[i] === "\"") {
        const end = scanBasicString(line, i);
        sanitized += line.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (line[i] === "'") {
        const end = scanLiteralString(line, i);
        sanitized += line.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      sanitized += line[i];
      i++;
    }
    out.push(sanitized);
  }
  if (multiline) throw new Error("unterminated TOML multiline string");
  return out.join("\n");
}

function countTomlBrackets(line: string): { opens: number; closes: number } {
  let opens = 0;
  let closes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\"") {
      i = scanBasicString(line, i);
      continue;
    }
    if (line[i] === "'") {
      i = scanLiteralString(line, i);
      continue;
    }
    if (line[i] === "[") opens++;
    if (line[i] === "]") closes++;
  }
  return { opens, closes };
}

function tomlAssignmentValue(text: string, key: string): string | null {
  const keyPattern = codexKeyPattern(key);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(keyPattern);
    if (!m) continue;
    let value = m[1].trim();
    if (!value.startsWith("[")) return value;
    let balance = 0;
    for (let j = i; j < lines.length; j++) {
      const fragment = j === i ? value : lines[j];
      const { opens, closes } = countTomlBrackets(fragment);
      balance += opens - closes;
      if (j > i) value += `\n${fragment.trim()}`;
      if (balance <= 0) return value;
    }
    return value;
  }
  return null;
}

function parseTomlScalar(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"")) {
    const end = scanBasicString(trimmed, 0);
    return trimmed.slice(1, end);
  }
  if (trimmed.startsWith("'")) {
    const end = scanLiteralString(trimmed, 0);
    return trimmed.slice(1, end);
  }
  const bare = trimmed.match(/^[^\s,]+/);
  return bare ? bare[0] : null;
}

function codexTomlValue(text: string, key: string): string | null {
  const value = tomlAssignmentValue(text, key);
  return value === null ? null : parseTomlScalar(value);
}

function codexTomlArray(text: string, key: string): string[] {
  const value = tomlAssignmentValue(text, key);
  if (!value || !value.trim().startsWith("[")) return [];
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\"") {
      const end = scanBasicString(value, i);
      out.push(value.slice(i + 1, end));
      i = end;
    } else if (value[i] === "'") {
      const end = scanLiteralString(value, i);
      out.push(value.slice(i + 1, end));
      i = end;
    }
  }
  return out;
}

function assertBasicTomlParsable(text: string): string {
  const sanitized = stripTomlCommentsAndMultilineStrings(text);
  let arrayDepth = 0;
  for (const line of sanitized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\[[^\]]+\]$/.test(trimmed)) continue;
    if (!trimmed.includes("=") && arrayDepth === 0) throw new Error(`malformed TOML line: ${trimmed}`);
    const { opens, closes } = countTomlBrackets(trimmed);
    arrayDepth += opens - closes;
    if (arrayDepth < 0) throw new Error(`malformed TOML line: ${trimmed}`);
  }
  if (arrayDepth > 0) throw new Error("unterminated TOML array");
  return sanitized;
}

function readCodexConfig(path: string): { rules: PermissionRulesConfig; failure: ConfigParseFailure | null } {
  try {
    const text = readFileSync(path, "utf8");
    const toml = assertBasicTomlParsable(text);
    const rules: PermissionRulesConfig = { allow: [], deny: [], ask: [], additionalDirectories: [], sandboxNetwork: false };
    if (codexTomlValue(toml, "sandbox_mode") === "read-only") {
      rules.deny.push("Edit", "Write", "NotebookEdit");
    }
    if (
      /\bsandbox_workspace_write\.network_access\s*=\s*true\b/i.test(toml) ||
      /^\s*\[sandbox_workspace_write\][\s\S]*?^\s*network_access\s*=\s*true\b/im.test(toml)
    ) {
      rules.sandboxNetwork = true;
    }
    rules.additionalDirectories.push(...codexTomlArray(toml, "writable_roots"));
    for (const m of toml.matchAll(/^\s*path\s*=\s*["']([^"']+)["']\s*\r?\n\s*access\s*=\s*["']deny["']/gm)) {
      rules.deny.push(`Edit(${m[1]})`, `Write(${m[1]})`);
    }
    for (const m of toml.matchAll(/^\s*domain\s*=\s*["']([^"']+)["']\s*\r?\n\s*access\s*=\s*["']deny["']/gm)) {
      rules.deny.push(`WebFetch(domain:${m[1]})`);
    }
    for (const m of toml.matchAll(/^\s*domain\s*=\s*["']([^"']+)["']\s*\r?\n\s*access\s*=\s*["']allow["']/gm)) {
      rules.allow.push(`WebFetch(domain:${m[1]})`);
      rules.sandboxNetwork = true;
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
  const merged: PermissionRulesConfig = {
    allow: [],
    deny: [],
    ask: [],
    additionalDirectories: [],
    sandboxNetwork: global.sandboxNetwork,
  };
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
    sandboxNetwork: merged.sandboxNetwork,
    permissionsCeiling: ceiling,
    escalation: global.escalation,
    strictReadParity: global.strictReadParity,
    configParseFailure: failures,
    repoConfigChangedSinceFirstSeen,
    selfProtectionDeny,
  };
}

function safeSlotNamespace(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "_");
  return cleaned || createHash("sha256").update(raw || "unknown").digest("hex").slice(0, 16);
}

export function currentUserSlotNamespace(): string {
  try {
    const info = userInfo();
    if (platform() !== "win32" && Number.isInteger(info.uid)) return `uid-${info.uid}`;
    return safeSlotNamespace(info.username);
  } catch {}
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (typeof uid === "number") return `uid-${uid}`;
  return safeSlotNamespace(process.env.USERNAME || process.env.USER || "unknown");
}

export function slotBaseDir(): string {
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

export function slotDir(): string {
  return join(slotBaseDir(), currentUserSlotNamespace());
}

export function countSlots(dir: string = slotDir()): number {
  try {
    return readdirSync(dir).filter((f) => f.startsWith("slot-")).length;
  } catch {
    return 0;
  }
}

function slotPathForIndex(dir: string, index: number): string {
  return join(dir, `slot-${index}.json`);
}

function slotMetadataJson(agentId: string): string {
  const now = Date.now();
  return JSON.stringify({
    schema_version: 1,
    agent_id: agentId,
    server_pid: process.pid,
    child_pid: null,
    cwd: process.cwd(),
    started_at: new Date(now).toISOString(),
    started_at_ms: now,
    last_activity_ms: now,
    status: null,
  });
}

function claimSlotPath(dir: string, agentId: string, max: number): string | null {
  let existing: string[];
  try {
    existing = readdirSync(dir).filter((f) => f.startsWith("slot-"));
  } catch {
    existing = [];
  }
  if (existing.length >= max) return null;
  const occupied = new Set(existing);
  const candidateCount = max - existing.length;
  const candidates: string[] = [];
  for (let i = 0; i < max && candidates.length < candidateCount; i++) {
    const name = `slot-${i}.json`;
    if (!occupied.has(name)) candidates.push(slotPathForIndex(dir, i));
  }
  for (const path of candidates) {
    let fd: number | null = null;
    try {
      fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, slotMetadataJson(agentId));
      return path;
    } catch (e) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {}
        fd = null;
        try {
          unlinkSync(path);
        } catch {}
      }
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {}
      }
    }
  }
  return null;
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
    if (dir === slotDir()) {
      mkdirSync(slotBaseDir(), { recursive: true, mode: 0o1777 });
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } else {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    cullStaleSlots(dir, cullDeps);
    // ponytail: numbered O_EXCL slot claims make admission atomic without queues or a process-wide lock.
    const slotPath = claimSlotPath(dir, agentId, max);
    if (!slotPath) return { ok: false, current: countSlots(dir), max };
    const after = countSlots(dir);
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
