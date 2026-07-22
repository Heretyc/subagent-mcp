/**
 * Unit tests for the `launch_agent` `sub-orchestrator: true` flag
 * (src/sub-orchestrator.ts + its two src/index.ts touch points).
 *
 * The flag forces orchestration-mode behavior ON for exactly ONE child via an
 * env pair plus a server-prepended prompt directive. The two properties that
 * MUST hold are (1) a grandchild never inherits the mode and (2) only the main
 * orchestrator (depth 0) can set it. Why each case matters is encoded in the
 * assertion messages (Rule 9: tests verify intent, not just behavior).
 */

import assert from "node:assert/strict";
import { buildChildEnv, pickInstructions } from "../dist/index.js";
import {
  SUB_ORCHESTRATOR_ENV,
  SUB_ORCHESTRATOR_DIRECTIVE,
  applySubOrchestratorDirective,
  isSubOrchestratorEnv,
  SUB_ORCH_DEPTH_ERROR,
} from "../dist/sub-orchestrator.js";
import { MARKER, ensureParentMarker } from "../dist/launch-prompt.js";

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

// ---------------------------------------------------------------------------
// (a) anti-inheritance strip
//     WHY: a sub-orchestrator's own launches spread its parent env. Without the
//     unconditional strip every worker (and every grandchild) would boot as an
//     orchestrator: an inheritance chain, not a single delegated section.
// ---------------------------------------------------------------------------
test("buildChildEnv strips the sub-orchestrator marker when this launch does not set it", () => {
  const parent = { [SUB_ORCHESTRATOR_ENV]: "1", PATH: "/usr/bin" };
  const env = buildChildEnv(parent, { SUBAGENT_MCP_SUBAGENT: "1", SUBAGENT_MCP_DEPTH: "2" });
  assert.equal(
    env[SUB_ORCHESTRATOR_ENV],
    undefined,
    "a sub-orchestrator's worker must NOT inherit the marker; if set, orchestration mode would propagate to grandchildren"
  );
  assert.equal(env.SUBAGENT_MCP_SUBAGENT, "1", "the child marker itself stays load-bearing");
  assert.equal(env.SUBAGENT_MCP_DEPTH, "2", "depth accounting is unaffected by the strip");
  assert.equal(parent[SUB_ORCHESTRATOR_ENV], "1", "the parent env must not be mutated");
});

// ---------------------------------------------------------------------------
// (b) explicit set survives
//     WHY: the strip must be delete-then-conditionally-set, not a blanket
//     delete; an explicitly flagged launch is the only way the marker is ever
//     present in a child env.
// ---------------------------------------------------------------------------
test("buildChildEnv keeps the marker when THIS launch explicitly sets it", () => {
  const env = buildChildEnv(
    { PATH: "/usr/bin" },
    { SUBAGENT_MCP_SUBAGENT: "1", SUBAGENT_MCP_DEPTH: "1", [SUB_ORCHESTRATOR_ENV]: "1" }
  );
  assert.equal(
    env[SUB_ORCHESTRATOR_ENV],
    "1",
    "an explicitly flagged launch must carry the marker; otherwise the child could not be bound ON"
  );
  assert.equal(env.SUBAGENT_MCP_SUBAGENT, "1", "sub-orchestrators remain subagents for depth/worktree purposes");
  assert.equal(
    isSubOrchestratorEnv(env),
    true,
    "both markers present must read as a sub-orchestrator session"
  );
  assert.equal(
    isSubOrchestratorEnv({ SUBAGENT_MCP_SUBAGENT: "1" }),
    false,
    "the child marker alone is a plain sub-agent; if true, every worker would claim orchestration"
  );
});

// ---------------------------------------------------------------------------
// (c) directive placement
//     WHY: the parent-process marker must stay the literal first line (it is
//     what the first-line exemption and launch-agent-upsert key on), so the
//     directive goes directly BELOW it, leaving the body untouched. Re-applying
//     must not stack a second directive block.
// ---------------------------------------------------------------------------
test("applySubOrchestratorDirective inserts below the marker, preserves the body, and is idempotent", () => {
  const body = "Implement section 3 of the plan.\nPlan file: /tmp/swarm-plan-3.md";
  const once = applySubOrchestratorDirective(ensureParentMarker(body));
  const lines = once.split("\n");
  assert.equal(lines[0], MARKER, "line 1 must remain the literal parent-process marker");
  assert.equal(
    lines[1],
    SUB_ORCHESTRATOR_DIRECTIVE.split("\n")[0],
    "line 2 must open the directive block; anything else means the marker was displaced or the block misplaced"
  );
  assert.equal(
    once,
    MARKER + "\n" + SUB_ORCHESTRATOR_DIRECTIVE + "\n\n" + body,
    "the prompt body must survive verbatim after the directive plus one blank line"
  );
  const twice = applySubOrchestratorDirective(once);
  assert.equal(
    twice,
    once,
    "re-application must be a no-op; a duplicated directive would double the injected instruction budget"
  );
});

// ---------------------------------------------------------------------------
// (d) depth-0 gate error text
//     WHY: the rejection has to explain WHY depth >= 1 cannot work (the 2-level
//     spawn cap would leave the sub-orchestrator's workers unable to run) so
//     the caller relaunches as a normal sub-agent instead of retrying.
// ---------------------------------------------------------------------------
test("SUB_ORCH_DEPTH_ERROR reports the caller's depth and the corrective action", () => {
  assert.equal(
    SUB_ORCH_DEPTH_ERROR(1),
    "Error: sub-orchestrator: true is only available to the main orchestrator (depth 0). Current SUBAGENT_MCP_DEPTH=1: a sub-orchestrator launched from this depth could not delegate, because the 2-level spawn cap leaves its workers unable to run. Relaunch this agent as a normal sub-agent (omit sub-orchestrator).",
    "the depth error must match the frozen contract text verbatim, including the caller's depth"
  );
  assert.ok(
    SUB_ORCH_DEPTH_ERROR(2).includes("SUBAGENT_MCP_DEPTH=2"),
    "the reported depth must be the caller's actual depth, not a hardcoded 1"
  );
});

// ---------------------------------------------------------------------------
// (e) instructions variant
//     WHY: the MCP `instructions` string is read once at connect. A
//     sub-orchestrator served the plain SUB-AGENT variant would be told not to
//     orchestrate, contradicting its own prompt directive.
// ---------------------------------------------------------------------------
test("pickInstructions serves the sub-orchestrator variant only when both markers are set", () => {
  assert.ok(
    pickInstructions({ SUBAGENT_MCP_SUBAGENT: "1", [SUB_ORCHESTRATOR_ENV]: "1" }).startsWith(
      "SUB-ORCHESTRATOR SESSION:"
    ),
    "both markers must serve the sub-orchestrator instructions; otherwise the session is coached to skip orchestration"
  );
  assert.ok(
    pickInstructions({ SUBAGENT_MCP_SUBAGENT: "1" }).startsWith("SUB-AGENT SESSION:"),
    "the child marker alone must still serve the plain sub-agent instructions"
  );
  assert.ok(
    pickInstructions({}).startsWith("subagent-mcp - CANONICAL OPERATING MODEL"),
    "a main orchestrator must still receive the full orchestration instructions"
  );
  assert.ok(
    pickInstructions({ [SUB_ORCHESTRATOR_ENV]: "1" }).startsWith("subagent-mcp - CANONICAL OPERATING MODEL"),
    "a stray marker without the child marker must not downgrade a main orchestrator's instructions"
  );
});

// ---------------------------------------------------------------------------
// Print summary and fail if any test failed
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
