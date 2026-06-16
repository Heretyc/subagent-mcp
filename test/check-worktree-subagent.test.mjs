/**
 * check-worktree-subagent.test.mjs — Verifies the delegated-sub-agent exemption
 * in scripts/check_worktree.mjs.
 *
 * WHY (Rule 9): subagent-mcp places delegated sub-agents in their target cwd and
 * sets SUBAGENT_MCP_SUBAGENT=1. The gate MUST short-circuit (exit 0, skip all
 * isolation checks) for them — otherwise every delegated mutating step would be
 * wrongly forced to create a worktree. This test encodes that the exemption fires
 * BEFORE the primary-tree failure path. It only asserts the exemption behavior so
 * it stays deterministic regardless of where the test runs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gate = resolve(__dirname, "..", "scripts", "check_worktree.mjs");

const SKIP_LINE =
  "check_worktree: delegated sub-agent (SUBAGENT_MCP_SUBAGENT=1) — worktree isolation skipped; operating in provided cwd.";

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

test("SUBAGENT_MCP_SUBAGENT=1 -> exit 0 and prints the skip line", () => {
  const r = spawnSync(process.execPath, [gate], {
    encoding: "utf8",
    env: { ...process.env, SUBAGENT_MCP_SUBAGENT: "1" },
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status} (stderr: ${r.stderr})`);
  assert.ok(
    r.stdout.includes(SKIP_LINE),
    `stdout must contain the skip line.\n--- stdout ---\n${r.stdout}`
  );
  assert.ok(
    !r.stdout.includes("WORKTREE-GATE:"),
    "exemption must short-circuit BEFORE the gate runs (no WORKTREE-GATE output)"
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
