/**
 * orchestration-pretool.test.mjs - Claude PreToolUse deterministic gates.
 *
 * WHY (Rule 9): the 5-call and sole-channel rules must not depend only on
 * prompt text. These tests pin the fail-open liveness guard, native subagent
 * denial, MCP exemption, per-request counter, and prompt-boundary reset.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { touchAlive, LIVENESS_TTL_MS } from "../dist/orchestration/liveness.js";
import {
  INLINE_TOOL_LIMIT,
  resetToolCount,
  runClaudePreTool,
} from "../dist/orchestration/pretool.js";
import { runClaudeHook } from "../dist/hooks/orchestration-claude.js";

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

function payload(tool_name = "Bash") {
  return {
    cwd: mkdtempSync(join(tmpdir(), "orch-pt-cwd-")),
    session_id: `s-${Math.random()}`,
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input: {},
  };
}

function cleanup(p) {
  resetToolCount(p);
  rmSync(p.cwd, { recursive: true, force: true });
}

test("liveness missing/stale -> fail open", () => {
  const p = payload("Task");
  try {
    const result = runClaudePreTool(p, {}, Date.now() + LIVENESS_TTL_MS + 1);
    assert.equal(result, null, "stale or absent heartbeat must not block tools");
  } finally {
    cleanup(p);
  }
});

test("native Task/Agent/Explore tools are denied while server is alive", () => {
  touchAlive();
  for (const tool of ["Task", "Agent", "Explore"]) {
    const p = payload(tool);
    try {
      const result = runClaudePreTool(p, {});
      assert.equal(result?.hookSpecificOutput.permissionDecision, "deny");
      assert.match(result?.hookSpecificOutput.permissionDecisionReason ?? "", /launch_agent/);
    } finally {
      cleanup(p);
    }
  }
});

test("subagent-mcp tools and question tools bypass the inline counter", () => {
  touchAlive();
  for (const tool of [
    "mcp__subagent_mcp__launch_agent",
    "mcp__subagent-mcp__wait",
    "AskUserQuestion",
  ]) {
    const p = payload(tool);
    try {
      for (let i = 0; i < INLINE_TOOL_LIMIT + 2; i++) {
        assert.equal(runClaudePreTool(p, {}), null, `${tool} remains allowed`);
      }
    } finally {
      cleanup(p);
    }
  }
});

test("sixth inline tool call asks instead of silently continuing", () => {
  touchAlive();
  const p = payload("Bash");
  try {
    for (let i = 1; i <= INLINE_TOOL_LIMIT; i++) {
      assert.equal(runClaudePreTool(p, {}), null, `call ${i} is below the limit`);
    }
    const result = runClaudePreTool(p, {});
    assert.equal(result?.hookSpecificOutput.permissionDecision, "ask");
    assert.match(result?.hookSpecificOutput.permissionDecisionReason ?? "", /5-CALL RULE/);
    assert.match(result?.hookSpecificOutput.additionalContext ?? "", /launch_agent/);
  } finally {
    cleanup(p);
  }
});

test("new top-level Claude prompt resets the inline counter", () => {
  touchAlive();
  const p = payload("Bash");
  try {
    for (let i = 1; i <= INLINE_TOOL_LIMIT + 1; i++) {
      runClaudePreTool(p, {});
    }
    assert.equal(runClaudePreTool(p, {})?.hookSpecificOutput.permissionDecision, "ask");
    runClaudeHook(p, {});
    assert.equal(runClaudePreTool(p, {}), null, "next request starts at call 1");
  } finally {
    cleanup(p);
  }
});

test("subagent env skips all PreToolUse enforcement", () => {
  touchAlive();
  const p = payload("Task");
  try {
    assert.equal(runClaudePreTool(p, { SUBAGENT_MCP_SUBAGENT: "1" }), null);
  } finally {
    cleanup(p);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
