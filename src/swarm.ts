/**
 * Agentic-swarm stage machine + performance-pin window.
 *
 * Pure and in-memory: no fs, no timers, injectable `now`. Mirrors the
 * createDeadlockWindow factory style in src/deadlock.ts — index.ts holds ONE
 * session instance beside the deadlock window, so a server restart resets the
 * swarm to IDLE by construction (nothing is ever persisted).
 *
 * This module is the source of truth for every swarm-facing string; docs mirror
 * it, never the other way around. Contract: docs/spec/swarm/_INDEX.md.
 *
 * Call semantics: `swarm(N)` means "stage N is DONE". Replies are ALWAYS
 * non-error — out-of-order, repeated, idle, and unknown-stage calls return
 * corrective coaching and change nothing, so a confused caller is steered back
 * onto the sequence instead of being handed a protocol failure.
 */

export const SWARM_STAGE_COUNT = 7;

/** Pin lifetime: performance-band routing is reachable for at most 1 hour per accepted advance. */
export const SWARM_PIN_WINDOW_MS = 60 * 60 * 1000;

/** Branch names as consumed by the routing table (mirrors RoutingBranch in src/routing.ts). */
export type RoutingBranchName = "cost_efficiency" | "performance";

type SwarmStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SwarmReply {
  text: string;
}

export interface SwarmSnapshot {
  active: boolean;
  current_stage: number | null;
  stage_name: string | null;
  pin_active: boolean;
  pin_expires_at: number | null;
}

export interface SwarmSession {
  /** Handle one swarm tool call. `stage` is null for "start the swarm". */
  handleCall(stage: number | null, now: number): SwarmReply;
  /** True only inside the pre-handoff stages (1-4) while the window is unexpired. */
  pinActive(now: number): boolean;
  /** Sanctioned get_status exposure; a pure read, never mutates state. */
  snapshot(now: number): SwarmSnapshot;
}

export const STAGE_NAMES: readonly string[] = [
  "planning-team",
  "critic-judgment",
  "write-plan-files",
  "master-goal-prompt",
  "handoff-resume",
  "dispatch",
  "test-complete",
];

// ---------------------------------------------------------------------------
// Hardcoded coaching text (pure ASCII). Every stage-K block ends with the
// literal instruction to call swarm(K) when stage K's work is done, so the
// orchestrator never has to infer the next call.
// ---------------------------------------------------------------------------

export const STAGE_COACHING: Readonly<Record<SwarmStage, string>> = {
  1: [
    "SWARM STAGE 1 of 7 - PLANNING TEAM.",
    "You are running an agentic swarm: a staged workflow for objectives projected to span multiple sessions. Follow each stage's coaching exactly; the server tracks the current stage in memory for THIS session only.",
    "Stage 1 work:",
    "1. Launch a planning team of exactly 4 sub-agents via launch_agent: 3 architects (task_category architecture) and 1 critic (task_category quality_review). Auto mode only - pass NO provider/model/effort.",
    "2. Brief every architect with the COMPLETE objective. Together they must evaluate ALL work needed for the final deliverable(s), decide the sub-orchestrator count, and partition the work into disjoint, reasonably uniform sections - exactly one plan per sub-orchestrator.",
    "3. Architects exchange drafts through scratch files under the temp dir (%TEMP% on Windows, /tmp on POSIX); assign the paths in their prompts. You NEVER read those files - you handle paths only.",
    "4. Collect the agreed sub-orchestrator count and one draft-plan scratch path per sub-orchestrator.",
    "Do NOT write final plan files yet and do NOT dispatch any implementation work in this stage.",
    "When stage 1 is done, call swarm(1).",
  ].join("\n"),
  2: [
    "SWARM STAGE 2 of 7 - CRITIC JUDGMENT.",
    "Every draft plan MUST be judged by the critic BEFORE it is written to its final plan file.",
    "1. For each draft, task the critic sub-agent with the draft's scratch path. The critic returns a verdict: APPROVED, or REVISE with concrete objections.",
    "2. On REVISE, route the objections to the owning architect for a revision, then re-judge. HARD CAP: 3 revise/re-judge rounds per plan.",
    "3. If any plan is still not APPROVED after 3 rounds, STOP and escalate to the user via the structured-question tool, carrying the unresolved objections. Never proceed on an unapproved plan.",
    "4. Track the approved draft scratch path for every sub-orchestrator.",
    "When every plan is APPROVED (or the user has resolved an escalation), call swarm(2).",
  ].join("\n"),
  3: [
    "SWARM STAGE 3 of 7 - WRITE PLAN FILES.",
    "1. Have a sub-agent write each APPROVED plan to its own file in the temp dir (%TEMP% on Windows, /tmp on POSIX), one file per sub-orchestrator, e.g. <TEMP>/swarm-plan-<n>-<slug>.md.",
    "2. Collect the FULL RESOLVED absolute path of every plan file.",
    "3. You are the master orchestrator: handle these paths ONLY. NEVER read, summarize, or edit the plan files yourself - each sub-orchestrator reads its own plan later.",
    "When every plan file exists and you hold every absolute path, call swarm(3).",
  ].join("\n"),
  4: [
    "SWARM STAGE 4 of 7 - MASTER GOAL PROMPT.",
    "1. Build the master orchestrator goal prompt for the NEXT session. It MUST embed: the overall objective, the full resolved plan file path list (one per sub-orchestrator), the instruction to resume via the smcp-handoff skill, the literal instruction to call swarm(5) once resumed, and the rule that the next session handles plan file PATHS only and never reads the plan files itself.",
    "2. PRINT the finished goal prompt directly in chat for the user to copy/paste into the next session. Do NOT deliver it via handoff-write - printing is deliberate so the user owns the session boundary.",
    "When the goal prompt has been printed in chat, call swarm(4).",
  ].join("\n"),
  5: [
    "SWARM STAGE 5 of 7 - HANDOFF AND RESUME.",
    "1. Follow the normal handoff flow for this working directory: when handoff-write is unlocked (>=20% context), write the handoff record per its tool contract and relay its response verbatim; confirm the user is ready via the structured-question tool.",
    "2. The user starts a NEW session and pastes the printed master goal prompt. The new session resumes via the smcp-handoff skill (handoff-read plus its 4 confirm questions).",
    "3. Swarm state is in-memory only, so the NEW session's server holds no swarm state: in the resumed session, swarm(5) is the designated re-entry call.",
    "When handoff and resume are complete (you are the resumed session), call swarm(5).",
  ].join("\n"),
  6: [
    "SWARM STAGE 6 of 7 - PARALLEL SUB-ORCHESTRATOR DISPATCH.",
    "1. For EACH plan file path in the master goal prompt, launch exactly ONE sub-agent via launch_agent with sub-orchestrator: true and task_category agentic_execution. Auto mode only - no provider/model/effort.",
    "2. Each prompt MUST state: the objective, that agent's ONE plan file path (it reads the plan itself), the boundaries of its disjoint section, the worktree/serialization rules (never concurrent writers over overlapping paths), and the required JSON completion summary.",
    "3. Dispatch all sub-orchestrators in parallel, then supervise with the wait tool on loop; use poll_agent tails only when needed.",
    "Sub-orchestrators are delegate-only orchestrators for their own section; their children are normal sub-agents. NEVER set sub-orchestrator: true outside this dispatch pattern.",
    "When every sub-orchestrator has finished its section, call swarm(6).",
  ].join("\n"),
  7: [
    "SWARM STAGE 7 of 7 - TEST AND COMPLETE.",
    "1. Dispatch fresh verification sub-agents (task_category quality_review, debugging, or agentic_execution as fits) to test ALL completed work against each plan's done-conditions: build, unit tests, and feature-level checks.",
    "2. INSUFFICIENT results: re-dispatch - launch a corrective sub-orchestrator (sub-orchestrator: true) or a targeted worker per failing section, then re-test. Repeat inside this stage until results are sufficient.",
    "3. SUFFICIENT results: report the verified outcome to the user.",
    "When all work verifies as sufficient, call swarm(7) to complete the swarm.",
  ].join("\n"),
};

export const SWARM_COMPLETE_TEXT: string = [
  "SWARM COMPLETE.",
  "All 7 stages are done and the swarm session has been reset. Report the final results to the user: what shipped, how it was verified, and any residual risks. A future multi-session objective can start a fresh swarm with swarm().",
].join("\n");

export const SWARM_RESET_TEXT: string = [
  "SWARM RESET.",
  "The active swarm was abandoned: stage state and any swarm routing state were cleared. Call swarm() to start a new swarm from stage 1.",
].join("\n");

export const SWARM_REENTRY_PREFIX: string =
  "SWARM RESUMED - post-handoff re-entry accepted (stage 5 recorded as done).";

export const SWARM_TOOL_DESCRIPTION: string =
  "Agentic-swarm staged workflow coach for work objectives projected to span MULTIPLE sessions - OFFER it to the user whenever you project that. Fixed 7-stage sequence: (1) planning team of 3 architects + 1 critic builds one plan per sub-orchestrator -> (2) critic judges every plan BEFORE it is written to disk, max 3 revision rounds then escalate to the user -> (3) approved plans written to temp files; the orchestrator handles PATHS only and never reads them -> (4) master goal prompt embedding those paths is PRINTED in chat for copy/paste (never via handoff-write) -> (5) handoff to a new session and resume -> (6) parallel sub-orchestrator dispatch, one per plan path -> (7) test all work, re-dispatch until sufficient, complete. CALLING: swarm() or swarm(null) starts and returns stage-1 coaching; swarm(N) means \"stage N is done\" and returns the NEXT stage's coaching plus the exact next call; swarm(0) abandons. Out-of-order or unknown stages return corrective coaching stating the expected current stage and never advance state. State is IN-MEMORY for THIS session only (never on disk); after the stage-5 handoff the resumed session calls swarm(5) as the designated re-entry. Follow each stage's returned coaching exactly and keep the harness task tracker updated.";

export const SWARM_STAGE_PARAM_GLOSS: string =
  "Omit or pass null to START the swarm (returns stage-1 coaching). Pass N (1-7) to report \"stage N is done\" and receive the next stage's coaching. Pass 0 to abandon the active swarm. Out-of-order values return corrective coaching and change nothing.";

// ---------------------------------------------------------------------------
// Corrective builders. All embed the CURRENT stage's coaching so a misrouted
// call still leaves the caller holding the instructions it actually needs.
// ---------------------------------------------------------------------------

function stageName(stage: number): string {
  return STAGE_NAMES[stage - 1];
}

function coaching(stage: number): string {
  return STAGE_COACHING[stage as SwarmStage];
}

export function outOfOrderText(called: number, stage: number): string {
  return (
    "SWARM OUT-OF-ORDER CALL.\n" +
    `You called swarm(${called}), but this swarm is at stage ${stage} of 7 (${stageName(stage)}). ` +
    `Nothing changed. Finish stage ${stage}, then call swarm(${stage}). To abandon the swarm, call swarm(0). ` +
    "Current stage coaching follows.\n\n" +
    coaching(stage)
  );
}

export function repeatText(called: number, stage: number): string {
  return (
    "SWARM REPEAT CALL.\n" +
    `Stage ${called} is already recorded as done; repeating the report changes nothing and does not extend any swarm state. ` +
    `This swarm is at stage ${stage} of 7 (${stageName(stage)}). Finish stage ${stage}, then call swarm(${stage}). ` +
    "Current stage coaching follows.\n\n" +
    coaching(stage)
  );
}

export function alreadyActiveText(stage: number): string {
  return (
    "SWARM ALREADY ACTIVE.\n" +
    `A swarm is already at stage ${stage} of 7 (${stageName(stage)}); swarm() only starts a NEW swarm from idle. ` +
    "Nothing changed. To abandon and restart, call swarm(0). Current stage coaching follows.\n\n" +
    coaching(stage)
  );
}

export function notActiveText(called: number): string {
  return (
    "SWARM NOT ACTIVE.\n" +
    `You called swarm(${called}), but no swarm is active in this session (swarm state is in-memory and per-session). ` +
    "Call swarm() to start at stage 1, or swarm(5) ONLY if you are a resumed post-handoff session holding a printed swarm master goal prompt with plan file paths."
  );
}

export function notActiveResetText(): string {
  return "SWARM NOT ACTIVE.\nThere is no active swarm to reset. Call swarm() to start one.";
}

export function invalidStageText(got: unknown, currentStage: number | null): string {
  const expected =
    currentStage === null
      ? "No swarm is active; call swarm() to start"
      : `This swarm is at stage ${currentStage} of 7; the expected call is swarm(${currentStage})`;
  return (
    "SWARM STAGE UNKNOWN.\n" +
    `${String(got)} is not a swarm stage. Valid calls: swarm() or swarm(null) to start a swarm, ` +
    "swarm(N) with N 1-7 to report stage N done, swarm(0) to abandon an active swarm. " +
    `${expected}. Nothing changed.`
  );
}

/**
 * Branch selection for auto-mode launches (index.ts call site).
 *
 * The swarm pin sits INSIDE the pure-auto guard exactly like the deadlock
 * window: provider/provider_model launches ALWAYS read cost_efficiency, so a
 * pinned swarm can never widen the manual-selector surface. With the pin
 * inactive this reproduces the pre-swarm expression exactly.
 */
export function resolveBranch(
  pureAuto: boolean,
  deadlockActive: boolean,
  swarmPinActive: boolean,
): RoutingBranchName {
  return pureAuto && (deadlockActive || swarmPinActive)
    ? "performance"
    : "cost_efficiency";
}

/**
 * One swarm session per server process. State is `{ currentStage, pinExpiresAt }`;
 * currentStage null = IDLE.
 *
 * PIN RULES (anti-gaming; docs/spec/swarm/_INDEX.md):
 * - ARM/RESTART only on an ACCEPTED forward advance into a pre-handoff stage,
 *   i.e. the idle start and accepted swarm(1)/swarm(2)/swarm(3). Each restart
 *   REPLACES the expiry rather than extending it.
 * - A REPEATED call to an already-reported stage, an out-of-order call, an
 *   already-active call, an idle call, and an invalid call NEVER touch the pin,
 *   so spamming stage reports cannot hold the window open.
 * - Accepted swarm(4) force-clears the pin because handoff is now the next
 *   stage; the 1h lazy expiry clears it otherwise. Whichever comes first wins.
 */
export function createSwarmSession(): SwarmSession {
  let currentStage: number | null = null;
  let pinExpiresAt: number | null = null;

  function pinActive(now: number): boolean {
    return (
      currentStage !== null &&
      currentStage >= 1 &&
      currentStage <= 4 &&
      pinExpiresAt !== null &&
      now < pinExpiresAt
    );
  }

  function handleCall(stage: number | null, now: number): SwarmReply {
    // START / already-active: swarm() and swarm(null) are the same call.
    if (stage === null) {
      if (currentStage === null) {
        currentStage = 1;
        pinExpiresAt = now + SWARM_PIN_WINDOW_MS;
        return { text: coaching(1) };
      }
      return { text: alreadyActiveText(currentStage) };
    }

    // Validated HERE, not in the zod shape, so a bad value gets corrective
    // coaching instead of a protocol validation error the caller cannot read.
    if (!Number.isInteger(stage) || stage < 0 || stage > SWARM_STAGE_COUNT) {
      return { text: invalidStageText(stage, currentStage) };
    }

    // Explicit reset.
    if (stage === 0) {
      if (currentStage === null) {
        return { text: notActiveResetText() };
      }
      currentStage = null;
      pinExpiresAt = null;
      return { text: SWARM_RESET_TEXT };
    }

    if (currentStage === null) {
      // Cold swarm(5) is the ONE designated post-handoff re-entry: in-memory
      // state cannot survive the handoff's new session. Cold 1-4 would arm
      // pinned territory without a real start (gaming vector) and cold 6/7
      // would skip the dispatch it claims is done, so neither adopts.
      if (stage === 5) {
        currentStage = 6;
        return { text: `${SWARM_REENTRY_PREFIX}\n\n${coaching(6)}` };
      }
      return { text: notActiveText(stage) };
    }

    if (stage !== currentStage) {
      // A repeat of the stage just reported is common and harmless, but it is
      // called out separately so the caller learns the report already landed -
      // and it explicitly does NOT restart the pin window.
      return {
        text:
          stage === currentStage - 1
            ? repeatText(stage, currentStage)
            : outOfOrderText(stage, currentStage),
      };
    }

    // Accepted forward advance.
    if (currentStage === SWARM_STAGE_COUNT) {
      currentStage = null;
      pinExpiresAt = null;
      return { text: SWARM_COMPLETE_TEXT };
    }
    const reported = currentStage;
    currentStage = reported + 1;
    if (reported <= 3) {
      pinExpiresAt = now + SWARM_PIN_WINDOW_MS;
    } else if (reported === 4) {
      // Stage 5 (handoff) is now next: the pin dies here regardless of the 1h clock.
      pinExpiresAt = null;
    }
    return { text: coaching(currentStage) };
  }

  return {
    handleCall,
    pinActive,
    snapshot(now: number): SwarmSnapshot {
      return {
        active: currentStage !== null,
        current_stage: currentStage,
        stage_name: currentStage === null ? null : stageName(currentStage),
        pin_active: pinActive(now),
        pin_expires_at: pinExpiresAt,
      };
    },
  };
}
