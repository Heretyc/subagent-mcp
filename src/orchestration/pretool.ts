import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwdHash, stateDir } from "./marker.js";
import { serverAlive } from "./liveness.js";
import { sessionKey, type HookPayload } from "./hook-core.js";

export const INLINE_TOOL_LIMIT = 5;

const NATIVE_SUBAGENT_TOOLS = new Set(["Task", "Agent", "Explore"]);
const QUESTION_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const SUBAGENT_MCP_TOOL_RE =
  /(^|__)subagent[-_]?mcp(__|$).*(launch_agent|poll_agent|wait|list_agents|send_message|kill_agent)$/i;

export interface PreToolPayload extends HookPayload {
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
}

export interface PreToolDecision {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny" | "ask";
    permissionDecisionReason: string;
    additionalContext?: string;
  };
}

function hash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

function owner(payload: HookPayload): string {
  return sessionKey(payload) ?? "null";
}

function countPath(payload: HookPayload): string {
  const cwd = payload.cwd || process.cwd();
  return join(stateDir, `pretool-${cwdHash(cwd)}-${hash(owner(payload))}.json`);
}

function readCount(payload: HookPayload): number {
  try {
    const parsed = JSON.parse(readFileSync(countPath(payload), "utf8")) as { count?: unknown };
    return typeof parsed.count === "number" && parsed.count >= 0 ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function writeCount(payload: HookPayload, count: number): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      countPath(payload),
      JSON.stringify({ owner: owner(payload), count, updated_at: Date.now() }),
      { encoding: "utf8", mode: 0o600 }
    );
  } catch {
    // Fail open: counter persistence is advisory enforcement, not host safety.
  }
}

export function resetToolCount(payload: HookPayload): void {
  try {
    if (existsSync(countPath(payload))) unlinkSync(countPath(payload));
  } catch {
    // Fail open.
  }
}

function decision(
  permissionDecision: "deny" | "ask",
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

function isSubagentMcpTool(tool: string): boolean {
  return (
    SUBAGENT_MCP_TOOL_RE.test(tool) ||
    [
      "launch_agent",
      "poll_agent",
      "wait",
      "list_agents",
      "send_message",
      "kill_agent",
    ].includes(tool)
  );
}

function exemptFromCounter(tool: string): boolean {
  return isSubagentMcpTool(tool) || QUESTION_TOOLS.has(tool);
}

export function runClaudePreTool(
  payload: PreToolPayload,
  env: NodeJS.ProcessEnv,
  now: number = Date.now()
): PreToolDecision | null {
  try {
    if (env.SUBAGENT_MCP_SUBAGENT === "1") return null;
    if (!serverAlive(now)) return null;

    const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
    if (!tool) return null;

    if (NATIVE_SUBAGENT_TOOLS.has(tool)) {
      return decision(
        "deny",
        "subagent-mcp is alive; harness-native Task/Agent/Explore is not the sanctioned sub-agent channel. Use the subagent-mcp launch_agent MCP tool with the parent-process sentinel as prompt line 1."
      );
    }

    if (exemptFromCounter(tool)) return null;

    const next = readCount(payload) + 1;
    writeCount(payload, next);
    if (next <= INLINE_TOOL_LIMIT) return null;

    return decision(
      "ask",
      `5-CALL RULE: this is tool call ${next} for the current user request. If work remains, delegate through subagent-mcp launch_agent; allow only for main-session-only capability or tight verification.`,
      "5-CALL RULE reached. Route remaining non-main-session work through subagent-mcp launch_agent; inline only for main-session-only capability or tight verification."
    );
  } catch {
    return null;
  }
}
