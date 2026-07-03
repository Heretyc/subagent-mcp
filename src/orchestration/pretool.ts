import { serverAlive } from "./liveness.js";
import { type HookPayload } from "./hook-core.js";
import { cullHookZombies, hookZombieReportText } from "./hook-core.js";

const NATIVE_SUBAGENT_TOOLS = new Set(["Task", "Agent", "Explore"]);

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
 * deny harness-native Task/Agent/Explore while subagent-mcp is alive so all
 * sub-agent launches route through launch_agent. There is NO inline tool-call
 * counter — the old inline tool-call-count injection is gone (D11/D24).
 * Long-horizon
 * upgrades are now agent-self-driven via the OFF-mode cumulative footprint
 * check (no hook-side counting).
 */
export function runClaudePreTool(
  payload: PreToolPayload,
  env: NodeJS.ProcessEnv,
  now: number = Date.now()
): PreToolDecision | null {
  try {
    const zombieReport = hookZombieReportText(cullHookZombies());
    if (env.SUBAGENT_MCP_SUBAGENT === "1") return null;

    const zombieAllowedDecision = zombieReport
      ? decision("allow", "zombies culled; allowing requested tool.", zombieReport)
      : null;

    if (!serverAlive(now)) return zombieAllowedDecision;

    const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
    if (!tool) return zombieAllowedDecision;

    if (NATIVE_SUBAGENT_TOOLS.has(tool)) {
      return decision(
        "deny",
        "subagent-mcp is alive; harness-native Task/Agent/Explore is not the sanctioned sub-agent channel. Use the subagent-mcp launch_agent MCP tool with the parent-process sentinel as prompt line 1.",
        zombieReport || undefined
      );
    }

    return zombieAllowedDecision;
  } catch {
    return null;
  }
}
