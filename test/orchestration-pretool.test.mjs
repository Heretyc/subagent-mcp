/**
 * orchestration-pretool.test.mjs - Claude PreToolUse deterministic gates.
 *
 * WHY (Rule 9): the sole-channel rule must not depend only on prompt text.
 * These tests pin the fail-open liveness guard, native subagent denial, and
 * the subagent-env skip. The old 5-call inline counter is GONE (D11/D24):
 * long-horizon upgrades are agent-self-driven, so the hook never counts tool
 * calls or asks on a sixth call.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentUserSlotNamespace, slotDir as currentSlotDir } from "../dist/concurrency.js";
import { alivePath, touchAlive, LIVENESS_TTL_MS } from "../dist/orchestration/liveness.js";
import { runClaudePreTool } from "../dist/orchestration/pretool.js";
import {
  slotPathForAgent,
  writeSlotMetadata,
  ZOMBIE_LIVE_IDLE_MS,
} from "../dist/zombie.js";

const ORIGINAL_SUBAGENT_SLOT_DIR = process.env.SUBAGENT_SLOT_DIR;
const TEST_SUBAGENT_SLOT_DIR = mkdtempSync(join(tmpdir(), "orch-pretool-default-slots-"));
mkdirSync(join(TEST_SUBAGENT_SLOT_DIR, currentUserSlotNamespace()), { recursive: true });
process.env.SUBAGENT_SLOT_DIR = TEST_SUBAGENT_SLOT_DIR;
process.on("exit", () => {
  if (ORIGINAL_SUBAGENT_SLOT_DIR === undefined) delete process.env.SUBAGENT_SLOT_DIR;
  else process.env.SUBAGENT_SLOT_DIR = ORIGINAL_SUBAGENT_SLOT_DIR;
  rmSync(TEST_SUBAGENT_SLOT_DIR, { recursive: true, force: true });
});

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
  rmSync(p.cwd, { recursive: true, force: true });
}

function withSlotDir(fn) {
  const previous = process.env.SUBAGENT_SLOT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "orch-pretool-slots-"));
  mkdirSync(join(dir, currentUserSlotNamespace()), { recursive: true });
  process.env.SUBAGENT_SLOT_DIR = dir;
  try {
    return fn(currentSlotDir());
  } finally {
    if (previous === undefined) delete process.env.SUBAGENT_SLOT_DIR;
    else process.env.SUBAGENT_SLOT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
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

test("fresh liveness with no live pid -> fail open", () => {
  const p = payload("Task");
  try {
    mkdirSync(join(alivePath(), ".."), { recursive: true });
    writeFileSync(alivePath(), `${Date.now()}\npid=99999999\n`, { mode: 0o600 });
    const result = runClaudePreTool(p, {});
    assert.equal(result, null, "dead-pid heartbeat must not block native tools");

    writeFileSync(alivePath(), `${Date.now()}\n`, { mode: 0o600 });
    assert.equal(
      runClaudePreTool(p, {}),
      null,
      "heartbeat without a pid must be treated as stale",
    );
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

test("native denial remains valid JSON and omits zombie context when culled", () => {
  touchAlive();
  const p = payload("Task");
  try {
    withSlotDir((slotDir) => {
      writeSlotMetadata(slotPathForAgent(slotDir, "agent-pretool"), {
        agent_id: "agent-pretool",
        server_pid: 123,
        child_pid: process.pid,
        last_activity_ms: Date.now() - ZOMBIE_LIVE_IDLE_MS - 1000,
        status: "processing",
      });
      const result = runClaudePreTool(p, {});
      assert.equal(result?.hookSpecificOutput.permissionDecision, "deny");
      assert.equal(result?.hookSpecificOutput.additionalContext, undefined);
      assert.doesNotMatch(result?.hookSpecificOutput.permissionDecisionReason ?? "", /zombies:/);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)),
        "PreToolUse output must remain JSON-serializable");
    });
  } finally {
    cleanup(p);
  }
});

test("ordinary tools are never blocked or counted (no 5-call rule)", () => {
  touchAlive();
  const p = payload("Bash");
  try {
    for (let i = 0; i < 12; i++) {
      assert.equal(runClaudePreTool(p, {}), null, `call ${i + 1} stays allowed`);
    }
  } finally {
    cleanup(p);
  }
});

test("ordinary allowed tools return neutral output when culled", () => {
  touchAlive();
  const p = payload("Bash");
  try {
    withSlotDir((slotDir) => {
      writeSlotMetadata(slotPathForAgent(slotDir, "agent-pretool-allowed"), {
        agent_id: "agent-pretool-allowed",
        server_pid: 123,
        child_pid: process.pid,
        last_activity_ms: Date.now() - ZOMBIE_LIVE_IDLE_MS - 1000,
        status: "processing",
      });
      const result = runClaudePreTool(p, {});
      assert.equal(result?.hookSpecificOutput.permissionDecision, "allow");
      assert.equal(result?.hookSpecificOutput.permissionDecisionReason, "maintenance completed; allowing requested tool.");
      assert.equal(result?.hookSpecificOutput.additionalContext, undefined);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)),
        "allowed PreToolUse maintenance output must remain JSON-serializable");
    });
  } finally {
    cleanup(p);
  }
});

test("fail-open liveness path returns neutral output when culled", () => {
  const p = payload("Task");
  try {
    withSlotDir((slotDir) => {
      writeSlotMetadata(slotPathForAgent(slotDir, "agent-pretool-liveness"), {
        agent_id: "agent-pretool-liveness",
        server_pid: 123,
        child_pid: process.pid,
        last_activity_ms: Date.now() - ZOMBIE_LIVE_IDLE_MS - 1000,
        status: "processing",
      });
      const result = runClaudePreTool(p, {}, Date.now() + LIVENESS_TTL_MS + 1);
      assert.equal(result?.hookSpecificOutput.permissionDecision, "allow");
      assert.equal(result?.hookSpecificOutput.permissionDecisionReason, "maintenance completed; allowing requested tool.");
      assert.equal(result?.hookSpecificOutput.additionalContext, undefined);
    });
  } finally {
    cleanup(p);
  }
});

test("ordinary allowed tools still return null when no zombies are culled", () => {
  touchAlive();
  const p = payload("Bash");
  try {
    assert.equal(runClaudePreTool(p, {}), null);
  } finally {
    cleanup(p);
  }
});

test("subagent-mcp and question tools stay allowed", () => {
  touchAlive();
  for (const tool of [
    "mcp__subagent_mcp__launch_agent",
    "mcp__subagent-mcp__wait",
    "AskUserQuestion",
  ]) {
    const p = payload(tool);
    try {
      for (let i = 0; i < 8; i++) {
        assert.equal(runClaudePreTool(p, {}), null, `${tool} remains allowed`);
      }
    } finally {
      cleanup(p);
    }
  }
});

test("subagent env still denies native Task/Agent/Explore tools", () => {
  touchAlive();
  for (const tool of ["Task", "Agent", "Explore"]) {
    const p = payload(tool);
    try {
      const result = runClaudePreTool(p, { SUBAGENT_MCP_SUBAGENT: "1" });
      assert.equal(result?.hookSpecificOutput.permissionDecision, "deny");
      assert.match(result?.hookSpecificOutput.permissionDecisionReason ?? "", /launch_agent/);
    } finally {
      cleanup(p);
    }
  }
});

test("subagent env still allows ordinary inline tools", () => {
  touchAlive();
  const p = payload("Bash");
  try {
    assert.equal(runClaudePreTool(p, { SUBAGENT_MCP_SUBAGENT: "1" }), null);
  } finally {
    cleanup(p);
  }
});

test("source comments no longer mention the retired 200-line self-estimation doctrine", () => {
  const source = readFileSync(join(process.cwd(), "src", "orchestration", "pretool.ts"), "utf8");
  assert.doesNotMatch(source, /200 line/i);
  assert.doesNotMatch(source, /self-estimat/i);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
