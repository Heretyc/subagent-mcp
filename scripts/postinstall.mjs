#!/usr/bin/env node
// Postinstall banner for subagent-mcp. Best-effort by design:
// never fail npm install, never mutate vendor config.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLAUDE_HOOK_IDS = [
  "subagent-mcp-pretool",
  "subagent-mcp-orchestration-claude",
  "subagent-mcp-session-start",
];

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function has(cmd) {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function capture(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

export function hookIds(config) {
  const found = new Set();
  for (const groups of Object.values(config?.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (typeof hook?.id === "string") found.add(hook.id);
      }
    }
  }
  return found;
}

function hasCodexHook(config) {
  const events = config?.hooks ?? {};
  return ["SessionStart", "UserPromptSubmit"].every((event) =>
    (events[event] ?? []).some((group) =>
      (group.hooks ?? []).some((hook) => JSON.stringify(hook).includes("orchestration-codex.js"))
    )
  );
}

function existingDistIndex(path) {
  if (!path) return "";
  const p = resolve(path);
  const ok = p.endsWith("dist/index.js") || p.endsWith("dist\\index.js");
  return ok && existsSync(p) ? p : "";
}

function claudePathFromConfig(home, root) {
  const entry = readJson(join(home, ".claude.json"), {})?.mcpServers?.["subagent-mcp"];
  const args = Array.isArray(entry?.args) ? entry.args : [];
  const argPath = args.find((a) => typeof a === "string" && /dist[\\/]index\.js$/.test(a));
  if (argPath) return existingDistIndex(argPath);
  if (entry?.command === "subagent-mcp") return existingDistIndex(join(root, "dist", "index.js"));
  if (typeof entry?.command === "string" && /dist[\\/]index\.js$/.test(entry.command)) {
    return existingDistIndex(entry.command);
  }
  return "";
}

function claudePathFromCli() {
  const m = capture("claude mcp list").match(
    /subagent-mcp[\s\S]{0,240}?([A-Za-z]:[^\r\n"']*dist[\\/]index\.js|\/[^\r\n"']*dist\/index\.js)/
  );
  return m ? existingDistIndex(m[1].trim()) : "";
}

function codexPathFromConfig(home) {
  const cfg = join(home, ".codex", "config.toml");
  const text = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
  const block = text.match(/\[mcp_servers\.subagent-mcp\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  const m = block.match(/args\s*=\s*\[[^\]]*["']([^"']*dist[\\/]index\.js)["']/);
  return m ? existingDistIndex(m[1]) : "";
}

function manifestHooksPresent(root, vendor) {
  if (vendor === "claude") {
    const plugin = readJson(join(root, ".claude-plugin", "plugin.json"), {});
    const hooks = readJson(resolve(root, plugin?.hooks ?? ""), {});
    const ids = hookIds(hooks);
    return CLAUDE_HOOK_IDS.every((id) => ids.has(id));
  }
  const plugin = readJson(join(root, ".codex-plugin", "plugin.json"), {});
  const hooks = readJson(resolve(root, plugin?.hooks ?? ""), {});
  return hasCodexHook(hooks);
}

export function verificationRows({ root, home = homedir() }) {
  const rows = [];
  const claudePath = claudePathFromConfig(home, root) || claudePathFromCli();
  const claudeIds = hookIds(readJson(join(home, ".claude", "settings.json"), {}));
  const claudeUserHooks = CLAUDE_HOOK_IDS.slice(0, 2).every((id) => claudeIds.has(id));
  const claudePlugin = manifestHooksPresent(root, "claude");
  rows.push({
    vendor: "Claude",
    ok: Boolean(claudePath) && (claudeUserHooks || claudePlugin),
    detail: claudePath
      ? `server=${claudePath}; hooks=${claudeUserHooks ? "user-config" : claudePlugin ? "plugin-manifest" : "missing"}`
      : "server missing from ~/.claude.json and claude mcp list",
  });

  const codexPath = codexPathFromConfig(home);
  const codexUserHooks = hasCodexHook(readJson(join(home, ".codex", "hooks.json"), {}));
  const codexPlugin = manifestHooksPresent(root, "codex");
  const codexPresent = existsSync(join(home, ".codex")) || has("codex") || codexPath || codexUserHooks || codexPlugin;
  rows.push({
    vendor: "Codex",
    ok: codexPresent && (codexPath || codexPlugin) && (codexUserHooks || codexPlugin),
    detail: codexPresent
      ? `server=${codexPath || (codexPlugin ? "plugin-manifest" : "missing")}; hooks=${codexUserHooks ? "user-config" : codexPlugin ? "plugin-manifest" : "missing"}`
      : "not detected",
  });
  return rows;
}

export function verificationSummary(options) {
  const rows = verificationRows(options);
  const width = Math.max("Vendor".length, ...rows.map((r) => r.vendor.length));
  const lines = ["  INSTALL VERIFICATION", "", `  ${"Vendor".padEnd(width)}  Status  Detail`];
  for (const row of rows) {
    lines.push(`  ${row.vendor.padEnd(width)}  ${row.ok ? "PASS" : "FAIL"}    ${row.detail}`);
  }
  if (rows.some((r) => !r.ok)) {
    lines.push("");
    lines.push("  Guidance: inspect ~/.claude.json, ~/.claude/settings.json, ~/.codex/config.toml, and ~/.codex/hooks.json.");
    lines.push("  Then run: subagent-mcp doctor");
  }
  return { rows, text: lines.join("\n") };
}

export function banner({ root, home = homedir() }) {
  const version = readJson(join(root, "package.json"), {})?.version ?? "";
  const hasClaude = has("claude");
  const hasCodex = has("codex") || existsSync(join(home, ".codex"));
  const L = [];
  const line = (s = "") => L.push(s);
  const bar = "============================================================";

  line();
  line(bar);
  line(`  subagent-mcp installed${version ? `  (v${version})` : ""}`);
  line(bar);
  line();
  line("  This is an MCP ADDON for Claude Code CLI and Codex CLI.");
  line("  It is NOT active yet; one command wires it in.");
  line();
  line("  FINISH SETUP  (auto-detects vendors, wires all present):");
  line();
  line("      subagent-mcp setup");
  line();
  line("  That registers the MCP server AND installs the per-turn");
  line("  orchestration-mode hooks for every vendor it finds.");
  line();

  if (hasClaude || hasCodex) {
    line("  Detected on this machine:");
    if (hasClaude) line("    - Claude Code CLI  (will get MCP server + UserPromptSubmit/PreToolUse hooks)");
    if (hasCodex) line("    - Codex CLI        (will get MCP server + SessionStart/UserPromptSubmit hooks)");
  } else {
    line("  No Claude Code or Codex CLI detected yet. Install one,");
    line("  then run:  subagent-mcp setup");
  }
  line();

  line("  AFTER setup; confirm it took effect:");
  if (hasClaude || !hasCodex) {
    line("    - Claude Code: restart the session, run /mcp");
    line("        -> 'subagent-mcp' shows Connected.");
  }
  if (hasCodex || !hasClaude) {
    line("    - Codex CLI:   restart the session, run /hooks");
    line("        -> TRUST the new subagent-mcp hook.");
  }
  line();
  line("  Preview without changes:   subagent-mcp setup --dry-run");
  line("  Health check any time:     subagent-mcp doctor");
  line("  Docs:  https://github.com/Heretyc/subagent-mcp#readme");
  line();
  line(verificationSummary({ root, home }).text);
  line(bar);
  line();
  return L.join("\n") + "\n";
}

export async function main() {
  try {
    const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    if (existsSync(join(root, "src"))) return;
    try {
      const { ensureFirstRunPermissionCeiling } = await import(
        pathToFileURL(join(root, "dist", "concurrency.js")).href
      );
      await ensureFirstRunPermissionCeiling({ log: (line) => process.stdout.write(`${line}\n`) });
    } catch {}
    process.stdout.write(banner({ root }));
  } catch {
    // Never let a banner failure break the install.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
  process.exit(0);
}
