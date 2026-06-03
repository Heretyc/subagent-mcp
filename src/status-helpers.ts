// Pure, unit-testable status-transition logic for sub-agents.
// `processing` (renamed from `stalled`) means alive-but-quiet, NOT a failure.

export const STALL_THRESHOLD = 60000;

export type AgentStatus =
  | "running"
  | "completed"
  | "failed"
  | "processing"
  | "killed";

export interface StatusTransitionInput {
  status: AgentStatus;
  exitCode: number | null;
  lastActivity: number;
  now: number;
  exitedAt: number | null;
}

export interface StatusTransitionResult {
  status: AgentStatus;
  exitedAt: number | null;
}

// Exit reconciliation is FIRST and authoritative: a live agent whose process
// has exited becomes completed/failed regardless of idle time. Otherwise a live
// agent toggles between running (recent output) and processing (quiet >= 60s).
export function computeStatusTransition(
  input: StatusTransitionInput
): StatusTransitionResult {
  const { status, exitCode, lastActivity, now } = input;
  const isLive = status === "running" || status === "processing";

  if (isLive && exitCode !== null) {
    return {
      status: exitCode === 0 ? "completed" : "failed",
      exitedAt: input.exitedAt ?? now,
    };
  }

  if (status === "processing" && now - lastActivity <= STALL_THRESHOLD) {
    return { status: "running", exitedAt: input.exitedAt };
  }

  if (status === "running" && now - lastActivity > STALL_THRESHOLD) {
    return { status: "processing", exitedAt: input.exitedAt };
  }

  return { status, exitedAt: input.exitedAt };
}

export interface LivenessFields {
  alive: boolean;
  idle_seconds: number;
  hint?: string;
}

// Pure formatter for the per-agent liveness fields shared by poll_agent and
// list_agents. `hint` is present ONLY when status === "processing".
export function buildLivenessFields(
  status: AgentStatus,
  exitCode: number | null,
  lastActivity: number,
  now: number
): LivenessFields {
  const idle_seconds = Math.floor((now - lastActivity) / 1000);
  const alive = exitCode === null && (status === "running" || status === "processing");
  const fields: LivenessFields = { alive, idle_seconds };
  if (status === "processing") {
    fields.hint =
      `alive but quiet for ${idle_seconds}s; the process is still running and ` +
      `may be thinking or awaiting a temp-file handoff. Prefer \`wait\` or re-poll (or ` +
      `check its temp output) before killing.`;
  }
  return fields;
}
