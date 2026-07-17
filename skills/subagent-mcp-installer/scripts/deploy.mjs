import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, realpathSync, unlinkSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";

// subagent-mcp standalone deployer. Zero-dependency ESM (Node >= 20).
// Builds a DECOUPLED copy of the addon and installs it to the PERMANENT global
// npm location, then prints (and optionally wires) the standards-compliant
// vendor config. Hard-refuses to install from a worktree/temp/Downloads source.
// Compliance basis: skills/subagent-mcp-installer/references/compliance.md.
//
// Usage:
//   node deploy.mjs --source <permanent-repo-path> [--wire-claude] [--wire-codex]
// Default --source is cwd. Omit wire flags for a print-only dry run.

const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function opt(name, def) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; }

const SOURCE = resolve(opt("--source", process.cwd()));
const WIRE_CLAUDE = flag("--wire-claude");
const WIRE_CODEX = flag("--wire-codex");
const CONFIG_FILE = "global-subagent-mcp-config.jsonc";
const LEGACY_CONFIG_FILE = "global-concurrency.jsonc";
const PACKAGE_NAME_RE = /^@?[a-z0-9-~][a-z0-9-._~/]*$/;
const PACKAGE_VERSION_RE = /^[0-9]+[0-9A-Za-z.+~-]*(?:-[0-9A-Za-z.+~-]+)?$/;

function die(msg) { console.error(`deploy: ${msg}`); process.exit(1); }
function realOrSelf(p) { try { return realpathSync(p); } catch { return resolve(p); } }
function norm(p) { const r = realOrSelf(p).split("\\").join("/"); return process.platform === "win32" ? r.toLowerCase() : r; }
export function quoteWinCmdArg(arg) {
  return `"${String(arg).replace(/"/g, '""').replace(/[&|^<>%]/g, "^$&")}"`;
}

function runViaCmdExe(cmd, cmdArgs, cwd, opts) {
  const comspec = process.env.ComSpec || "cmd.exe";
  const resolved = resolveWinExecutable(cmd, cwd);
  if (!resolved) throw Object.assign(new Error(`executable not found: ${cmd}`), { code: "ENOENT" });
  const line = [resolved, ...cmdArgs].map(quoteWinCmdArg).join(" ");
  return execFileSync(comspec, ["/d", "/s", "/c", `"${line}"`], { ...opts, cwd });
}

function resolveWinExecutable(cmd, cwd) {
  if (/[\\/]/.test(cmd) || /\.[A-Za-z0-9]+$/.test(cmd)) return cmd;
  try {
    const found = execFileSync("where.exe", [cmd], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return found[0] || null;
  } catch {
    return null;
  }
}

export function resolveCmdShimNodeScript(cmdPath) {
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

export function validatePackageMetadata(pkg) {
  if (!PACKAGE_NAME_RE.test(pkg?.name || "")) die(`invalid package name: ${pkg?.name || ""}`);
  if (!PACKAGE_VERSION_RE.test(pkg?.version || "")) die(`invalid package version: ${pkg?.version || ""}`);
}

// --- Forbidden-location guard (references/locations.md) -------------------
function forbiddenReason(p) {
  const n = norm(p);
  const segs = n.split("/").filter(Boolean);
  if (segs.some((s) => s.endsWith(".worktrees")) || n.includes(".worktrees/")) return "git worktree (*.worktrees)";
  if (segs.some((s) => /^(temp|tmp)$/i.test(s))) return "temp/tmp path segment";
  if (segs.some((s) => s === "downloads")) return "Downloads folder";
  const t = norm(tmpdir());
  if (n === t || n.startsWith(t + "/")) return `OS temp dir (${tmpdir()})`;
  // Linked git worktree: per-worktree gitdir differs from the shared common dir.
  try {
    const gitOpt = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const gitDir = norm(execFileSync("git", ["-C", p, "rev-parse", "--absolute-git-dir"], gitOpt).trim());
    // --git-common-dir may be relative to the source dir (p), not the script cwd.
    const commonRaw = execFileSync("git", ["-C", p, "rev-parse", "--git-common-dir"], gitOpt).trim();
    const common = norm(resolve(p, commonRaw));
    if (gitDir && common && gitDir !== common) return "linked git worktree (gitdir != common dir)";
  } catch { /* not a git repo / git absent — other checks still apply */ }
  return null;
}

// --- Locate the addon root under the source -------------------------------
// The deploy script ships inside the package at skills/subagent-mcp-installer/scripts/,
// but --source is the addon root (package.json name "@heretyc/subagent-mcp",
// or legacy unscoped "subagent-mcp").
function addonRoot() {
  for (const cand of [SOURCE, resolve(SOURCE, "../../..")]) {
    const pj = join(cand, "package.json");
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, "utf8"));
        if (j.name === "subagent-mcp" || j.name === "@heretyc/subagent-mcp") return { root: cand, pkg: j };
      } catch { /* ignore */ }
    }
  }
  die(`no subagent-mcp package.json found at or above --source (${SOURCE})`);
}

export function run(cmd, cmdArgs, cwd) {
  console.error(`  $ ${cmd} ${cmdArgs.join(" ")}`);
  const stdio = ["ignore", "pipe", "inherit"];
  const opts = { cwd, encoding: "utf8", stdio, shell: false };
  const exe = process.platform === "win32" ? (resolveWinExecutable(cmd, cwd) || cmd) : cmd;
  const isWinCmdShim = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(exe);
  if (isWinCmdShim) {
    const js = resolveCmdShimNodeScript(exe);
    if (js) return execFileSync(process.execPath, [js, ...cmdArgs], opts);
  }
  try {
    return execFileSync(exe, cmdArgs, opts);
  } catch (e) {
    const mayNeedCmdExe = process.platform === "win32" && ["ENOENT", "EINVAL", "UNKNOWN"].includes(e.code);
    if (!mayNeedCmdExe) throw e;
    return runViaCmdExe(exe, cmdArgs, cwd, { encoding: "utf8", stdio, shell: false });
  }
}

// --- Build + pack + global install ----------------------------------------
function deploy(root, pkg) {
  validatePackageMetadata(pkg);
  console.error(`==> build (${root})`);
  run("npm", ["run", "build"], root);

  console.error("==> pack (decoupled tarball)");
  run("npm", ["pack"], root);
  // Scoped packages: @scope/name → scope-name-<ver>.tgz (npm strips @ and replaces / with -)
  const tarballBase = pkg.name.replace(/^@/, "").replace(/\//, "-");
  const tarball = join(root, `${tarballBase}-${pkg.version}.tgz`);
  if (!existsSync(tarball)) die(`expected tarball not found: ${tarball}`);

  // Resolve the prospective install root BEFORE installing: npm install -g
  // replaces the package dir in place, so user-edited retained config files
  // must be snapshotted now or they are gone with the old dir.
  const gRoot = run("npm", ["root", "-g"], root).trim();
  // Scoped packages install under <gRoot>/@scope/name, unscoped under <gRoot>/name.
  // Derive from pkg.name so the install root matches npm's real layout either way.
  const install = join(gRoot, ...pkg.name.split("/"));
  const live = join(install, "dist", "advanced-ruleset.py");
  let userRuleset = null;
  if (existsSync(live)) {
    userRuleset = readFileSync(live, "utf8");
    const snap = join(tmpdir(), `advanced-ruleset.py.bak-deploy-${Date.now()}`);
    try { writeFileSync(snap, userRuleset); console.error(`  backed up user advanced-ruleset.py -> ${snap}`); } catch { /* in-memory copy still restores */ }
  }
  const configLive = join(install, "dist", CONFIG_FILE);
  const legacyConfigLive = join(install, "dist", LEGACY_CONFIG_FILE);
  const configSnapshotPath = existsSync(configLive) ? configLive : legacyConfigLive;
  let userConfig = null;
  if (existsSync(configSnapshotPath)) {
    userConfig = readFileSync(configSnapshotPath, "utf8");
    const configSnapshotName = configSnapshotPath === configLive ? CONFIG_FILE : LEGACY_CONFIG_FILE;
    const snap = join(tmpdir(), `${configSnapshotName}.bak-deploy-${Date.now()}`);
    try { writeFileSync(snap, userConfig); console.error(`  backed up user ${configSnapshotName} -> ${snap}`); } catch { /* in-memory copy still restores */ }
  }

  console.error("==> global install");
  run("npm", ["install", "-g", tarball], root);
  try { unlinkSync(tarball); } catch { /* leave if locked */ }

  const t = forbiddenReason(install);
  if (t) die(`global install root is a forbidden location (${t}): ${install}`);

  if (userRuleset !== null) {
    const shipped = existsSync(live) ? readFileSync(live, "utf8") : null;
    if (shipped === userRuleset) {
      console.error("  advanced-ruleset.py unchanged — left as-is");
    } else {
      writeFileSync(live, userRuleset);
      console.error("  restored user advanced-ruleset.py (package update never overwrites user edits)");
    }
  }
  if (userConfig !== null) {
    const restoreConfigPath = existsSync(configLive) ? configLive : legacyConfigLive;
    const restoreConfigName = restoreConfigPath === configLive ? CONFIG_FILE : LEGACY_CONFIG_FILE;
    const shipped = existsSync(restoreConfigPath) ? readFileSync(restoreConfigPath, "utf8") : null;
    if (shipped === userConfig) {
      console.error(`  ${restoreConfigName} unchanged — left as-is`);
    } else {
      writeFileSync(restoreConfigPath, userConfig);
      console.error(`  restored user ${restoreConfigName} (package update never overwrites user edits)`);
    }
  }
  return install;
}

// --- Verify every shipped part --------------------------------------------
function verify(install) {
  const need = [
    "dist/index.js",
    "dist/hooks/orchestration-claude.js",
    "dist/hooks/orchestration-claude-pretool.js",
    "dist/hooks/statusline-claude.js",
    "dist/hooks/orchestration-codex.js",
    "dist/advanced-ruleset.py",
    "dist/global-subagent-mcp-config.jsonc",
    "directives/carryover-claude.md",
    "directives/carryover-codex.md",
    "directives/orchestration-claude.md",
    "directives/orchestration-codex.md",
    "directives/short-on.md",
    "directives/short-off.md",
    "directives/reminder-on.md",
    "directives/reminder-off-claude.md",
    "directives/reminder-off-codex.md",
    "skills/smcp-handoff/SKILL.md",
    "node_modules/@modelcontextprotocol/sdk/package.json",
    "node_modules/zod/package.json",
  ];
  const missing = need.filter((f) => !existsSync(join(install, ...f.split("/"))));
  if (
    missing.includes("dist/global-subagent-mcp-config.jsonc") &&
    existsSync(join(install, "dist", "global-concurrency.jsonc"))
  ) {
    missing.splice(missing.indexOf("dist/global-subagent-mcp-config.jsonc"), 1);
  }
  if (missing.length) die(`install incomplete, missing:\n  - ${missing.join("\n  - ")}`);
  console.error("==> verified: all parts present");
}

// --- Config emission (forward-slash absolute paths) -----------------------
function paths(install) {
  const fwd = install.split("\\").join("/");
  return {
    server: `${fwd}/dist/index.js`,
    claudeHook: `${fwd}/dist/hooks/orchestration-claude.js`,
    claudePreToolHook: `${fwd}/dist/hooks/orchestration-claude-pretool.js`,
    claudeStatuslineHook: `${fwd}/dist/hooks/statusline-claude.js`,
    codexHook: `${fwd}/dist/hooks/orchestration-codex.js`,
  };
}

function printConfig(install) {
  const p = paths(install);
  console.log(`\n# Install root: ${install}\n`);
  console.log("## Claude Code (CLI)");
  console.log(`claude mcp add --scope user subagent-mcp -- node "${p.server}"`);
  console.log(`# ~/.claude/settings.json -> hooks.UserPromptSubmit[].hooks[]:`);
  console.log(JSON.stringify({ type: "command", command: "node", args: [p.claudeHook] }, null, 2));
  console.log(`# ~/.claude/settings.json -> hooks.PreToolUse[].hooks[]:`);
  console.log(JSON.stringify({ type: "command", command: "node", args: [p.claudePreToolHook], timeout: 5 }, null, 2));
  console.log(`# ~/.claude/settings.json -> statusLine:`);
  console.log(JSON.stringify({ type: "command", command: `node "${p.claudeStatuslineHook}"` }, null, 2));
  console.log("\n## Codex CLI");
  console.log(`# ~/.codex/config.toml`);
  console.log(`[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["${p.server}"]\nstartup_timeout_sec = 10\ntool_timeout_sec = 60`);
  console.log(`# ~/.codex/hooks.json -> SessionStart & UserPromptSubmit hook:`);
  console.log(JSON.stringify({ type: "command", command: `node "${p.codexHook}"`, commandWindows: `node "${p.codexHook}"`, timeout: 10 }, null, 2));
}

// --- Optional wiring (idempotent, backs up before edit) -------------------
function backup(file) { const b = `${file}.bak-deploy-${Date.now()}`; try { copyFileSync(file, b); console.error(`  backed up -> ${b}`); } catch { /* new file */ } }
function readJson(file, def) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return def; } }
function statuslineCommand(shimPath, innerCommand = "") {
  const inner = String(innerCommand).trim();
  return `node "${shimPath}"${inner ? ` ${quoteStatuslineInnerArg(inner)}` : ""}`;
}
function quoteStatuslineInnerArg(command) {
  if (process.platform === "win32") {
    return JSON.stringify(command);
  }
  return `'${String(command).replace(/'/g, "'\\''")}'`;
}
function extractStatuslineInner(command) {
  const marker = "statusline-claude.js";
  const idx = String(command).indexOf(marker);
  if (idx < 0) return null;
  let restStart = idx + marker.length;
  if (command[restStart] === "\"") restStart++;
  const rest = command.slice(restStart).trim();
  return unquoteStatuslineInnerArg(rest);
}
function unquoteStatuslineInnerArg(arg) {
  if (!arg) return arg;
  if (process.platform === "win32" && arg.startsWith("\"")) {
    try {
      const parsed = JSON.parse(arg);
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
function reconcileStatusLine(settings, shimPath) {
  const current = settings.statusLine;
  const currentCommand =
    current && typeof current === "object" && !Array.isArray(current) && typeof current.command === "string"
      ? current.command
      : typeof current === "string"
        ? current
        : null;
  const inner = currentCommand !== null ? extractStatuslineInner(currentCommand) : null;
  const desired = { type: "command", command: statuslineCommand(shimPath, inner ?? currentCommand ?? "") };
  if (
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    current.type === desired.type &&
    current.command === desired.command
  ) {
    return false;
  }
  settings.statusLine = desired;
  return true;
}

function wireClaude(install) {
  const p = paths(install);
  console.error("==> wire Claude (official CLI + settings.json hook)");
  try {
    run("claude", ["mcp", "add", "--scope", "user", "subagent-mcp", "--", "node", p.server], install);
  } catch (e) { console.error(`  note: 'claude mcp add' failed (claude missing or already present): ${e.message?.split("\n")[0]}`); }
  const sfile = join(homedir(), ".claude", "settings.json");
  const s = readJson(sfile, {});
  s.hooks = s.hooks || {};
  const ups = (s.hooks.UserPromptSubmit = s.hooks.UserPromptSubmit || []);
  const pre = (s.hooks.PreToolUse = s.hooks.PreToolUse || []);
  let changed = false;
  if (!JSON.stringify(ups).includes("orchestration-claude.js")) {
    ups.push({ hooks: [{ type: "command", command: "node", args: [p.claudeHook] }] });
    changed = true;
  }
  if (!JSON.stringify(pre).includes("orchestration-claude-pretool.js")) {
    pre.push({ matcher: "*", hooks: [{ type: "command", command: "node", args: [p.claudePreToolHook], timeout: 5 }] });
    changed = true;
  }
  if (reconcileStatusLine(s, p.claudeStatuslineHook)) changed = true;
  if (!changed) {
    console.error("  settings.json hooks already present - left as-is");
  } else {
    mkdirSync(dirname(sfile), { recursive: true });
    if (existsSync(sfile)) backup(sfile);
    writeFileSync(sfile, JSON.stringify(s, null, 2));
    console.error(`  added/updated Claude hooks -> ${sfile}`);
  }

  const source = join(install, "skills", "smcp-handoff", "SKILL.md");
  const target = join(homedir(), ".claude", "skills", "smcp-handoff", "SKILL.md");
  if (!existsSync(source)) {
    console.error(`  smcp-handoff skill source missing -> ${source}`);
  } else {
    const body = readFileSync(source, "utf8");
    if (existsSync(target) && readFileSync(target, "utf8") === body) {
      console.error("  smcp-handoff skill already present - left as-is");
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
      console.error(`  deployed smcp-handoff skill -> ${target}`);
    }
  }
}

function wireCodex(install) {
  const p = paths(install);
  // Codex has no Agent Skill mechanism; MCP instructions carry handoff guidance.
  console.error("==> wire Codex (config.toml block + hooks.json)");
  const cfg = join(homedir(), ".codex", "config.toml");
  if (existsSync(cfg)) {
    const toml = readFileSync(cfg, "utf8");
    if (toml.includes("[mcp_servers.subagent-mcp]")) {
      console.error("  [mcp_servers.subagent-mcp] already in config.toml — verify path manually; left as-is");
    } else {
      backup(cfg);
      const block = `\n[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["${p.server}"]\nstartup_timeout_sec = 10\ntool_timeout_sec = 60\n`;
      writeFileSync(cfg, toml + block);
      console.error(`  appended [mcp_servers.subagent-mcp] -> ${cfg}`);
    }
  } else {
    console.error(`  ${cfg} not found — create it with the [mcp_servers.subagent-mcp] block printed above`);
  }
  const hfile = join(homedir(), ".codex", "hooks.json");
  const h = readJson(hfile, {});
  h.hooks = h.hooks || {};
  const entry = { type: "command", command: `node "${p.codexHook}"`, commandWindows: `node "${p.codexHook}"`, timeout: 10 };
  let changed = false;
  for (const ev of ["SessionStart", "UserPromptSubmit"]) {
    h.hooks[ev] = h.hooks[ev] || [];
    if (JSON.stringify(h.hooks[ev]).includes("orchestration-codex.js")) continue;
    h.hooks[ev].push({ hooks: [entry] });
    changed = true;
  }
  if (!changed) { console.error("  hooks.json already references orchestration-codex.js — left as-is"); return; }
  if (existsSync(hfile)) backup(hfile);
  writeFileSync(hfile, JSON.stringify(h, null, 2));
  console.error(`  wrote SessionStart + UserPromptSubmit hooks -> ${hfile}`);
  console.error("  REMINDER: run 'codex' -> /hooks and TRUST the new hook (hash changed).");
}

// --- Main -----------------------------------------------------------------
function main() {
  const reason = forbiddenReason(SOURCE);
  if (reason) die(`refusing to install from a forbidden source location (${reason}): ${SOURCE}\n` +
    `Clone to a permanent path and re-run (see references/locations.md).`);

  const { root, pkg } = addonRoot();
  const install = deploy(root, pkg);
  verify(install);
  printConfig(install);
  if (WIRE_CLAUDE) wireClaude(install);
  if (WIRE_CODEX) wireCodex(install);
  console.error(`\n==> done. Install root: ${install}`);
  if (!WIRE_CLAUDE && !WIRE_CODEX) console.error("(print-only; pass --wire-claude / --wire-codex to apply, or wire by hand from references/)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
