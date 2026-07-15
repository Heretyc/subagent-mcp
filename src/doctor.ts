#!/usr/bin/env node

import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createBackup } from "./backup.js";
import { getConfigHome } from "./config-home.js";
import { parseJsoncFile, type JsonObj } from "./jsonc.js";
import { askYesNo } from "./prompt.js";
import { TASK_CATEGORIES as ROUTING_TASK_CATEGORIES } from "./routing.js";
import {
  detectInstallMode,
  existingDist,
  npmGlobalDist,
  resolveCommandPath,
  scanPluginDists,
} from "./install-mode.js";
import { atomicWriteFile } from "./orchestration/atomic-write.js";
import {
  fetchLatestVersion,
  isVersionNewer,
  readInstalledPackageInfo,
} from "./orchestration/update-check.js";
import { probeProviderHead, type HeadProbeResult } from "./providers/provider-client.js";

type Status = "PASS" | "WARN" | "FAIL" | "INFO";
interface DoctorLine {
  status: Status;
  id: number;
  name: string;
  detail: string;
}

interface DoctorOptions {
  home?: string;
  configHome?: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  fetch?: typeof fetch;
  providerHead?: (baseUrl: string) => Promise<HeadProbeResult>;
  packageInfo?: () => { name: string; version: string };
  registryBaseUrl?: string;
  statusSource?: () => { session_start_time: string | null } | null;
}

function line(r: DoctorLine): string {
  return `[${r.status}] ${r.id} ${r.name}: ${r.detail}`;
}

function readJson(file: string): JsonObj | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
}

function backupFile(file: string): void {
  if (existsSync(file)) copyFileSync(file, `${file}.bak-${Date.now()}`);
}

const TASK_CATEGORIES = ROUTING_TASK_CATEGORIES.filter((c) => c !== "fallback_default");

function configHome(opts: DoctorOptions): string {
  return opts.configHome ?? (opts.home ? join(opts.home, ".subagent-mcp") : getConfigHome());
}

function providerEntries(config: JsonObj | null): Array<[string, JsonObj]> {
  const providers = config?.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
  return Object.entries(providers).filter((e): e is [string, JsonObj] => !!e[1] && typeof e[1] === "object" && !Array.isArray(e[1]));
}

export function checkInstallMode(opts: DoctorOptions = {}): DoctorLine {
  const mode = detectInstallMode({ home: opts.home ?? homedir(), env: opts.env ?? process.env });
  const parts = [
    mode.npmGlobalDist ? `npm-global=${mode.npmGlobalDist}` : null,
    ...mode.marketplaceDists.map((p) => `marketplace=${p}`),
  ].filter((p): p is string => p !== null);
  return {
    status: parts.length ? "PASS" : "FAIL",
    id: 1,
    name: "install-mode",
    detail: parts.length ? parts.join("; ") : "no npm-global or marketplace install found",
  };
}

function resolveEntry(entry: JsonObj | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!entry || typeof entry.command !== "string") return null;
  const args = Array.isArray(entry.args) ? entry.args : [];
  if (entry.command === "node" && typeof args[0] === "string") {
    return resolve(args[0]);
  }
  if (entry.command === "subagent-mcp") return npmGlobalDist(env) ?? resolveCommandPath("subagent-mcp", env);
  return resolveCommandPath(entry.command, env);
}

function canonicalEntry(): JsonObj {
  return { type: "stdio", command: "subagent-mcp", args: [], env: {} };
}

async function askFix(opts: DoctorOptions): Promise<boolean> {
  return askYesNo(opts, "Fix MCP registration? [Y/n] ");
}

export async function checkMcpRegistration(opts: DoctorOptions = {}): Promise<DoctorLine> {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const liveFile = join(home, ".claude.json");
  const staleFile = join(home, ".claude", "mcp.json");
  const liveEntry = readJson(liveFile)?.mcpServers?.["subagent-mcp"];
  const staleJson = readJson(staleFile);
  const staleEntry = staleJson?.mcpServers?.["subagent-mcp"];
  const liveTarget = resolveEntry(liveEntry, env);
  const staleTarget = resolveEntry(staleEntry, env);
  const liveOk = existingDist(liveTarget) !== null;
  const staleDangling = staleEntry !== undefined && existingDist(staleTarget) === null;

  if (staleDangling) {
    const staleDetail = `${staleFile} points at ${staleTarget ?? "unresolved command"} (missing); live ${liveFile} points at ${liveTarget ?? "unresolved command"}`;
    if (opts.isTTY ?? process.stdin.isTTY) {
      if (await askFix(opts)) {
        createBackup();
        mkdirSync(dirname(staleFile), { recursive: true });
        staleJson!.mcpServers = staleJson!.mcpServers ?? {};
        staleJson!.mcpServers["subagent-mcp"] = canonicalEntry();
        writeFileSync(staleFile, `${JSON.stringify(staleJson, null, 2)}\n`, "utf8");
        return {
          status: liveOk ? "WARN" : "FAIL",
          id: 2,
          name: "mcp-registration",
          detail: `${staleDetail}; repaired stale file after backup`,
        };
      }
      return { status: liveOk ? "WARN" : "FAIL", id: 2, name: "mcp-registration", detail: `${staleDetail}; repair skipped` };
    }
    return { status: liveOk ? "WARN" : "FAIL", id: 2, name: "mcp-registration", detail: `${staleDetail}; non-TTY: no changes made` };
  }

  if (liveOk) {
    return { status: "PASS", id: 2, name: "mcp-registration", detail: `${liveFile} resolves to ${existingDist(liveTarget)}` };
  }
  return {
    status: "FAIL",
    id: 2,
    name: "mcp-registration",
    detail: `${liveFile} does not resolve to an existing dist/index.js (${liveTarget ?? "missing entry"})`,
  };
}

interface HookEntry {
  sourceFile: string;
  event: string;
  groupIndex: number;
  hookIndex: number;
  entry: JsonObj;
  script: string | null;
  id: string | null;
  command: string;
  canonical: boolean;
}

interface HookDuplicate {
  id: string;
  kind: "same-id" | "legacy-pair" | "dual-mode";
  keep: HookEntry | null;
  remove: HookEntry;
}

const SCRIPT_IDS: Record<string, string> = {
  "orchestration-claude.js": "subagent-mcp-orchestration-claude",
  "orchestration-claude-pretool.js": "subagent-mcp-pretool",
  "smcp-activate.js": "subagent-mcp-session-start",
  "orchestration-codex.js": "subagent-mcp-orchestration-codex",
};

const SESSION_START_ID = "subagent-mcp-session-start";

function canonicalSessionStartEntry(): JsonObj {
  return {
    id: SESSION_START_ID,
    type: "command",
    command: "node dist/hooks/smcp-activate.js",
    commandWindows: null,
    timeout: 5,
  };
}

function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function entryCommand(entry: JsonObj): string {
  const args = Array.isArray(entry.args) ? entry.args.map(String).join(" ") : "";
  const cmd = typeof entry.command === "string" ? entry.command : "";
  const win = typeof entry.commandWindows === "string" && entry.commandWindows !== cmd ? ` | ${entry.commandWindows}` : "";
  return `${cmd}${args ? ` ${args}` : ""}${win}`;
}

function hookScript(entry: JsonObj): string | null {
  const text = entryCommand(entry).replace(/\\/g, "/");
  for (const script of Object.keys(SCRIPT_IDS)) {
    const re = new RegExp(`(?:^|[/ "'])dist/hooks/${reEsc(script)}(?:$|["' ])`);
    if (re.test(text) || text.includes(`/hooks/${script}`)) return script;
  }
  return null;
}

function currentHookCommands(script: string, npmDist: string | null): string[] {
  if (!npmDist) return [];
  const root = dirname(dirname(npmDist)).replace(/\\/g, "/");
  const hook = `${root}/dist/hooks/${script}`;
  return [`node ${hook}`, `node "${hook}"`];
}

function flattenHooks(file: string, json: JsonObj | null, env: NodeJS.ProcessEnv): HookEntry[] {
  const hooks = json?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return [];
  const npmDist = npmGlobalDist(env);
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, groupIndex) => {
      const list = group && typeof group === "object" ? (group as JsonObj).hooks : null;
      if (!Array.isArray(list)) return;
      list.forEach((raw, hookIndex) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        const entry = raw as JsonObj;
        const script = hookScript(entry);
        const id = typeof entry.id === "string" && entry.id.startsWith("subagent-mcp") ? entry.id : null;
        if (!script && !id) return;
        const command = entryCommand(entry);
        out.push({
          sourceFile: file,
          event,
          groupIndex,
          hookIndex,
          entry,
          script,
          id,
          command,
          canonical: script ? currentHookCommands(script, npmDist).includes(command.replace(/\\/g, "/")) : false,
        });
      });
    });
  }
  return out;
}

function hookDetail(h: HookEntry): string {
  return `${h.sourceFile} ${h.event} command=${JSON.stringify(h.command)} entry=${JSON.stringify(h.entry)}`;
}

function betterHook(a: HookEntry, b: HookEntry): HookEntry {
  if (a.canonical !== b.canonical) return a.canonical ? a : b;
  if ((a.id !== null) !== (b.id !== null)) return a.id !== null ? a : b;
  return a.groupIndex < b.groupIndex || (a.groupIndex === b.groupIndex && a.hookIndex <= b.hookIndex) ? a : b;
}

function pluginHooksPresent(home: string, env: NodeJS.ProcessEnv): Set<string> {
  const scripts = new Set<string>();
  for (const dist of scanPluginDists(home)) {
    const root = dirname(dirname(dist));
    for (const rel of ["hooks/hooks.json", "codex/hooks.json"]) {
      for (const h of flattenHooks(join(root, rel), readJson(join(root, rel)), env)) {
        if (h.script) scripts.add(h.script);
      }
    }
  }
  return scripts;
}

function installedHookManifests(home: string, env: NodeJS.ProcessEnv): string[] {
  const mode = detectInstallMode({ home, env });
  const roots = [
    mode.npmGlobalDist ? dirname(dirname(mode.npmGlobalDist)) : null,
    ...mode.marketplaceDists.map((dist) => dirname(dirname(dist))),
  ].filter((p): p is string => p !== null);
  return [...new Set(roots.map((root) => join(root, "hooks", "hooks.json")))];
}

function hasSessionStartEntry(file: string, env: NodeJS.ProcessEnv): boolean {
  return flattenHooks(file, readJson(file), env).some((h) => h.event === "SessionStart" && h.id === SESSION_START_ID);
}

function restoreSessionStartEntry(file: string): void {
  const json = readJson(file) ?? { hooks: {} };
  const hooks = json.hooks && typeof json.hooks === "object" && !Array.isArray(json.hooks) ? json.hooks as JsonObj : {};
  json.hooks = hooks;
  const groups = Array.isArray(hooks.SessionStart) ? hooks.SessionStart as JsonObj[] : [];
  hooks.SessionStart = groups;
  if (groups.length === 0) groups.push({ hooks: [] });
  const list = Array.isArray(groups[0].hooks) ? groups[0].hooks as JsonObj[] : [];
  groups[0].hooks = list;
  list.push(canonicalSessionStartEntry());
  mkdirSync(dirname(file), { recursive: true });
  backupFile(file);
  atomicWriteFile(file, `${JSON.stringify(json, null, 2)}\n`, { encoding: "utf8" });
}

function findHookDuplicates(files: Array<{ file: string; json: JsonObj | null }>, home: string, env: NodeJS.ProcessEnv): HookDuplicate[] {
  const all = files.flatMap((f) => flattenHooks(f.file, f.json, env));
  const out: HookDuplicate[] = [];
  const seen = new Set<string>();
  const add = (d: HookDuplicate) => {
    const k = `${d.kind}:${d.remove.sourceFile}:${d.remove.groupIndex}:${d.remove.hookIndex}:${d.keep?.sourceFile ?? "plugin"}:${d.id}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  };

  for (const id of new Set(all.map((h) => h.id).filter((v): v is string => v !== null))) {
    const matches = all.filter((h) => h.id === id);
    if (matches.length < 2) continue;
    let keep = matches[0];
    for (const h of matches.slice(1)) keep = betterHook(keep, h);
    for (const h of matches) if (h !== keep) add({ id, kind: "same-id", keep, remove: h });
  }

  for (const idHook of all.filter((h) => h.id && h.script)) {
    for (const legacy of all.filter((h) => !h.id && h.script === idHook.script)) {
      const keep = betterHook(idHook, legacy);
      add({ id: idHook.id!, kind: "legacy-pair", keep, remove: keep === idHook ? legacy : idHook });
    }
  }

  // Marketplace hooks and npm-global user hooks are both valid alone. Together,
  // the manifest fires the same script, so the user-config copy is redundant.
  const pluginScripts = pluginHooksPresent(home, env);
  for (const h of all) {
    if (h.script && pluginScripts.has(h.script)) add({ id: h.id ?? SCRIPT_IDS[h.script], kind: "dual-mode", keep: null, remove: h });
  }
  return out;
}

function removeHookEntry(json: JsonObj, h: HookEntry): void {
  const groups = ((json.hooks as JsonObj)[h.event] as JsonObj[]);
  const list = groups[h.groupIndex].hooks as JsonObj[];
  list.splice(h.hookIndex, 1);
}

export async function checkDuplicateHooks(opts: DoctorOptions = {}): Promise<DoctorLine> {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const files = [
    { file: join(home, ".claude", "settings.json"), json: readJson(join(home, ".claude", "settings.json")) },
    { file: join(home, ".codex", "hooks.json"), json: readJson(join(home, ".codex", "hooks.json")) },
  ];
  const dupes = findHookDuplicates(files, home, env);
  if (dupes.length === 0) return { status: "PASS", id: 3, name: "duplicate-hooks", detail: "no duplicate subagent-mcp hooks found" };

  const tty = opts.isTTY ?? process.stdin.isTTY;
  const detail = dupes.map((d) => `${d.kind} ${d.id}: remove ${hookDetail(d.remove)}${d.keep ? `; keep ${hookDetail(d.keep)}` : "; keep plugin manifest"}`).join("; ");
  if (!tty) return { status: "WARN", id: 3, name: "duplicate-hooks", detail: `${detail}; non-TTY: no changes made` };

  let backedUp = false;
  const removals = new Map<string, Set<string>>();
  for (const d of dupes) {
    if (await askYesNo(opts, `Remove duplicate entry ${d.id}? [Y/n] `)) {
      if (!backedUp) {
        createBackup();
        backedUp = true;
      }
      const key = `${d.remove.event}:${d.remove.groupIndex}:${d.remove.hookIndex}`;
      const set = removals.get(d.remove.sourceFile) ?? new Set<string>();
      set.add(key);
      removals.set(d.remove.sourceFile, set);
    }
  }
  for (const f of files) {
    const set = removals.get(f.file);
    if (!set || !f.json) continue;
    const entries = flattenHooks(f.file, f.json, env)
      .filter((h) => set.has(`${h.event}:${h.groupIndex}:${h.hookIndex}`))
      .sort((a, b) => b.groupIndex - a.groupIndex || b.hookIndex - a.hookIndex);
    for (const h of entries) removeHookEntry(f.json, h);
    atomicWriteFile(f.file, `${JSON.stringify(f.json, null, 2)}\n`, { encoding: "utf8" });
  }
  const count = [...removals.values()].reduce((n, s) => n + s.size, 0);
  return { status: "WARN", id: 3, name: "duplicate-hooks", detail: `${detail}; removed=${count}${backedUp ? " after backup" : ""}` };
}

export function checkProviderConfig(opts: DoctorOptions = {}): DoctorLine {
  const file = join(configHome(opts), "providers.jsonc");
  if (!existsSync(file)) {
    return { status: "FAIL", id: 4, name: "provider-config", detail: `missing ${file}; run: subagent-mcp config init` };
  }
  const parsed = parseJsoncFile(file);
  return parsed.ok
    ? { status: "PASS", id: 4, name: "provider-config", detail: `${file} parses` }
    : { status: "FAIL", id: 4, name: "provider-config", detail: `${file} parse error: ${parsed.error}` };
}

function readProviderConfig(opts: DoctorOptions): JsonObj | null {
  const file = join(configHome(opts), "providers.jsonc");
  if (!existsSync(file)) return null;
  const parsed = parseJsoncFile(file);
  return parsed.ok ? parsed.json : null;
}

function readDotEnv(path: string): Map<string, string> | null {
  if (!existsSync(path)) return null;
  const env = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  return env;
}

export function checkEnvKeys(opts: DoctorOptions = {}): DoctorLine {
  const home = configHome(opts);
  const env = readDotEnv(join(home, ".env"));
  const keys = [...new Set(providerEntries(readProviderConfig(opts)).map(([, p]) => p.key_env).filter((v): v is string => typeof v === "string"))];
  const missing = env === null ? keys : keys.filter((k) => !env.get(k) || env.get(k) === "YOUR_KEY_HERE");
  return {
    status: env === null || missing.length ? "WARN" : "PASS",
    id: 5,
    name: "env-keys",
    detail: env === null
      ? (keys.length ? `missing .env; missing keys: ${missing.join(", ")}` : "missing .env; no key_env entries")
      : (missing.length ? `missing keys: ${missing.join(", ")}` : "all key_env entries set"),
  };
}

export function checkRoutingCoverage(opts: DoctorOptions = {}): DoctorLine {
  const routed = new Set<string>();
  for (const [, provider] of providerEntries(readProviderConfig(opts))) {
    const routing = provider.routing;
    if (!routing || typeof routing !== "object" || Array.isArray(routing)) continue;
    for (const category of TASK_CATEGORIES) {
      if (typeof routing[category] === "number" && routing[category] >= 1) routed.add(category);
    }
  }
  return routed.size === 0
    ? { status: "WARN", id: 6, name: "routing-coverage", detail: "no API routing active" }
    : { status: "PASS", id: 6, name: "routing-coverage", detail: `${routed.size}/14 categories routed` };
}

export async function checkReachability(opts: DoctorOptions = {}): Promise<DoctorLine[]> {
  const providers = providerEntries(readProviderConfig(opts))
    .map(([name, p]) => [name, p.base_url] as const)
    .filter((e): e is readonly [string, string] => typeof e[1] === "string" && e[1].length > 0);
  if (providers.length === 0) {
    return [{ status: "INFO", id: 7, name: "reachability", detail: "no providers with base_url configured" }];
  }
  const probe = opts.providerHead ?? ((url: string) => probeProviderHead(url, { timeoutMs: 3000 }));
  return Promise.all(providers.map(async ([name, url]) => {
    const r = await probe(url);
    return {
      status: "INFO" as const,
      id: 7,
      name: "reachability",
      detail: r.status ? `${name}: status ${r.status}` : `${name}: unreachable (${r.error ?? "unknown"})`,
    };
  }));
}

export async function checkUpdate(opts: DoctorOptions = {}): Promise<DoctorLine> {
  const pkg = (opts.packageInfo ?? readInstalledPackageInfo)();
  const latest = await fetchLatestVersion(pkg.name, {
    fetch: opts.fetch ?? fetch,
    registryBaseUrl: opts.registryBaseUrl ?? "https://registry.npmjs.org",
    timeoutMs: 2500,
  });
  if (!latest) return { status: "INFO", id: 8, name: "update-check", detail: "offline or undeterminable" };
  return isVersionNewer(latest, pkg.version)
    ? { status: "WARN", id: 8, name: "update-check", detail: `latest ${latest}; run: subagent-mcp upgrade` }
    : { status: "PASS", id: 8, name: "update-check", detail: `current ${pkg.version}` };
}

export async function checkSessionState(opts: DoctorOptions = {}): Promise<DoctorLine> {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const manifests = installedHookManifests(home, env);
  const missing = manifests.filter((file) => !hasSessionStartEntry(file, env));
  const source = opts.statusSource?.();
  const sourceDetail = source === undefined || source === null
    ? "server session state available via get_status MCP tool; doctor CLI cannot query running MCP server memory"
    : source.session_start_time
      ? "get_status session_start_time is populated"
      : "get_status session_start_time would be null";

  if (missing.length > 0 || manifests.length === 0) {
    const detail = manifests.length === 0
      ? "no installed hooks/hooks.json manifest found"
      : `missing ${SESSION_START_ID} in ${missing.join(", ")}`;
    if (!(opts.isTTY ?? process.stdin.isTTY)) {
      return { status: "WARN", id: 9, name: "session-state", detail: `${detail}; ${sourceDetail}; non-TTY: no changes made` };
    }
    if (await askYesNo(opts, "Restore SessionStart hook? [Y/n] ")) {
      for (const file of missing) restoreSessionStartEntry(file);
      return { status: "WARN", id: 9, name: "session-state", detail: `${detail}; repaired after backup; ${sourceDetail}` };
    }
    return { status: "WARN", id: 9, name: "session-state", detail: `${detail}; repair skipped; ${sourceDetail}` };
  }

  if (source?.session_start_time === null) {
    return { status: "WARN", id: 9, name: "session-state", detail: `SessionStart hook present; ${sourceDetail}` };
  }
  return { status: "INFO", id: 9, name: "session-state", detail: `SessionStart hook present; ${sourceDetail}` };
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<number> {
  const results = [
    checkInstallMode(opts),
    await checkMcpRegistration(opts),
    await checkDuplicateHooks(opts),
    checkProviderConfig(opts),
    checkEnvKeys(opts),
    checkRoutingCoverage(opts),
    ...await checkReachability(opts),
    await checkUpdate(opts),
    await checkSessionState(opts),
  ];
  for (const r of results) console.log(line(r));
  const counts = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
  for (const r of results) counts[r.status]++;
  const exitCode = counts.FAIL > 0 ? 1 : 0;
  console.log(`Summary: pass=${counts.PASS} warn=${counts.WARN} fail=${counts.FAIL} info=${counts.INFO} exit=${exitCode}`);
  return exitCode;
}
