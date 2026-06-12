/**
 * cli-args.test.mjs — Integration tests for the CLI argument guard in
 * dist/index.js (the `subagent-mcp` bin entry).
 *
 * WHY (Rule 9): the dispatch used to recognize only `setup`/`doctor`; every
 * other argument — including `--version` — fell through and silently started
 * the stdio MCP server, which blocks forever waiting on stdin. These tests
 * encode the guard contract:
 *   - --version/-v  -> exit 0, prints exactly the package.json version,
 *   - --help/-h     -> exit 0, usage names the real commands (setup, init,
 *                      doctor, --update),
 *   - --init        -> dispatches to init instead of starting stdio,
 *   - unknown arg   -> exit 1, "unknown argument" on STDERR, never the server.
 * `--update` itself is deliberately NEVER spawned here: it would mutate the
 * real global install and hit the network. Only its presence in the usage
 * text is asserted.
 * Each spawn carries a hard timeout so a guard regression fails the test run
 * instead of hanging CI forever. The bare no-arg invocation is deliberately
 * NOT spawned here: it is the server and would block by design.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
function runBin(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    timeout: SPAWN_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) {
    throw new Error(`spawn ${args.join(" ")} failed: ${r.error.message}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// --version / -v
// ---------------------------------------------------------------------------
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
// --help / -h
// ---------------------------------------------------------------------------
test("--help: exit 0, usage mentions setup and doctor", () => {
  const r = runBin(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /setup/);
  assert.match(r.stdout, /init/);
  assert.match(r.stdout, /doctor/);
});

test("-h: exit 0, usage mentions setup and doctor", () => {
  const r = runBin(["-h"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /setup/);
  assert.match(r.stdout, /init/);
  assert.match(r.stdout, /doctor/);
});

// --help and the unknown-arg stderr share one usage string, so asserting on
// --help covers both. --update is NOT executed (see header).
test("--help: usage mentions --update", () => {
  const r = runBin(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--update/);
});

// ---------------------------------------------------------------------------
// init / --init
// ---------------------------------------------------------------------------
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
