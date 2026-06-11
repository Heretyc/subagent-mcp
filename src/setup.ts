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
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

const cliArgs = process.argv.slice(3); // argv[2]='setup', flags start at [3]
const DRY_RUN = cliArgs.includes("--dry-run");

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
    codexHook: `${f}/dist/hooks/orchestration-codex.js`,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests and for the doctor command)
// ---------------------------------------------------------------------------

export type WireStatus = "ok" | "added" | "repaired";
export type JsonObj = Record<string, unknown>;

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
 * Reconcile the UserPromptSubmit hook in a parsed ~/.claude/settings.json.
 * Mutates `s` in place. Exact wiring present -> ok. A hook referencing
 * orchestration-claude.js at any OTHER path/shape -> repaired (rewritten to the
 * canonical exec form). Absent -> added. Unrelated hooks are never touched.
 */
export function reconcileClaudeSettings(
  s: JsonObj,
  hookPath: string
): { changed: boolean; status: WireStatus } {
  const hooksBlock = (s.hooks ?? {}) as JsonObj;
  s.hooks = hooksBlock;
  const upsList = (hooksBlock.UserPromptSubmit ?? []) as Array<{
    hooks?: Array<Record<string, unknown>>;
  }>;
  hooksBlock.UserPromptSubmit = upsList;

  for (const grp of upsList) {
    for (const hk of grp.hooks ?? []) {
      if (!JSON.stringify(hk).includes("orchestration-claude.js")) continue;
      const args = hk.args as unknown[] | undefined;
      const exact =
        hk.command === "node" &&
        Array.isArray(args) &&
        args.length === 1 &&
        args[0] === hookPath;
      if (exact) return { changed: false, status: "ok" };
      hk.type = "command";
      hk.command = "node";
      hk.args = [hookPath];
      return { changed: true, status: "repaired" };
    }
  }
  upsList.push({
    hooks: [{ type: "command", command: "node", args: [hookPath] }],
  });
  return { changed: true, status: "added" };
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
    const exact =
      cur.command === "node" &&
      Array.isArray(args) &&
      args.length === 1 &&
      args[0] === serverPath;
    if (exact) return { changed: false, status: "ok" };
  }
  servers["subagent-mcp"] = {
    type: "stdio",
    command: "node",
    args: [serverPath],
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
  if (m[0].includes(`args = ["${serverPath}"]`)) {
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
    "dist/hooks/orchestration-claude.js",
    "dist/hooks/orchestration-codex.js",
    "directives/orchestration-claude.md",
    "directives/orchestration-codex.md",
    "directives/off-turn-reminder.md",
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
  console.log(`  $ ${cmd} ${cmdArgs.join(" ")}`);
  if (DRY_RUN) {
    console.log("    (dry-run: skipped)");
    return true;
  }
  try {
    if (process.platform === "win32") {
      // npm-installed CLIs are .cmd shims execFileSync can't spawn directly.
      const line = [cmd, ...cmdArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
      execSync(line, { stdio: "pipe" });
    } else {
      execFileSync(cmd, cmdArgs, { stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
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
      `[node "${p.server}"] (use 'claude mcp add --scope user' or edit the mcpServers ` +
      `key in ~/.claude.json), and (2) ensure ~/.claude/settings.json has a ` +
      `hooks.UserPromptSubmit entry {type:"command", command:"node", args:["${p.claudeHook}"]}. ` +
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

function wireClaude(): void {
  console.log("\n--- Claude Code CLI ---");
  const p = serverPaths();
  const cjFile = join(homedir(), ".claude.json");

  // 1) MCP server (user scope). Reconcile against ~/.claude.json; prefer the
  //    official CLI for writes, fall back to a direct (schema-identical) edit.
  try {
    const cj = readJson(cjFile, {});
    const probe = JSON.parse(JSON.stringify(cj)) as JsonObj;
    const { status } = reconcileClaudeJson(probe, p.server);
    if (status === "ok") {
      describe("ok", "MCP server (user scope)");
    } else {
      if (status === "repaired") {
        console.log("  MCP server registration points at a stale path — re-registering.");
        runCmd("claude", ["mcp", "remove", "-s", "user", "subagent-mcp"]);
      }
      const cliOk = runCmd("claude", [
        "mcp", "add", "--scope", "user", "subagent-mcp", "--", "node", p.server,
      ]);
      // Read back; if the CLI failed or didn't take, write the entry directly.
      const after = readJson(cjFile, {});
      const verify = reconcileClaudeJson(after, p.server);
      if (verify.status !== "ok" && !DRY_RUN) {
        if (!cliOk) console.log("  'claude mcp add' failed — writing ~/.claude.json directly.");
        backup(cjFile);
        writeFileSync(cjFile, JSON.stringify(after, null, 2));
      }
      describe(status, "MCP server (user scope)");
    }
  } catch (e) {
    fail("claude", `could not register the MCP server: ${(e as Error).message}`);
  }

  // 2) UserPromptSubmit hook in ~/.claude/settings.json.
  try {
    const sfile = join(homedir(), ".claude", "settings.json");
    const s = readJson(sfile, {});
    const { changed, status } = reconcileClaudeSettings(s, p.claudeHook);
    if (changed && !DRY_RUN) {
      backup(sfile);
      writeFileSync(sfile, JSON.stringify(s, null, 2));
    }
    describe(status, "UserPromptSubmit hook");
    if (changed && DRY_RUN) console.log("    (dry-run: not written)");
  } catch (e) {
    fail("claude", `could not write the settings.json hook: ${(e as Error).message}`);
  }
}

function wireCodex(): void {
  console.log("\n--- Codex CLI ---");
  const p = serverPaths();
  const codexDir = join(homedir(), ".codex");

  // 1) config.toml — MCP server block (created if the file is missing).
  try {
    const cfg = join(codexDir, "config.toml");
    const toml = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
    const r = reconcileCodexToml(toml, p.server);
    if (r.changed && !DRY_RUN) {
      backup(cfg);
      writeFileSync(cfg, r.toml);
    }
    describe(r.status, toml === "" ? "config.toml (created) MCP server block" : "config.toml MCP server block");
    if (r.changed && DRY_RUN) console.log("    (dry-run: not written)");
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
// Read-back verification (also used by `subagent-mcp doctor`)
// ---------------------------------------------------------------------------

export interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

export function verifyWiring(root: string = INSTALL_ROOT): CheckResult[] {
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
  if (hasClaude) {
    const cj = readJson(join(home, ".claude.json"), {});
    const sj = readJson(join(home, ".claude", "settings.json"), {});
    const srv = reconcileClaudeJson(JSON.parse(JSON.stringify(cj)) as JsonObj, p.server);
    const hk = reconcileClaudeSettings(JSON.parse(JSON.stringify(sj)) as JsonObj, p.claudeHook);
    results.push({
      label: "claude: MCP server (user scope)",
      ok: srv.status === "ok",
      detail: srv.status === "ok" ? "registered" : `${srv.status === "repaired" ? "stale path" : "not registered"} — run: subagent-mcp setup`,
    });
    results.push({
      label: "claude: UserPromptSubmit hook",
      ok: hk.status === "ok",
      detail: hk.status === "ok" ? "wired" : `${hk.status === "repaired" ? "stale path" : "not wired"} — run: subagent-mcp setup`,
    });
  }

  const hasCodex = findOnPath("codex") !== null || existsSync(join(home, ".codex"));
  if (hasCodex) {
    const cfg = join(home, ".codex", "config.toml");
    const toml = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
    const tomlR = reconcileCodexToml(toml, p.server);
    const hj = readJson(join(home, ".codex", "hooks.json"), { hooks: {} });
    const hkR = reconcileCodexHooks(hj, `node "${p.codexHook}"`);
    results.push({
      label: "codex: config.toml MCP server block",
      ok: tomlR.status === "ok",
      detail: tomlR.status === "ok" ? "registered" : `${tomlR.status === "repaired" ? "stale path" : "not registered"} — run: subagent-mcp setup`,
    });
    const allOk = Object.values(hkR.statuses).every((s) => s === "ok");
    results.push({
      label: "codex: SessionStart + UserPromptSubmit hooks",
      ok: allOk,
      detail: allOk ? "wired (trust via /hooks in Codex)" : "incomplete — run: subagent-mcp setup",
    });
  }

  if (!hasClaude && !hasCodex) {
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
  if (major < 18) {
    console.error(`ERROR: Node ${process.versions.node} is too old — Node >= 18 required.`);
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

  // Read-back verification: report what is ACTUALLY on disk now.
  if (!DRY_RUN) {
    console.log("\n--- Verification (read-back) ---");
    for (const r of verifyWiring()) {
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
