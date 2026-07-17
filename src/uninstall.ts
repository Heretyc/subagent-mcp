import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createBackup } from "./backup.js";
import { isSubagentMcpHook, type JsonObj } from "./hook-match.js";
import { atomicWriteFile } from "./orchestration/atomic-write.js";
import { askYesNo } from "./prompt.js";
import { clearInitRegistry } from "./init-registry.js";

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
  log("subagent-mcp uninstall removes hooks and MCP registrations only.");
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
  const remaining = verifyNoSubagentMcp(home);
  log(remaining.length === 0 ? "verification: PASS, zero subagent-mcp hooks/registrations remain" : `verification: FAIL, remaining in ${remaining.join(", ")}`);
  log("Package not removed. To remove it: npm uninstall -g @heretyc/subagent-mcp");
  log("Marketplace equivalent: claude plugin remove subagent-mcp@subagent-mcp");
  return remaining.length === 0 ? 0 : 1;
}
