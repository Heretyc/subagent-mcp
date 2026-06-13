/**
 * cli-args.test.mjs — Integration tests for the CLI argument guard in
 * dist/index.js (the `subagent-mcp` bin entry).
 *
 * WHY (Rule 9): the dispatch used to recognize only `setup`/`doctor`; every
 * other argument — including `--version` — fell through and silently started
 * the stdio MCP server, which blocks forever waiting on stdin. These tests
 * encode the guard contract:
 *   - version/--version/-v  -> exit 0, prints exactly the package.json version,
 *   - help/--help/-h        -> exit 0, usage names the real commands (setup,
 *                              init, doctor, update),
 *   - update/--update       -> real npm is never spawned; a fake npm proves
 *                              user-edited advanced-ruleset.py is preserved,
 *   - init/--init           -> dispatches to init instead of starting stdio,
 *   - unknown arg   -> exit 1, "unknown argument" on STDERR, never the server.
 * Real update is deliberately NEVER spawned here: it would mutate the real
 * global install and hit the network. The update test uses a temp fake npm.
 * Each spawn carries a hard timeout so a guard regression fails the test run
 * instead of hanging CI forever. The bare no-arg invocation is deliberately
 * NOT spawned here: it is the server and would block by design.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "dist", "index.js");
const PKG_VERSION = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8")
).version;
const SPAWN_MS = 15000;

/** Spawn the bin with a hard timeout: a regression that starts the blocking
 *  stdio server surfaces as ETIMEDOUT here, not as a hung CI job. */
function runBin(args, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: SPAWN_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) {
    throw new Error(`spawn ${args.join(" ")} failed: ${r.error.message}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// version / --version / -v
// ---------------------------------------------------------------------------
test("version: exit 0, stdout is exactly the package.json version", () => {
  const r = runBin(["version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG_VERSION);
});

test("--version: exit 0, stdout is exactly the package.json version", () => {
  const r = runBin(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG_VERSION);
});

test("-v: exit 0, stdout is exactly the package.json version", () => {
  const r = runBin(["-v"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG_VERSION);
});

// ---------------------------------------------------------------------------
// help / --help / -h
// ---------------------------------------------------------------------------
test("help: exit 0, usage mentions setup, init, doctor, and update", () => {
  const r = runBin(["help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /setup/);
  assert.match(r.stdout, /init/);
  assert.match(r.stdout, /doctor/);
  assert.match(r.stdout, /update/);
});

test("--help: exit 0, usage mentions setup, init, doctor, and update", () => {
  const r = runBin(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /setup/);
  assert.match(r.stdout, /init/);
  assert.match(r.stdout, /doctor/);
  assert.match(r.stdout, /update/);
});

test("-h: exit 0, usage mentions setup, init, doctor, and update", () => {
  const r = runBin(["-h"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /setup/);
  assert.match(r.stdout, /init/);
  assert.match(r.stdout, /doctor/);
  assert.match(r.stdout, /update/);
});

// --help and the unknown-arg stderr share one usage string, so asserting on
// --help covers both. --update is NOT executed (see header).
test("--help: usage keeps dashed compatibility aliases", () => {
  const r = runBin(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--update/);
  assert.match(r.stdout, /--init/);
});

// ---------------------------------------------------------------------------
// update / --update
// ---------------------------------------------------------------------------
test("update: preserves user-edited advanced-ruleset.py", () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-cli-update-"));
  try {
    const fakeBin = join(root, "bin");
    const globalRoot = join(root, "global");
    const installRoot = join(globalRoot, "@heretyc", "subagent-mcp");
    const ruleset = join(installRoot, "dist", "advanced-ruleset.py");
    const userRuleset = "LOAD_RULES = True\n# user custom rule\n";
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(dirname(ruleset), { recursive: true });
    writeFileSync(ruleset, userRuleset);

    const fakeNpmCli = join(fakeBin, "npm-cli.js");
    writeFileSync(
      fakeNpmCli,
      [
        "const { mkdirSync, writeFileSync } = require('node:fs');",
        "const { dirname, join } = require('node:path');",
        "const args = process.argv.slice(2);",
        "const root = process.env.FAKE_NPM_ROOT;",
        "if (args[0] === 'root' && args[1] === '-g') { console.log(root); process.exit(0); }",
        "if (args[0] === 'install' && args[1] === '-g') {",
        "  const p = join(root, '@heretyc', 'subagent-mcp', 'dist', 'advanced-ruleset.py');",
        "  mkdirSync(dirname(p), { recursive: true });",
        "  writeFileSync(p, 'LOAD_RULES = False\\n# fresh shipped scaffold\\n');",
        "  process.exit(0);",
        "}",
        "console.error('unexpected npm args: ' + args.join(' '));",
        "process.exit(2);",
      ].join("\n")
    );
    const fakeNpm = join(fakeBin, "npm");
    writeFileSync(
      fakeNpm,
      `#!${process.execPath}\nrequire(${JSON.stringify(fakeNpmCli)});\n`
    );
    chmodSync(fakeNpm, 0o755);
    writeFileSync(
      join(fakeBin, "npm.cmd"),
      `@IF EXIST "%~dp0\\node.exe" ("%~dp0\\node.exe" "%~dp0\\npm-cli.js" %*) ELSE ("${process.execPath}" "%~dp0\\npm-cli.js" %*)\r\n`
    );

    const r = runBin(["update"], {
      FAKE_NPM_ROOT: globalRoot,
      PATH: fakeBin,
      Path: fakeBin,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(ruleset, "utf8"), userRuleset);
    assert.match(r.stdout, /backed up user advanced-ruleset\.py/);
    assert.match(r.stdout, /restored user advanced-ruleset\.py/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// init / --init
// ---------------------------------------------------------------------------
test("init: dry-run exits 0 and writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-cli-init-"));
  try {
    const r = runBin(["init", "--root", root, "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(dry-run: no files written\)/);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--init: dry-run exits 0 and writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-cli-init-"));
  try {
    const r = runBin(["--init", "--root", root, "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(dry-run: no files written\)/);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// unknown argument
// ---------------------------------------------------------------------------
test("bogus-arg: exit 1, stderr names the unknown argument", () => {
  const r = runBin(["bogus-arg"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown argument: bogus-arg/);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
