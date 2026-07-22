import { serverAlive } from "./liveness.js";
import { type HookPayload } from "./hook-core.js";
import { cullHookZombies } from "./hook-core.js";

/**
 * Harness-native sub-agent launchers gated by the sole-channel rule. Exactly
 * `Agent`: Claude's task/widget tools (Task, TaskCreate, TaskUpdate, TaskGet,
 * TaskList, TaskOutput, TaskStop) are not sub-agent launchers and must pass
 * through, and `Explore` is only reachable as an `Agent` subagent_type.
 */
const NATIVE_SUBAGENT_TOOLS = new Set(["Agent"]);

export interface PreToolPayload extends HookPayload {
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
}

export interface PreToolDecision {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny" | "ask" | "allow";
    permissionDecisionReason: string;
    additionalContext?: string;
  };
}

function decision(
  permissionDecision: "deny" | "ask" | "allow",
  permissionDecisionReason: string,
  additionalContext?: string
): PreToolDecision {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason,
      ...(additionalContext ? { additionalContext } : {}),
    },
  };
}

/**
 * Claude PreToolUse gate. The ONLY enforcement here is the sole-channel rule:
 * deny the harness-native Agent tool while subagent-mcp is alive so all
 * sub-agent launches route through launch_agent. Task* widget tools are NOT
 * gated — they are not sub-agent launchers. There is NO inline tool-call
 * counter — the old inline tool-call-count injection is gone (D11/D24).
 * Long-horizon upgrades are now driven by provider-metered context tracking
 * (see docs/spec/dev-loop/orchestration-directive-architecture/context-metering.md),
 * not any hook-side footprint counting.
 */
export function runClaudePreTool(
  payload: PreToolPayload,
  env: NodeJS.ProcessEnv,
  now: number = Date.now()
): PreToolDecision | null {
  try {
    const zombieRecords = cullHookZombies();
    const maintenanceAllowedDecision = zombieRecords.length > 0
      ? decision("allow", "maintenance completed; allowing requested tool.")
      : null;

    if (!serverAlive(now)) return maintenanceAllowedDecision;

    const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
    if (!tool) return maintenanceAllowedDecision;

    if (NATIVE_SUBAGENT_TOOLS.has(tool)) {
      return decision(
        "deny",
        "subagent-mcp is alive; the harness-native Agent tool is not the sanctioned sub-agent channel. Use the subagent-mcp launch_agent MCP tool with the parent-process sentinel as prompt line 1."
      );
    }

    if (env.SUBAGENT_MCP_SUBAGENT === "1") return maintenanceAllowedDecision;

    return maintenanceAllowedDecision;
  } catch {
    return null;
  }
}
