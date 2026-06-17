#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, spawnSync, execSync } from "child_process";
import { unlinkSync, existsSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "crypto";
import { isAbsolute, basename, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "url";
import { Provider, buildCommand } from "./effort.js";
import { createProviderDriver, type DriverProcess, type ProviderDriver } from "./drivers.js";
import { resolveExeFor } from "./platform.js";
import { formatLocalIso, selectUnreported } from "./wait-helpers.js";
import type { AgentStatus } from "./status-helpers.js";
import {
  computeStatusTransition,
  buildLivenessFields,
} from "./status-helpers.js";
import { extractFinalTurn } from "./output-helpers.js";
import {
  consumeStreamChunk,
  flushStream,
  isTurnCompletedLine,
  retainLastN,
  type VisibleStreamItem,
} from "./stream-helpers.js";
import {
  loadRoutingTable,
  buildCandidates,
  validatePresence,
  TASK_CATEGORIES,
  AUTO_HINT,
  SPLIT_HINT,
  type Candidate,
  type SelectionMode,
  type RoutingBranch,
} from "./routing.js";
import { createDeadlockWindow } from "./deadlock.js";
import {
  createRulesetGate,
  RULESET_HARD_FAIL_MSG,
  type RulesetStdinPayload,
} from "./ruleset.js";
import * as orchestrationMarker from "./orchestration/marker.js";
import * as modelMode from "./orchestration/model-mode.js";
import { startLivenessHeartbeat } from "./orchestration/liveness.js";
import { ensureParentMarker } from "./launch-prompt.js";

type FailureType = "transient_provider" | "permanent";

interface AgentState {
  id: string;
  provider: Provider;
  model: string;
  status: AgentStatus;
  process: DriverProcess;
  driver: ProviderDriver;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  exitedAt: number | null;
  startedAt: number;
  lastActivity: number;
  cwd: string;
  ucSettingsPath?: string;
  waitReported: boolean;
  routingTier?: "cost_efficiency" | "performance" | "manual";
  // Set ONLY when the advanced ruleset actually ALTERED the routing decision
  // for this launch (ran-but-passthrough and disabled leave both fields absent).
  rulesetApplied?: boolean;
  rulesetOriginalSelection?: { provider: string; model: string; effort: string };
  // Set ONLY by provider turn-completion marker scans (stdout data + close
  // flush handlers). The grace window's sole success exception keys on this
  // flag — NOT on status, which any code-0 exit also sets to "finished".
  turnCompleted?: boolean;
  // Rolling buffer of the last 3 parsed visible provider stream items.
  // Each item is stamped with its capture time (`at`, ms).
  visibleStream: VisibleStreamItem[];
  // Carried-over partial stdout line (a provider JSONL event split across two
  // stdout chunks). Held until its terminating newline arrives so a valid event
  // is never dropped. Flushed on close.
  streamBuf: string;
  /** Set only when at least one candidate was skipped before this agent launched. */
  failoverFrom?: {
    provider: string;
    model: string;
    effort: string;
    failure_type: FailureType;
  }[];
}

const agents = new Map<string, AgentState>();
const MAX_CLAUDE = 5;
const MAX_CODEX = 5;
const deadlockWindow = createDeadlockWindow();
// Advanced-ruleset gate: per-process latch with exactly the deadlock-window
// scoping. The env-check runs lazily at the FIRST launch_agent call; success
// latches enabled/disabled for the process lifetime, failure never latches.
const rulesetGate = createRulesetGate();

// Post-spawn grace window (ms). A provider driver that exits within this window
// after a successful driver start never launched (not logged in, expired auth, instant
// crash) — the attempt loop silently advances instead of falsely reporting
// success. ANY exit within the window counts, even code 0, EXCEPT a driver
// already finalized by its turn-completed marker (legitimate fast completion).
// SUBAGENT_SPAWN_GRACE_MS overrides (non-negative int; 0 disables only this
// post-start early-exit detection) — a test seam; production never sets it.
const SPAWN_GRACE_MS = (() => {
  const raw = process.env.SUBAGENT_SPAWN_GRACE_MS;
  if (raw === undefined || raw === "") return 1500;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1500;
})();

// TASK_CATEGORIES, AUTO_HINT, SPLIT_HINT, and validatePresence are the pure,
// side-effect-free presence layer — defined in ./routing.js and imported above
// so the handler-validation test can exercise them without importing this entry
// module (which would open the stdio transport).

// Caveman self-classification gloss for the task_category param (tool-description.md).
const TASK_CATEGORY_GLOSS =
  "REQUIRED. Task shape -> routing category (server picks best model for it). Pick ONE: math_proof: deliverable=proof/derivation/formally-checkable result; proof IS deliverable; deductive step-validity under axioms; verified by proof-checker not tests. security_review: deliverable=security verdict/threat-assessment/demonstrated-exploit; adversarial reasoning over attack surface; vuln, auth/authz, crypto, exploitability. debugging: deliverable=verified fix/root-cause; ONLY observed failure (error, crash, red test, regression, flake) preconditions work; done when symptom resolved. quality_review: deliverable=evaluative verdict on existing NON-security artifact, NO observed failure; review diff/PR, compare A-vs-B, validate-vs-spec; never self-review. architecture: deliverable=cross-module design/plan, NO code, NO execution loop; system structure, interface/migration strategy, decompose-into-tasks; >2 files or public API. agentic_execution: deliverable=target end-state via iterate in mutating env (act/observe/adapt loop); run/deploy/provision/browse, tool/function-call, iterate-until-tests-pass. data_analysis: deliverable=empirical finding/model ABOUT structured dataset; query/SQL/dataframe answer, statistic, fit-model-report-drivers; finding scored even if code runs. coding: deliverable=bounded runnable code artifact, one-pass; implement function/module/feature/script, write tests, single-module refactor; compiles/passes-tests. knowledge_synthesis: deliverable=novel integrated prose over sources; synthesize/summarize/translate/draft/explain-across-files; verified by faithfulness/coherence not exact-match. mechanical: deliverable=deterministic single-pass transform/leaf op, exact-match checkable; find/grep/list/rename/reformat/format-convert/extract-to-fixed-schema; minimal reasoning. prompt_engineering: deliverable=designed/optimized prompt or prompt-system steering an LLM/agent; author/refine/eval instructions; system prompt, few-shot, template, prompt rubric; comp-infer parents knowledge_synthesis+coding+quality_review; no direct benchmark. vulnerability_research: deliverable=NOVEL vuln discovery/root-cause/PoC, NOT broad CVE summary; find flaw, root-cause, build PoC; fuzzing, reverse-engineer, exploit primitive; comp-infer parents security_review+debugging+coding; no direct benchmark. molecular_biology: deliverable=reasoned molecular/computational-biology result; sequences, structures, pathways, -omics data; comp-infer parents knowledge_synthesis+data_analysis+math_proof; no direct benchmark. ml_accelerator_design: deliverable=hardware/software design for ML acceleration; dataflow, tiling, memory hierarchy, kernel, roofline; comp-infer parents architecture+coding+math_proof; no direct benchmark. fallback_default: no category matches with confidence (under-specified/mixed/tied); read-only; PREFER splitting work into smaller atomic steps each mapping to one category.";

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function classifyFailureReason(reason: string, stderr: string): FailureType {
  const text = `${reason}\n${stderr}`;
  return /\b429\b|\b5\d{2}\b|quota|usage.?cap|rate.?limit|timeout|connection.?reset|ECONNRESET|ETIMEDOUT|ECONNREFUSED|too many requests|service unavailable|server error|overloaded/i.test(text)
    ? "transient_provider"
    : "permanent";
}

function buildFailoverNote(
  skipped: { provider: string; model: string; effort: string; failure_type: string }[],
  winner: Candidate
): string {
  const top = skipped[0];
  const topLabel = `${top.model}@${top.effort} (${top.provider})`;
  const winnerLabel = `${winner.model}@${winner.effort} (${winner.provider})`;
  return `Rank-1 candidate ${topLabel} failed with ${top.failure_type === "transient_provider" ? "a transient provider error" : "a permanent error"}; auto-selected ${winnerLabel}.`;
}

function failureTypeForError(error: Error, stderr: string): FailureType {
  return (error as Error & { isTransient?: boolean }).isTransient
    ? "transient_provider"
    : classifyFailureReason(error.message, stderr);
}

const isWindows = process.platform === "win32";

let _npmPrefix: string | null = null;
function getNpmPrefix(): string {
  if (!_npmPrefix) {
    _npmPrefix = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
  }
  return _npmPrefix;
}

function resolveExe(provider: Provider): string {
  return resolveExeFor(provider, process.platform, { existsSync, npmPrefix: getNpmPrefix });
}

function cleanupUcSettings(agentState: AgentState): void {
  if (agentState.ucSettingsPath) {
    try {
      if (existsSync(agentState.ucSettingsPath)) {
        unlinkSync(agentState.ucSettingsPath);
      }
    } catch {}
    agentState.ucSettingsPath = undefined;
  }
}

// Concurrency cap accounting: only `processing` agents count against a
// provider's cap. `stalled` agents (live but quiet past the heartbeat window) do
// NOT count, freeing a slot while they idle.
function countProcessing(provider: Provider): number {
  let count = 0;
  for (const a of agents.values()) {
    if (a.provider === provider && a.status === "processing") count++;
  }
  return count;
}

// Synchronously reconcile a single agent's status against the pure transition
// helper. Folds the live process exitCode into AgentState first so an already-
// exited process is reported as completed/failed immediately (no monitor lag).
function reconcileAgent(agent: AgentState, now: number): void {
  if (
    (agent.status === "processing" || agent.status === "stalled") &&
    agent.process.exitCode !== null
  ) {
    agent.exitCode = agent.process.exitCode;
  }
  const next = computeStatusTransition({
    status: agent.status,
    exitCode: agent.exitCode,
    lastActivity: agent.lastActivity,
    now,
    exitedAt: agent.exitedAt,
  });
  agent.status = next.status;
  agent.exitedAt = next.exitedAt;
}

// .unref() so this background reconcile timer never keeps the event loop alive
// on its own — the process (and any test importing this module) can exit cleanly.
const reconcileInterval = setInterval(() => {
  const now = Date.now();
  for (const agent of agents.values()) {
    reconcileAgent(agent, now);
  }
}, 10000);
reconcileInterval.unref();

// Heavy operating-model + governance guidance for ORCHESTRATION MODE. Carried in
// the MCP server `instructions` field so a connecting host reads it ONCE at
// initialize (per the MCP spec the initialize result has an `instructions`
// field) rather than re-injecting it on every turn. The bundled per-turn hook
// injects only a small compact reminder; this is the durable, full explanation.
// Canonical A2 mirror fragment retained byte-identical for
// test/mirror-fragments.test.mjs while ORCHESTRATION_INSTRUCTIONS below stays
// compressed under MCP metadata limits:
// READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.
const ORCHESTRATION_INSTRUCTIONS =
  "subagent-mcp - CANONICAL OPERATING MODEL (full spec: docs/spec/dev-loop/orchestration-directive-architecture.md).\n\nPRECEDENCE. The latest <subagent-mcp state=\"...\"> hook tag and repo/system safety rules are co-supreme; genuine conflict => STOP and ask the user. Only the hook state changes ON/OFF.\n\nSOLE CHANNEL. Every sub-agent launch uses launch_agent; never harness Task/Agent or shell-spawned agents.\n\nORCHESTRATION ON. You are a delegate-ONLY orchestrator. Use only the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. No direct reads/writes; inline-by-right does not exist. Non-delegable atomic step: ask for a one-time exception, do only that step, then resume delegating.\n\nREAD LADDER. poll_agent tail -> one <=100-line summarizer sub-agent, trusted as-is -> else the USER reads it. Large handoffs use scratch-file paths; producer writes, consumer reads; orchestrator never reads those files. Empty/stalled tail means ALIVE; use wait.\n\nORCHESTRATION OFF. If total context footprint since last upgrade ask exceeds 200 lines, after that turn STOP and ask whether to switch ON; reset count only when you ask.\n\nDROPOUT WHILE ON: HALT and ask; stay halted until restored. SUB-AGENT EXEMPTION: a prompt whose literal FIRST LINE begins \"<this is a request from a parent process>\" skips this regime.\n\nMODEL SELECTION MODE. Default smart rejects provider/model/effort selectors; launch_agent auto-picks. user-approved-overrides lasts 30 minutes, expires lazily on launch_agent, and must be enabled only after explicit user authorization via AskUserQuestion/request-user-input.";

const SUBAGENT_INSTRUCTIONS =
  "SUB-AGENT SESSION: you are a child process launched by subagent-mcp. Follow the parent prompt. Do not treat yourself as the orchestrator, do not re-trigger orchestration carryover, and do not launch further sub-agents unless the parent prompt explicitly assigns that.\n\nMODEL SELECTION MODE (parallel to orchestration-mode, set via the model-selection-mode tool). DEFAULT is \"smart\" and is used whenever unset: in smart, launch_agent REJECTS any call supplying provider/model/effort selectors and the server auto-picks the best model. \"user-approved-overrides\" opens a 30-MINUTE window where selectors are HONORED, enforced LAZILY (the mode reverts to smart on the next launch_agent call after 30 minutes) and re-enabling does NOT extend an active window. HONOR-BASED: you MUST NOT set \"user-approved-overrides\" without explicit interactive USER authorization via the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex); never enable it on your own initiative.";

const server = new McpServer(
  {
    name: "subagent-mcp",
    version: "2.9.0",
    description:
      "Launches always-interactive local Claude and Codex sub-agent sessions. Claude uses the Claude Agent SDK over the local Claude Code executable; Codex uses `codex app-server` over stdio. The server does not call Anthropic or OpenAI HTTP APIs directly.",
  },
  {
    instructions:
      process.env.SUBAGENT_MCP_SUBAGENT === "1"
        ? SUBAGENT_INSTRUCTIONS
        : ORCHESTRATION_INSTRUCTIONS,
  }
);

// Best-effort removal of a candidate's temp ultracode settings file after a
// LAUNCH-TIME failure (the agentState is never registered, so the close handler
// will not run cleanupUcSettings for it).
function cleanupUcSettingsPath(ucSettingsPath?: string): void {
  if (!ucSettingsPath) return;
  try {
    if (existsSync(ucSettingsPath)) unlinkSync(ucSettingsPath);
  } catch {}
}

// Attempt to spawn + register a single candidate. Resolves to the agent_id on a
// successful driver start, or a launch-time failure reason string (never throws/rejects).
//
// spawn() failures (ENOENT/EACCES) are ASYNC: a missing/broken CLI emits the
// child 'error' event AFTER spawn() returns, so a try/catch around spawn cannot
// see it. We therefore: (a) fast-fail when the resolved exe path does not exist;
// (b) attach an 'error' handler immediately and AWAIT a one-shot 'spawn' vs
// 'error' race. Only on the 'spawn' win do we register the agent. A persistent
// 'error' handler stays attached so a LATE spawn error can never crash the
// process. Any launch-time failure cleans up and is reported so the attempt loop
// silently advances to the next candidate.
async function tryLaunchCandidate(
  candidate: Candidate,
  prompt: string,
  agentCwd: string,
  routingTier?: "cost_efficiency" | "performance" | "manual",
  rulesetInfo?: {
    applied: true;
    originalSelection: { provider: string; model: string; effort: string };
  }
): Promise<{ agentId: string } | { reason: string; failure_type: FailureType }> {
  // Concurrency cap for this provider.
  const running = countProcessing(candidate.provider);
  const max = candidate.provider === "claude" ? MAX_CLAUDE : MAX_CODEX;
  if (running >= max) {
    const reason = `Maximum ${max} concurrent ${candidate.provider} agents already running. Current: ${running}`;
    return { reason, failure_type: "permanent" };
  }

  // Build the command. haiku ignores effort; pass "high" placeholder for the
  // "none" sentinel (buildCommand drops it for haiku anyway).
  const effortForBuild = candidate.effort === "none" ? "high" : candidate.effort;

  let buildResult: { args: string[]; ucSettingsPath?: string };
  let cmd: string;
  try {
    buildResult = buildCommand(
      candidate.provider,
      candidate.model,
      effortForBuild,
      agentCwd
    );
    cmd = resolveExe(candidate.provider);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { reason, failure_type: "permanent" };
  }

  // Fast-fail absolute paths only. Bare names intentionally rely on PATH; spawn
  // below resolves them and reports ENOENT/EACCES through the same failure path.
  if (isAbsolute(cmd) && !existsSync(cmd)) {
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    return { reason: `CLI executable not found: ${cmd}`, failure_type: "permanent" };
  }

  let driver: ProviderDriver;
  try {
    driver = await createProviderDriver({
      provider: candidate.provider,
      command: cmd,
      args: buildResult.args,
      cwd: agentCwd,
      env: { ...process.env, SUBAGENT_MCP_SUBAGENT: "1" },
      model: candidate.model,
      effort: candidate.effort,
      ucSettingsPath: buildResult.ucSettingsPath,
    });
  } catch (error) {
    // Synchronous spawn throw (rare) — clean up and report as a launch failure.
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    const reason = error instanceof Error ? error.message : String(error);
    return { reason, failure_type: classifyFailureReason(reason, "") };
  }
  const childProcess = driver.process;
  let definitelyStarted = false;
  let startupRejection: Error | null = null;
  const definitelyStartedProbe = driver.definitelyStarted.then(
    () => {
      definitelyStarted = true;
      return true;
    },
    (e) => {
      startupRejection = e instanceof Error ? e : new Error(String(e));
      return false;
    }
  );
  const readStartedBoundary = async (): Promise<boolean> => {
    await Promise.race([
      definitelyStartedProbe,
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ]);
    return definitelyStarted;
  };

  // Await the one-shot spawn/error race. The 'error' handler is attached BEFORE
  // we await so an async ENOENT cannot escape as an unhandled event.
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      childProcess.once("spawn", () => {
        childProcess.removeListener("error", onError);
        resolve();
      });
      childProcess.once("error", onError);
    });
  } catch (err) {
    // Launch-time failure (ENOENT/EACCES/etc.) — kill if somehow alive, clean up
    // the settings file, and report so the attempt loop advances.
    try {
      driver.kill();
    } catch {}
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    const reason = err instanceof Error ? err.message : String(err);
    return { reason, failure_type: classifyFailureReason(reason, "") };
  }

  // Spawn succeeded. Register the agent exactly as before. Keep a persistent
  // 'error' handler so a LATE spawn error never crashes the process; fold it
  // into stderr rather than throwing.
  const agentId = randomUUID();
  const now = Date.now();

  const agentState: AgentState = {
    id: agentId,
    provider: candidate.provider,
    model: candidate.model,
    routingTier,
    ...(rulesetInfo
      ? { rulesetApplied: true, rulesetOriginalSelection: rulesetInfo.originalSelection }
      : {}),
    status: "processing",
    process: childProcess,
    driver,
    stdout: "",
    stderr: "",
    exitCode: null,
    exitedAt: null,
    // Launch time is the initial heartbeat. Only PARSED VISIBLE provider stream
    // items refresh lastActivity afterwards (see the stdout handler); raw
    // stdout/stderr chunks do NOT, so `stalled` means exactly "no visible
    // provider stream item for the heartbeat window".
    startedAt: now,
    lastActivity: now,
    cwd: agentCwd,
    ucSettingsPath: buildResult.ucSettingsPath,
    waitReported: false,
    visibleStream: [],
    streamBuf: "",
  };

  childProcess.on("error", (err) => {
    // Captured into the stderr tail for debugging. Not a visible provider stream
    // item, so it does NOT refresh the heartbeat.
    agentState.stderr += `\n[process error] ${err instanceof Error ? err.message : String(err)}`;
  });

  if (childProcess.stdout) {
    childProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      const at = Date.now();
      // Buffer partial lines so a provider JSONL event split across chunks is
      // never dropped. Only COMPLETE lines are parsed this call; the trailing
      // fragment is carried in streamBuf until its newline arrives.
      const { items, pending, lines } = consumeStreamChunk(
        agentState.provider,
        agentState.streamBuf,
        chunk
      );
      agentState.streamBuf = pending;
      // Accumulate all complete lines into stored stdout.
      for (const line of lines) {
        agentState.stdout += line + "\n";
      }
      if (items.length > 0) {
        // Heartbeat refreshes only on parsed visible provider stream items,
        // not on raw stdout bytes.
        agentState.lastActivity = at;
        agentState.visibleStream = retainLastN(
          agentState.visibleStream,
          items.map((it) => ({ ...it, at })),
          3
        );
      }
      // Provider completion events mark the current turn finished while the
      // logical interactive session can remain available for later messages.
      // Scan COMPLETE lines only so a marker split across chunks is matched
      // once fully assembled (never on a partial fragment).
      if (lines.some((l) => isTurnCompletedLine(agentState.provider, l))) {
        agentState.turnCompleted = true;
        agentState.status = "finished";
        if (agentState.exitedAt === null) agentState.exitedAt = at;
      }
    });
  }

  // Capture stderr into the tail for debugging. stderr is NOT a parsed visible
  // provider stream, so it does NOT refresh the heartbeat (parsed-visible only).
  if (childProcess.stderr) {
    childProcess.stderr.on("data", (data) => {
      agentState.stderr += data.toString();
    });
  }

  childProcess.on("close", (code) => {
    // Flush any buffered trailing stdout line (final event may arrive without a
    // terminating newline) so its visible item is not lost.
    if (agentState.streamBuf) {
      const at = Date.now();
      const { items, lines } = flushStream(agentState.provider, agentState.streamBuf);
      agentState.streamBuf = "";
      for (const line of lines) {
        agentState.stdout += line + "\n";
      }
      // A completion marker may arrive only in this final flush (no trailing
      // newline) — the grace window's success exception needs it.
      if (lines.some((l) => isTurnCompletedLine(agentState.provider, l))) {
        agentState.turnCompleted = true;
        agentState.status = "finished";
        if (agentState.exitedAt === null) agentState.exitedAt = at;
      }
      if (items.length > 0) {
        agentState.lastActivity = at;
        agentState.visibleStream = retainLastN(
          agentState.visibleStream,
          items.map((it) => ({ ...it, at })),
          3
        );
      }
    }

    // Always clean up ultracode settings file on close
    cleanupUcSettings(agentState);

    // Always record actual close time (unless already finalized)
    if (agentState.exitedAt === null) agentState.exitedAt = Date.now();

    if (agentState.status === "stopped") {
      // Record real exit code but preserve "stopped" status
      if (agentState.exitCode === null) agentState.exitCode = code !== null ? code : -1;
      return;
    }
    if (agentState.status === "finished") {
      // Already finalized by turn.completed; record that the interactive
      // driver is no longer live so poll/list stop advertising alive=true.
      if (agentState.exitCode === null) agentState.exitCode = code !== null ? code : -1;
      if (code !== 0) agentState.status = "errored";
      return;
    }
    // Normal exit: set exit code and derive status
    agentState.exitCode = code !== null ? code : -1;
    agentState.status = code === 0 ? "finished" : "errored";
  });

  // Resolves after the close handler above has fully run (attach order):
  // streams flushed and any final turn.completed marker scanned. Pre-created
  // because 'close' can fire in the same frame as 'exit', before the grace
  // race's await continuation could attach a listener.
  const closedAfterFlush = new Promise<void>((resolve) => {
    childProcess.once("close", () => resolve());
  });

  // POSIX seam: a child can die and deliver 'exit' DURING the startup write
  // below (the write then rejects with EPIPE) — before the grace block attaches
  // its own listener. Capture that exit here so the grace window still sees it
  // and reports the exit code, instead of registering a corpse or surfacing the
  // raw EPIPE as the failure reason.
  let earlyExitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  childProcess.once("exit", (code, signal) => {
    earlyExitInfo = { code, signal };
  });

  // The startup write is best-effort. On POSIX, writing to an already-dead
  // child's stdin rejects with EPIPE; that is NOT itself a launch failure.
  // Record it and fall through to the grace window, which reports the real exit
  // code (grace>0) or the legacy startup-write seam registers it (grace=0).
  let startError: Error | null = null;
  try {
    await driver.start(prompt);
  } catch (err) {
    startError = err instanceof Error ? err : new Error(String(err));
    await readStartedBoundary();
    if (!definitelyStarted) {
      const reason = startError.message;
      cleanupUcSettings(agentState);
      return {
        reason,
        failure_type: failureTypeForError(startError, agentState.stderr),
      };
    }
  }

  // Post-spawn grace window: a 'spawn' win alone is NOT success — a provider
  // driver that starts then dies immediately must advance the attempt loop, not
  // falsely conclude it. AgentState is fully wired and the initial turn already
  // submitted above, so a surviving driver loses no stream output during the
  // wait. Exception: a driver already finalized by its turn-completion marker
  // completed the task legitimately fast — that is a success, never a launch
  // failure. The close handler above cleans up a condemned driver (uc settings,
  // stream flush); the agent is simply never registered.
  if (SPAWN_GRACE_MS > 0) {
    const earlyExit =
      earlyExitInfo ??
      (await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | null>((resolve) => {
        if (earlyExitInfo) {
          resolve(earlyExitInfo);
          return;
        }
        const timer = setTimeout(() => {
          childProcess.removeListener("exit", onExit);
          resolve(null);
        }, SPAWN_GRACE_MS);
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
          clearTimeout(timer);
          resolve({ code, signal });
        };
        childProcess.once("exit", onExit);
      }));
    if (earlyExit) {
      // 'exit' can be delivered before the final stdout chunk, so wait for
      // 'close' (streams drained, flush scanned) before deciding — a
      // turn.completed fast completion must never be misread as a launch
      // failure and the task silently re-executed on the next candidate.
      await closedAfterFlush;
      const startedBeforeExit = await readStartedBoundary();
      if (!agentState.turnCompleted && !startedBeforeExit) {
        const tail = agentState.stderr.trim().split("\n").slice(-1)[0] ?? "";
        const reason = `process exited (code ${earlyExit.code ?? earlyExit.signal}) within ${SPAWN_GRACE_MS}ms of spawn${tail ? `: ${tail}` : ""}`;
        return {
          reason,
          failure_type: startupRejection
            ? failureTypeForError(startupRejection, agentState.stderr)
            : classifyFailureReason(reason, agentState.stderr),
        };
      }
    } else if (startError && !agentState.turnCompleted) {
      const startedBeforeStartError = await readStartedBoundary();
      if (startedBeforeStartError) {
        agents.set(agentId, agentState);
        return { agentId };
      }
      // Lived past the grace window but the startup write failed: the child is
      // not accepting input, so advance the loop rather than register an agent
      // that never received its prompt.
      try {
        driver.kill();
      } catch {}
      cleanupUcSettings(agentState);
      return {
        reason: startError.message,
        failure_type: failureTypeForError(startError, agentState.stderr),
      };
    }
  }

  agents.set(agentId, agentState);
  return { agentId };
}

// Order-sensitive (provider, model, effort) list equality. Detects whether the
// advanced ruleset actually ALTERED the routing decision — visibility fields
// are persisted/exposed only then (passthrough looks identical to disabled).
function sameTriples(a: Candidate[], b: Candidate[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (c, i) => c.provider === b[i].provider && c.model === b[i].model && c.effort === b[i].effort
  );
}

// Tool 1: launch_agent
server.tool(
  "launch_agent",
  "Spawn a sub-agent session. AUTO MODE (mandatory first attempt unless an override is licensed below): pass only `prompt` + `task_category` and NO overrides; the server picks the best provider/model/effort for that category from its routing table, launches the top candidate, and silently falls back to the next-best on launch failure. `provider`/`model`/`effort` are overrides — licensed on 1st/2nd attempts ONLY when the task verifiably requires a specific capability; STATE that capability when overriding; if you pass `model` you must also pass `provider`, and if you pass `effort` you must pass both `provider` and `model`. SOLE CHANNEL: while this server is connected this tool is the ONLY sanctioned way to spawn sub-agents, in BOTH orchestration states — harness-native Task/Agent tools are FORBIDDEN for sub-agent launches. PROMPT RULE: every sub-agent `prompt`'s first line is the self-identification marker \"<this is a request from a parent process>\"; the server now UPSERTS this marker as the true first line automatically (idempotent — it is never duplicated and your prompt body is never mutated), so you need not add it yourself. Unsure which task_category fits? Don't submit one amorphous task — SPLIT into atomic steps that each map to a single category, one agent per step. ultracode effort is Opus 4.8+ only. Claude uses a Claude Agent SDK logical session over the local Claude executable; Codex uses a `codex app-server` child. Children run with env SUBAGENT_MCP_SUBAGENT=1 so the orchestration hooks skip them (they are not orchestrators and don't re-trigger carryover). Launch returns status `processing` (alive); a later `stalled` is alive-but-quiet (thinking or awaiting a temp-file handoff), NOT dead — wait or re-poll, don't kill (see poll_agent). DEADLOCK RULE: you MUST ALWAYS set `deadlock=true` when 2 launch attempts for the SAME atomic task have already failed or been unsatisfactory (the 3rd attempt onward; re-wording or re-splitting the prompt does NOT make it a different task), and NEVER otherwise — from the 3rd attempt deadlock outranks any capability override: drop provider/model/effort.",
  {
    task_category: z.enum(TASK_CATEGORIES).describe(TASK_CATEGORY_GLOSS),
    prompt: z.string().min(1),
    provider: z.enum(["claude", "codex"]).optional(),
    model: z.enum(["haiku", "sonnet", "opus", "opus-4-8", "gpt-5.5"]).optional(),
    effort: z.enum(["medium", "high", "xhigh", "max", "ultracode"]).optional(),
    cwd: z.string().optional(),
    deadlock: z.boolean().optional().describe("MANDATE: ALWAYS set deadlock=true when, and ONLY when, 2 launch attempts for the SAME atomic task have already failed or been unsatisfactory — the 3rd attempt onward. Re-wording the prompt does NOT make it a different task; splitting a failed task does NOT reset attempts for its unchanged parts; re-launching for the same deliverable means the prior attempt COUNTS as failed/unsatisfactory ('partial progress' is not an exemption). NEVER set it on a 1st or 2nd attempt, NEVER for a different task, NEVER speculatively. Auto mode only: cannot be combined with provider/model/effort — from the 3rd attempt deadlock outranks any capability override, so drop those params. Passing false is identical to omitting it."),
  },
  async (params) => {
    const { task_category, provider, model, effort, deadlock } = params;
    // D19/D20/S8: server silently upserts the parent-process marker as the TRUE
    // first line of every sub-agent prompt (idempotent; never duplicates; never
    // mutates the body). This is what makes the child first-line exemption fire.
    const prompt = ensureParentMarker(params.prompt);
    const agentCwd = params.cwd || process.cwd();

    // 1-5. Param-presence validation (zod already constrains task_category, but
    //       hard-validate so the spec error text — valid list + hints, and the
    //       effort-before-model ordering — is what the caller sees). Pure,
    //       exported, and unit-tested (test/handler-validation.test.mjs).
    const presenceError = validatePresence({ task_category, provider, model, effort, deadlock });
    if (presenceError) {
      return errorResult(presenceError);
    }

    const modelGate = modelMode.gateLaunch(agentCwd, { provider, model, effort });
    if (!modelGate.allowed) {
      return errorResult(modelGate.message ?? modelMode.SELECTOR_REJECTION_MESSAGE);
    }

    // 6. Build the candidate list per mode.
    const overrides = { provider, model, effort };
    const isExplicit = !!(provider && model && effort);

    if (!isExplicit && task_category === "fallback_default") {
      return errorResult(
        `Error: fallback_default is a split hint sentinel, not a launchable routing-table category.\n${SPLIT_HINT}\n${AUTO_HINT}`
      );
    }

    // Arm window after all validation (including fallback_default rejection) passes.
    if (deadlock === true) {
      deadlockWindow.arm();
    }

    const pureAuto = !provider && !model && !effort;
    const branch: RoutingBranch = (pureAuto && deadlockWindow.active()) ? "performance" : "cost_efficiency";
    const routingTier = isExplicit ? "manual" : branch;

    // explicit mode never reads the table; all other modes do.
    const table = isExplicit ? null : loadRoutingTable();
    if (!isExplicit && table === null) {
      return errorResult(
        `Error: routing table not populated for ${task_category} (routing-table file missing or unreadable). Either run the model-profiler to populate it, or pass provider+model+effort explicitly for a fully-specified launch.\n${AUTO_HINT}`
      );
    }

    const result = buildCandidates(table, task_category, overrides, branch);
    const mode: SelectionMode = result.mode;

    if (!isExplicit && result.noCandidates) {
      let scope = "";
      if (mode === "provider") scope = ` matching provider ${provider}`;
      else if (mode === "provider_model") scope = ` matching model ${model}`;
      return errorResult(
        `Error: routing table not populated for ${task_category} (no${scope} pairings available). Either run the model-profiler to populate it, or pass provider+model+effort explicitly.\n${AUTO_HINT}`
      );
    }

    // Advanced-ruleset hook (docs/spec/advanced-ruleset/). Env-check gate runs
    // at the first launch_agent of this process (success latches for the
    // process lifetime; failure NEVER latches — re-run next call so an admin
    // fix recovers without a restart). When enabled, routing mode runs ONCE per
    // launch_agent — in ALL selection modes, explicit included — and is never
    // re-run per failover attempt: the attempt loop consumes the returned list
    // verbatim. Deadlock/branch state is never exposed to the script. The
    // hard-fail message deliberately carries no hints (admin must intervene).
    const gateResult = await rulesetGate.ensureReady();
    if (!gateResult.ok) {
      return errorResult(RULESET_HARD_FAIL_MSG);
    }

    let candidates = result.candidates;
    let rulesetApplied = false;
    let rulesetOriginalSelection: { provider: string; model: string; effort: string } | undefined;

    if (gateResult.active) {
      const payload: RulesetStdinPayload = {
        candidates: candidates.map((c, i) => ({
          provider: c.provider,
          model: c.model,
          effort: c.effort,
          // Dense positional rank 1..N over the already-filtered list (raw
          // table ranks gap after launchability filtering; explicit has none).
          rank: i + 1,
        })),
        context: {
          task_category,
          cwd: agentCwd,
          selection_mode: mode,
          provider: provider ?? null,
          model: model ?? null,
          effort: effort ?? null,
        },
      };
      const applied = await rulesetGate.applyRules(payload);
      if (!applied.ok) {
        return errorResult(RULESET_HARD_FAIL_MSG);
      }
      if (applied.candidates.length === 0) {
        // Empty list = deliberate policy veto (the limit case of the allowed
        // filter operation), NOT a malfunction — clean error, never the
        // hard-fail message, never latched.
        return errorResult(
          `Error: advanced ruleset returned zero candidates for task_category ${task_category}; launch vetoed by ruleset.\n${AUTO_HINT}`
        );
      }
      rulesetApplied = !sameTriples(candidates, applied.candidates);
      if (rulesetApplied) {
        rulesetOriginalSelection = { ...candidates[0] };
      }
      candidates = applied.candidates;
    }

    // 6. Attempt loop: best→worst. Register on first successful driver start; silently
    //    advance on launch-time failure. Sub-agent task outcome is NEVER a trigger.
    const skipped: {
      model: string;
      effort: string;
      provider: string;
      reason: string;
      failure_type: FailureType;
    }[] = [];
    for (const candidate of candidates) {
      const outcome = await tryLaunchCandidate(
        candidate,
        prompt,
        agentCwd,
        routingTier,
        rulesetApplied && rulesetOriginalSelection !== undefined
          ? { applied: true, originalSelection: rulesetOriginalSelection }
          : undefined
      );
      if ("agentId" in outcome) {
        if (branch === "performance") {
          deadlockWindow.consume();
        }
        if (skipped.length > 0) {
          const registeredAgent = agents.get(outcome.agentId);
          if (registeredAgent) {
            registeredAgent.failoverFrom = skipped.map((s) => ({
              provider: s.provider,
              model: s.model,
              effort: s.effort,
              failure_type: s.failure_type,
            }));
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                agent_id: outcome.agentId,
                status: "processing",
                provider: candidate.provider,
                model: candidate.model,
                effort: candidate.effort,
                task_category,
                ...(rulesetApplied
                  ? {
                      ruleset_applied: true,
                      ruleset_original_selection: rulesetOriginalSelection,
                    }
                  : {}),
                ...(skipped.length > 0
                  ? {
                      failover_occurred: true,
                      failover_from: skipped.map((s) => ({
                        provider: s.provider,
                        model: s.model,
                        effort: s.effort,
                        failure_type: s.failure_type,
                      })),
                      failover_note: buildFailoverNote(skipped, candidate),
                    }
                  : {}),
              }),
            },
          ],
        };
      }
      skipped.push({
        model: candidate.model,
        effort: candidate.effort,
        provider: candidate.provider,
        reason: outcome.reason,
        failure_type: outcome.failure_type,
      });
      if (!pureAuto) {
        break;
      }
    }

    // 7. All candidates failed. Override selector modes are single-attempt hard
    //    failures; pure auto mode reports the attempted candidates.
    if (!pureAuto) {
      const f = skipped[0];
      const transientNote = f.failure_type === "transient_provider"
        ? `\nNote: this failure appears transient (quota/rate-limit/network). Switch to auto mode (omit provider/model/effort) for automatic silent failover to the next-best provider.`
        : "";
      const label = isExplicit ? "explicit" : "override";
      return errorResult(
        `Error: ${label} launch ${f.model}@${f.effort} (${f.provider}) failed: ${f.reason}.${transientNote}\n${AUTO_HINT}`
      );
    }
    const lines = skipped
      .map((s, i) => `  ${i + 1}. ${s.model}@${s.effort} (${s.provider}) [${s.failure_type}]: ${s.reason}`)
      .join("\n");
    return errorResult(
      `Error: all ${skipped.length} candidate launches failed for task_category ${task_category}:\n${lines}\n${SPLIT_HINT}\n${AUTO_HINT}`
    );
  }
);

// Tool 2: poll_agent
server.tool(
  "poll_agent",
  "Get an agent's current status and output. Status `processing` = ALIVE with visible provider activity in the last 10 minutes; `stalled` = ALIVE but no parsed visible provider stream item for 10 minutes (thinking, or awaiting a temp-file handoff) — NOT dead, so prefer `wait`/re-poll over killing. Always returns `alive` and `idle_seconds`, plus `recent_stream` (the last 3 visible provider stream items, each timestamped) and a `hint` while stalled. Pass `verbose: true` to also return `final_output`, the agent's final assistant turn extracted from its captured stdout.",
  {
    agent_id: z.string(),
    verbose: z.boolean().optional().default(false),
  },
  async (params) => {
    const agent = agents.get(params.agent_id);
    if (!agent) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent ${params.agent_id} not found`,
          },
        ],
        isError: true,
      };
    }

    // Reconcile exit synchronously so an already-exited process is reported as
    // completed/failed immediately (no up-to-10s health-monitor lag).
    const now = Date.now();
    reconcileAgent(agent, now);

    const stdoutTail =
      agent.stdout.length > 2000
        ? agent.stdout.slice(-2000)
        : agent.stdout;
    const stderrTail =
      agent.stderr.length > 1000
        ? agent.stderr.slice(-1000)
        : agent.stderr;

    const liveness = buildLivenessFields(
      agent.status,
      agent.exitCode,
      agent.lastActivity,
      now
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: agent.id,
            provider: agent.provider,
            model: agent.model,
            status: agent.status,
            exit_code: agent.exitCode,
            stdout_tail: stdoutTail,
            stderr_tail: stderrTail,
            started_at: agent.startedAt,
            last_activity: agent.lastActivity,
            cwd: agent.cwd,
            ...liveness,
            ...(agent.routingTier !== undefined ? { routing_tier: agent.routingTier } : {}),
            ...(agent.rulesetApplied
              ? {
                  ruleset_applied: true,
                  ruleset_original_selection: agent.rulesetOriginalSelection,
                }
              : {}),
            ...(agent.failoverFrom && agent.failoverFrom.length > 0
              ? {
                  failover_occurred: true,
                  failover_from: agent.failoverFrom,
                }
              : {}),
            recent_stream: agent.visibleStream.map((it) => ({
              type: it.type,
              text: it.text,
              at: it.at !== undefined ? formatLocalIso(it.at) : null,
            })),
            ...(params.verbose
              ? { final_output: extractFinalTurn(agent.provider, agent.stdout) }
              : {}),
          }),
        },
      ],
    };
  }
);

// Tool 3: kill_agent
server.tool(
  "kill_agent",
  "Terminate a live agent/session (status `processing`, `stalled`, or turn-finished but still interactive) by immediately force-killing its managed driver. No-op for already-terminal closed agents.",
  {
    agent_id: z.string(),
  },
  async (params) => {
    const agent = agents.get(params.agent_id);
    if (!agent) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent ${params.agent_id} not found`,
          },
        ],
        isError: true,
      };
    }

    // Kill applies to ALL live driver states (processing, stalled, or finished
    // current turn with an open interactive session). Closed terminal agents are
    // a no-op.
    const isLive =
      (agent.status === "processing" || agent.status === "stalled" || agent.status === "finished") &&
      !agent.driver.closed;
    if (!isLive) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agent.id,
              status: agent.status,
              message: `Agent is not live (status: ${agent.status})`,
            }),
          },
        ],
      };
    }

    try {
      // Immediately force-kill the managed process tree — no graceful SIGTERM
      // grace period. On Windows, taskkill /t /f tears down the whole tree; on
      // POSIX, SIGKILL the process (close handler records the real exit code).
      agent.status = "stopped";
      agent.driver.kill();
      if (isWindows && agent.process.pid) {
        spawn("taskkill", ["/pid", String(agent.process.pid), "/t", "/f"], {
          windowsHide: true,
        });
      } else if (agent.process.pid) {
        process.kill(agent.process.pid, "SIGKILL");
      } else {
        agent.process.kill("SIGKILL");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agent.id,
              status: "stopped",
              message: "Process tree force-killed",
            }),
          },
        ],
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error killing agent: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 4: send_message
server.tool(
  "send_message",
  "Enqueue a user message for an open interactive agent session. Observe output with poll_agent or wait.",
  {
    agent_id: z.string(),
    message: z.string().min(1),
  },
  async (params) => {
    const agent = agents.get(params.agent_id);
    if (!agent) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent ${params.agent_id} not found`,
          },
        ],
        isError: true,
      };
    }

    const isLive =
      (agent.status === "processing" || agent.status === "stalled" || agent.status === "finished") &&
      !agent.driver.closed;
    if (!isLive) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent is not live (status: ${agent.status})`,
          },
        ],
        isError: true,
      };
    }

    try {
      await agent.driver.send(params.message);
      const now = Date.now();
      agent.status = "processing";
      agent.exitCode = null;
      agent.exitedAt = null;
      agent.waitReported = false;
      agent.turnCompleted = false;
      agent.lastActivity = now;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agent.id,
              status: "sent",
              message: "Message accepted by provider driver",
            }),
          },
        ],
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error sending message: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 5: list_agents
server.tool(
  "list_agents",
  "List all agents with token-efficient core metrics (status, `alive`, `idle_seconds`). `stalled` is ALIVE-but-quiet, NOT dead (full status semantics on poll_agent). Use `poll_agent` for per-agent stream items, hints, and final output.",
  {},
  async () => {
    const now = Date.now();
    const agentList = Array.from(agents.values()).map((agent) => {
      // Reconcile exit synchronously so already-exited processes are reported
      // as finished/errored immediately (no health-monitor lag).
      reconcileAgent(agent, now);
      // includeHint=false: the verbose stalled hint lives on poll_agent only;
      // list_agents stays token-efficient.
      return {
        id: agent.id,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        started_at: agent.startedAt,
        last_activity: agent.lastActivity,
        cwd_basename: basename(agent.cwd),
        ...buildLivenessFields(
          agent.status,
          agent.exitCode,
          agent.lastActivity,
          now,
          false
        ),
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ agents: agentList }),
        },
      ],
    };
  }
);

// Tool 6: wait
server.tool(
  "wait",
  "Blocks until one or more sub-agents reach a reportable state (turn-finished, errored, or stopped), returning exit code when known + local-time timestamp; or returns the live-job list after a 15-minute timeout. A `finished` agent can still be alive and accept `send_message` when exit_code is null. A `stalled` agent is still ALIVE and does NOT end the wait. Pass `verbose: true` to add each finished agent's `final_output`.",
  {
    verbose: z.boolean().optional().default(false),
  },
  async (params) => {
    const { verbose } = params;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const TIMEOUT_MS = 15 * 60 * 1000;
    const deadline = Date.now() + TIMEOUT_MS;

    const buildFinishedEntry = (a: AgentState) => ({
      id: a.id,
      provider: a.provider,
      model: a.model,
      status: a.status,
      exit_code: a.exitCode,
      exited_at: formatLocalIso(a.exitedAt as number),
      elapsed_ms: (a.exitedAt as number) - a.startedAt,
      ...(verbose
        ? { final_output: extractFinalTurn(a.provider, a.stdout) }
        : {}),
    });

    const buildRunningEntry = (a: AgentState, now: number) => ({
      id: a.id,
      provider: a.provider,
      model: a.model,
      status: a.status,
      started_at_local: formatLocalIso(a.startedAt),
      last_activity_local: formatLocalIso(a.lastActivity),
      elapsed_ms: now - a.startedAt,
    });

    // Step 1: collect already-terminal unreported agents
    const allAgents = Array.from(agents.values());
    let unreported = selectUnreported(allAgents);
    if (unreported.length > 0) {
      // Mark reported synchronously before building return (single-threaded JS → atomic)
      for (const a of unreported) a.waitReported = true;
      const payload = { finished: unreported.map(buildFinishedEntry) };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    }

    // Step 2: nothing alive and nothing unreported (includes stopped-but-not-yet-closed).
    // `stalled` is a LIVE state — it keeps the wait pending, it never ends it.
    const TERMINAL_SET = new Set(["finished", "errored", "stopped"]);
    const hasPending = Array.from(agents.values()).some(
      (a) =>
        a.status === "processing" ||
        a.status === "stalled" ||
        (TERMINAL_SET.has(a.status) && a.exitedAt === null)
    );
    if (!hasPending) {
      const payload = {
        finished: [] as ReturnType<typeof buildFinishedEntry>[],
        message: "No agents are running or waiting to finish.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    }

    // Step 3: block-poll until a terminal agent appears or deadline passes
    while (Date.now() < deadline) {
      await sleep(250);
      unreported = selectUnreported(Array.from(agents.values()));
      if (unreported.length > 0) {
        for (const a of unreported) a.waitReported = true;
        const payload = { finished: unreported.map(buildFinishedEntry) };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }
    }

    // Step 4: timeout — return still-running jobs
    const now = Date.now();
    const stillRunning = Array.from(agents.values()).filter(
      (a) => a.status === "processing" || a.status === "stalled"
    );
    const payload = {
      timed_out: true,
      elapsed_minutes: 15,
      running: stillRunning.map((a) => buildRunningEntry(a, now)),
      hint: "15 minutes elapsed with no agent finishing. Call wait again to block for another 15 minutes or until the next agent finishes.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

// Tool 7: orchestration-mode
server.tool(
  "orchestration-mode",
  "Toggle or query per-project ORCHESTRATION MODE. `enabled`: true = ON, false = OFF, omit = query current state. SOLE CHANNEL: the subagent MCP is the ONLY sanctioned channel for launching sub-agents whether this mode is ON or OFF — toggling OFF does not lift that obligation. When OFF, run the per-turn upgrade check: a long-horizon task = any whose TOTAL context footprint (input read + output produced) exceeds 200 lines, measured CUMULATIVELY since your last upgrade ask; after EVERY user turn, if it qualifies, STOP and ask the user whether to switch ON (ask every qualifying turn; a decline does not latch; reset the count only when you actually ask). The FULL operating model + governance is carried in this server's MCP `instructions` (read once at initialize) — this is the operational summary only; do not act on the mode without that detail. WHAT: a per-project toggle for LONG-HORIZON work that would fill the context window if run to completion inline; when ON, act as a delegate-ONLY orchestrator: delegate every step; inline-by-right does not exist; a non-delegable atomic step requires a one-time user-approved exception via the structured-question tool (state which + why). PERSISTENCE: a per-project marker keyed by cwd; absence of the marker = OFF = no injection; once ON it persists across restarts/sessions until a permitted disable (it does NOT reset on a new session). CARRYOVER: if ON was inherited from a PRIOR session (provenance = carried-over, not user-enabled this session), the bundled hook prepends a ONE-TIME notice (once per marker, never per turn) — you MUST then notify the user it auto-activated and confirm whether to keep it ON. DISABLE: never on your own initiative; you MAY PROPOSE turning it OFF on task-fit mismatch, but only EXPLICIT user permission (AskUserQuestion on Claude, request-user-input on Codex) may set enabled:false. Per-turn injection fires only in CLI hosts that load the bundled hook; desktop hosts toggle the marker but inject nothing (documented degradation).",
  {
    enabled: z.boolean().optional(),
  },
  async (params) => {
    const cwd = process.cwd();
    if (params.enabled === true) {
      orchestrationMarker.enable(cwd);
    } else if (params.enabled === false) {
      orchestrationMarker.disable(cwd);
    }
    // enabled === undefined -> query only; no marker mutation.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            orchestration_mode: orchestrationMarker.isActive(cwd),
            marker_path: orchestrationMarker.markerPath(cwd),
          }),
        },
      ],
    };
  }
);

// Tool 8: model-selection-mode
server.tool(
  "model-selection-mode",
  "Set or query per-project MODEL SELECTION MODE, which gates launch_agent's `provider`/`model`/`effort` selectors. `mode`: \"smart\" or \"user-approved-overrides\"; omit to query current state. \"smart\" is the DEFAULT and is used whenever the mode is unset — in smart, launch_agent REJECTS any call that supplies provider/model/effort and the server auto-picks the best model for the task_category. \"user-approved-overrides\" opens a 30-MINUTE window during which selectors are HONORED; the window is enforced LAZILY — the mode reverts to smart on the next launch_agent call after the 30 minutes elapse — and re-enabling does NOT extend an already-active window. HONOR-BASED, parallel to orchestration-mode: you MUST NOT set this to \"user-approved-overrides\" without explicit interactive USER authorization obtained via the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex; a plain yes/no exchange if neither exists). This tool CANNOT verify that authorization — never enable it on your own initiative. PERSISTENCE: per-project state keyed by cwd; both the mode and the override-window enable-timestamp persist across MCP server restarts (the remaining window is restored, not reset).",
  {
    mode: z.enum(["smart", "user-approved-overrides"]).optional(),
  },
  async (params) => {
    const cwd = process.cwd();
    if (params.mode) modelMode.setMode(cwd, params.mode);
    const r = modelMode.resolveMode(cwd);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              model_selection_mode: r.mode,
              enabled_at: r.enabled_at,
              window_remaining_ms: r.window_remaining_ms,
              marker_path: modelMode.modelModePath(cwd),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Connect the stdio transport only when run as the entry point (the bin), NOT
// when this module is imported (e.g. test/handler-validation.test.mjs importing
// the exported validatePresence). Connecting on import would block the test on
// an open stdio transport. argv[1] is the invoked script; compare to this URL.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  // CLI argument guard — runs BEFORE the stdio transport connects. Any argv[2]
  // other than the known commands used to fall through and silently start the
  // MCP server, which blocks forever waiting on stdin (`subagent-mcp --version`
  // hung indefinitely). Only a bare invocation may reach the server below.
  const arg = process.argv[2];
  const usage = [
    "Usage: subagent-mcp [command]",
    "",
    "  (no command)       start the MCP stdio server (how vendor CLIs run it)",
    "  setup [--dry-run]  wire Claude Code CLI / Codex CLI (--dry-run: preview only)",
    "  init, --init [flags]",
    "                     upsert project instruction-file invariant blocks",
    "                     flags: --dry-run --remove --force --root <dir> --files <csv> --copilot --cursor",
    "                     --global  upsert into ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md",
    "  doctor             check install and wiring health",
    "  update, --update   update to the latest release (npm install -g)",
    "  version, --version, -v",
    "                     print the installed version",
    "  help, --help, -h   show this help",
  ].join("\n");
  // dist/index.js -> ../package.json (the installed package manifest).
  const readPkg = () =>
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { name: string; version: string };
  if (arg === "version" || arg === "--version" || arg === "-v") {
    console.log(readPkg().version);
    process.exit(0);
  }
  if (arg === "help" || arg === "--help" || arg === "-h") {
    console.log(usage);
    process.exit(0);
  }
  if (arg === "update" || arg === "--update") {
    const pkg = readPkg();
    const npmArgs = ["install", "-g", `${pkg.name}@latest`];
    console.log(`subagent-mcp ${pkg.version} -> npm ${npmArgs.join(" ")}`);
    // npm on Windows is npm.cmd; spawning a .cmd without a shell fails
    // (EINVAL on modern Node). Resolve the underlying npm-cli.js and run it
    // with this same node binary: cmd-shim layout first (npm installed into a
    // prefix), then the official Node-for-Windows layout (npm.cmd sitting
    // next to node_modules\npm). POSIX spawns the npm executable directly.
    const { findOnPath, resolveCmdShimNodeScript } = await import(
      "./setup.js"
    );
    const npm = findOnPath("npm") ?? "npm";
    const spawnNpm = (
      args: string[],
      stdio: "inherit" | "pipe"
    ) => {
      const sibling = join(dirname(npm), "node_modules", "npm", "bin", "npm-cli.js");
      if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(npm)) {
        const js =
          resolveCmdShimNodeScript(npm) ?? (existsSync(sibling) ? sibling : null);
        return js
          ? spawnSync(process.execPath, [js, ...args], {
              stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
              encoding: stdio === "pipe" ? "utf8" : undefined,
            })
          : // Last resort: cmd.exe via shell. The arg vector is a fixed literal
            // list (safe charset only), so there is no quoting/injection surface.
            spawnSync("npm", args, {
              stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
              shell: true,
              encoding: stdio === "pipe" ? "utf8" : undefined,
            });
      }
      return spawnSync(npm, args, {
        stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
        encoding: stdio === "pipe" ? "utf8" : undefined,
      });
    };

    const npmRoot = spawnNpm(["root", "-g"], "pipe");
    if (npmRoot.error || npmRoot.status !== 0) {
      console.error(
        `update failed to resolve npm global root: ${
          npmRoot.error?.message ?? npmRoot.stderr?.toString().trim() ?? "npm root -g failed"
        }`
      );
      process.exit(npmRoot.status ?? 1);
    }
    const installRoot = join(
      npmRoot.stdout.toString().trim(),
      ...pkg.name.split("/")
    );
    const rulesetPath = join(installRoot, "dist", "advanced-ruleset.py");
    let previousRuleset: Buffer | null = null;
    if (existsSync(rulesetPath)) {
      previousRuleset = readFileSync(rulesetPath);
      const backupPath = join(
        tmpdir(),
        `advanced-ruleset.py.bak-update-${Date.now()}`
      );
      try {
        writeFileSync(backupPath, previousRuleset);
        console.log(`backed up user advanced-ruleset.py to ${backupPath}`);
      } catch (e) {
        console.error(
          `update refused before install: failed to back up advanced-ruleset.py: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
        process.exit(1);
      }
    }
    const r = spawnNpm(npmArgs, "inherit");
    if (r.error) {
      console.error(`update failed to start npm: ${r.error.message}`);
      process.exit(1);
    }
    const code = r.status ?? 1;
    if (code === 0) {
      if (previousRuleset !== null) {
        try {
          const freshRuleset = existsSync(rulesetPath)
            ? readFileSync(rulesetPath)
            : null;
          if (freshRuleset === null || !previousRuleset.equals(freshRuleset)) {
            writeFileSync(rulesetPath, previousRuleset);
            console.log(
              "restored user advanced-ruleset.py (package update never overwrites user edits)"
            );
          }
        } catch (e) {
          console.error(
            `update failed to restore advanced-ruleset.py: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          process.exit(1);
        }
      }
      console.log(
        "Update complete. Restart your CLI sessions so the MCP server picks up the new build."
      );
    }
    process.exit(code);
  }
  if (arg === "setup") {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    process.exit(0);
  }
  if (arg === "init" || arg === "--init") {
    const { runInit } = await import("./init.js");
    process.exit(await runInit());
  }
  if (arg === "doctor") {
    const { runDoctor } = await import("./doctor.js");
    process.exit(await runDoctor());
  }
  if (arg !== undefined && arg !== "") {
    console.error(`unknown argument: ${arg}`);
    console.error(usage);
    process.exit(1);
  }
  // ORCHESTRATION MODE PERSISTS across restarts/sessions: the server does NOT
  // clear the marker on startup. DEFAULT OFF now means ABSENCE of a marker — a
  // project never enabled stays OFF; a project explicitly enabled persists ON
  // until disabled with explicit user permission. On a new session the bundled
  // hook detects the carried-over marker and prompts the user to confirm.
  // (orchestrationMarker.disable is still used by the tool's enabled:false.)
  startLivenessHeartbeat();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
