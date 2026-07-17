#!/usr/bin/env node
// Setup CLI for the globally-installed subagent-mcp addon.
// Wires Claude Code CLI and Codex CLI with the MCP server + orchestration-mode hook.
// Run after: npm install -g @heretyc/subagent-mcp
//
// Usage:
//   subagent-mcp setup              -- auto-detect vendors, wire all present
//   subagent-mcp setup --dry-run    -- print config, make no changes
//
// Design: maximally automatic and self-repairing.
//   - Wiring that exists but points at a WRONG/STALE path (moved npm prefix,
//     scope rename, dev-tree leftovers) is REPAIRED in place, not "left as-is".
//   - Claude server registration falls back from the official CLI to a direct
//     ~/.claude.json edit (same schema) if the CLI fails.
//   - A missing ~/.codex/config.toml is created, not punted to the user.
//   - Every config file is backed up before its first edit.
//   - Failures never abort the run: they are collected and reported at the end
//     with a copy-paste repair prompt the user can hand to Claude/Codex.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { stateDir } from "./orchestration/marker.js";
import { STATUSLINE_TTL_MS } from "./orchestration/statusline-state.js";
import { askLine, type PromptOptions } from "./prompt.js";
import { runInit } from "./init.js";

const cliArgs = process.argv.slice(3); // argv[2]='setup', flags start at [3]
const DRY_RUN = cliArgs.includes("--dry-run");
const UNATTENDED = cliArgs.includes("--unattended");

export const SERVER_NAME = "subagent-mcp";

// Install root: dist/setup.js -> dist/ -> <install-root>
const INSTALL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fwd(p: string): string {
  return p.split("\\").join("/");
}

export function serverPaths(root: string = INSTALL_ROOT) {
  const f = fwd(root);
  return {
    server: `${f}/dist/index.js`,
    claudeHook: `${f}/dist/hooks/orchestration-claude.js`,
    claudePreToolHook: `${f}/dist/hooks/orchestration-claude-pretool.js`,
    claudeStatuslineHook: `${f}/dist/hooks/statusline-claude.js`,
    codexHook: `${f}/dist/hooks/orchestration-codex.js`,
  };
}

const SMCP_AGENT_SKILLS = ["smcp-doctor", "smcp-help", "smcp-status", "smcp-handoff"] as const;

function smcpAssetPaths(root: string = INSTALL_ROOT, home: string = homedir()) {
  return [
    ...SMCP_AGENT_SKILLS.map((name) => ({
      label: `claude: ${name} skill`,
      source: join(root, "skills", name),
      target: join(home, ".claude", "skills", name),
    })),
    ...SMCP_AGENT_SKILLS.map((name) => ({
      label: `claude: ${name} command`,
      source: join(root, "commands", `${name}.toml`),
      target: join(home, ".claude", "commands", `${name}.toml`),
    })),
  ];
}

// ---------------------------------------------------------------------------
// Pure helpers exported for tests and setup wiring.
// ---------------------------------------------------------------------------

export type WireStatus = "ok" | "added" | "repaired";
export type JsonObj = Record<string, unknown>;

export interface SmcpSkillsAndCommandsResult {
  changed: boolean;
  status: WireStatus | "missing-source";
  detail: string;
  missingSources: string[];
}

function statuslineCommand(shimPath: string, innerCommand: string = ""): string {
  const inner = innerCommand.trim();
  return `node "${shimPath}"${inner ? ` ${quoteStatuslineInnerArg(inner)}` : ""}`;
}

function quoteStatuslineInnerArg(command: string): string {
  if (process.platform === "win32") {
    return JSON.stringify(command);
  }
  return `'${command.replace(/'/g, "'\\''")}'`;
}

function extractStatuslineInner(command: string): string | null {
  const marker = "statusline-claude.js";
  const idx = command.indexOf(marker);
  if (idx < 0) return null;
  let restStart = idx + marker.length;
  if (command[restStart] === "\"") restStart++;
  const rest = command.slice(restStart).trim();
  return unquoteStatuslineInnerArg(rest);
}

function unquoteStatuslineInnerArg(arg: string): string {
  if (!arg) return arg;
  if (process.platform === "win32" && arg.startsWith("\"")) {
    try {
      const parsed = JSON.parse(arg) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      return arg;
    }
  }
  if (process.platform !== "win32" && arg.startsWith("'") && arg.endsWith("'")) {
    return arg.slice(1, -1).replace(/'\\''/g, "'");
  }
  return arg;
}

/**
 * Pure-node PATH lookup. `where`/`which` are not guaranteed to exist (minimal
 * containers, stripped distros), so scan PATH ourselves. On win32, PATHEXT
 * extensions are tried; existence (not exec bit) is the test on POSIX, which is
 * the right tolerance level for "is this CLI installed".
 */
export function findOnPath(
  cmd: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  const sep = platform === "win32" ? ";" : ":";
  const dirs = (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean);
  const exts =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const d of dirs) {
    for (const e of exts) {
      const p = join(d, cmd + e.toLowerCase());
      if (existsSync(p)) return p;
    }
    if (platform === "win32" && existsSync(join(d, cmd))) return join(d, cmd);
  }
  return null;
}

/**
 * Reconcile the UserPromptSubmit and PreToolUse hooks in a parsed ~/.claude/settings.json.
 * Mutates `s` in place. Exact wiring present -> ok. A hook referencing
 * orchestration-claude.js at any OTHER path/shape -> repaired (rewritten to the
 * canonical exec form). Absent -> added. Unrelated hooks are never touched.
 */
export function reconcileClaudeSettings(
  s: JsonObj,
  hookPath: string,
  preToolHookPath: string = hookPath.replace(
    /orchestration-claude\.js$/,
    "orchestration-claude-pretool.js"
  ),
  statuslineHookPath: string = hookPath.replace(
    /orchestration-claude\.js$/,
    "statusline-claude.js"
  )
): { changed: boolean; status: WireStatus } {
  const hooksBlock = (s.hooks ?? {}) as JsonObj;
  s.hooks = hooksBlock;

  const reconcile = (
    event: "UserPromptSubmit" | "PreToolUse",
    scriptName: string,
    desired: Record<string, unknown>
  ): { changed: boolean; status: WireStatus } => {
    const list = (hooksBlock[event] ?? []) as Array<{
      hooks?: Array<Record<string, unknown>>;
    }>;
    hooksBlock[event] = list;
    for (const grp of list) {
      for (const hk of grp.hooks ?? []) {
        if (typeof desired.id === "string" && hk.id === desired.id) {
          return { changed: false, status: "ok" };
        }
        if (!JSON.stringify(hk).includes(scriptName)) continue;
        const args = hk.args as unknown[] | undefined;
        const exact =
          hk.id === desired.id &&
          hk.type === desired.type &&
          hk.command === desired.command &&
          Array.isArray(args) &&
          JSON.stringify(args) === JSON.stringify(desired.args) &&
          (desired.timeout === undefined || hk.timeout === desired.timeout);
        if (exact) return { changed: false, status: "ok" };
        Object.assign(hk, desired);
        return { changed: true, status: "repaired" };
      }
    }
    list.push({ hooks: [{ ...desired }] });
    return { changed: true, status: "added" };
  };

  const prompt = reconcile("UserPromptSubmit", "orchestration-claude.js", {
    id: "subagent-mcp-orchestration-claude",
    type: "command",
    command: "node",
    args: [hookPath],
  });
  const pretool = reconcile("PreToolUse", "orchestration-claude-pretool.js", {
    id: "subagent-mcp-pretool",
    type: "command",
    command: "node",
    args: [preToolHookPath],
    timeout: 5,
  });
  const statusline = reconcileClaudeStatusLine(s, statuslineHookPath);
  const status =
    prompt.status === "repaired" || pretool.status === "repaired" || statusline.status === "repaired"
      ? "repaired"
      : prompt.status === "added" || pretool.status === "added" || statusline.status === "added"
        ? "added"
        : "ok";
  return { changed: prompt.changed || pretool.changed || statusline.changed, status };
}

export function reconcileClaudeStatusLine(
  s: JsonObj,
  statuslineHookPath: string
): { changed: boolean; status: WireStatus } {
  const current = s.statusLine;
  const currentCommand =
    current && typeof current === "object" && !Array.isArray(current) &&
    typeof (current as JsonObj).command === "string"
      ? (current as JsonObj).command as string
      : typeof current === "string"
        ? current
        : null;
  const inner = currentCommand !== null ? extractStatuslineInner(currentCommand) : null;
  const desired = {
    type: "command",
    command: statuslineCommand(statuslineHookPath, inner ?? currentCommand ?? ""),
  };
  if (currentCommand === null) {
    s.statusLine = desired;
    return { changed: true, status: "added" };
  }
  if (
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    (current as JsonObj).type === desired.type &&
    (current as JsonObj).command === desired.command
  ) {
    return { changed: false, status: "ok" };
  }
  s.statusLine = desired;
  return { changed: true, status: "repaired" };
}

/**
 * Reconcile the user-scope MCP server entry in a parsed ~/.claude.json.
 * Mutates `cj` in place. Same ok/repaired/added semantics; other servers are
 * never touched. (Direct-edit fallback for when `claude mcp add` fails; the
 * schema written matches what the official CLI writes.)
 */
export function reconcileClaudeJson(
  cj: JsonObj,
  serverPath: string
): { changed: boolean; status: WireStatus } {
  const servers = (cj.mcpServers ?? {}) as JsonObj;
  cj.mcpServers = servers;
  const cur = servers["subagent-mcp"] as JsonObj | undefined;
  if (cur) {
    const args = cur.args as unknown[] | undefined;
    const exact = cur.command === "subagent-mcp" && Array.isArray(args) && args.length === 0;
    if (exact) return { changed: false, status: "ok" };
  }
  servers["subagent-mcp"] = {
    type: "stdio",
    command: "subagent-mcp",
    args: [],
    env: {},
  };
  return { changed: true, status: cur ? "repaired" : "added" };
}

/**
 * Reconcile the [mcp_servers.subagent-mcp] block in ~/.codex/config.toml text.
 * Block absent -> appended. Block present with the exact server path -> ok.
 * Block present pointing elsewhere -> the main block (NOT its .tools subtables)
 * is rewritten to the canonical form. Returns the new TOML text.
 */
export function reconcileCodexToml(
  toml: string,
  serverPath: string
): { toml: string; changed: boolean; status: WireStatus } {
  const canonical =
    `[mcp_servers.subagent-mcp]\n` +
    `command = "node"\n` +
    `args = ["${serverPath}"]\n` +
    `startup_timeout_sec = 10\n` +
    `tool_timeout_sec = 60\n`;

  // Main block runs from its header to the next table header — a '[' at the
  // START of a line (its .tools.* subtables are separate tables and are left
  // alone). A bare [^[]* would stop at the '[' inside `args = ["..."]`.
  const blockRe = /\[mcp_servers\.subagent-mcp\][\s\S]*?(?=\n\[|$)/;
  const m = toml.match(blockRe);
  if (!m) {
    const sepNl = toml.endsWith("\n") || toml === "" ? "" : "\n";
    return {
      toml: toml + `${sepNl}\n` + canonical,
      changed: true,
      status: "added",
    };
  }
  if (m[0].includes(`command = "node"`) && m[0].includes(`args = ["${serverPath}"]`)) {
    return { toml, changed: false, status: "ok" };
  }
  return {
    toml: toml.replace(blockRe, canonical + "\n"),
    changed: true,
    status: "repaired",
  };
}

/**
 * Reconcile the SessionStart + UserPromptSubmit entries in a parsed
 * ~/.codex/hooks.json. Mutates `h` in place. Per event: exact command -> ok,
 * stale orchestration-codex.js reference -> repaired, absent -> added.
 */
export function reconcileCodexHooks(
  h: JsonObj,
  hookCmd: string
): { changed: boolean; statuses: Record<string, WireStatus> } {
  const hooksBlock = (h.hooks ?? {}) as Record<
    string,
    Array<{ hooks?: Array<Record<string, unknown>> }>
  >;
  h.hooks = hooksBlock;
  const statuses: Record<string, WireStatus> = {};
  let changed = false;

  for (const ev of ["SessionStart", "UserPromptSubmit"]) {
    const evList = (hooksBlock[ev] = hooksBlock[ev] ?? []);
    let found: Record<string, unknown> | null = null;
    for (const grp of evList) {
      for (const hk of grp.hooks ?? []) {
        if (JSON.stringify(hk).includes("orchestration-codex.js")) {
          found = hk;
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      if (found.command === hookCmd && found.commandWindows === hookCmd) {
        statuses[ev] = "ok";
        continue;
      }
      found.type = "command";
      found.command = hookCmd;
      found.commandWindows = hookCmd;
      found.timeout = 10;
      statuses[ev] = "repaired";
      changed = true;
    } else {
      evList.push({
        hooks: [
          {
            type: "command",
            command: hookCmd,
            commandWindows: hookCmd,
            timeout: 10,
          },
        ],
      });
      statuses[ev] = "added";
      changed = true;
    }
  }
  return { changed, statuses };
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

export function verifyInstall(root: string = INSTALL_ROOT): string[] {
  const required = [
    "dist/index.js",
    "dist/advanced-ruleset.py",
    "dist/global-subagent-mcp-config.jsonc",
    "dist/hooks/orchestration-claude.js",
    "dist/hooks/orchestration-claude-pretool.js",
    "dist/hooks/statusline-claude.js",
    "dist/hooks/orchestration-codex.js",
    "directives/carryover-claude.md",
    "directives/carryover-codex.md",
    "directives/orchestration-claude.md",
    "directives/orchestration-codex.md",
    "directives/short-on.md",
    "directives/short-off.md",
    "directives/reminder-on.md",
    "directives/reminder-off-claude.md",
    "directives/reminder-off-codex.md",
  ];
  return required.filter((f) => !existsSync(join(root, ...f.split("/"))));
}

function readJson(file: string, fallback: JsonObj): JsonObj {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
  } catch {
    return { ...fallback };
  }
}

const backedUp = new Set<string>();
function backup(file: string): void {
  if (backedUp.has(file) || !existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    copyFileSync(file, `${file}.bak-setup-${stamp}`);
    backedUp.add(file);
  } catch {
    /* backup is best-effort */
  }
}

function runCmd(cmd: string, cmdArgs: string[]): boolean {
  return runCmdCapture(cmd, cmdArgs).ok;
}

/**
 * Parse an npm cmd-shim (.cmd) for its dp0-relative node script.
 * Matches both modern `"%dp0%\node_modules\...\cli.js"` and legacy
 * `"%~dp0\..."` forms. Returns the absolute JS path or null.
 */
export function resolveCmdShimNodeScript(cmdPath: string): string | null {
  try {
    const text = readFileSync(cmdPath, "utf8");
    const m = text.match(/"%(?:~dp0|dp0%)\\([^"]+\.(?:js|cjs|mjs))"/i);
    if (!m) return null;
    const js = join(dirname(cmdPath), m[1]);
    return existsSync(js) ? js : null;
  } catch {
    return null;
  }
}

// Conservative safe-charset: quote on ANYTHING else, including the cmd.exe
// metachars & | < > ^ ( ) % ! plus space, tab, and ".
const WIN_SAFE_ARG = /^[A-Za-z0-9_.,:=@+\/\\-]+$/;

export function quoteWinShellArg(arg: string): string {
  if (arg !== "" && WIN_SAFE_ARG.test(arg)) return arg;
  // "" doubling: quote-state-safe at the cmd parse stage, a literal " at the
  // final MSVCRT argv stage (\" would close the quote and expose metachars).
  return `"${arg.replace(/"/g, '""')}"`;
}

export function quoteWinShellExe(exe: string): string {
  return `"${exe.replace(/"/g, '""')}"`;
}

function runCmdCapture(cmd: string, cmdArgs: string[]): { ok: boolean; stdout: string } {
  console.log(`  $ ${cmd} ${cmdArgs.join(" ")}`);
  if (DRY_RUN) {
    console.log("    (dry-run: skipped)");
    return { ok: true, stdout: "" };
  }
  try {
    const exe = findOnPath(cmd) ?? cmd;
    const isWinCmdShim = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(exe);
    let stdout: string;
    if (!isWinCmdShim) {
      stdout = execFileSync(exe, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } else {
      // Primary: bypass cmd.exe by invoking node on the shim's JS entry —
      // execFileSync without a shell does correct argv quoting, so cmd.exe
      // metachar/percent expansion never applies.
      const js = resolveCmdShimNodeScript(exe);
      if (js) {
        stdout = execFileSync(process.execPath, [js, ...cmdArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } else {
        // Fallback for non-npm shims: hardened cmd.exe quoting. '%' is the one
        // channel cmd cannot neutralize on a /c line — warn, don't reject.
        if ([exe, ...cmdArgs].some((a) => a.includes("%"))) {
          console.log(
            "    note: an argument contains '%' — cmd.exe may expand it as an env var; if this command fails, check for name collisions."
          );
        }
        stdout = execSync([quoteWinShellExe(exe), ...cmdArgs.map(quoteWinShellArg)].join(" "), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    }
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export function claudeAddArgs(): string[] {
  return ["mcp", "add", "subagent-mcp", "subagent-mcp", "-s", "user"];
}

export function claudeRemoveArgs(): string[] {
  return ["mcp", "remove", "subagent-mcp", "-s", "user"];
}

export function codexAddArgs(serverPath: string): string[] {
  return ["mcp", "add", "subagent-mcp", "--", "node", serverPath];
}

export function codexRemoveArgs(): string[] {
  return ["mcp", "remove", "subagent-mcp"];
}

/**
 * True iff CLI output mentions `name` as a standalone token: the chars
 * immediately around it must not be server-name chars [A-Za-z0-9._-].
 * Robust to `claude mcp list` / `codex mcp list` / `mcp get` formats
 * ("name: cmd - ✓ Connected", table rows, "Name: x" detail views), and
 * rejects sibling names like `subagent-mcp-dev` / `my-subagent-mcp`.
 */
export function outputListsServer(stdout: string, name: string = SERVER_NAME): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9._-])${esc}($|[^A-Za-z0-9._-])`, "m").test(stdout);
}

/** Exec seams, injectable for unit tests. */
export interface ExecDeps {
  run(cmd: string, args: string[]): boolean;
  capture(cmd: string, args: string[]): { ok: boolean; stdout: string };
  dryRun: boolean;
}

const defaultExecDeps: ExecDeps = {
  run: runCmd,
  capture: runCmdCapture,
  dryRun: DRY_RUN,
};

function registeredViaCli(cli: string, deps: ExecDeps = defaultExecDeps): boolean {
  const get = deps.capture(cli, ["mcp", "get", SERVER_NAME]);
  if (get.ok && outputListsServer(get.stdout)) return true;
  const list = deps.capture(cli, ["mcp", "list"]);
  return list.ok && outputListsServer(list.stdout);
}

// ---------------------------------------------------------------------------
// Failure collection -> end-of-run repair prompts
// ---------------------------------------------------------------------------

interface Issue {
  vendor: string;
  problem: string;
  repairPrompt: string;
}
const issues: Issue[] = [];

function repairPromptFor(vendor: "claude" | "codex", problem: string): string {
  const p = serverPaths();
  if (vendor === "claude") {
    return (
      `subagent-mcp setup hit a problem on my machine: ${problem}. ` +
      `The install root is "${fwd(INSTALL_ROOT)}". Please repair my Claude Code wiring: ` +
      `(1) register a user-scope MCP server named "subagent-mcp" running ` +
      `the global bin shim "subagent-mcp" (use 'claude mcp add subagent-mcp subagent-mcp -s user' or edit the mcpServers ` +
      `key in ~/.claude.json), and (2) ensure ~/.claude/settings.json has ` +
      `hooks.UserPromptSubmit -> {type:"command", command:"node", args:["${p.claudeHook}"]} and ` +
      `hooks.PreToolUse -> {type:"command", command:"node", args:["${p.claudePreToolHook}"], timeout:5}, and ` +
      `statusLine -> {type:"command", command:"node \\"${p.claudeStatuslineHook}\\""}. ` +
      `Back up any file before editing it.`
    );
  }
  return (
    `subagent-mcp setup hit a problem on my machine: ${problem}. ` +
    `The install root is "${fwd(INSTALL_ROOT)}". Please repair my Codex CLI wiring: ` +
    `(1) ensure ~/.codex/config.toml has [mcp_servers.subagent-mcp] with command = "node", ` +
    `args = ["${p.server}"], startup_timeout_sec = 10, tool_timeout_sec = 60, and ` +
    `(2) ensure ~/.codex/hooks.json has SessionStart and UserPromptSubmit entries ` +
    `{type:"command", command:'node "${p.codexHook}"', timeout:10}. ` +
    `Back up any file before editing it, then remind me to run /hooks in Codex and trust the hook.`
  );
}

function fail(vendor: "claude" | "codex", problem: string): void {
  console.log(`  PROBLEM: ${problem}`);
  issues.push({ vendor, problem, repairPrompt: repairPromptFor(vendor, problem) });
}

// ---------------------------------------------------------------------------
// Vendor wiring
// ---------------------------------------------------------------------------

function describe(status: WireStatus, what: string): void {
  if (status === "ok") console.log(`  ${what}: already correct.`);
  else if (status === "added") console.log(`  ${what}: added.`);
  else console.log(`  ${what}: pointed at a stale path — repaired.`);
}

function copyPackagePath(source: string, target: string, write = false): boolean {
  const sourceStat = statSync(source);
  if (sourceStat.isDirectory()) {
    let changed = !existsSync(target);
    for (const name of readdirSync(source)) {
      changed = copyPackagePath(join(source, name), join(target, name), write) || changed;
    }
    return changed;
  }
  const desired = readFileSync(source, "utf8");
  const changed = !existsSync(target) || readFileSync(target, "utf8") !== desired;
  if (changed && write && !DRY_RUN) {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) backup(target);
    writeFileSync(target, desired);
  }
  return changed;
}

function removeLegacyHandoffResumeSkill(home: string): { removed: boolean; warning: string | null } {
  const oldTarget = join(home, ".claude", "skills", "handoff-resume");
  if (!existsSync(oldTarget) || DRY_RUN) return { removed: false, warning: null };
  try {
    rmSync(oldTarget, { recursive: true, force: true });
    return { removed: true, warning: null };
  } catch (e) {
    return {
      removed: false,
      warning: `could not remove legacy handoff-resume skill at ${oldTarget}: ${(e as Error).message}`,
    };
  }
}

export function deploySmcpSkillsAndCommands(
  root: string = INSTALL_ROOT,
  home: string = homedir()
): SmcpSkillsAndCommandsResult {
  const missingSources = smcpAssetPaths(root, home)
    .map((p) => p.source)
    .filter((source) => !existsSync(source));
  if (missingSources.length > 0) {
    return {
      changed: false,
      status: "missing-source",
      detail: `source missing at ${missingSources.join(", ")}; reinstall @heretyc/subagent-mcp, then run subagent-mcp setup`,
      missingSources,
    };
  }

  const paths = smcpAssetPaths(root, home);
  const changedPaths = paths.filter((p) => copyPackagePath(p.source, p.target));
  const status: WireStatus =
    changedPaths.length === 0 ? "ok" : changedPaths.some((p) => existsSync(p.target)) ? "repaired" : "added";
  if (!DRY_RUN) {
    for (const p of changedPaths) copyPackagePath(p.source, p.target, true);
  }
  const legacy = removeLegacyHandoffResumeSkill(home);
  return {
    changed: changedPaths.length > 0 || legacy.removed,
    status,
    detail: `${status === "repaired" ? "restored" : "deployed"}${legacy.warning ? `; WARN ${legacy.warning}` : ""}`,
    missingSources: [],
  };
}

export function verifySmcpSkillsAndCommands(
  root: string = INSTALL_ROOT,
  home: string = homedir()
): CheckResult {
  const paths = smcpAssetPaths(root, home);
  const missingSources = paths.filter((p) => !existsSync(p.source)).map((p) => p.source);
  if (missingSources.length > 0) {
    return {
      label: "claude: smcp skills and commands",
      ok: false,
      detail: "source missing from install - reinstall @heretyc/subagent-mcp",
    };
  }
  const missing = paths.filter((p) => !existsSync(p.target)).map((p) => p.label);
  if (missing.length > 0) {
    return {
      label: "claude: smcp skills and commands",
      ok: false,
      detail: `missing ${missing.join(", ")} - run subagent-mcp setup`,
    };
  }
  const stale = paths.filter((p) => copyPackagePath(p.source, p.target));
  return {
    label: "claude: smcp skills and commands",
    ok: stale.length === 0,
    detail: stale.length === 0 ? "deployed" : `stale ${stale.map((p) => p.label).join(", ")} - run subagent-mcp setup`,
  };
}

/** Everything vendor-specific about wiring the MCP server, in one descriptor. */
export interface VendorWireSpec {
  vendor: "claude" | "codex";
  cli: string;
  configFile: string;
  addArgs: string[];
  removeArgs: string[];
  read(): unknown; // JsonObj (claude) | toml string, "" if absent (codex)
  reconcile(cfg: unknown): { status: WireStatus; changed: boolean; out: unknown };
  serialize(out: unknown): string;
  ensureDir?(): void;
  cliFailMsg: string; // fail() text when CLI verify fails and no fallback applies
}

export function vendorWireSpecs(
  p = serverPaths(),
  home = homedir()
): { claude: VendorWireSpec; codex: VendorWireSpec } {
  const claudeFile = join(home, ".claude.json");
  const codexDir = join(home, ".codex");
  const codexFile = join(codexDir, "config.toml");
  return {
    claude: {
      vendor: "claude",
      cli: "claude",
      configFile: claudeFile,
      addArgs: claudeAddArgs(),
      removeArgs: claudeRemoveArgs(),
      read: () => readJson(claudeFile, {}),
      reconcile: (cfg) => {
        const r = reconcileClaudeJson(cfg as JsonObj, p.server);
        return { status: r.status, changed: r.changed, out: cfg };
      },
      serialize: (out) => JSON.stringify(out, null, 2),
      cliFailMsg:
        "MCP server file shape is correct, but 'claude mcp add' failed to register it with the CLI",
    },
    codex: {
      vendor: "codex",
      cli: "codex",
      configFile: codexFile,
      addArgs: codexAddArgs(p.server),
      removeArgs: codexRemoveArgs(),
      read: () => (existsSync(codexFile) ? readFileSync(codexFile, "utf8") : ""),
      reconcile: (cfg) => {
        const r = reconcileCodexToml(cfg as string, p.server);
        return { status: r.status, changed: r.changed, out: r.toml };
      },
      serialize: (out) => out as string,
      ensureDir: () => mkdirSync(codexDir, { recursive: true }),
      cliFailMsg:
        "MCP server file shape is correct, but 'codex mcp add' failed to register it with the CLI",
    },
  };
}

/**
 * Single wiring driver for both vendors. Policy: CLI-first -> read-back ->
 * reconcile -> unconditional canonical write on divergence -> fail only when
 * neither the CLI registration nor the file fallback took.
 */
export function wireMcpServer(
  spec: VendorWireSpec,
  deps: ExecDeps = defaultExecDeps
): { status: WireStatus; registered: boolean; wroteFile: boolean; failure: string | null } {
  const initial = spec.reconcile(spec.read());
  if (initial.status === "repaired") {
    console.log("  MCP server registration points at a stale path — re-registering.");
    deps.run(spec.cli, spec.removeArgs);
  }
  let registered = initial.status === "ok" && registeredViaCli(spec.cli, deps);
  if (!registered) {
    deps.run(spec.cli, spec.addArgs);
    registered = registeredViaCli(spec.cli, deps);
  }
  if (deps.dryRun) {
    // Never verify/fail/write in dry-run: capture() returns empty stdout, so
    // any verification below would fail spuriously.
    if (initial.changed) console.log("    (dry-run: not written)");
    return { status: initial.status, registered: true, wroteFile: false, failure: null };
  }
  const after = spec.reconcile(spec.read()); // read-back: what is ACTUALLY on disk now
  let wroteFile = false;
  if (after.status !== "ok") {
    spec.ensureDir?.();
    backup(spec.configFile);
    writeFileSync(spec.configFile, spec.serialize(after.out));
    wroteFile = true;
    console.log(
      registered
        ? `  NOTE: ${spec.cli} CLI registration diverged from the canonical config — rewrote ${spec.configFile} to the canonical form.`
        : `  '${spec.cli} mcp add' failed — writing ${spec.configFile} directly.`
    );
  }
  const failure = registered || wroteFile ? null : spec.cliFailMsg;
  return { status: initial.status, registered, wroteFile, failure };
}

function wireClaude(): void {
  console.log("\n--- Claude Code CLI ---");
  const p = serverPaths();
  const specs = vendorWireSpecs(p);

  // 1) MCP server (user scope). CLI-first, read-back verified, with a direct
  //    (schema-identical) ~/.claude.json write whenever the file diverges.
  try {
    const r = wireMcpServer(specs.claude);
    if (r.failure) fail("claude", r.failure);
    else describe(r.status, "MCP server (user scope)");
  } catch (e) {
    fail("claude", `could not register the MCP server: ${(e as Error).message}`);
  }

  // 2) UserPromptSubmit and PreToolUse hooks in ~/.claude/settings.json.
  try {
    const sfile = join(homedir(), ".claude", "settings.json");
    const s = readJson(sfile, {});
    const { changed, status } = reconcileClaudeSettings(s, p.claudeHook);
    if (changed && !DRY_RUN) {
      backup(sfile);
      writeFileSync(sfile, JSON.stringify(s, null, 2));
    }
    describe(status, "UserPromptSubmit + PreToolUse hooks");
    if (changed && DRY_RUN) console.log("    (dry-run: not written)");
  } catch (e) {
    fail("claude", `could not write the settings.json hook: ${(e as Error).message}`);
  }

  // 3) Claude /smcp:* Agent Skills and slash-commands.
  try {
    const r = deploySmcpSkillsAndCommands(INSTALL_ROOT);
    if (r.status === "missing-source") {
      fail("claude", r.detail);
    } else {
      if (r.status === "ok") console.log("  smcp skills and commands: already correct.");
      else if (r.status === "added") console.log("  smcp skills and commands: added.");
      else console.log("  smcp skills and commands: restored from package copy.");
      if (r.detail.includes("WARN ")) console.log(`  ${r.detail.slice(r.detail.indexOf("WARN "))}`);
      if (r.changed && DRY_RUN) console.log("    (dry-run: not written)");
    }
  } catch (e) {
    fail("claude", `could not deploy smcp skills and commands: ${(e as Error).message}`);
  }
}

function wireCodex(): void {
  console.log("\n--- Codex CLI ---");
  const p = serverPaths();
  const codexDir = join(homedir(), ".codex");
  const specs = vendorWireSpecs(p);

  // Codex has no Agent Skill mechanism; MCP instructions carry handoff guidance.

  // 1) config.toml — MCP server block (created if the file is missing).
  try {
    const existed = existsSync(specs.codex.configFile);
    const r = wireMcpServer(specs.codex);
    if (r.failure) fail("codex", r.failure);
    else describe(r.status, existed ? "config.toml MCP server block" : "config.toml (created) MCP server block");
  } catch (e) {
    fail("codex", `could not write config.toml: ${(e as Error).message}`);
  }

  // 2) hooks.json — SessionStart + UserPromptSubmit hooks.
  try {
    const hfile = join(codexDir, "hooks.json");
    const h = readJson(hfile, { hooks: {} });
    const hookCmd = `node "${p.codexHook}"`;
    const { changed, statuses } = reconcileCodexHooks(h, hookCmd);
    if (changed && !DRY_RUN) {
      mkdirSync(codexDir, { recursive: true });
      backup(hfile);
      writeFileSync(hfile, JSON.stringify(h, null, 2));
    }
    for (const [ev, st] of Object.entries(statuses)) describe(st, `${ev} hook`);
    if (changed && DRY_RUN) console.log("    (dry-run: not written)");
    if (changed) {
      console.log("  NOTE: hook content changed — run 'codex', then /hooks, and TRUST the hook.");
    }
  } catch (e) {
    fail("codex", `could not write hooks.json: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Read-back verification for setup wiring.
// ---------------------------------------------------------------------------

export interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

type InitScope = "project" | "global";

export interface SetupInitMenuOptions extends PromptOptions {
  isTTY?: boolean;
  unattended?: boolean;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function chooseSetupInitScope(
  opts: SetupInitMenuOptions = {}
): Promise<InitScope> {
  if (opts.unattended) {
    opts.log?.("Init scope: unattended setup, defaulting to global.");
    return "global";
  }

  const tty = opts.isTTY ?? process.stdin.isTTY;
  if (!tty) {
    opts.log?.("Init scope: non-TTY setup, defaulting to global.");
    return "global";
  }

  opts.log?.("Choose init scope for first run:");
  opts.log?.("  1. Project - upsert instruction blocks in this repository.");
  opts.log?.("  2. Global  - upsert home instructions for Claude, Codex, and Gemini. (Recommended)");
  for (;;) {
    const answer = await askLine(opts, "Select [1-2, default 2 Global]: ");
    if (answer === "" || answer === "2" || answer === "g" || answer === "global") return "global";
    if (answer === "1" || answer === "p" || answer === "project") return "project";
    opts.log?.("Enter 1 or 2.");
  }
}

export async function runSetupInitMenu(
  opts: SetupInitMenuOptions & { init?: (args: string[]) => Promise<number> } = {}
): Promise<number> {
  const scope = await chooseSetupInitScope(opts);
  return (opts.init ?? runInit)([
    ...(opts.dryRun ? ["--dry-run"] : []),
    ...(scope === "global" ? ["--global"] : []),
  ]);
}

/** Detail string for a CLI registration check; "CLI repair failed" only when a
 *  repair was actually attempted. */
export function registrationDetail(registered: boolean, attemptedRepair: boolean): string {
  if (registered) return attemptedRepair ? "repaired" : "registered";
  return attemptedRepair
    ? "not registered; CLI repair failed"
    : "not registered — run: subagent-mcp doctor";
}

export function hasRecentStatuslineSignal(
  stateDirOverride: string = stateDir,
  now: number = Date.now()
): boolean {
  try {
    for (const name of readdirSync(stateDirOverride)) {
      if (!/^sl-(?:cwd-)?[0-9a-f]{16}\.json$/i.test(name)) continue;
      const stat = statSync(join(stateDirOverride, name));
      if (now - stat.mtimeMs <= STATUSLINE_TTL_MS) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function checkCliRegistration(
  cli: string,
  addArgs: string[],
  repair: boolean,
  deps: ExecDeps = defaultExecDeps
): { registered: boolean; attemptedRepair: boolean } {
  let registered = registeredViaCli(cli, deps);
  let attemptedRepair = false;
  if (!registered && repair) {
    deps.run(cli, addArgs);
    attemptedRepair = true;
    registered = registeredViaCli(cli, deps);
  }
  return { registered, attemptedRepair };
}

export function verifyWiring(root: string = INSTALL_ROOT, repair: boolean = false): CheckResult[] {
  const p = serverPaths(root);
  const results: CheckResult[] = [];
  const home = homedir();

  const missing = verifyInstall(root);
  results.push({
    label: "install files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `all present under ${fwd(root)}` : `missing: ${missing.join(", ")}`,
  });

  const hasClaude = findOnPath("claude") !== null;
  const hasClaudeConfig = existsSync(join(home, ".claude.json"));
  if (hasClaude) {
    const sj = readJson(join(home, ".claude", "settings.json"), {});
    const { registered, attemptedRepair } = checkCliRegistration("claude", claudeAddArgs(), repair);
    const hk = reconcileClaudeSettings(sj, p.claudeHook);
    results.push({
      label: "claude: MCP server (user scope)",
      ok: registered,
      detail: registrationDetail(registered, attemptedRepair),
    });
    results.push({
      label: "claude: UserPromptSubmit + PreToolUse hooks",
      ok: hk.status === "ok",
      detail: hk.status === "ok" ? "wired" : `${hk.status === "repaired" ? "stale path" : "not wired"} - run: subagent-mcp setup`,
    });
    const sl = reconcileClaudeStatusLine(sj, p.claudeStatuslineHook);
    results.push({
      label: "claude: statusLine",
      ok: sl.status === "ok",
      detail: sl.status === "ok"
        ? hasRecentStatuslineSignal()
          ? "wired; signal live"
          : "wired; waiting for Claude statusLine signal"
        : `${sl.status === "repaired" ? "stale path" : "not wired"} - run: subagent-mcp setup`,
    });
    results.push(verifySmcpSkillsAndCommands(root, home));
  } else if (hasClaudeConfig) {
    const cj = readJson(join(home, ".claude.json"), {});
    const sj = readJson(join(home, ".claude", "settings.json"), {});
    const srv = reconcileClaudeJson(cj, p.server);
    const hk = reconcileClaudeSettings(sj, p.claudeHook);
    results.push({
      label: "claude: MCP server (user scope)",
      ok: srv.status === "ok",
      detail: srv.status === "ok" ? "registered (file fallback)" : "config stale — run: subagent-mcp setup",
    });
    results.push({
      label: "claude: UserPromptSubmit + PreToolUse hooks",
      ok: hk.status === "ok",
      detail: hk.status === "ok" ? "wired" : `${hk.status === "repaired" ? "stale path" : "not wired"} - run: subagent-mcp setup`,
    });
    const sl = reconcileClaudeStatusLine(sj, p.claudeStatuslineHook);
    results.push({
      label: "claude: statusLine",
      ok: sl.status === "ok",
      detail: sl.status === "ok"
        ? hasRecentStatuslineSignal()
          ? "wired; signal live"
          : "wired; waiting for Claude statusLine signal"
        : `${sl.status === "repaired" ? "stale path" : "not wired"} - run: subagent-mcp setup`,
    });
    results.push(verifySmcpSkillsAndCommands(root, home));
  }

  const hasCodexCli = findOnPath("codex") !== null;
  const hasCodex = hasCodexCli || existsSync(join(home, ".codex"));
  if (hasCodex) {
    const cfg = join(home, ".codex", "config.toml");
    const toml = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
    const tomlR = reconcileCodexToml(toml, p.server);
    const hj = readJson(join(home, ".codex", "hooks.json"), { hooks: {} });
    const hkR = reconcileCodexHooks(hj, `node "${p.codexHook}"`);
    let registered = false;
    let detail: string;
    if (hasCodexCli) {
      const r = checkCliRegistration("codex", codexAddArgs(p.server), repair);
      registered = r.registered;
      detail = registrationDetail(r.registered, r.attemptedRepair);
    } else {
      registered = tomlR.status === "ok";
      detail = registered ? "registered" : "config stale — run: subagent-mcp setup";
    }
    results.push({
      label: "codex: config.toml MCP server block",
      ok: registered,
      detail,
    });
    const allOk = Object.values(hkR.statuses).every((s) => s === "ok");
    results.push({
      label: "codex: SessionStart + UserPromptSubmit hooks",
      ok: allOk,
      detail: allOk ? "wired (trust via /hooks in Codex)" : "incomplete - run: subagent-mcp setup",
    });
  }

  if (!hasClaude && !hasClaudeConfig && !hasCodex) {
    results.push({
      label: "vendors",
      ok: false,
      detail: "neither 'claude' nor 'codex' detected on PATH (and no ~/.codex)",
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runSetup(): Promise<void> {
  console.log(`subagent-mcp setup${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`Install root: ${INSTALL_ROOT}\n`);

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    console.error(`ERROR: Node ${process.versions.node} is too old. Node >= 20 required.`);
    process.exit(1);
  }

  const missing = verifyInstall();
  if (missing.length > 0) {
    console.error(`ERROR: install is incomplete — missing:\n  - ${missing.join("\n  - ")}`);
    console.error("Re-install: npm install -g @heretyc/subagent-mcp");
    process.exit(1);
  }

  const hasClaude = findOnPath("claude") !== null;
  const hasCodex = findOnPath("codex") !== null || existsSync(join(homedir(), ".codex"));

  if (!hasClaude && !hasCodex) {
    console.log(
      "No supported vendors found (neither 'claude' nor 'codex' on PATH, " +
      "and ~/.codex does not exist).\n" +
      "Install Claude Code CLI or Codex CLI first, then re-run: subagent-mcp setup"
    );
    process.exit(1);
  }

  if (hasClaude) wireClaude();
  else console.log("\nSkipping Claude Code (not on PATH).");

  if (hasCodex) wireCodex();
  else console.log("\nSkipping Codex CLI (not detected).");

  console.log("\n--- Init Instructions ---");
  const initCode = await runSetupInitMenu({
    unattended: UNATTENDED,
    dryRun: DRY_RUN,
    log: console.log,
  });
  if (initCode !== 0) {
    issues.push({
      vendor: "init",
      problem: `init command exited with code ${initCode}`,
      repairPrompt: "Run subagent-mcp init --global or subagent-mcp init from the target project and fix any reported file issues.",
    });
  }

  // Read-back verification: report what is ACTUALLY on disk now.
  if (!DRY_RUN) {
    console.log("\n--- Verification (read-back) ---");
    for (const r of verifyWiring(INSTALL_ROOT, false)) {
      console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label} — ${r.detail}`);
    }
  }

  console.log("\n=== Setup complete ===");
  if (hasClaude) {
    console.log("Claude Code: restart your session, then run /mcp — 'subagent-mcp' should show Connected.");
  }
  if (hasCodex) {
    console.log("Codex CLI:   restart your session, then run /hooks and TRUST the subagent-mcp hook.");
  }
  console.log("Health check any time:  subagent-mcp doctor");

  if (issues.length > 0) {
    console.log(`\n=== ${issues.length} issue(s) need attention ===`);
    for (const i of issues) {
      console.log(`\n[${i.vendor}] ${i.problem}`);
      console.log("  Paste this prompt into Claude Code or Codex to repair it:");
      console.log(`  "${i.repairPrompt}"`);
    }
    process.exit(1);
  }
}
