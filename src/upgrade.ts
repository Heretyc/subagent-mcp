import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createBackup } from "./backup.js";
import { detectInstallMode, type InstallModeInfo } from "./install-mode.js";
import { globalTargetFiles, upsertInitBlock } from "./init.js";
import { atomicWriteFile } from "./orchestration/atomic-write.js";
import { runDoctor } from "./doctor.js";
import { deploySmcpSkillsAndCommands, serverPaths } from "./setup.js";
import { referencedHookPath } from "./hook-match.js";
import { askYesNo } from "./prompt.js";

type JsonObj = Record<string, any>;
type RunResult = { status: number | null; error?: Error };

export interface CommandRunner {
  run(command: string, args: string[]): RunResult;
}

export interface UpgradeOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  runner?: CommandRunner;
  backup?: () => unknown;
  installRoot?: string;
  doctor?: typeof runDoctor;
  detect?: () => InstallModeInfo;
  log?: (line: string) => void;
}

const defaultRunner: CommandRunner = {
  run(command, args) {
    const r = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    return { status: r.status, error: r.error };
  },
};

const HOOK_BY_ID: Record<string, (root: string) => JsonObj> = {
  "subagent-mcp-orchestration-claude": (root) => ({
    id: "subagent-mcp-orchestration-claude",
    type: "command",
    command: "node",
    args: [serverPaths(root).claudeHook],
  }),
  "subagent-mcp-pretool": (root) => ({
    id: "subagent-mcp-pretool",
    type: "command",
    command: "node",
    args: [serverPaths(root).claudePreToolHook],
    timeout: 5,
  }),
  "subagent-mcp-session-start": (root) => ({
    id: "subagent-mcp-session-start",
    type: "command",
    command: `node "${serverPaths(root).codexHook.replace(/orchestration-codex\.js$/, "smcp-activate.js")}"`,
    commandWindows: `node "${serverPaths(root).codexHook.replace(/orchestration-codex\.js$/, "smcp-activate.js")}"`,
    timeout: 5,
  }),
  "subagent-mcp-orchestration-codex": (root) => ({
    id: "subagent-mcp-orchestration-codex",
    type: "command",
    command: `node "${serverPaths(root).codexHook}"`,
    commandWindows: `node "${serverPaths(root).codexHook}"`,
    timeout: 10,
  }),
};

function readJson(file: string): JsonObj | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
}

function writeJson(file: string, value: JsonObj): void {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

function repairHooksIn(file: string, root: string): number {
  const json = readJson(file);
  const hooks = json?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return 0;
  let count = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const list = group && typeof group === "object" ? (group as JsonObj).hooks : null;
      if (!Array.isArray(list)) continue;
      for (const hook of list) {
        if (!hook || typeof hook !== "object" || Array.isArray(hook)) continue;
        const entry = hook as JsonObj;
        const id = typeof entry.id === "string" ? entry.id : "";
        const desired = HOOK_BY_ID[id]?.(root);
        const p = referencedHookPath(entry);
        if (!desired || !p || existsSync(p)) continue;
        Object.keys(entry).forEach((k) => delete entry[k]);
        Object.assign(entry, desired);
        count++;
      }
    }
  }
  if (count > 0) writeJson(file, json);
  return count;
}

export function repairStaleHooks(home = homedir(), root: string): number {
  return [
    join(home, ".claude", "settings.json"),
    join(home, ".codex", "hooks.json"),
  ].reduce((n, file) => n + repairHooksIn(file, root), 0);
}

async function manageGlobalInitBlocks(opts: UpgradeOptions): Promise<{ updated: number; skipped: number }> {
  const home = opts.home ?? homedir();
  const targets = globalTargetFiles(home);
  let updated = 0;
  const absent = targets.filter((f) => !existsSync(f) || !readFileSync(f, "utf8").includes("subagent-mcp:managed:begin"));
  for (const file of targets.filter((f) => !absent.includes(f))) {
    if (upsertInitBlock(file).changed) updated++;
  }
  if (absent.length === 0) return { updated, skipped: 0 };
  if (!(opts.isTTY ?? process.stdin.isTTY)) return { updated, skipped: absent.length };
  if (!(await askYesNo(opts, "Install init blocks globally? [Y/n] "))) return { updated, skipped: absent.length };
  for (const file of absent) {
    if (upsertInitBlock(file).changed) updated++;
  }
  return { updated, skipped: 0 };
}

function updateCommands(mode: InstallModeInfo["mode"]): Array<[string, string[]]> {
  const npm: [string, string[]] = ["npm", ["install", "-g", "@heretyc/subagent-mcp@latest"]];
  const marketplace: [string, string[]] = ["claude", ["plugin", "update", "subagent-mcp@subagent-mcp"]];
  if (mode === "npm-global") return [npm];
  if (mode === "marketplace") return [marketplace];
  if (mode === "dual-mode") return [npm, marketplace];
  return [];
}

export async function runUpgrade(opts: UpgradeOptions = {}): Promise<number> {
  const log = opts.log ?? console.log;
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const root = opts.installRoot;
  const mode = opts.detect?.() ?? detectInstallMode({ home, env });
  const commands = updateCommands(mode.mode);
  if (commands.length === 0) {
    log("upgrade failed: no npm-global or marketplace install found");
    return 1;
  }

  (opts.backup ?? createBackup)();
  const actions: string[] = ["backup"];
  const runner = opts.runner ?? defaultRunner;
  for (const [cmd, args] of commands) {
    const r = runner.run(cmd, args);
    actions.push(`${cmd} ${args.join(" ")}`);
    if (r.error || r.status !== 0) {
      log(`upgrade failed: ${cmd} ${args.join(" ")} exited ${r.status ?? r.error?.message}`);
      return r.status ?? 1;
    }
  }

  const repairRoot = root ?? dirname(dirname(mode.npmGlobalDist ?? mode.marketplaceDists[0]));
  const repaired = repairStaleHooks(home, repairRoot);
  actions.push(`repaired-hooks=${repaired}`);
  const smcp = deploySmcpSkillsAndCommands(repairRoot, home);
  const codexSmcp = deploySmcpSkillsAndCommands(repairRoot, home, "codex");
  actions.push(`smcp-assets=${smcp.status}`, `codex-smcp-skills=${codexSmcp.status}`);
  const init = await manageGlobalInitBlocks(opts);
  actions.push(`init-updated=${init.updated}`, `init-skipped=${init.skipped}`);

  log("--- Doctor ---");
  await (opts.doctor ?? runDoctor)({ home, env, isTTY: false, input: opts.input, output: opts.output });
  log(`Upgrade complete: ${actions.join("; ")}`);
  return 0;
}
