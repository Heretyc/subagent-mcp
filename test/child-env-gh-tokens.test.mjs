/**
 * Unit tests for buildChildEnv: stale GH_TOKEN / GITHUB_TOKEN must be stripped
 * from every spawned child agent by default so the child's own `gh` keyring auth
 * wins, with an explicit SUBAGENT_MCP_PASS_GH_TOKENS=1 opt-in passthrough.
 */

import assert from "node:assert/strict";
import { buildChildEnv, resolveFreshGhToken } from "../dist/index.js";

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

test("inject: fresh gh token becomes GH_TOKEN, GITHUB_TOKEN absent, parent untouched", () => {
  const parent = { GH_TOKEN: "stale-gh", GITHUB_TOKEN: "stale-github", PATH: "/usr/bin" };
  const fresh = resolveFreshGhToken(parent, () => ({ status: 0, stdout: "fresh-token-123\n" }));
  assert.equal(fresh, "fresh-token-123");
  const env = buildChildEnv(parent, { SUBAGENT_MCP_SUBAGENT: "1" }, fresh);
  assert.equal(env.GH_TOKEN, "fresh-token-123");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.SUBAGENT_MCP_SUBAGENT, "1");
  // Parent env must not be mutated.
  assert.equal(parent.GH_TOKEN, "stale-gh");
  assert.equal(parent.GITHUB_TOKEN, "stale-github");
});

test("resolver strips GH_TOKEN/GITHUB_TOKEN from the env used to invoke gh", () => {
  const parent = { GH_TOKEN: "stale-gh", GITHUB_TOKEN: "stale-github", PATH: "/usr/bin" };
  let seen;
  resolveFreshGhToken(parent, (env) => {
    seen = env;
    return { status: 0, stdout: "tok" };
  });
  assert.equal(seen.GH_TOKEN, undefined);
  assert.equal(seen.GITHUB_TOKEN, undefined);
  assert.equal(seen.PATH, "/usr/bin");
  // Stripping from the gh-invocation env must not mutate the parent.
  assert.equal(parent.GH_TOKEN, "stale-gh");
});

test("fallback: gh nonzero status yields strip-only env", () => {
  const parent = { GH_TOKEN: "stale-gh", GITHUB_TOKEN: "stale-github" };
  const fresh = resolveFreshGhToken(parent, () => ({ status: 1, stdout: "" }));
  assert.equal(fresh, undefined);
  const env = buildChildEnv(parent, {}, fresh);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

test("fallback: empty/whitespace stdout yields strip-only env", () => {
  const parent = { GH_TOKEN: "stale-gh" };
  const fresh = resolveFreshGhToken(parent, () => ({ status: 0, stdout: "   \n" }));
  assert.equal(fresh, undefined);
  const env = buildChildEnv(parent, {}, fresh);
  assert.equal(env.GH_TOKEN, undefined);
});

test("fallback: runner error (spawn failure/timeout) yields strip-only env", () => {
  const parent = { GH_TOKEN: "stale-gh" };
  const fresh = resolveFreshGhToken(parent, () => ({ error: new Error("ETIMEDOUT"), stdout: "" }));
  assert.equal(fresh, undefined);
  const env = buildChildEnv(parent, {}, fresh);
  assert.equal(env.GH_TOKEN, undefined);
});

test("passthrough: resolver not called, and buildChildEnv ignores supplied fresh token", () => {
  const parent = {
    GH_TOKEN: "keep-gh",
    GITHUB_TOKEN: "keep-github",
    SUBAGENT_MCP_PASS_GH_TOKENS: "1",
  };
  let called = false;
  const fresh = resolveFreshGhToken(parent, () => {
    called = true;
    return { status: 0, stdout: "fresh" };
  });
  assert.equal(called, false);
  assert.equal(fresh, undefined);
  // Even if a fresh token is somehow supplied, pass-through preserves parent tokens verbatim.
  const env = buildChildEnv(parent, {}, "should-be-ignored");
  assert.equal(env.GH_TOKEN, "keep-gh");
  assert.equal(env.GITHUB_TOKEN, "keep-github");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
