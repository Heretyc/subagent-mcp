import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createBackup } from "./backup.js";
import { isSubagentMcpHook, type JsonObj } from "./hook-match.js";
import { atomicWriteFile } from "./orchestration/atomic-write.js";
import { askYesNo } from "./prompt.js";
import { clearInitRegistry } from "./init-registry.js";
import {
  CLAUDE_NATIVE_AGENT_DENY,
  CLAUDE_NATIVE_AGENT_DENY_LEGACY,
  reconcileClaudeNativeAgentDeny,
  reconcileCodexNativeAgentDisable,
} from "./native-suppression.js";

export interface UninstallOptions {
  home?: string;
  isTTY?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  backup?: () => unknown;
  log?: (line: string) => void;
}

type RemovalSummary = Record<string, number>;

function readJson(file: string): JsonObj | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
}

function writeJson(file: string, value: JsonObj): void {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

export function removeSubagentHooks(json: JsonObj | null): number {
  const hooks = json?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return 0;
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    (hooks as Record<string, unknown>)[event] = groups.flatMap((group) => {
      if (!group || typeof group !== "object" || Array.isArray(group)) return [group];
      const list = (group as JsonObj).hooks;
      if (!Array.isArray(list)) return [group];
      const kept = list.filter((hook) => {
        const drop = hook && typeof hook === "object" && !Array.isArray(hook) && isSubagentMcpHook(hook as JsonObj);
        if (drop) removed++;
        return !drop;
      });
      return kept.length === 0 ? [] : [{ ...(group as JsonObj), hooks: kept }];
    });
  }
  return removed;
}

export function removeClaudeMcpServer(json: JsonObj | null): number {
  const servers = json?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return 0;
  if (!Object.hasOwn(servers, "subagent-mcp")) return 0;
  delete (servers as JsonObj)["subagent-mcp"];
  return 1;
}

export function removeCodexMcpBlock(toml: string): { toml: string; removed: number } {
  const lines = toml.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  let removed = 0;
  for (const line of lines) {
    const table = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (table) {
      skipping = table === "mcp_servers.subagent-mcp" || table.startsWith("mcp_servers.subagent-mcp.");
      if (skipping) {
        removed++;
        continue;
      }
    }
    if (!skipping) out.push(line);
  }
  return { toml: out.join("\n").replace(/\n{3,}/g, "\n\n"), removed };
}

/* ------------------------------------------------------------------ *
 * Native-agent suppression reversion
 *
 * `subagent-mcp init --global` / `setup` suppress the host's own sub-agent
 * launchers so every launch is funnelled through this MCP server. Uninstall
 * must hand those hosts back in a fresh-install state.
 *
 * Two strategies, in order of preference:
 *   1. Restore a sidecar backup, but ONLY one that is demonstrably pre-smcp.
 *      Equivalence alone is NOT sufficient: a sidecar taken while migrating an
 *      older install (or on a second run over an already-suppressed file) can
 *      itself contain managed state, and reconciling it still reproduces the
 *      current file -- so restoring it would reintroduce exactly what uninstall
 *      must remove, or silently no-op and skip removal altogether. See
 *      findSafeSidecarBackup for the two conditions that must both hold.
 *   2. Otherwise, surgically remove only the keys smcp writes, leaving every
 *      unrelated or user-authored setting in place and in order.
 * ------------------------------------------------------------------ */

/** Sidecar backups written by native-suppression.ts and setup.ts. */
const SMCP_SIDECAR_RE = /^\.bak-(?:native-agent|setup)-(.+)$/;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function serializeJson(value: JsonObj): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Sidecar backups of `file` written by smcp, newest stamp first. */
export function smcpSidecarBackups(file: string): string[] {
  const dir = dirname(file);
  if (!existsSync(dir)) return [];
  const base = basename(file);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith(`${base}.`))
    .map((d) => ({ name: d.name, stamp: d.name.slice(base.length).match(SMCP_SIDECAR_RE)?.[1] ?? null }))
    .filter((c): c is { name: string; stamp: string } => c.stamp !== null)
    // Stamps are `toISOString()` with `:`/`.` swapped for `-`, so they sort
    // lexicographically. Tie-break on name so the order is deterministic.
    .sort((a, b) => (a.stamp === b.stamp ? b.name.localeCompare(a.name) : b.stamp.localeCompare(a.stamp)))
    .map((c) => join(dir, c.name));
}

/**
 * Newest sidecar backup that is safe to restore, or null when none is.
 *
 * TWO independent conditions must both hold:
 *   1. FRESH -- the backup must itself carry no smcp-managed state. Sidecars
 *      are taken on every suppression write, including migrations of an older
 *      install and repeat runs, so a backup can already contain the legacy
 *      deny trio or `multi_agent = false`. Restoring such a backup reintroduces
 *      managed state (Claude) or no-ops while skipping removal (Codex).
 *      Freshness is defined as "surgical removal is a no-op on the backup",
 *      deliberately reusing the fallback path's ownership rules so the two can
 *      never disagree about what smcp owns.
 *   2. UNCHANGED SINCE -- re-applying smcp's own reconcile to the backup must
 *      reproduce the current file byte-for-byte, proving the sole delta between
 *      backup and disk is smcp's write, so no user edit is lost.
 */
export function findSafeSidecarBackup(
  file: string,
  current: string,
  isFresh: (backup: string) => boolean,
  reapply: (backup: string) => string
): string | null {
  for (const candidate of smcpSidecarBackups(file)) {
    try {
      const text = readFileSync(candidate, "utf8");
      if (isFresh(text) && reapply(text) === current) return candidate;
    } catch {
      // Unreadable or unparsable candidate: not safely identifiable, keep looking.
    }
  }
  return null;
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

/**
 * Drop `multi_agent = false` from Codex `[features]`. Any other value is
 * user-authored and left untouched; the table header goes only when removing
 * the line leaves it completely empty.
 */
export function removeCodexNativeAgentDisable(toml: string): { toml: string; removed: number } {
  const block = toml.match(/^(\s*\[features\]\s*(?:#.*)?\r?\n?)([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m);
  if (!block || block.index === undefined) return { toml, removed: 0 };
  const lineRe = /^[ \t]*multi_agent[ \t]*=[ \t]*false[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/m;
  const body = block[2];
  if (!lineRe.test(body)) return { toml, removed: 0 };
  const nextBody = body.replace(lineRe, "");
  const nextBlock = nextBody.trim() === "" ? "" : `${block[1]}${nextBody}`;
  const out = `${toml.slice(0, block.index)}${nextBlock}${toml.slice(block.index + block[0].length)}`;
  return { toml: out.replace(/\n{3,}/g, "\n\n"), removed: 1 };
}

export interface NativeRevertResult {
  file: string;
  action: "restored" | "removed" | "none" | "failed";
  detail: string;
}

function parseJson(text: string): JsonObj {
  return JSON.parse(stripBom(text)) as JsonObj;
}

/** Pre-smcp when the backup carries no managed deny rule of its own. */
function claudeBackupIsFresh(text: string): boolean {
  return removeClaudeNativeAgentDeny(parseJson(text)) === 0;
}

/** Pre-smcp when the backup carries no `multi_agent = false` of its own. */
function codexBackupIsFresh(text: string): boolean {
  return removeCodexNativeAgentDisable(text).removed === 0;
}

function revertClaudeSettings(file: string): NativeRevertResult {
  const current = readFileSync(file, "utf8");
  const backup = findSafeSidecarBackup(file, current, claudeBackupIsFresh, (text) => {
    const json = parseJson(text);
    reconcileClaudeNativeAgentDeny(json);
    return serializeJson(json);
  });
  if (backup) {
    atomicWriteFile(file, readFileSync(backup, "utf8"), { encoding: "utf8" });
    return { file, action: "restored", detail: `pre-smcp backup ${basename(backup)}` };
  }
  const json = parseJson(current);
  const n = removeClaudeNativeAgentDeny(json);
  if (n > 0) writeJson(file, json);
  return n > 0
    ? { file, action: "removed", detail: `${n} managed permissions.deny entr${n === 1 ? "y" : "ies"}` }
    : { file, action: "none", detail: "no managed permissions.deny state found" };
}

function revertCodexConfig(file: string): NativeRevertResult {
  const current = readFileSync(file, "utf8");
  const backup = findSafeSidecarBackup(file, current, codexBackupIsFresh, (t) => reconcileCodexNativeAgentDisable(t).toml);
  if (backup) {
    atomicWriteFile(file, readFileSync(backup, "utf8"), { encoding: "utf8" });
    return { file, action: "restored", detail: `pre-smcp backup ${basename(backup)}` };
  }
  const r = removeCodexNativeAgentDisable(current);
  if (r.removed > 0) atomicWriteFile(file, r.toml, { encoding: "utf8" });
  return r.removed > 0
    ? { file, action: "removed", detail: "features.multi_agent = false" }
    : { file, action: "none", detail: "no managed features.multi_agent state found" };
}

/**
 * Hand the native sub-agent launchers back to Claude and Codex.
 *
 * MUST run before the hook/MCP-registration pass: a restored sidecar backup
 * predates uninstall and can still carry smcp hooks, which that later pass
 * then strips.
 */
export function revertNativeAgentSuppression(home = homedir()): NativeRevertResult[] {
  const hosts: Array<[string, (file: string) => NativeRevertResult]> = [
    [join(home, ".claude", "settings.json"), revertClaudeSettings],
    [join(home, ".codex", "config.toml"), revertCodexConfig],
  ];
  const out: NativeRevertResult[] = [];
  for (const [file, revert] of hosts) {
    if (!existsSync(file)) continue;
    try {
      out.push(revert(file));
    } catch (e) {
      out.push({ file, action: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export function verifyNoSubagentMcp(home = homedir()): string[] {
  const remaining: string[] = [];
  for (const file of [join(home, ".claude", "settings.json"), join(home, ".codex", "hooks.json")]) {
    const json = readJson(file);
    if (json && removeSubagentHooks(JSON.parse(JSON.stringify(json)) as JsonObj) > 0) remaining.push(file);
  }
  for (const file of [join(home, ".claude.json"), join(home, ".claude", "mcp.json")]) {
    const json = readJson(file);
    if (json && removeClaudeMcpServer(JSON.parse(JSON.stringify(json)) as JsonObj) > 0) remaining.push(file);
  }
  const codex = join(home, ".codex", "config.toml");
  if (existsSync(codex) && removeCodexMcpBlock(readFileSync(codex, "utf8")).removed > 0) remaining.push(codex);
  return remaining;
}

function scope(home: string): string[] {
  return [
    join(home, ".claude", "settings.json"),
    join(home, ".codex", "hooks.json"),
    join(home, ".claude.json"),
    join(home, ".claude", "mcp.json"),
    join(home, ".codex", "config.toml"),
  ];
}

export async function runUninstall(opts: UninstallOptions = {}): Promise<number> {
  const home = opts.home ?? homedir();
  const log = opts.log ?? console.log;
  log("subagent-mcp uninstall removes hooks, MCP registrations, and native-agent suppression.");
  log("Preserved: ~/.subagent-mcp/providers.jsonc, ~/.subagent-mcp/.env, ~/.subagent-mcp/backups");
  if (!(opts.isTTY ?? process.stdin.isTTY)) {
    log("Would inspect/remove from:");
    for (const file of scope(home)) log(`  ${file}`);
    log("non-TTY: no changes made");
    return 0;
  }
  if (!(await askYesNo(opts, "Proceed with uninstall? [Y/n] "))) {
    log("uninstall cancelled");
    return 0;
  }

  (opts.backup ?? createBackup)();
  // Native reversion runs first: a restored sidecar backup predates uninstall
  // and can still carry smcp hooks, which the hook pass below then strips.
  const reverted = revertNativeAgentSuppression(home);
  for (const r of reverted) log(`${r.action.padEnd(8)} ${r.file} (${r.detail})`);
  const removed: RemovalSummary = {};
  const jsonFiles = [
    [join(home, ".claude", "settings.json"), removeSubagentHooks],
    [join(home, ".codex", "hooks.json"), removeSubagentHooks],
    [join(home, ".claude.json"), removeClaudeMcpServer],
    [join(home, ".claude", "mcp.json"), removeClaudeMcpServer],
  ] as const;
  for (const [file, fn] of jsonFiles) {
    const json = readJson(file);
    const n = fn(json);
    removed[file] = n;
    if (json && n > 0) writeJson(file, json);
  }
  const codex = join(home, ".codex", "config.toml");
  if (existsSync(codex)) {
    const r = removeCodexMcpBlock(readFileSync(codex, "utf8"));
    removed[codex] = r.removed;
    if (r.removed > 0) atomicWriteFile(codex, r.toml, { encoding: "utf8" });
  } else {
    removed[codex] = 0;
  }

  for (const [file, count] of Object.entries(removed)) log(`removed ${count}: ${file}`);
  clearInitRegistry(home);
  const failures = reverted.filter((r) => r.action === "failed");
  for (const f of failures) log(`warning: could not revert ${f.file}: ${f.detail}`);
  const remaining = verifyNoSubagentMcp(home);
  log(remaining.length === 0 ? "verification: PASS, zero subagent-mcp hooks/registrations remain" : `verification: FAIL, remaining in ${remaining.join(", ")}`);
  log("Package not removed. To remove it: npm uninstall -g @heretyc/subagent-mcp");
  log("Marketplace equivalent: claude plugin remove subagent-mcp@subagent-mcp");
  return remaining.length === 0 && failures.length === 0 ? 0 : 1;
}
