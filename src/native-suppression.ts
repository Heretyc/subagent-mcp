import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readDoctrine } from "./concurrency.js";
import { atomicWriteFile } from "./orchestration/atomic-write.js";

export type NativeSuppressionStatus = "ok" | "added" | "repaired" | "skipped";
export type JsonObj = Record<string, unknown>;

/**
 * Canonical Claude `permissions.deny` entries for native-agent suppression.
 * Exactly `Agent` — the single harness-native sub-agent launcher. `Task` is the
 * prefix of Claude's task/widget tools (TaskCreate, TaskUpdate, ...) and must
 * not be denied; `Explore` is not a tool name; `Agent(Explore)` is a
 * subagent-type specifier that `Agent` already covers.
 */
export const CLAUDE_NATIVE_AGENT_DENY = ["Agent"] as const;
/** Over-broad entries written by earlier versions; removed on reconcile. */
export const CLAUDE_NATIVE_AGENT_DENY_LEGACY = ["Task", "Explore", "Agent(Explore)"] as const;
export const GEMINI_NATIVE_AGENT_TOOLS = ["generalist", "codebase_investigator", "cli_help", "browser_agent"] as const;
export const GEMINI_NATIVE_AGENT_POLICY = "subagent-mcp-native-agents.toml";

function featuresBlock(toml: string): RegExpMatchArray | null {
  return toml.match(/^(\s*\[features\]\s*(?:#.*)?\r?\n?)([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m);
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export type ReconcileStatus = "ok" | "added" | "repaired";

export function reconcileClaudeNativeAgentDeny(
  s: JsonObj
): { changed: boolean; status: ReconcileStatus } {
  const permissions =
    s.permissions && typeof s.permissions === "object" && !Array.isArray(s.permissions)
      ? (s.permissions as JsonObj)
      : {};
  const hadPermissions = s.permissions === permissions;
  s.permissions = permissions;
  const rawDeny = Array.isArray(permissions.deny) ? (permissions.deny as unknown[]) : null;
  const before = uniqueStrings(permissions.deny);
  // Surgical: drop only the legacy over-broad entries, keep every other rule in
  // place and in order, then append the canonical entry if it is not present.
  const legacy = new Set<string>(CLAUDE_NATIVE_AGENT_DENY_LEGACY);
  const deny = before.filter((rule) => !legacy.has(rule));
  for (const rule of CLAUDE_NATIVE_AGENT_DENY) if (!deny.includes(rule)) deny.push(rule);
  permissions.deny = deny;
  const changed =
    !hadPermissions || rawDeny === null || rawDeny.length !== deny.length || deny.some((r, i) => r !== rawDeny[i]);
  return { changed, status: changed ? (before.length ? "repaired" : "added") : "ok" };
}

/** True when the parsed Claude settings carry any smcp-owned deny rule. */
export function hasClaudeNativeAgentDeny(json: JsonObj | null): boolean {
  const permissions = json?.permissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return false;
  const deny = (permissions as JsonObj).deny;
  if (!Array.isArray(deny)) return false;
  const owned = new Set<string>([...CLAUDE_NATIVE_AGENT_DENY, ...CLAUDE_NATIVE_AGENT_DENY_LEGACY]);
  return deny.some((rule) => typeof rule === "string" && owned.has(rule));
}

/** Drop the Claude `permissions.deny` rules smcp writes; keep every other rule. */
export function removeClaudeNativeAgentDeny(json: JsonObj | null): number {
  const permissions = json?.permissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return 0;
  const perms = permissions as JsonObj;
  if (!Array.isArray(perms.deny)) return 0;
  const owned = new Set<string>([...CLAUDE_NATIVE_AGENT_DENY, ...CLAUDE_NATIVE_AGENT_DENY_LEGACY]);
  const before = perms.deny as unknown[];
  const kept = before.filter((rule) => !(typeof rule === "string" && owned.has(rule)));
  if (kept.length === before.length) return 0;
  if (kept.length > 0) {
    perms.deny = kept;
  } else {
    delete perms.deny;
    if (Object.keys(perms).length === 0) delete (json as JsonObj).permissions;
  }
  return before.length - kept.length;
}

export interface NativeDenyRemovalResult {
  file: string;
  changed: boolean;
  removed: number;
}

/**
 * Remove the smcp-owned Agent deny rules from `~/.claude/settings.json`,
 * keeping every other rule. No sidecar restore state is needed: smcp only ever
 * appends its own deny rules, so dropping them restores the pre-smcp list
 * exactly. A timestamped backup is written before any change.
 */
export function removeNativeAgentDenyFromClaudeSettings(
  home: string,
  opts: { dryRun?: boolean } = {}
): NativeDenyRemovalResult {
  const file = join(home, ".claude", "settings.json");
  if (!existsSync(file)) return { file, changed: false, removed: 0 };
  const json = readJson(file);
  const removed = removeClaudeNativeAgentDeny(json);
  if (removed > 0 && !opts.dryRun) {
    backup(file);
    atomicWriteFile(file, `${JSON.stringify(json, null, 2)}\n`, { encoding: "utf8" });
  }
  return { file, changed: removed > 0, removed };
}

export function reconcileCodexNativeAgentDisable(
  toml: string
): { toml: string; changed: boolean; status: ReconcileStatus } {
  const blockMatch = featuresBlock(toml);
  const block = blockMatch?.[0] ?? null;
  if (!block) {
    const sep = toml === "" || toml.endsWith("\n") ? "" : "\n";
    return { toml: `${toml}${sep}\n[features]\nmulti_agent = false\n`, changed: true, status: "added" };
  }
  const lineRe = /^(\s*)multi_agent\s*=\s*([^#\r\n]*)(.*)$/m;
  const line = block.match(lineRe);
  if (line && line[2].trim() === "false") return { toml, changed: false, status: "ok" };
  const nextBlock = line
    ? block.replace(lineRe, (_m, indent: string, _value: string, tail: string) => `${indent}multi_agent = false${tail.startsWith("#") ? " " : ""}${tail}`)
    : `${blockMatch![1]}multi_agent = false\n${block.slice(blockMatch![1].length)}`;
  return {
    toml: `${toml.slice(0, blockMatch!.index)}${nextBlock}${toml.slice(blockMatch!.index! + block.length)}`,
    changed: true,
    status: line ? "repaired" : "added",
  };
}

export function codexNativeAgentDisableOk(toml: string): boolean {
  const block = featuresBlock(toml)?.[0];
  return !!block && /^(\s*)multi_agent\s*=\s*false\s*(?:#.*)?$/m.test(block);
}

export function reconcileGeminiSettings(
  s: JsonObj
): { changed: boolean; status: ReconcileStatus } {
  const experimental =
    s.experimental && typeof s.experimental === "object" && !Array.isArray(s.experimental)
      ? (s.experimental as JsonObj)
      : {};
  const hadExperimental = s.experimental === experimental;
  const before = experimental.enableAgents;
  s.experimental = experimental;
  experimental.enableAgents = false;
  const changed = !hadExperimental || before !== false;
  return { changed, status: changed ? (before === undefined ? "added" : "repaired") : "ok" };
}

export function geminiNativeAgentPolicyToml(): string {
  return `${GEMINI_NATIVE_AGENT_TOOLS.map((tool) => `[[rule]]
toolName = "${tool}"
decision = "deny"
priority = 999
`).join("\n")}`;
}

export function geminiNativeAgentPolicyOk(toml: string): boolean {
  const rules = toml.split(/^\s*\[\[rule\]\]\s*(?:#.*)?$/m).slice(1);
  return GEMINI_NATIVE_AGENT_TOOLS.every((tool) => {
    const quoted = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const toolRe = new RegExp(`\\btoolName\\s*=\\s*(?:"${quoted}"|\\[[^\\]]*"${quoted}"[^\\]]*\\])`);
    return rules.some((rule) => toolRe.test(rule) && /\bdecision\s*=\s*"deny"/.test(rule));
  });
}

function readJson(file: string): JsonObj {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
}

function backup(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(file, `${file}.bak-native-agent-${stamp}`);
}

export interface NativeSuppressionWriteResult {
  host: "claude" | "codex" | "gemini";
  layer: string;
  file: string;
  changed: boolean;
  status: NativeSuppressionStatus;
}

export function ensureNativeAgentSuppression(
  home: string,
  hosts: Array<"claude" | "codex" | "gemini">,
  opts: { dryRun?: boolean; force?: boolean; configHome?: string } = {}
): NativeSuppressionWriteResult[] {
  const out: NativeSuppressionWriteResult[] = [];
  if (hosts.includes("claude")) {
    const file = join(home, ".claude", "settings.json");
    // Under windowed doctrine the user has confirmed lifting the user-level
    // Agent deny, so every writer skips re-adding it HERE - the invariant
    // cannot depend on each caller remembering a guard. Only the confirmed
    // doctrine transition in configure passes `force` to restore it.
    // `configHome` overrides the doctrine-read location for hermetic tests;
    // the default honors SUBAGENT_CONFIG_HOME like every other doctrine read.
    const windowed =
      !opts.force &&
      readDoctrine(opts.configHome ? { configHome: opts.configHome } : undefined) === "windowed";
    if (windowed) {
      out.push({ host: "claude", layer: "permissions.deny", file, changed: false, status: "skipped" });
    } else {
      const json = readJson(file);
      const r = reconcileClaudeNativeAgentDeny(json);
      if (r.changed && !opts.dryRun) {
        mkdirSync(dirname(file), { recursive: true });
        backup(file);
        atomicWriteFile(file, `${JSON.stringify(json, null, 2)}\n`, { encoding: "utf8" });
      }
      out.push({ host: "claude", layer: "permissions.deny", file, ...r });
    }
  }
  if (hosts.includes("codex")) {
    const file = join(home, ".codex", "config.toml");
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const r = reconcileCodexNativeAgentDisable(text);
    if (r.changed && !opts.dryRun) {
      mkdirSync(dirname(file), { recursive: true });
      backup(file);
      atomicWriteFile(file, r.toml, { encoding: "utf8" });
    }
    out.push({ host: "codex", layer: "features.multi_agent", file, changed: r.changed, status: r.status });
  }
  if (hosts.includes("gemini")) {
    const settings = join(home, ".gemini", "settings.json");
    const json = readJson(settings);
    const r = reconcileGeminiSettings(json);
    if (r.changed && !opts.dryRun) {
      mkdirSync(dirname(settings), { recursive: true });
      backup(settings);
      atomicWriteFile(settings, `${JSON.stringify(json, null, 2)}\n`, { encoding: "utf8" });
    }
    out.push({ host: "gemini", layer: "experimental.enableAgents", file: settings, ...r });

    const policy = join(home, ".gemini", "policies", GEMINI_NATIVE_AGENT_POLICY);
    const current = existsSync(policy) ? readFileSync(policy, "utf8") : "";
    const ok = geminiNativeAgentPolicyOk(current);
    if (!ok && !opts.dryRun) {
      mkdirSync(dirname(policy), { recursive: true });
      backup(policy);
      writeFileSync(policy, geminiNativeAgentPolicyToml(), "utf8");
    }
    out.push({ host: "gemini", layer: "policies/native-agents", file: policy, changed: !ok, status: ok ? "ok" : current ? "repaired" : "added" });
  }
  return out;
}
