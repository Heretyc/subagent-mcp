import { basename } from "node:path";

export type JsonObj = Record<string, unknown>;

const HOOK_SCRIPTS = new Set([
  "orchestration-claude.js",
  "orchestration-claude-pretool.js",
  "orchestration-codex.js",
  "smcp-activate.js",
  "statusline-claude.js",
]);

export function referencedHookPath(entry: JsonObj): string | null {
  if (entry.command === "node" && Array.isArray(entry.args) && typeof entry.args[0] === "string") {
    return entry.args[0];
  }
  const text = [entry.command, entry.commandWindows].filter((v) => typeof v === "string").join(" ");
  const m = text.match(/(?:^|\s)node\s+"?([^"\s]+dist[\\/](?:hooks[\\/])?[^"\s]+\.js)"?/);
  return m?.[1] ?? null;
}

export function isSubagentMcpHook(entry: JsonObj): boolean {
  const id = typeof entry.id === "string" ? entry.id : "";
  if (id.startsWith("subagent-mcp")) return true;
  if (id) return false;
  const p = referencedHookPath(entry);
  return p !== null && /[\\/]dist[\\/]hooks[\\/]/.test(p) && HOOK_SCRIPTS.has(basename(p));
}
