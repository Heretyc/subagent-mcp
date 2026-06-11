#!/usr/bin/env node
// Postinstall banner for subagent-mcp.
//
// `npm install -g @heretyc/subagent-mcp` ships only the MCP server + hook
// assets; it does NOT wire them into Claude Code / Codex. Without feedback the
// user has no idea an addon landed, let alone that a second step is required.
// This prints a clear "what installed / what to run next / how to verify"
// banner so the install is self-explanatory.
//
// Rules:
//   - NEVER fail the install. Any error is swallowed; always exit 0.
//   - Only speak for a real end-user install. In the dev checkout (src/ present)
//     stay silent so `npm install` during development isn't noisy.
//   - Print only — do not mutate vendor config. Wiring is the explicit,
//     reversible `subagent-mcp setup` step.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

try {
  // Install root: scripts/postinstall.mjs -> scripts/ -> <root>
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  // Dev checkout? (src/ only exists in the repo, never in the shipped tarball.)
  // Stay silent there — the maintainer doesn't need the end-user banner.
  if (existsSync(join(ROOT, "src"))) process.exit(0);

  let version = "";
  try {
    version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version || "";
  } catch { /* version is cosmetic */ }

  // Best-effort vendor detection so the banner can say what WILL be wired.
  // Pure read-only; failures just fall back to "not detected".
  function has(cmd) {
    try {
      execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
  const hasClaude = has("claude");
  const hasCodex = has("codex") || existsSync(join(homedir(), ".codex"));

  const L = [];
  const line = (s = "") => L.push(s);
  const bar = "============================================================";

  line();
  line(bar);
  line(`  subagent-mcp installed${version ? `  (v${version})` : ""}`);
  line(bar);
  line();
  line("  This is an MCP ADDON for Claude Code CLI and Codex CLI.");
  line("  It is NOT active yet — one command wires it in.");
  line();
  line("  FINISH SETUP  (auto-detects vendors, wires all present):");
  line();
  line("      subagent-mcp setup");
  line();
  line("  That registers the MCP server AND installs the per-turn");
  line("  orchestration-mode hooks for every vendor it finds.");
  line();

  // Detected vendors — concrete, so the user knows what setup will touch.
  if (hasClaude || hasCodex) {
    line("  Detected on this machine:");
    if (hasClaude) line("    - Claude Code CLI  (will get MCP server + UserPromptSubmit hook)");
    if (hasCodex) line("    - Codex CLI        (will get MCP server + SessionStart/UserPromptSubmit hooks)");
  } else {
    line("  No Claude Code or Codex CLI detected yet. Install one,");
    line("  then run:  subagent-mcp setup");
  }
  line();

  line("  AFTER setup — confirm it took effect:");
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
  line(bar);
  line();

  process.stdout.write(L.join("\n") + "\n");
} catch {
  // Never let a banner failure break the install.
}
process.exit(0);
