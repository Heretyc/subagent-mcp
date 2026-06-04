// Pure, unit-testable status-transition logic for sub-agents.
//
// Public status enum (visible-stream activity model):
//   processing - ALIVE and seen visible provider activity within the heartbeat
//                window. Counts against provider concurrency caps.
//   stalled    - ALIVE but NO parsed visible provider stream item for the
//                heartbeat window. NOT a failure and NOT terminal; does NOT
//                count against provider concurrency caps.
//   finished   - process exited 0.
//   errored    - process exited non-zero.
//   stopped    - process was killed.
//
// Liveness is driven by a heartbeat: launch time is the initial heartbeat and
// every subsequent PARSED visible provider stream item refreshes it (raw
// raw stdout/stderr bytes do not). A live agent is
// `processing` until the heartbeat is older than the window, at which point it
// becomes `stalled`. Resumed visible activity returns it to `processing`.

// 10-minute visible-stream heartbeat window. A live agent with no parsed
// visible provider stream item for this long becomes `stalled`.
export const HEARTBEAT_TIMEOUT_MS = 600000;

export type AgentStatus =
  | "processing"
  | "stalled"
  | "finished"
  | "errored"
  | "stopped";

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
// has exited becomes finished/errored regardless of heartbeat age. Otherwise a
// live agent toggles between `processing` (recent visible activity) and
// `stalled` (heartbeat older than the window).
export function computeStatusTransition(
  input: StatusTransitionInput
): StatusTransitionResult {
  const { status, exitCode, lastActivity, now } = input;
  const isLive = status === "processing" || status === "stalled";

  if (isLive && exitCode !== null) {
    return {
      status: exitCode === 0 ? "finished" : "errored",
      exitedAt: input.exitedAt ?? now,
    };
  }

  if (status === "stalled" && now - lastActivity <= HEARTBEAT_TIMEOUT_MS) {
    return { status: "processing", exitedAt: input.exitedAt };
  }

  if (status === "processing" && now - lastActivity > HEARTBEAT_TIMEOUT_MS) {
    return { status: "stalled", exitedAt: input.exitedAt };
  }

  return { status, exitedAt: input.exitedAt };
}

export interface LivenessFields {
  alive: boolean;
  idle_seconds: number;
  hint?: string;
}

// Pure formatter for the per-agent liveness fields shared by poll_agent and
// list_agents. `hint` is present ONLY when status === "stalled" AND the caller
// opts in (poll_agent does; list_agents omits it to stay token-efficient).
export function buildLivenessFields(
  status: AgentStatus,
  exitCode: number | null,
  lastActivity: number,
  now: number,
  includeHint = true
): LivenessFields {
  const idle_seconds = Math.floor((now - lastActivity) / 1000);
  const alive = exitCode === null && (status === "processing" || status === "stalled");
  const fields: LivenessFields = { alive, idle_seconds };
  if (status === "stalled" && includeHint) {
    fields.hint =
      `alive but no visible provider activity for ${idle_seconds}s; the process ` +
      `is still running and may be thinking or awaiting a temp-file handoff. ` +
      `Prefer \`wait\` or re-poll (or check its temp output) before killing.`;
  }
  return fields;
}
