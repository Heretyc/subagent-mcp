/**
 * Unit tests for buildChildEnv: stale GH_TOKEN / GITHUB_TOKEN must be stripped
 * from every spawned child agent by default so the child's own `gh` keyring auth
 * wins, with an explicit SUBAGENT_MCP_PASS_GH_TOKENS=1 opt-in passthrough.
 */

import assert from "node:assert/strict";
import { buildChildEnv } from "../dist/index.js";

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

test("default: GH_TOKEN and GITHUB_TOKEN are stripped from the child env", () => {
  const parent = { GH_TOKEN: "stale-gh", GITHUB_TOKEN: "stale-github", PATH: "/usr/bin" };
  const env = buildChildEnv(parent, { SUBAGENT_MCP_SUBAGENT: "1" });
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.SUBAGENT_MCP_SUBAGENT, "1");
  assert.equal(env.PATH, "/usr/bin");
  // The parent env must not be mutated.
  assert.equal(parent.GH_TOKEN, "stale-gh");
});

test("opt-in: SUBAGENT_MCP_PASS_GH_TOKENS=1 passes both tokens through", () => {
  const parent = {
    GH_TOKEN: "keep-gh",
    GITHUB_TOKEN: "keep-github",
    SUBAGENT_MCP_PASS_GH_TOKENS: "1",
  };
  const env = buildChildEnv(parent, { SUBAGENT_MCP_DEPTH: "1" });
  assert.equal(env.GH_TOKEN, "keep-gh");
  assert.equal(env.GITHUB_TOKEN, "keep-github");
  assert.equal(env.SUBAGENT_MCP_DEPTH, "1");
});

test("opt-in requires exactly '1': other truthy values still strip", () => {
  const parent = { GH_TOKEN: "x", GITHUB_TOKEN: "y", SUBAGENT_MCP_PASS_GH_TOKENS: "true" };
  const env = buildChildEnv(parent, {});
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
