import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "./orchestration/atomic-write.js";

export type NativeSuppressionStatus = "ok" | "added" | "repaired";
export type JsonObj = Record<string, unknown>;

export const CLAUDE_NATIVE_AGENT_DENY = ["Task", "Agent", "Explore", "Agent(Explore)"] as const;
export const GEMINI_NATIVE_AGENT_TOOLS = ["generalist", "codebase_investigator", "cli_help", "browser_agent"] as const;
export const GEMINI_NATIVE_AGENT_POLICY = "subagent-mcp-native-agents.toml";

function featuresBlock(toml: string): RegExpMatchArray | null {
  return toml.match(/^(\s*\[features\]\s*(?:#.*)?\r?\n?)([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m);
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function reconcileClaudeNativeAgentDeny(
  s: JsonObj
): { changed: boolean; status: NativeSuppressionStatus } {
  const permissions =
    s.permissions && typeof s.permissions === "object" && !Array.isArray(s.permissions)
      ? (s.permissions as JsonObj)
      : {};
  const hadPermissions = s.permissions === permissions;
  s.permissions = permissions;
  const hadDenyArray = Array.isArray(permissions.deny);
  const before = uniqueStrings(permissions.deny);
  const deny = [...before];
  for (const rule of CLAUDE_NATIVE_AGENT_DENY) if (!deny.includes(rule)) deny.push(rule);
  permissions.deny = deny;
  const changed = !hadPermissions || !hadDenyArray || deny.length !== before.length;
  return { changed, status: changed ? (before.length ? "repaired" : "added") : "ok" };
}

export function reconcileCodexNativeAgentDisable(
  toml: string
): { toml: string; changed: boolean; status: NativeSuppressionStatus } {
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
): { changed: boolean; status: NativeSuppressionStatus } {
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
  opts: { dryRun?: boolean } = {}
): NativeSuppressionWriteResult[] {
  const out: NativeSuppressionWriteResult[] = [];
  if (hosts.includes("claude")) {
    const file = join(home, ".claude", "settings.json");
    const json = readJson(file);
    const r = reconcileClaudeNativeAgentDeny(json);
    if (r.changed && !opts.dryRun) {
      mkdirSync(dirname(file), { recursive: true });
      backup(file);
      atomicWriteFile(file, `${JSON.stringify(json, null, 2)}\n`, { encoding: "utf8" });
    }
    out.push({ host: "claude", layer: "permissions.deny", file, ...r });
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
