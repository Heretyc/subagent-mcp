/**
 * setup-cli-integration.test.mjs — Guarded integration test: does
 * outputListsServer() recognize the REAL `claude mcp list` / `codex mcp list`
 * output formats, and reject sibling names against real output?
 *
 * WHY (Rule 9): the unit tests assert against captured format strings; if a
 * vendor changes its list format, only a real CLI round-trip catches it.
 *
 * Safety contract (must never touch real user config):
 *   - SKIPs cleanly (exit 0) when a CLI is not on PATH.
 *   - Every spawn gets an isolated throwaway HOME/USERPROFILE plus
 *     CLAUDE_CONFIG_DIR/CODEX_HOME pointing inside it.
 *   - Registers ONLY a throwaway name (submcp-itest-<pid>), NEVER the real
 *     "subagent-mcp", and always `mcp remove`s it in finally — so even a CLI
 *     version that ignores the isolation env cannot leave residue behind.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";

import { findOnPath, outputListsServer, resolveCmdShimNodeScript } from "../dist/setup.js";

let passed = 0;
let failed = 0;
let skipped = 0;

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

const SPAWN_MS = 30000;

/** Spawn a vendor CLI without cmd.exe quoting hazards: npm .cmd shims are
 *  resolved to their JS entry and run under this node; all argv tokens here
 *  are shell-safe anyway, so the execSync fallback is harmless. */
function runCli(exe, args, env) {
  const opts = { encoding: "utf8", env, timeout: SPAWN_MS, stdio: ["ignore", "pipe", "pipe"] };
  if (/\.(?:cmd|bat)$/i.test(exe)) {
    const js = resolveCmdShimNodeScript(exe);
    if (js) return execFileSync(process.execPath, [js, ...args], opts);
    return execSync([`"${exe}"`, ...args].join(" "), opts);
  }
  return execFileSync(exe, args, opts);
}

/** `mcp list` may exit non-zero when a registered server fails its health
 *  check; the listing on stdout is still what we are testing. */
function captureList(exe, args, env) {
  try {
    return runCli(exe, args, env);
  } catch (e) {
    return e && e.stdout ? String(e.stdout) : "";
  }
}

const NAME = `submcp-itest-${process.pid}`;

const VENDORS = [
  {
    cli: "claude",
    addArgs: ["mcp", "add", NAME, "-s", "user", "--", "node", "--version"],
    removeArgs: ["mcp", "remove", NAME, "-s", "user"],
  },
  {
    cli: "codex",
    addArgs: ["mcp", "add", NAME, "--", "node", "--version"],
    removeArgs: ["mcp", "remove", NAME],
  },
];

for (const v of VENDORS) {
  const exe = findOnPath(v.cli);
  if (exe === null) {
    console.log(`  SKIP: ${v.cli} not on PATH — integration round-trip not run`);
    skipped++;
    continue;
  }
  test(`${v.cli}: real 'mcp list' round-trip with throwaway name in isolated home`, () => {
    const home = mkdtempSync(join(tmpdir(), "submcp-itest-home-"));
    // codex refuses to start when CODEX_HOME does not exist; pre-create both
    // vendor dirs so the isolation env is always honored.
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CODEX_HOME: join(home, ".codex"),
    };
    try {
      runCli(exe, v.addArgs, env);
      const out = captureList(exe, ["mcp", "list"], env);
      assert.equal(outputListsServer(out, NAME), true, `exact name must be listed in:\n${out}`);
      assert.equal(outputListsServer(out, `${NAME}-dev`), false, "sibling name must NOT match");
    } finally {
      try {
        runCli(exe, v.removeArgs, env);
      } catch {
        /* nothing to remove if add failed */
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  process.exit(1);
}
