import { serverAlive } from "./liveness.js";
import { type HookPayload } from "./hook-core.js";
import { computeEffectiveActive, cullHookZombies, sessionKey } from "./hook-core.js";
import { anonKey } from "./marker.js";
import { readDoctrine } from "../concurrency.js";

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

    const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";

    if (tool && NATIVE_SUBAGENT_TOOLS.has(tool)) {
      const doctrine = readDoctrine();
      if (doctrine === "windowed") {
        const cwd = payload.cwd || process.cwd();
        const current = sessionKey(payload) ?? anonKey(cwd, "claude");
        // The one doctrine read above is threaded through so the branch and
        // the effective-state decision cannot disagree; the fail-safe term is
        // inert under windowed, so passing `false` is exact. A payload without
        // a session_id falls back to the anon key, which marker.isActive
        // treats as unconditionally ON -> still denied. This check runs
        // BEFORE the liveness bail on purpose: init/setup writes a static
        // permissions.deny for Agent into the harness settings, and only an
        // explicit PreToolUse "allow" outranks it - abstaining with the
        // server down would leave a windowed OFF session with no sub-agent
        // channel at all.
        if (!computeEffectiveActive(cwd, current, now, false, doctrine)) {
          return decision(
            "allow",
            "user.doctrine=windowed and orchestration is OFF for this session; the harness-native Agent tool is permitted while OFF. It is denied again whenever orchestration-mode is ON."
          );
        }
      }
      if (!serverAlive(now)) return maintenanceAllowedDecision;
      return decision(
        "deny",
        "subagent-mcp is alive; the harness-native Agent tool is not the sanctioned sub-agent channel. Use the subagent-mcp launch_agent MCP tool with the parent-process sentinel as prompt line 1."
      );
    }

    if (!serverAlive(now)) return maintenanceAllowedDecision;
    if (!tool) return maintenanceAllowedDecision;

    if (env.SUBAGENT_MCP_SUBAGENT === "1") return maintenanceAllowedDecision;

    return maintenanceAllowedDecision;
  } catch {
    return null;
  }
}
