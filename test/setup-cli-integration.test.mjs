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
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

import { findOnPath, outputListsServer, resolveCmdShimNodeScript, verifyInstall } from "../dist/setup.js";

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
// `setup` reconciles Claude Code's auto-compact override.
//
// These drive the REAL `node dist/index.js setup --unattended` inline wireClaude
// path in a fully isolated home. A fake `claude` on PATH makes hasClaude true
// with ZERO host dependency, so nothing here is skipped. CLAUDE_CONFIG_DIR is
// pointed at a directory DISTINCT from <home>/.claude, so the settings.json
// under test is touched ONLY by the auto-compact reconciliation step (the hooks
// step writes <home>/.claude/settings.json — a different file). Every assertion
// is therefore attributable to the code path we mean to exercise, and the value
// is read back from the parsed file rather than grep-matched out of stdout.
// ---------------------------------------------------------------------------

const INDEX_JS = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const OVERRIDE_KEY = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";
const EXPECTED_PCT = "90"; // CODEX_AUTOCOMPACT_PCT

/** Build a throwaway home with a fake `claude` on PATH and an isolated
 *  CLAUDE_CONFIG_DIR. Caller seeds cfgDir/settings.json (via `seed`), runs
 *  setup, then rmSync(home) in a finally. */
function makeIsolatedHome(seed, { defaultConfig = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "submcp-setup-home-"));
  const cfgDir = defaultConfig ? join(home, ".claude") : join(home, "claude-cfg");
  const binDir = join(home, "bin");
  mkdirSync(cfgDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });

  // Portable no-op `claude`: a POSIX shell script (the execFileSync target) plus
  // a Windows .cmd shim (resolved via PATHEXT, run through cmd.exe). Both exit 0,
  // so MCP registration falls back to the direct ~/.claude.json write and never
  // records a failure — keeping the exit code a clean signal for the reconcile.
  const posix = join(binDir, "claude");
  writeFileSync(posix, "#!/bin/sh\nexit 0\n");
  try {
    chmodSync(posix, 0o755);
  } catch {
    /* no-op / unsupported on Windows */
  }
  writeFileSync(join(binDir, "claude.cmd"), "@echo off\r\nexit /b 0\r\n");

  const settings = join(cfgDir, "settings.json");
  if (seed !== undefined) writeFileSync(settings, seed, "utf8");

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SUBAGENT_CONFIG_HOME: join(home, ".subagent-mcp"),
    PATH: binDir,
    Path: binDir,
  };
  if (defaultConfig) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = cfgDir;
  delete env.CODEX_HOME;
  return { home, cfgDir, settings, env };
}

/** Run the real setup CLI under `env`; capture stdout + exit code without
 *  throwing on the nonzero exits the refusal scenarios expect. */
function runSetup(env, extraArgs = []) {
  const args = [INDEX_JS, "setup", "--unattended", ...extraArgs];
  const opts = { encoding: "utf8", env, timeout: SPAWN_MS, stdio: ["ignore", "pipe", "pipe"] };
  try {
    return { code: 0, stdout: execFileSync(process.execPath, args, opts) };
  } catch (e) {
    return {
      code: e && typeof e.status === "number" ? e.status : 1,
      stdout: e && e.stdout ? String(e.stdout) : "",
    };
  }
}

/** Input backups live beside the file as `settings.json.bak-setup-<stamp>`
 *  (setup.ts backs a file up once per run, before its first edit). */
function backupsOf(cfgDir) {
  return readdirSync(cfgDir).filter((n) => n.startsWith("settings.json.bak-setup-"));
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const seedJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

test("setup: absent override is added as '90'; unrelated settings/env preserved; exactly one input backup; read-back + restart shown", () => {
  const t = makeIsolatedHome(
    seedJson({
      model: "sonnet",
      statusLine: { type: "command", command: "keep-me" },
      env: { KEEP_ME: "keep" },
    })
  );
  try {
    const r = runSetup(t.env);
    assert.equal(r.code, 0, `setup should exit 0; stdout:\n${r.stdout}`);

    // Authoritative value comes from the parsed file, not a stdout match.
    const after = readJsonFile(t.settings);
    assert.strictEqual(after.env[OVERRIDE_KEY], EXPECTED_PCT, "override written as exactly '90'");
    assert.equal(after.env.KEEP_ME, "keep", "unrelated env key preserved");
    assert.equal(after.model, "sonnet", "unrelated top-level setting preserved");
    assert.deepEqual(
      after.statusLine,
      { type: "command", command: "keep-me" },
      "unrelated block preserved verbatim"
    );

    // Exactly one input backup, holding content with the override absent.
    const baks = backupsOf(t.cfgDir);
    assert.equal(baks.length, 1, `exactly one .bak-setup-* expected, saw: ${baks.join(", ")}`);
    const bak = readJsonFile(join(t.cfgDir, baks[0]));
    assert.equal(bak.env[OVERRIDE_KEY], undefined, "backup contains the input file (override absent)");
    assert.equal(bak.env.KEEP_ME, "keep");

    assert.ok(
      r.stdout.includes(`auto-compact override (env.${OVERRIDE_KEY}): added.`),
      `expected 'added' status line; stdout:\n${r.stdout}`
    );
    // Read-back verification is visible and reports the value now on disk.
    assert.ok(r.stdout.includes("claude: auto-compact override"), "read-back verification line present");
    assert.ok(r.stdout.includes(`env.${OVERRIDE_KEY}=${EXPECTED_PCT}`), "read-back reports =90");
    assert.ok(r.stdout.includes("Claude Code: restart your session"), "restart message emitted");
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("setup: noncanonical override value is repaired to '90'; single input backup keeps that value", () => {
  const t = makeIsolatedHome(seedJson({ env: { [OVERRIDE_KEY]: "75", KEEP_ME: "keep" } }));
  try {
    const r = runSetup(t.env);
    assert.equal(r.code, 0, `setup should exit 0; stdout:\n${r.stdout}`);

    const after = readJsonFile(t.settings);
    assert.strictEqual(after.env[OVERRIDE_KEY], EXPECTED_PCT, "noncanonical value repaired to exactly '90'");
    assert.equal(after.env.KEEP_ME, "keep", "unrelated env key preserved");

    const baks = backupsOf(t.cfgDir);
    assert.equal(baks.length, 1, `exactly one backup expected, saw: ${baks.join(", ")}`);
    assert.strictEqual(
      readJsonFile(join(t.cfgDir, baks[0])).env[OVERRIDE_KEY],
      "75",
      "backup holds the input value"
    );
    assert.ok(
      r.stdout.includes(`auto-compact override (env.${OVERRIDE_KEY}):`) && r.stdout.includes("repaired."),
      `expected 'repaired' status line; stdout:\n${r.stdout}`
    );
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("setup: already-correct override makes no write and no backup", () => {
  const t = makeIsolatedHome(seedJson({ env: { [OVERRIDE_KEY]: "90", KEEP_ME: "keep" } }));
  try {
    const before = readFileSync(t.settings, "utf8");
    const r = runSetup(t.env);
    assert.equal(r.code, 0, `setup should exit 0; stdout:\n${r.stdout}`);
    assert.equal(readFileSync(t.settings, "utf8"), before, "already-correct settings.json left byte-identical");
    assert.equal(backupsOf(t.cfgDir).length, 0, "no backup when nothing changes");
    assert.ok(
      r.stdout.includes(`auto-compact override (env.${OVERRIDE_KEY}): already correct.`),
      `expected 'already correct' status line; stdout:\n${r.stdout}`
    );
    assert.ok(r.stdout.includes(`env.${OVERRIDE_KEY}=${EXPECTED_PCT}`), "read-back still reports =90");
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("setup --dry-run: reports the pending add but writes nothing and makes no backup", () => {
  const t = makeIsolatedHome(seedJson({ env: { KEEP_ME: "keep" } }));
  try {
    const before = readFileSync(t.settings, "utf8");
    const r = runSetup(t.env, ["--dry-run"]);
    assert.equal(readFileSync(t.settings, "utf8"), before, "dry-run leaves settings.json untouched");
    assert.equal(backupsOf(t.cfgDir).length, 0, "dry-run makes no backup");
    assert.ok(
      r.stdout.includes(`auto-compact override (env.${OVERRIDE_KEY}): added.`),
      `dry-run still reports the pending add; stdout:\n${r.stdout}`
    );
    assert.ok(r.stdout.includes("(dry-run: not written)"), "dry-run marks the change as not written");
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("setup: malformed settings.json is refused without clobber, with actionable output and nonzero exit", () => {
  const seed = "{ this is not valid json";
  const t = makeIsolatedHome(seed);
  try {
    const r = runSetup(t.env);
    assert.notEqual(r.code, 0, "malformed settings must make setup exit nonzero");
    assert.equal(readFileSync(t.settings, "utf8"), seed, "malformed file must NOT be clobbered");
    assert.equal(backupsOf(t.cfgDir).length, 0, "no backup of a file we refused to touch");
    assert.ok(r.stdout.includes("is not valid JSON"), `actionable 'not valid JSON'; stdout:\n${r.stdout}`);
    assert.ok(r.stdout.includes(OVERRIDE_KEY), "message names the override key");
    assert.ok(r.stdout.includes("Repair the file"), "message tells the user how to recover");
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("setup: malformed default ~/.claude/settings.json is refused and kept byte-identical", () => {
  const seed = Buffer.from("{ malformed default settings\r\n", "utf8");
  const t = makeIsolatedHome(seed, { defaultConfig: true });
  try {
    assert.equal("CLAUDE_CONFIG_DIR" in t.env, false, "the CLI must resolve Claude's default settings path");
    const r = runSetup(t.env);
    assert.notEqual(r.code, 0, "malformed default settings must make setup exit nonzero");
    assert.deepEqual(readFileSync(t.settings), seed, "default settings bytes must be preserved");
    assert.equal(backupsOf(t.cfgDir).length, 0, "refusal must not create a backup or rewrite the file");
    assert.ok(r.stdout.includes("is not valid JSON"), `actionable refusal expected; stdout:\n${r.stdout}`);
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("setup: non-object env is refused without clobber, with actionable output and nonzero exit", () => {
  const seed = seedJson({ env: "not-an-object", KEEP_ME: "keep" });
  const t = makeIsolatedHome(seed);
  try {
    const r = runSetup(t.env);
    assert.notEqual(r.code, 0, "non-object env must make setup exit nonzero");
    assert.equal(readFileSync(t.settings, "utf8"), seed, "file with non-object env must NOT be clobbered");
    assert.equal(backupsOf(t.cfgDir).length, 0, "no backup of a file we refused to touch");
    assert.ok(r.stdout.includes("is not an object"), `actionable 'not an object'; stdout:\n${r.stdout}`);
    assert.ok(r.stdout.includes(OVERRIDE_KEY), "message names the override key");
    assert.ok(r.stdout.includes('make "env" a JSON object'), "message tells the user how to recover");
  } finally {
    rmSync(t.home, { recursive: true, force: true });
  }
});

test("verifyInstall reports a missing session-handoff-required lifecycle asset", () => {
  const root = mkdtempSync(join(tmpdir(), "submcp-install-root-"));
  try {
    assert.ok(verifyInstall(root).includes("directives/session-handoff-required.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  process.exit(1);
}
