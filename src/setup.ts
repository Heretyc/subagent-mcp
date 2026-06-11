#!/usr/bin/env node
// Setup CLI for the globally-installed subagent-mcp addon.
// Wires Claude Code CLI and Codex CLI with the MCP server + orchestration-mode hook.
// Run after: npm install -g subagent-mcp
//
// Usage:
//   subagent-mcp setup              -- auto-detect vendors, wire all present
//   subagent-mcp setup --dry-run    -- print config, make no changes

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

function fwd(p: string): string {
  return p.split("\\").join("/");
}

function serverPaths() {
  const f = fwd(INSTALL_ROOT);
  return {
    server: `${f}/dist/index.js`,
    claudeHook: `${f}/dist/hooks/orchestration-claude.js`,
    codexHook: `${f}/dist/hooks/orchestration-codex.js`,
  };
}

function verifyInstall(): void {
  const required = [
    "dist/index.js",
    "dist/hooks/orchestration-claude.js",
    "dist/hooks/orchestration-codex.js",
    "dist/advanced-ruleset.py",
    "directives/orchestration-claude.md",
    "directives/orchestration-codex.md",
  ];
  const missing = required.filter(
    (f) => !existsSync(join(INSTALL_ROOT, ...f.split("/")))
  );
  if (missing.length > 0) {
    console.error(
      `ERROR: install is incomplete — missing:\n  - ${missing.join("\n  - ")}`
    );
    console.error("Re-install: npm install -g subagent-mcp");
    process.exit(1);
  }
}

function hasCommand(cmd: string): boolean {
  try {
    if (process.platform === "win32") {
      execSync(`where ${cmd}`, { stdio: "ignore" });
    } else {
      execFileSync("which", [cmd], { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

type JsonObj = Record<string, unknown>;

function readJson(file: string, fallback: JsonObj): JsonObj {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
  } catch {
    return { ...fallback };
  }
}

function backup(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    copyFileSync(file, `${file}.bak-setup-${stamp}`);
  } catch { /* ignore */ }
}

function runCmd(cmd: string, cmdArgs: string[], cwd?: string): boolean {
  console.log(`  $ ${cmd} ${cmdArgs.join(" ")}`);
  if (DRY_RUN) {
    console.log("    (dry-run: skipped)");
    return true;
  }
  try {
    if (process.platform === "win32") {
      const line = [cmd, ...cmdArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
      execSync(line, { cwd, stdio: "inherit" });
    } else {
      execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
    }
    return true;
  } catch {
    return false;
  }
}

function wireClaude(): void {
  console.log("\n--- Claude Code CLI ---");
  const p = serverPaths();

  console.log("Registering MCP server (user scope)...");
  const ok = runCmd("claude", [
    "mcp", "add", "--scope", "user", "subagent-mcp", "--", "node", p.server,
  ]);
  if (!ok) {
    console.log(
      "  note: 'claude mcp add' failed — may already be registered.\n" +
      "  Verify with: claude mcp list"
    );
  }

  const sfile = join(homedir(), ".claude", "settings.json");
  const hookEntry = { type: "command", command: "node", args: [p.claudeHook] };
  const s = readJson(sfile, {});

  const hooksBlock = (s.hooks ?? {}) as JsonObj;
  s.hooks = hooksBlock;
  const upsList = (hooksBlock.UserPromptSubmit ?? []) as Array<{ hooks: unknown[] }>;
  hooksBlock.UserPromptSubmit = upsList;

  if (JSON.stringify(upsList).includes("orchestration-claude.js")) {
    console.log("  UserPromptSubmit hook already present — left as-is.");
  } else {
    console.log(`Writing UserPromptSubmit hook -> ${sfile}`);
    if (!DRY_RUN) {
      backup(sfile);
      upsList.push({ hooks: [hookEntry] });
      writeFileSync(sfile, JSON.stringify(s, null, 2));
    } else {
      console.log("  (dry-run: skipped)");
    }
    console.log("  Done.");
  }
}

function wireCodex(): void {
  console.log("\n--- Codex CLI ---");
  const p = serverPaths();
  const codexDir = join(homedir(), ".codex");

  // config.toml — MCP server block
  const cfg = join(codexDir, "config.toml");
  if (existsSync(cfg)) {
    const toml = readFileSync(cfg, "utf8");
    if (toml.includes("[mcp_servers.subagent-mcp]")) {
      console.log("  [mcp_servers.subagent-mcp] already in config.toml — left as-is.");
    } else {
      const block =
        `\n[mcp_servers.subagent-mcp]\n` +
        `command = "node"\n` +
        `args = ["${fwd(p.server)}"]\n` +
        `startup_timeout_sec = 10\n` +
        `tool_timeout_sec = 60\n`;
      console.log(`Writing MCP server block -> ${cfg}`);
      if (!DRY_RUN) {
        backup(cfg);
        writeFileSync(cfg, toml + block);
      } else {
        console.log("  (dry-run: skipped)");
      }
      console.log("  Done.");
    }
  } else {
    console.log(`  ${cfg} not found — add this block manually:`);
    console.log(
      `  [mcp_servers.subagent-mcp]\n` +
      `  command = "node"\n` +
      `  args = ["${fwd(p.server)}"]\n` +
      `  startup_timeout_sec = 10\n` +
      `  tool_timeout_sec = 60`
    );
  }

  // hooks.json — SessionStart + UserPromptSubmit hooks
  const hfile = join(codexDir, "hooks.json");
  const h = readJson(hfile, { hooks: {} });
  const hooksBlock = (h.hooks ?? {}) as Record<string, Array<{ hooks: unknown[] }>>;
  h.hooks = hooksBlock;

  const hookCmd = `node "${fwd(p.codexHook)}"`;
  const entry = {
    type: "command",
    command: hookCmd,
    commandWindows: hookCmd,
    timeout: 10,
  };

  let changed = false;
  for (const ev of ["SessionStart", "UserPromptSubmit"]) {
    const evList = (hooksBlock[ev] = hooksBlock[ev] ?? []);
    if (JSON.stringify(evList).includes("orchestration-codex.js")) continue;
    evList.push({ hooks: [entry] });
    changed = true;
  }

  if (!changed) {
    console.log("  hooks.json already references orchestration-codex.js — left as-is.");
  } else {
    console.log(`Writing SessionStart + UserPromptSubmit hooks -> ${hfile}`);
    if (!DRY_RUN) {
      backup(hfile);
      writeFileSync(hfile, JSON.stringify(h, null, 2));
    } else {
      console.log("  (dry-run: skipped)");
    }
    console.log("  Done.");
    console.log("  REMINDER: run 'codex', then /hooks and TRUST the new hook.");
  }
}

export async function runSetup(): Promise<void> {
  console.log(`subagent-mcp setup${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`Install root: ${INSTALL_ROOT}\n`);

  verifyInstall();

  const hasClaude = hasCommand("claude");
  const hasCodex = hasCommand("codex") || existsSync(join(homedir(), ".codex"));

  if (!hasClaude && !hasCodex) {
    console.log(
      "No supported vendors found (neither 'claude' nor 'codex' on PATH, " +
      "and ~/.codex does not exist).\n" +
      "Install Claude Code CLI or Codex CLI first, then re-run."
    );
    process.exit(1);
  }

  if (hasClaude) {
    wireClaude();
  } else {
    console.log("\nSkipping Claude Code (not on PATH).");
  }

  if (hasCodex) {
    wireCodex();
  } else {
    console.log("\nSkipping Codex CLI (not detected).");
  }

  console.log("\n=== Setup complete ===");
  if (hasClaude) {
    console.log("Claude Code: restart your session to activate the MCP server and hook.");
  }
  if (hasCodex) {
    console.log("Codex CLI:   restart your session and run /hooks to trust the new hook.");
  }
}
