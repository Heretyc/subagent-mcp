/**
 * windowed-deny-canary.test.mjs - live host canary for the windowed-doctrine
 * deny toggle. Everything here exercises the REAL `claude` host decision, not
 * this repo's hook JSON, so the two facts the unit suites cannot pin are
 * pinned end to end:
 *
 *   1. A PreToolUse `allow` does NOT beat a settings `permissions.deny` rule
 *      (it only skips the interactive prompt), so a hook counter-decision can
 *      never implement the dormant OFF state.
 *   2. Removing the deny rule - the configure toggle's mechanism - is what
 *      actually unblocks the tool at the host level.
 *
 * The toggle's own file contract (confirmation flow, surgical removal,
 * backups, restore) is pinned by the always-run unit suite in
 * test/configure.test.mjs; this file adds only the live-host evidence.
 *
 * SAFETY CONTRACT: opt-in only. The suite SKIPs (exit 0) unless
 * SUBAGENT_MCP_LIVE_DENY_CANARY=1 AND a `claude` CLI is resolvable on PATH.
 * Every spawn runs against a throwaway HOME/CLAUDE_CONFIG_DIR created by this
 * file and removed in finally; the user's real configuration is never read or
 * written. Runs cost real model tokens (haiku, bounded turns).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "../dist/setup.js";

const OPTED_IN = process.env.SUBAGENT_MCP_LIVE_DENY_CANARY === "1";
const CLAUDE_EXE = findOnPath("claude", process.env);

if (!OPTED_IN || !CLAUDE_EXE) {
  console.log(
    `SKIP windowed-deny-canary: ${!OPTED_IN ? "SUBAGENT_MCP_LIVE_DENY_CANARY!=1" : "no claude CLI on PATH"}`
  );
  process.exit(0);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

const home = mkdtempSync(join(tmpdir(), "windowed-canary-home-"));
const claudeDir = join(home, ".claude");
mkdirSync(claudeDir, { recursive: true });
const settingsFile = join(claudeDir, "settings.json");

// Seed file-based credentials into the throwaway home when the real install
// has them (Linux/CI; macOS keychain auth cannot follow a redirected HOME).
// Read-only with respect to the real configuration.
for (const [src, dst] of [
  [join(homedir(), ".claude", ".credentials.json"), join(claudeDir, ".credentials.json")],
  [join(homedir(), ".claude.json"), join(home, ".claude.json")],
]) {
  try {
    if (existsSync(src)) copyFileSync(src, dst);
  } catch {
    // Unreadable source: the auth probe below will skip cleanly.
  }
}

// A PreToolUse hook that answers an unconditional allow for Bash.
const allowHook = {
  matcher: "Bash",
  hooks: [
    {
      type: "command",
      command:
        `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"canary allow"}}'`,
    },
  ],
};

function writeSettings(withDeny) {
  writeFileSync(
    settingsFile,
    `${JSON.stringify(
      {
        ...(withDeny ? { permissions: { deny: ["Bash"] } } : {}),
        hooks: { PreToolUse: [allowHook] },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function runClaude(probe) {
  try {
    return execFileSync(
      CLAUDE_EXE,
      [
        "-p",
        `Run exactly one Bash command and nothing else: touch ${probe}. Then reply done.`,
        "--model",
        "haiku",
        "--max-turns",
        "3",
      ],
      {
        cwd: home,
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claudeDir },
        timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        // npm ships claude as a .cmd shim on Windows; a shell spawn executes it.
        shell: process.platform === "win32",
      }
    );
  } catch (e) {
    // A non-zero exit (e.g. the model reporting it could not run the tool) is
    // fine: the assertion is the probe file side effect, not the exit code.
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

// Auth probe: an isolated HOME only authenticates on file-credential installs.
// Without auth, leg 1 would pass vacuously (nothing runs, so no probe file),
// so an unauthenticated environment must SKIP loudly rather than report green.
{
  const probeOut = String(runClaude(join(home, "auth-probe.txt")) ?? "");
  if (/not logged in/i.test(probeOut)) {
    console.log(
      "SKIP windowed-deny-canary: claude cannot authenticate in an isolated HOME on this machine (keychain-based credentials); run on a file-credential install (e.g. Linux/CI)."
    );
    rmSync(home, { recursive: true, force: true });
    process.exit(0);
  }
}

try {
  test("host decision: settings deny beats a PreToolUse allow", () => {
    writeSettings(true);
    const probe = join(home, "probe-denied.txt");
    runClaude(probe);
    assert.equal(existsSync(probe), false, "the denied Bash tool must not run despite the hook allow");
  });

  test("host decision: removing the deny (the toggle's mechanism) unblocks the tool", () => {
    writeSettings(false);
    const probe = join(home, "probe-allowed.txt");
    runClaude(probe);
    assert.equal(existsSync(probe), true, "with the deny removed, the hook-allowed Bash tool runs");
  });

} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
