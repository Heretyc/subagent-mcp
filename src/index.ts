#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, spawnSync, execSync } from "child_process";
import { EventEmitter } from "node:events";
import { unlinkSync, existsSync, realpathSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "crypto";
import { isAbsolute, basename, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "url";
import { Provider, buildCommand } from "./effort.js";
import { createProviderDriver, type DriverProcess, type ProviderDriver } from "./drivers.js";
import { resolveExeFor } from "./platform.js";
import {
  formatLocalIso,
  selectUnreported,
  selectUnreportedPermissionRequested,
} from "./wait-helpers.js";
import type { AgentStatus } from "./status-helpers.js";
import {
  computeStatusTransition,
  buildLivenessFields,
  reconcilePermissionStatus,
} from "./status-helpers.js";
import {
  escapeUntrustedTags,
  envelopeUntrustedOutput,
  extractFinalTurn,
} from "./output-helpers.js";
import {
  consumeStreamChunk,
  flushStream,
  isTurnCompletedLine,
  retainLastN,
  terminalTurnFailure,
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
  slotInsert,
} from "./routing.js";
import { callApiProvider } from "./providers/provider-client.js";
import { loadApiProviders } from "./providers/config-loader.js";
import { effortToTemperature } from "./providers/effort-map.js";
import { createDeadlockWindow } from "./deadlock.js";
import {
  createRulesetGate,
  RULESET_HARD_FAIL_MSG,
  type RulesetStdinPayload,
} from "./ruleset.js";
import {
  CONFIG_FILENAME,
  NONBLOCKING_CULL_DEPS,
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_TERMINAL_IDLE_MS,
  buildProcessTreeKillCommands,
  drainZombieIntents,
  drainZombieReports,
  defaultConfigPath,
  globalCapMessage,
  readSlotMetadata,
  readMergedPermissionConfig,
  readPermissionsCeiling,
  ensureFirstRunPermissionCeiling,
  readGlobalCap,
  releaseSlot,
  reserveSlot,
  slotDir,
  writeSlotMetadata,
  type ZombieRecord,
} from "./concurrency.js";
import { shouldReapTerminalButAlive } from "./zombie.js";
import * as orchestrationMarker from "./orchestration/marker.js";
import * as modelMode from "./orchestration/model-mode.js";
import * as handoff from "./orchestration/handoff.js";
import * as metering from "./orchestration/metering.js";
import { computeEffectiveActive } from "./orchestration/hook-core.js";
import {
  getStatus,
  incrementAgentCount,
  recordRoutingDecision,
} from "./status-tracker.js";
import { startLivenessHeartbeat } from "./orchestration/liveness.js";
import { checkForNpmUpdate } from "./orchestration/update-check.js";
import { applyRegistryAfterUpdate, prepareRegistryForUpdate } from "./init-registry.js";
import { ensureParentMarker } from "./launch-prompt.js";
import {
  pendingPermissionManager,
  type PendingPermissionRecord,
} from "./pending-permissions.js";
import type { PermissionSnapshot } from "./permission-engine.js";

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
  lastExitCode: number | null;
  lastExitedAt: number | null;
  startedAt: number;
  lastActivity: number;
  slotLastActivity: number;
  cwd: string;
  permissionSnapshot: PermissionSnapshot;
  ucSettingsPath?: string;
  ucSettingsDir?: string;
  slotPath?: string | null;
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
  // Set ONLY when the FIRST turn terminally failed with a provider/model error
  // (systemError / invalid_request / model-not-supported) before any visible
  // output. The launch grace window consults this to treat the attempt as a
  // launch-equivalent failure and silently fall over to the next candidate.
  launchTurnFailure?: { reason: string; failure_type: FailureType };
  // Rolling buffer of the last 3 parsed visible provider stream items.
  // Each item is stamped with its capture time (`at`, ms).
  visibleStream: VisibleStreamItem[];
  // Carried-over partial stdout line (a provider JSONL event split across two
  // stdout chunks). Held until its terminating newline arrives so a valid event
  // is never dropped. Flushed on close.
  streamBuf: string;
  // Claude SDK background-task wake state. When stream activity arrives after a
  // turn has already completed, we mark it here and resume once via the driver.
  bgTaskResumeObservedAt?: number;
  bgTaskResumeSentAt?: number;
  bgTaskResumeInFlight?: boolean;
  /** Set only when at least one candidate was skipped before this agent launched. */
  failoverFrom?: {
    provider: string;
    model: string;
    effort: string;
    failure_type: FailureType;
  }[];
}

const agents = new Map<string, AgentState>();
const deadlockWindow = createDeadlockWindow();
const STDOUT_RING_BYTES = 2 * 1024 * 1024;
export const AGENT_RETENTION_MS = 30 * 60 * 1000;
// Advanced-ruleset gate: per-process latch with exactly the deadlock-window
// scoping. The env-check runs lazily at the FIRST launch_agent call; success
// latches enabled/disabled for the process lifetime, failure never latches.
const rulesetGate = createRulesetGate();

class ClosedProcess extends EventEmitter implements DriverProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = 0;

  kill(): boolean {
    this.killed = true;
    return false;
  }
}

function closedDriver(process: DriverProcess): ProviderDriver {
  return {
    process,
    closed: true,
    definitelyStarted: Promise.resolve(),
    start: async () => {},
    send: async () => { throw new Error("api provider sessions are single-turn"); },
    kill: () => { process.kill(); },
  };
}

function ceilingRank(ceiling: "manual" | "auto" | "yolo"): number {
  return ceiling === "manual" ? 0 : ceiling === "auto" ? 1 : 2;
}

function buildPermissionSnapshot(cwd: string): PermissionSnapshot {
  const merged = readMergedPermissionConfig(cwd);
  return {
    ceiling: merged.permissionsCeiling,
    escalation: merged.escalation,
    rules: {
      allow: merged.allow,
      ask: merged.ask,
      deny: merged.deny,
    },
    additionalDirectories: merged.additionalDirectories,
    repoConfigChangedSinceFirstSeen: merged.repoConfigChangedSinceFirstSeen,
  };
}

function isStalePermissive(agent: AgentState): boolean {
  if (!isLiveAgent(agent)) return false;
  const current = readPermissionsCeiling();
  return ceilingRank(agent.permissionSnapshot.ceiling) > ceilingRank(current);
}

function pendingPermissionSummary(record: PendingPermissionRecord, now = Date.now()) {
  return {
    request_id: record.request_id,
    tool_name_or_method: record.tool_name_or_method,
    harness_channel: record.harness_channel,
    permission_ceiling: record.permission_ceiling,
    escalation: record.escalation,
    irreversible: record.irreversible,
    escalate_to_human: record.escalate_to_human,
    requested_at: formatLocalIso(record.requested_at),
    age_seconds: Math.floor((now - record.requested_at) / 1000),
  };
}

// Reconcile one agent's live status against its current pending-permission
// depth. Used by the live queue listener AND at registration time (agents.set)
// to recover a park whose queue event fired before the agent was registered —
// the Codex approval race, where approvals arrive during driver.start() inside
// the spawn-grace window, ahead of agents.set. Idempotent and no-op unless the
// pure rule says the status must change.
function reconcileAgentPermissionStatus(agent: AgentState): void {
  if (agent.exitCode !== null) return;
  const { status, changed } = reconcilePermissionStatus(
    agent.status,
    pendingPermissionManager.pendingCount(agent.id)
  );
  if (!changed) return;
  agent.status = status;
  agent.waitReported = false;
  if (status === "processing") agent.lastActivity = Date.now();
  updateSlotMetadata(agent);
}

pendingPermissionManager.onAgentQueueChange((agentId) => {
  const agent = agents.get(agentId);
  if (!agent) return;
  reconcileAgentPermissionStatus(agent);
});

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

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function computeEffectiveOrchestrationActive(cwd: string, key: string | undefined): boolean {
  const now = Date.now();
  // Derive the metering fail-safe from the PERSISTED record only: a record that
  // exists but cannot resolve a percentage is undetectable (fail-safe ON). The
  // ABSENCE of a record is NOT fail-safed -- it matches the hook's turn-1 grace
  // window (no completed turn yet), so the tool's report agrees with the hook's
  // tag on turn 1 instead of spuriously flipping ON. Everything else flows
  // through the one shared helper so the tool never diverges from the hook.
  const record = key !== undefined ? metering.readMetering(key) : null;
  const meteringUndetectableFailSafe =
    record !== null && record.used_percentage === null;
  return computeEffectiveActive(cwd, key, now, meteringUndetectableFailSafe);
}

function currentLaunchDepth(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SUBAGENT_MCP_DEPTH;
  if (raw !== undefined && raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && String(parsed) === raw.trim()) return parsed;
  }
  return env.SUBAGENT_MCP_SUBAGENT === "1" ? 1 : 0;
}

function envDuration(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function zombieLiveIdleMs(): number {
  return envDuration("SUBAGENT_ZOMBIE_LIVE_IDLE_MS", ZOMBIE_LIVE_IDLE_MS);
}

function zombieTerminalIdleMs(): number {
  return envDuration("SUBAGENT_ZOMBIE_TERMINAL_IDLE_MS", ZOMBIE_TERMINAL_IDLE_MS);
}

function zombieForceGraceMs(): number {
  return envDuration("SUBAGENT_ZOMBIE_FORCE_GRACE_MS", ZOMBIE_FORCE_GRACE_MS);
}

function zombieReport(records: ZombieRecord[]): string | undefined {
  const ids = Array.from(new Set(records.map((r) => r.agent_id))).filter(Boolean);
  return ids.length > 0 ? `zombies: ${ids.join(",")}` : undefined;
}

function withZombieReport<T extends { content?: { type: string; text: string }[] }>(
  result: T,
  records: ZombieRecord[]
): T {
  const report = zombieReport(records);
  if (!report || !result.content?.[0] || result.content[0].type !== "text") return result;
  const text = result.content[0].text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed.zombie_report = report;
      result.content[0].text = JSON.stringify(parsed, null, text.includes("\n") ? 2 : undefined);
      return result;
    }
  } catch {}
  result.content[0].text = `${text}\n${report}`;
  return result;
}

function slotHeartbeatIntervalMs(): number {
  return Math.max(1000, Math.min(30_000, Math.floor(zombieLiveIdleMs() / 3)));
}

function isLiveAgent(agent: AgentState): boolean {
  return (
    agent.status === "processing" ||
    agent.status === "permission_requested" ||
    agent.status === "stalled"
  );
}

type EvictableAgentState = Pick<
  AgentState,
  "status" | "driver" | "exitedAt" | "waitReported"
>;

function isTerminalAgentStatus(status: AgentStatus): boolean {
  return (
    status === "finished" ||
    status === "errored" ||
    status === "stopped" ||
    status === "zombie_killed"
  );
}

export function shouldEvictAgent(
  agent: EvictableAgentState,
  now = Date.now(),
  retentionMs = AGENT_RETENTION_MS
): boolean {
  if (!isTerminalAgentStatus(agent.status)) return false;
  if (!agent.driver.closed) return false;
  if (!agent.waitReported) return false;
  if (agent.exitedAt === null) return false;
  return now - agent.exitedAt > retentionMs;
}

export function evictExpiredAgents<T extends EvictableAgentState>(
  agentMap: Map<string, T>,
  now = Date.now(),
  retentionMs = AGENT_RETENTION_MS
): number {
  let evicted = 0;
  for (const [id, agent] of agentMap) {
    if (!shouldEvictAgent(agent, now, retentionMs)) continue;
    agentMap.delete(id);
    evicted++;
  }
  return evicted;
}

function isSameOwnerSlot(
  agent: AgentState,
  slotMeta: ReturnType<typeof readSlotMetadata>
): boolean {
  if (!slotMeta) return true;
  if (slotMeta.agent_id !== agent.id) return false;
  return slotMeta.server_pid === null || slotMeta.server_pid === process.pid;
}

function adoptNewerSlotActivity(agent: AgentState, slotMeta: ReturnType<typeof readSlotMetadata>): void {
  if (!slotMeta?.last_activity_ms || !isSameOwnerSlot(agent, slotMeta)) return;
  if (slotMeta.last_activity_ms > agent.slotLastActivity) {
    agent.slotLastActivity = slotMeta.last_activity_ms;
  }
}

function updateSlotMetadata(agent: AgentState, slotActivityMs?: number): void {
  if (!agent.slotPath) return;
  const lastActivityMs = Math.max(agent.slotLastActivity, agent.lastActivity, slotActivityMs ?? 0);
  agent.slotLastActivity = lastActivityMs;
  writeSlotMetadata(agent.slotPath, {
    agent_id: agent.id,
    server_pid: process.pid,
    child_pid: agent.process.pid ?? null,
    cwd: agent.cwd,
    started_at: new Date(agent.startedAt).toISOString(),
    started_at_ms: agent.startedAt,
    last_activity_ms: lastActivityMs,
    status: agent.status,
  });
}

function refreshLiveSlotMetadata(agent: AgentState, now: number): void {
  if (!agent.slotPath || !isLiveAgent(agent)) return;
  const slotMeta = readSlotMetadata(agent.slotPath);
  if (!isSameOwnerSlot(agent, slotMeta)) return;
  adoptNewerSlotActivity(agent, slotMeta);
  const diskActivityMs = slotMeta?.last_activity_ms ?? null;
  const shouldRefresh =
    slotMeta === null ||
    diskActivityMs === null ||
    diskActivityMs < agent.slotLastActivity ||
    now - agent.slotLastActivity >= slotHeartbeatIntervalMs();
  if (shouldRefresh) updateSlotMetadata(agent, now);
}

function spawnProcessTreeKill(pid: number, force: boolean): void {
  const commands = buildProcessTreeKillCommands(pid);
  const command = force ? commands.force : commands.graceful;
  try {
    const child = spawn(command.command, command.args, {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    });
    child.unref();
  } catch {}
}

function scheduleZombieForceKill(agent: AgentState): void {
  const pid = agent.process.pid;
  if (!pid || agent.driver.closed) return;
  const timer = setTimeout(() => {
    if (!agent.driver.closed && agent.status === "zombie_killed") {
      try {
        agent.driver.kill();
      } catch {}
      spawnProcessTreeKill(pid, true);
    }
  }, zombieForceGraceMs());
  timer.unref();
}

function markZombieKilled(
  agent: AgentState,
  reason: "stale_live" | "terminal_but_alive",
  now: number
): ZombieRecord {
  void pendingPermissionManager.closeAgent(agent.id, "agent stopped by operator");
  agent.status = "zombie_killed";
  agent.exitCode = agent.exitCode ?? -1;
  agent.exitedAt = agent.exitedAt ?? now;
  agent.waitReported = false;
  releaseSlot(agent.slotPath ?? null);
  const slotPath = agent.slotPath ?? "";
  agent.slotPath = null;
  const pid = agent.process.pid ?? null;
  const record: ZombieRecord = {
    kind: "zombie_killed",
    agent_id: agent.id,
    child_pid: pid,
    server_pid: process.pid,
    slot_path: slotPath,
    reason,
    detected_at_ms: now,
    last_activity_ms: agent.lastActivity,
    message: `zombies: culled ${agent.id}`,
  };
  if (pid && !agent.driver.closed) {
    if (reason === "terminal_but_alive") {
      try {
        agent.driver.kill();
      } catch {}
      spawnProcessTreeKill(pid, true);
    } else {
      spawnProcessTreeKill(pid, false);
      scheduleZombieForceKill(agent);
    }
  }
  return record;
}

function applyZombieRecord(record: ZombieRecord, now: number): ZombieRecord | null {
  const agent = agents.get(record.agent_id);
  if (!agent || agent.status === "zombie_killed") return null;
  void pendingPermissionManager.closeAgent(agent.id, "agent stopped by operator");
  agent.status = "zombie_killed";
  agent.exitCode = agent.exitCode ?? -1;
  agent.exitedAt = agent.exitedAt ?? now;
  agent.waitReported = false;
  releaseSlot(agent.slotPath ?? null);
  agent.slotPath = null;
  try {
    if (!agent.driver.closed) agent.driver.kill();
  } catch {}
  return { ...record, detected_at_ms: record.detected_at_ms || now };
}

function runToolMaintenance(): ZombieRecord[] {
  const now = Date.now();
  const records: ZombieRecord[] = [];
  const applied = new Set<string>();

  for (const record of [...drainZombieIntents(slotDir()), ...drainZombieReports(slotDir())]) {
    if (applied.has(record.agent_id)) continue;
    const appliedRecord = applyZombieRecord(record, now);
    if (appliedRecord) {
      records.push(appliedRecord);
      applied.add(record.agent_id);
    }
  }

  for (const agent of agents.values()) {
    if (agent.status === "zombie_killed") continue;
    reconcileAgent(agent, now);
    const live = isLiveAgent(agent);
    if (live) {
      refreshLiveSlotMetadata(agent, now);
      continue;
    }
    const slotMeta = agent.slotPath ? readSlotMetadata(agent.slotPath) : null;
    adoptNewerSlotActivity(agent, slotMeta);
    const terminalButAlive = shouldReapTerminalButAlive(agent, now, zombieTerminalIdleMs());
    if (terminalButAlive) {
      const record = markZombieKilled(agent, "terminal_but_alive", now);
      records.push(record);
      applied.add(agent.id);
      continue;
    }
    updateSlotMetadata(agent);
  }

  evictExpiredAgents(agents, now);
  return records;
}

function withMaintenance<P>(
  handler: (params: P, zombieRecords: ZombieRecord[]) => Promise<any> | any,
  options: { includeZombieReport?: boolean } = {}
): any {
  return async (params: P) => {
    const zombieRecords = runToolMaintenance();
    const result = await handler(params, zombieRecords);
    if (!options.includeZombieReport) return result;
    if (result && typeof result === "object" && "content" in result) {
      return withZombieReport(result as { content?: { type: string; text: string }[] }, zombieRecords);
    }
    return result;
  };
}

export function classifyFailureReason(reason: string, stderr: string): FailureType {
  const text = `${reason}\n${stderr}`;
  return TRANSIENT_FAILURE_RE.test(text)
    ? "transient_provider"
    : "permanent";
}

const TRANSIENT_FAILURE_RE =
  /\b429\b|\b(?:http(?:\/\d(?:\.\d)?)?|status|statuscode|status_code|code|error)\b[\s:=#-]*5\d{2}\b|quota|usage.?cap|rate.?limit|timeout|connection.?reset|ECONNRESET|ETIMEDOUT|ECONNREFUSED|too many requests|service unavailable|server error|overloaded/i;

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

// Resolved lazily and memoized on first use so that plain CLI invocations never
// spawn `npm prefix -g` at import time. The server warms this once during
// startup (see main()) so a live, long-lived server never stalls mid-request.
let npmPrefixCache: string | undefined;

function getNpmPrefix(): string {
  if (npmPrefixCache === undefined) {
    npmPrefixCache = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
  }
  return npmPrefixCache;
}

type BackgroundResumeAgent = Pick<
  AgentState,
  | "provider"
  | "status"
  | "driver"
  | "lastActivity"
  | "lastExitCode"
  | "lastExitedAt"
  | "exitCode"
  | "exitedAt"
  | "waitReported"
  | "turnCompleted"
  | "bgTaskResumeObservedAt"
  | "bgTaskResumeSentAt"
  | "bgTaskResumeInFlight"
>;

const CLAUDE_BACKGROUND_RESUME_TEXT =
  "Your background task has completed. Resume and continue where you left off.";

export function isClaudeBackgroundWakeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  try {
    const evt = JSON.parse(trimmed) as Record<string, unknown>;
    if (evt.type === "result") return false;
    const method = typeof evt.method === "string" ? evt.method : "";
    const type = typeof evt.type === "string" ? evt.type : "";
    const name = typeof evt.name === "string" ? evt.name : "";
    const marker = `${method} ${type} ${name}`.toLowerCase();
    if (marker.includes("task_notification") || marker.includes("task-notification")) return true;
    if (marker.includes("background") && marker.includes("complete")) return true;
    if (marker.includes("taskoutput") && marker.includes("complete")) return true;
    // Only concrete Claude bg-task-complete markers should wake the parked SDK
    // loop; unrelated post-turn JSONL activity is not a resume signal.
    return false;
  } catch {
    return false;
  }
}

function noteBackgroundResumeSignal(agent: BackgroundResumeAgent, at: number): void {
  if (agent.provider !== "claude" || agent.driver.closed) return;
  agent.bgTaskResumeObservedAt = Math.max(agent.bgTaskResumeObservedAt ?? 0, at);
}

export async function maybeResumeAfterBackgroundTask(
  agent: BackgroundResumeAgent,
  now = Date.now()
): Promise<boolean> {
  if (agent.provider !== "claude") return false;
  if (agent.driver.closed) return false;
  if (agent.bgTaskResumeInFlight) return false;
  const observedAt = agent.bgTaskResumeObservedAt ?? 0;
  if (observedAt === 0 || observedAt <= (agent.bgTaskResumeSentAt ?? 0)) return false;
  agent.bgTaskResumeInFlight = true;
  try {
    if (typeof agent.driver.notifyTaskComplete === "function") {
      await agent.driver.notifyTaskComplete(CLAUDE_BACKGROUND_RESUME_TEXT);
    } else {
      await agent.driver.send(CLAUDE_BACKGROUND_RESUME_TEXT);
    }
    agent.bgTaskResumeSentAt = observedAt;
    agent.status = "processing";
    agent.lastExitCode = agent.exitCode;
    agent.lastExitedAt = agent.exitedAt;
    agent.exitCode = null;
    agent.exitedAt = null;
    agent.waitReported = false;
    agent.turnCompleted = false;
    agent.lastActivity = now;
    return true;
  } finally {
    agent.bgTaskResumeInFlight = false;
  }
}

function handleCompletedStdoutLines(agent: AgentState, lines: string[], at: number): void {
  let turnWasComplete = agent.turnCompleted === true;
  for (const line of lines) {
    if (turnWasComplete && isClaudeBackgroundWakeLine(line)) {
      noteBackgroundResumeSignal(agent, at);
    }
    // A terminal provider/model error on the FIRST turn (before any visible
    // output) is a launch-equivalent failure, not a legitimate fast completion:
    // record it (so the grace window can fail over) and never mark the turn
    // completed — a failed turn/completed must not be read as success.
    if (
      !turnWasComplete &&
      agent.launchTurnFailure === undefined &&
      agent.visibleStream.length === 0
    ) {
      const failureReason = terminalTurnFailure(agent.provider, line);
      if (failureReason !== null) {
        agent.launchTurnFailure = { reason: failureReason, failure_type: "permanent" };
        continue;
      }
    }
    if (isTurnCompletedLine(agent.provider, line)) {
      turnWasComplete = true;
      agent.turnCompleted = true;
      agent.status = "finished";
      if (agent.exitedAt === null) agent.exitedAt = at;
      updateSlotMetadata(agent, at);
    }
  }
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
  if (agentState.ucSettingsDir) {
    try {
      if (existsSync(agentState.ucSettingsDir)) {
        rmSync(agentState.ucSettingsDir, { recursive: true, force: true });
      }
    } catch {}
    agentState.ucSettingsDir = undefined;
  }
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
    refreshLiveSlotMetadata(agent, now);
    if (agent.bgTaskResumeObservedAt && agent.bgTaskResumeObservedAt > (agent.bgTaskResumeSentAt ?? 0)) {
      void maybeResumeAfterBackgroundTask(agent, now).then((resumed) => {
        if (resumed) updateSlotMetadata(agent);
      });
    }
  }
  evictExpiredAgents(agents, now);
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
  "subagent-mcp - CANONICAL OPERATING MODEL (full spec: orchestration-directive-architecture.md).\n\nPRECEDENCE. The latest <subagent-mcp state=\"...\"> hook tag and repo/system safety rules are jointly binding; genuine conflict => STOP and ask. Only the hook flips ON/OFF; absence of any tag = UNKNOWN => fail-safe ON.\n\nSOLE CHANNEL. Every launch uses launch_agent; never harness Task/Agent or shell-spawned agents.\n\nORCHESTRATION ON. You are a delegate-ONLY orchestrator: use only the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and /workflows. No direct reads/writes; inline-by-right does not exist. Non-delegable step: ask a one-time exception, do only that step, resume delegating.\n\nSUB-AGENT CONTRACT. Prompt carries objective + output format + tools/sources + boundaries. SCALE: ~1 fact-find agent, 2-4 for comparisons; split multi-phase work into atomic steps. FAN-OUT independents, sequence dependents, SERIALIZE writers over shared paths (no cwd lock). VERIFY code and non-trivial steps with a separate sub-agent first.\n\nREAD LADDER. poll_agent tail -> one <=100-line summarizer sub-agent, trusted as-is -> else the USER reads it. Large handoffs use scratch-file paths; producer writes, consumer reads, orchestrator never reads them. Empty/stalled tail means ALIVE; learn finish via wait, do not poll-loop.\n\nORCHESTRATION starts OFF each session. Hook meters provider-reported context (never tokenized); at 15% it latches ON and coaches a 4-question plan; at 40% it unlocks handoff-write/handoff-read/handoff-clear; at 50% it warns. Undetectable context size = fail-safe ON.\n\nDROPOUT WHILE ON: HALT and ask until restored. SUB-AGENT EXEMPTION: a prompt whose literal FIRST LINE begins \"<this is a request from a parent process>\" skips this regime. DISABLE: user-only, never on your own initiative.\n\nMODEL SELECTION. Default smart auto-picks, rejects provider/model/effort selectors. user-approved-overrides honors them 30 min, expires lazily on launch_agent, needs user authorization.";

const SUBAGENT_INSTRUCTIONS =
  "SUB-AGENT SESSION: you are a child process launched by subagent-mcp. Follow the parent prompt. Do not treat yourself as the orchestrator, do not re-trigger orchestration carryover, and do not launch further sub-agents unless the parent prompt explicitly assigns that. launch_agent is code-capped at 2 spawn levels below the main orchestrator: depth 1 may launch depth 2 workers; depth 2 workers cannot spawn further.\n\nMODEL SELECTION MODE (parallel to orchestration-mode, set via the model-selection-mode tool). DEFAULT is \"smart\" and is used whenever unset: in smart, launch_agent REJECTS any call supplying provider/model/effort selectors and the server auto-picks the best model. \"user-approved-overrides\" opens a 30-MINUTE window where selectors are HONORED, enforced LAZILY (the mode reverts to smart on the next launch_agent call after 30 minutes) and re-enabling does NOT extend an active window. HONOR-BASED: you MUST NOT set \"user-approved-overrides\" without explicit interactive USER authorization via the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex); never enable it on your own initiative.";

const server = new McpServer(
  {
    name: "subagent-mcp",
    version: "3.1.3-beta.1",
    description:
      "Launches local Claude and Codex sub-agent sessions and can route configured tasks to direct Claude Messages or OpenAI-compatible API providers.",
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
function cleanupUcSettingsPath(ucSettingsPath?: string, ucSettingsDir?: string): void {
  if (!ucSettingsPath) return;
  try {
    if (existsSync(ucSettingsPath)) unlinkSync(ucSettingsPath);
  } catch {}
  if (!ucSettingsDir) return;
  try {
    if (existsSync(ucSettingsDir)) rmSync(ucSettingsDir, { recursive: true, force: true });
  } catch {}
}

// Compose the environment for a spawned child agent. GH_TOKEN / GITHUB_TOKEN are
// stripped by default so a stale inherited token cannot override the child's own
// `gh` keyring auth. Opt back in with SUBAGENT_MCP_PASS_GH_TOKENS=1.
export function buildChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  overrides: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv, ...overrides };
  if (parentEnv.SUBAGENT_MCP_PASS_GH_TOKENS !== "1") {
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
  }
  return env;
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
  permissionSnapshot: PermissionSnapshot,
  routingTier?: "cost_efficiency" | "performance" | "manual",
  rulesetInfo?: {
    applied: true;
    originalSelection: { provider: string; model: string; effort: string };
  }
): Promise<{ agentId: string } | { reason: string; failure_type: FailureType }> {
  if (candidate.provider === "api") {
    if (!candidate.apiProvider) {
      return { reason: "api provider config missing for candidate", failure_type: "permanent" };
    }
    const agentId = randomUUID();
    const now = Date.now();
    try {
      const response = await callApiProvider(candidate.apiProvider, {
        messages: [{ role: "user", content: prompt }],
        temperature: effortToTemperature(candidate.effort as Parameters<typeof effortToTemperature>[0]),
        max_tokens: 4096,
      });
      const process = new ClosedProcess();
      const agentState: AgentState = {
        id: agentId,
        provider: "api",
        model: candidate.model,
        routingTier,
        ...(rulesetInfo
          ? { rulesetApplied: true, rulesetOriginalSelection: rulesetInfo.originalSelection }
          : {}),
        status: "finished",
        process,
        driver: closedDriver(process),
        stdout: response.text,
        stderr: "",
        exitCode: 0,
        exitedAt: now,
        lastExitCode: null,
        lastExitedAt: null,
        startedAt: now,
        lastActivity: now,
        cwd: agentCwd,
        permissionSnapshot,
        waitReported: false,
        visibleStream: response.text ? [{ type: "text", text: response.text, at: now }] : [],
        streamBuf: "",
        slotLastActivity: now,
      };
      agents.set(agentId, agentState);
      return { agentId };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return { reason, failure_type: classifyFailureReason(reason, "") };
    }
  }

  // Build the command. haiku ignores effort; pass "high" placeholder for the
  // "none" sentinel (buildCommand drops it for haiku anyway).
  const effortForBuild = candidate.effort === "none" ? "high" : candidate.effort;

  const agentId = randomUUID();
  let buildResult: { args: string[]; ucSettingsPath?: string; ucSettingsDir?: string };
  let cmd: string;
  try {
    buildResult = buildCommand(
      candidate.provider,
      candidate.model,
      effortForBuild,
      agentCwd,
      agentId
    );
    cmd = resolveExe(candidate.provider);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { reason, failure_type: "permanent" };
  }

  // Fast-fail absolute paths only. Bare names intentionally rely on PATH; spawn
  // below resolves them and reports ENOENT/EACCES through the same failure path.
  if (isAbsolute(cmd) && !existsSync(cmd)) {
    cleanupUcSettingsPath(buildResult.ucSettingsPath, buildResult.ucSettingsDir);
    return { reason: `CLI executable not found: ${cmd}`, failure_type: "permanent" };
  }

  let driver: ProviderDriver;
  try {
    driver = await createProviderDriver({
      provider: candidate.provider,
      command: cmd,
      args: buildResult.args,
      cwd: agentCwd,
      env: buildChildEnv(process.env, {
        SUBAGENT_MCP_SUBAGENT: "1",
        SUBAGENT_MCP_DEPTH: String(currentLaunchDepth() + 1),
      }),
      model: candidate.model,
      effort: candidate.effort,
      ucSettingsPath: buildResult.ucSettingsPath,
      ucSettingsDir: buildResult.ucSettingsDir,
      agentId,
    });
  } catch (error) {
    // Synchronous spawn throw (rare) — clean up and report as a launch failure.
    cleanupUcSettingsPath(buildResult.ucSettingsPath, buildResult.ucSettingsDir);
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
    cleanupUcSettingsPath(buildResult.ucSettingsPath, buildResult.ucSettingsDir);
    const reason = err instanceof Error ? err.message : String(err);
    return { reason, failure_type: classifyFailureReason(reason, "") };
  }

  // Spawn succeeded. Register the agent exactly as before. Keep a persistent
  // 'error' handler so a LATE spawn error never crashes the process; fold it
  // into stderr rather than throwing.
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
    lastExitCode: null,
    lastExitedAt: null,
    // Launch time is the initial heartbeat. Only PARSED VISIBLE provider stream
    // items refresh lastActivity afterwards (see the stdout handler); raw
    // stdout/stderr chunks do NOT, so `stalled` means exactly "no visible
    // provider stream item for the heartbeat window".
    startedAt: now,
    lastActivity: now,
    cwd: agentCwd,
    permissionSnapshot,
    ucSettingsPath: buildResult.ucSettingsPath,
    ucSettingsDir: buildResult.ucSettingsDir,
    waitReported: false,
    visibleStream: [],
    streamBuf: "",
    slotLastActivity: now,
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
        if (agentState.stdout.length > STDOUT_RING_BYTES) {
          agentState.stdout = agentState.stdout.slice(-STDOUT_RING_BYTES);
        }
      }
      if (items.length > 0) {
        // Heartbeat refreshes only on parsed visible provider stream items,
        // not on raw stdout bytes.
        agentState.lastActivity = at;
        updateSlotMetadata(agentState);
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
      handleCompletedStdoutLines(agentState, lines, at);
      if (agentState.bgTaskResumeObservedAt && agentState.bgTaskResumeObservedAt > (agentState.bgTaskResumeSentAt ?? 0)) {
        void maybeResumeAfterBackgroundTask(agentState, at).then((resumed) => {
          if (resumed) updateSlotMetadata(agentState);
        });
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
    void pendingPermissionManager.closeAgent(agentState.id, "agent process exited while permission request was pending");
    // Flush any buffered trailing stdout line (final event may arrive without a
    // terminating newline) so its visible item is not lost.
    if (agentState.streamBuf) {
      const at = Date.now();
      const { items, lines } = flushStream(agentState.provider, agentState.streamBuf);
      agentState.streamBuf = "";
      for (const line of lines) {
        agentState.stdout += line + "\n";
        if (agentState.stdout.length > STDOUT_RING_BYTES) {
          agentState.stdout = agentState.stdout.slice(-STDOUT_RING_BYTES);
        }
      }
      // A completion marker may arrive only in this final flush (no trailing
      // newline) — the grace window's success exception needs it.
      handleCompletedStdoutLines(agentState, lines, at);
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
    releaseSlot(agentState.slotPath ?? null);
    agentState.slotPath = null;

    // Always record actual close time (unless already finalized)
    if (agentState.exitedAt === null) agentState.exitedAt = Date.now();

    if (agentState.status === "zombie_killed") {
      if (agentState.exitCode === null) agentState.exitCode = code !== null ? code : -1;
      return;
    }

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
        const tail = escapeUntrustedTags(agentState.stderr.trim().split("\n").slice(-1)[0] ?? "");
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
        reconcileAgentPermissionStatus(agentState);
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

    // Terminal first-turn provider/model error surfaced through the stream
    // (systemError / invalid_request / model-not-supported) with no visible
    // output and no process exit: treat it as a launch-equivalent failure so the
    // attempt loop silently advances to the next-best candidate, recording the
    // failover exactly like a launch failure.
    if (agentState.launchTurnFailure && !agentState.turnCompleted && agentState.visibleStream.length === 0) {
      try {
        driver.kill();
      } catch {}
      cleanupUcSettings(agentState);
      return {
        reason: agentState.launchTurnFailure.reason,
        failure_type: agentState.launchTurnFailure.failure_type,
      };
    }
  }

  agents.set(agentId, agentState);
  reconcileAgentPermissionStatus(agentState);
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

function reattachCandidateMetadata(original: Candidate[], returned: Candidate[]): Candidate[] {
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of original) {
    const key = `${candidate.provider}\0${candidate.model}\0${candidate.effort}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(candidate);
    else buckets.set(key, [candidate]);
  }
  return returned.map((candidate) => {
    const key = `${candidate.provider}\0${candidate.model}\0${candidate.effort}`;
    const match = buckets.get(key)?.shift();
    return match?.apiProvider ? { ...candidate, apiProvider: match.apiProvider } : candidate;
  });
}

// Tool 1: launch_agent
server.tool(
  "launch_agent",
  "Spawn a sub-agent session. CONTRACT: every `prompt` states objective + required output format + tools/sources + boundaries; the server auto-upserts the self-identification marker \"<this is a request from a parent process>\" as the true first line (idempotent, never duplicated, body never mutated), so you need not add it. SCALE to complexity: ~1 agent for a simple fact-find, 2-4 for comparisons; never one-shot a multi-phase task — SPLIT into atomic steps that each map to ONE task_category, one agent per step. AUTO MODE (mandatory first attempt unless an override is licensed below): pass only `prompt` + `task_category`, NO overrides; the server picks the best provider/model/effort for that category and silently falls back to the next-best on launch failure. `provider`/`model`/`effort` are OVERRIDES, licensed on the 1st/2nd attempt ONLY when the task verifiably needs a specific capability — STATE that capability; `model` requires `provider`, `effort` requires `provider`+`model`; ultracode effort is Opus 4.8+ only. SOLE CHANNEL: while this server is connected this is the ONLY sanctioned way to spawn sub-agents in BOTH orchestration states; harness-native Task/Agent tools are FORBIDDEN. Children run with env SUBAGENT_MCP_SUBAGENT=1 so orchestration hooks skip them (not orchestrators, no carryover re-trigger). Launch returns `processing` (alive); a later `stalled` is alive-but-quiet (thinking or awaiting a temp-file handoff), NOT dead — wait or re-poll, don't kill (see poll_agent). DEADLOCK RULE: you MUST set `deadlock=true` when, and ONLY when, 2 attempts for the SAME atomic task have already failed/been unsatisfactory (the 3rd attempt onward; re-wording or re-splitting does NOT make it a new task), and NEVER otherwise — from the 3rd attempt deadlock outranks any capability override: drop provider/model/effort.",
  {
    task_category: z.enum(TASK_CATEGORIES).describe(TASK_CATEGORY_GLOSS),
    prompt: z.string().min(1),
    provider: z.enum(["claude", "codex", "api"]).optional(),
    model: z.enum(["haiku", "sonnet", "opus", "opus-4-8", "fable", "gpt-5.5", "gpt-5.6"]).optional(),
    effort: z.enum(["medium", "high", "xhigh", "max", "ultracode"]).optional(),
    cwd: z.string().optional(),
    deadlock: z.boolean().optional().describe("MANDATE: ALWAYS set deadlock=true when, and ONLY when, 2 launch attempts for the SAME atomic task have already failed or been unsatisfactory — the 3rd attempt onward. Re-wording the prompt does NOT make it a different task; splitting a failed task does NOT reset attempts for its unchanged parts; re-launching for the same deliverable means the prior attempt COUNTS as failed/unsatisfactory ('partial progress' is not an exemption). NEVER set it on a 1st or 2nd attempt, NEVER for a different task, NEVER speculatively. Auto mode only: cannot be combined with provider/model/effort — from the 3rd attempt deadlock outranks any capability override, so drop those params. Passing false is identical to omitting it."),
  },
  withMaintenance(async (params: any) => {
    const launchStartedAt = Date.now();
    const { task_category, provider, model, effort, deadlock } = params;
    const launchDepth = currentLaunchDepth();
    if (launchDepth >= 2) {
      return errorResult(
        `Error: launch_agent depth cap reached: current SUBAGENT_MCP_DEPTH=${launchDepth}. subagent-mcp permits exactly 2 spawn levels below the main orchestrator (depth 0 -> 1 -> 2); depth 2 workers cannot spawn further sub-agents.`
      );
    }

    // D19/D20/S8: server silently upserts the parent-process marker as the TRUE
    // first line of every sub-agent prompt (idempotent; never duplicates; never
    // mutates the body). This is what makes the child first-line exemption fire.
    const prompt = ensureParentMarker(params.prompt);
    const agentCwd = params.cwd || process.cwd();
    const permissionSnapshot = buildPermissionSnapshot(agentCwd);

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
    if (pureAuto && process.env.SUBAGENT_MCP_DISABLE_API_PROVIDERS !== "1") {
      candidates = slotInsert(candidates, loadApiProviders(), task_category);
    }
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
        rulesetOriginalSelection = {
          provider: candidates[0].provider,
          model: candidates[0].model,
          effort: candidates[0].effort,
        };
      }
      candidates = reattachCandidateMetadata(candidates, applied.candidates);
    }

    // 6. Attempt loop: best→worst. Register on first successful driver start; silently
    //    advance on launch-time failure. Sub-agent task outcome is NEVER a trigger.
    const apiGate = modelMode.gateLaunch(agentCwd, {
      provider,
      model,
      effort,
      dispatchSource: candidates.some((c) => c.provider === "api") ? "api-provider" : undefined,
    });
    if (!apiGate.allowed) {
      return errorResult(apiGate.message ?? modelMode.SELECTOR_REJECTION_MESSAGE);
    }

    const cap = readGlobalCap();
    const reservationId = randomUUID();
    const reservation = reserveSlot(reservationId, cap, slotDir(), NONBLOCKING_CULL_DEPS);
    if (!reservation.ok) {
      return errorResult(globalCapMessage(reservation.current, cap, defaultConfigPath()));
    }

    const skipped: {
      model: string;
      effort: string;
      provider: string;
      reason: string;
      failure_type: FailureType;
    }[] = [];
    let launched = false;
    incrementAgentCount();
    try {
      for (const candidate of candidates) {
        let outcome = await tryLaunchCandidate(
          candidate,
          prompt,
          agentCwd,
          permissionSnapshot,
          routingTier,
          rulesetApplied && rulesetOriginalSelection !== undefined
            ? { applied: true, originalSelection: rulesetOriginalSelection }
            : undefined
        );
        if (
          candidate.provider === "api" &&
          !("agentId" in outcome) &&
          outcome.failure_type === "transient_provider"
        ) {
          outcome = await tryLaunchCandidate(
            candidate,
            prompt,
            agentCwd,
            permissionSnapshot,
            routingTier,
            rulesetApplied && rulesetOriginalSelection !== undefined
              ? { applied: true, originalSelection: rulesetOriginalSelection }
              : undefined
          );
        }
        if ("agentId" in outcome) {
          if (branch === "performance") {
            deadlockWindow.consume();
          }
          const registeredAgent = agents.get(outcome.agentId);
          if (registeredAgent) {
            registeredAgent.slotPath = reservation.slotPath;
            updateSlotMetadata(registeredAgent);
            // The child can reach a terminal state DURING tryLaunchCandidate's
            // awaits — before slotPath was set — so its close handler ran
            // releaseSlot(undefined) (a no-op) and left the slot leaked. Detect
            // that here and release now. slotPath is unique per reservation, so
            // this never frees another agent's slot.
            if (registeredAgent.exitCode !== null) {
              releaseSlot(registeredAgent.slotPath);
              registeredAgent.slotPath = null;
            }
            if (skipped.length > 0) {
              registeredAgent.failoverFrom = skipped.map((s) => ({
                provider: s.provider,
                model: s.model,
                effort: s.effort,
                failure_type: s.failure_type,
              }));
            }
          }
          launched = true;
          recordRoutingDecision({
            category: task_category,
            provider: candidate.provider,
            elapsed_ms: Date.now() - launchStartedAt,
          });
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
                  ...(routingTier ? { routing_tier: routingTier } : {}),
                  permissions_applied: {
                    ceiling: permissionSnapshot.ceiling,
                    escalation: permissionSnapshot.escalation,
                    allow_count: permissionSnapshot.rules.allow?.length ?? 0,
                    ask_count: permissionSnapshot.rules.ask?.length ?? 0,
                    deny_count: permissionSnapshot.rules.deny?.length ?? 0,
                    additional_directories_count:
                      permissionSnapshot.additionalDirectories?.length ?? 0,
                    repo_config_changed_since_first_seen:
                      permissionSnapshot.repoConfigChangedSinceFirstSeen ?? false,
                  },
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
    } finally {
      if (!launched) {
        releaseSlot(reservation.slotPath);
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
  }) // ponytail: launch_agent still reaps, but callers do not receive zombie_report.
);

server.tool(
  "get_status",
  "Return live in-memory MCP session state. `session_start_time` is the MCP server process boot time because smcp-activate runs as a separate hook process and cannot update this server's memory; no state file is used.",
  {},
  withMaintenance(async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(getStatus()),
      },
    ],
  }))
);

// Tool 2: poll_agent
server.tool(
  "poll_agent",
  "Get an agent's current status and output. `processing` = ALIVE with visible provider activity in the last 10 min; `stalled` = ALIVE but no visible provider stream item for 10 min (thinking, or awaiting a temp-file handoff) — NOT dead, so prefer `wait`/re-poll over killing. Polling refreshes the agent's idle clock. Always returns `alive` + `idle_seconds`, plus `recent_stream` (last 3 timestamped visible stream items) and a `hint` while stalled. `verbose: true` also returns `final_output`, the agent's final assistant turn from its captured stdout.",
  {
    agent_id: z.string(),
    verbose: z.boolean().optional().default(false),
  },
  withMaintenance(async (params: any) => {
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
    agent.lastActivity = now;

    const escapedStdout = escapeUntrustedTags(agent.stdout);
    const escapedStderr = escapeUntrustedTags(agent.stderr);
    const stdoutTail = envelopeUntrustedOutput(
      escapedStdout.length > 2000
        ? escapedStdout.slice(-2000)
        : escapedStdout
    );
    const stderrTail = envelopeUntrustedOutput(
      escapedStderr.length > 1000
        ? escapedStderr.slice(-1000)
        : escapedStderr
    );

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
            ...(agent.routingTier ? { routing_tier: agent.routingTier } : {}),
            status: agent.status,
            exit_code: agent.exitCode,
            started_at: agent.startedAt,
            last_activity: agent.lastActivity,
            cwd: agent.cwd,
            ...liveness,
            ...(pendingPermissionManager.pendingCount(agent.id) > 0
              ? {
                  pending_permissions: pendingPermissionManager
                    .pendingForAgent(agent.id)
                    .map((p) => pendingPermissionSummary(p, now)),
                }
              : {}),
            ...(isStalePermissive(agent)
              ? {
                  stale_permissive: true,
                  stale_permissive_hint:
                    "agent launched under a more permissive ceiling than current config; consider kill_agent",
                }
              : {}),
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
              text: envelopeUntrustedOutput(escapeUntrustedTags(it.text)),
              at: it.at !== undefined ? formatLocalIso(it.at) : null,
            })),
            ...(params.verbose
              ? {
                  stdout_tail: stdoutTail,
                  stderr_tail: stderrTail,
                  final_output: envelopeUntrustedOutput(
                    escapeUntrustedTags(extractFinalTurn(agent.provider, agent.stdout))
                  ),
                }
              : {}),
          }),
        },
      ],
    };
  }, { includeZombieReport: true })
);

// Tool 3: kill_agent
server.tool(
  "kill_agent",
  "Terminate a live agent/session (status `processing`, `stalled`, or turn-finished but still interactive) by immediately force-killing its managed driver. A finished agent is force-killed automatically after 6 minutes of no `send_message`/`poll_agent` activity; call `kill_agent` sooner to free resources immediately. No-op for already-terminal closed agents.",
  {
    agent_id: z.string(),
  },
  withMaintenance(async (params: any) => {
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
      (agent.status === "processing" ||
        agent.status === "permission_requested" ||
        agent.status === "stalled" ||
        agent.status === "finished") &&
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
      await pendingPermissionManager.closeAgent(agent.id, "agent stopped by operator");
      agent.status = "stopped";
      agent.driver.kill();
      releaseSlot(agent.slotPath ?? null);
      agent.slotPath = null;
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
  })
);

// Tool 4: respond_permission (parents only; children cannot approve other children)
if (process.env.SUBAGENT_MCP_SUBAGENT !== "1") {
  server.tool(
    "respond_permission",
    "Answer a parked permission request for an agent. One-time only; does not create session-wide approvals. If request_id is omitted, answers the agent's oldest pending request.",
    {
      agent_id: z.string(),
      request_id: z.string().optional(),
      decision: z.enum(["allow", "deny"]),
      reason: z.string().optional(),
    },
    withMaintenance(async (params: any) => {
      const agent = agents.get(params.agent_id);
      if (!agent) {
        return {
          content: [{ type: "text", text: `Error: Agent ${params.agent_id} not found` }],
          isError: true,
        };
      }
      try {
        const answered = await pendingPermissionManager.respond(
          agent.id,
          params.request_id,
          params.decision,
          params.reason
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                agent_id: agent.id,
                request_id: answered.request_id,
                decision: answered.answer,
                status: agent.status,
                pending_permission_count: pendingPermissionManager.pendingCount(agent.id),
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error responding to permission request: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    })
  );
}

// Tool 5: send_message
server.tool(
  "send_message",
  "Enqueue a user message for an open interactive agent session. Observe output with poll_agent or wait.",
  {
    agent_id: z.string(),
    message: z.string().min(1),
  },
  withMaintenance(async (params: any) => {
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
      (agent.status === "processing" ||
        agent.status === "permission_requested" ||
        agent.status === "stalled" ||
        agent.status === "finished") &&
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
    const pendingCount = pendingPermissionManager.pendingCount(agent.id);
    if (pendingCount > 0) {
      return {
        content: [
          {
            type: "text",
            text:
              `Error: agent has ${pendingCount} pending permission request(s); ` +
              `call respond_permission before sending further messages`,
          },
        ],
        isError: true,
      };
    }

    try {
      await agent.driver.send(params.message);
      const now = Date.now();
      agent.status = "processing";
      agent.lastExitCode = agent.exitCode;
      agent.lastExitedAt = agent.exitedAt;
      agent.exitCode = null;
      agent.exitedAt = null;
      agent.waitReported = false;
      agent.turnCompleted = false;
      agent.lastActivity = now;
      updateSlotMetadata(agent);
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
  })
);

// Tool 6: list_agents
server.tool(
  "list_agents",
  "List all agents with token-efficient core metrics (status, `alive`, `idle_seconds`). `stalled` is ALIVE-but-quiet, NOT dead (full status semantics on poll_agent). Use `poll_agent` for per-agent stream items, hints, and final output.",
  {},
  withMaintenance(async () => {
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
        pending_permission_count: pendingPermissionManager.pendingCount(agent.id),
        ...(isStalePermissive(agent) ? { stale_permissive: true } : {}),
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
  }, { includeZombieReport: true })
);

// Tool 7: wait
server.tool(
  "wait",
  "Blocks until one or more sub-agents reach a reportable state (turn-finished, errored, stopped, or zombie_killed), returning exit code when known + local-time timestamp; or returns the live-job list after a 15-minute timeout. This is how you learn an agent finished — do NOT poll-loop. A `finished` agent with null exit_code is still alive and accepts `send_message`; `send_message`/`poll_agent` activity keeps it alive, and 6 minutes idle auto-kills it. A `stalled` agent is still ALIVE and does NOT end the wait. `verbose: true` adds each finished agent's `final_output`.",
  {
    verbose: z.boolean().optional().default(false),
  },
  withMaintenance(async (params: any, zombieRecords: ZombieRecord[]) => {
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
        ? {
            final_output: envelopeUntrustedOutput(
              escapeUntrustedTags(extractFinalTurn(a.provider, a.stdout))
            ),
          }
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
      ...(isStalePermissive(a) ? { stale_permissive: true } : {}),
      ...(a.status === "permission_requested"
        ? {
            pending_permissions: pendingPermissionManager
              .pendingForAgent(a.id)
              .map((p) => pendingPermissionSummary(p, now)),
          }
        : {}),
    });

    const buildPermissionRequestedEntry = (a: AgentState, now: number) => ({
      id: a.id,
      provider: a.provider,
      model: a.model,
      status: a.status,
      ...(isStalePermissive(a) ? { stale_permissive: true } : {}),
      pending_permissions: pendingPermissionManager
        .pendingForAgent(a.id)
        .map((p) => pendingPermissionSummary(p, now)),
    });

    // Step 1: collect already-terminal unreported agents
    const allAgents = Array.from(agents.values());
    let unreported = selectUnreported(allAgents);
    let unreportedPermissionRequested = selectUnreportedPermissionRequested(allAgents);
    if (unreported.length > 0 || unreportedPermissionRequested.length > 0) {
      // Mark reported synchronously before building return (single-threaded JS → atomic)
      for (const a of unreported) a.waitReported = true;
      for (const a of unreportedPermissionRequested) a.waitReported = true;
      const payload = {
        ...(unreported.length > 0 ? { finished: unreported.map(buildFinishedEntry) } : {}),
        ...(unreportedPermissionRequested.length > 0
          ? {
              permission_requested: unreportedPermissionRequested.map((a) =>
                buildPermissionRequestedEntry(a, Date.now())
              ),
            }
          : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      };
    }

    // Step 2: nothing alive and nothing unreported (includes stopped-but-not-yet-closed).
    // `stalled` is a LIVE state — it keeps the wait pending, it never ends it.
    const TERMINAL_SET = new Set(["finished", "errored", "stopped", "zombie_killed"]);
    const hasPending = Array.from(agents.values()).some(
      (a) =>
        a.status === "processing" ||
        a.status === "permission_requested" ||
        a.status === "stalled" ||
        (TERMINAL_SET.has(a.status) && a.exitedAt === null)
    );
    if (!hasPending) {
      const payload = {
        finished: [] as ReturnType<typeof buildFinishedEntry>[],
        message: "No agents are running or waiting to finish.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      };
    }

    // Step 3: block-poll until a terminal agent appears or deadline passes
    while (Date.now() < deadline) {
      await sleep(250);
      zombieRecords.push(...runToolMaintenance());
      const loopAgents = Array.from(agents.values());
      unreported = selectUnreported(loopAgents);
      unreportedPermissionRequested = selectUnreportedPermissionRequested(loopAgents);
      if (unreported.length > 0 || unreportedPermissionRequested.length > 0) {
        for (const a of unreported) a.waitReported = true;
        for (const a of unreportedPermissionRequested) a.waitReported = true;
        const payload = {
          ...(unreported.length > 0 ? { finished: unreported.map(buildFinishedEntry) } : {}),
          ...(unreportedPermissionRequested.length > 0
            ? {
                permission_requested: unreportedPermissionRequested.map((a) =>
                  buildPermissionRequestedEntry(a, Date.now())
                ),
              }
            : {}),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
        };
      }
    }

    // Step 4: timeout — return still-running jobs
    const now = Date.now();
    const stillRunning = Array.from(agents.values()).filter(
      (a) =>
        a.status === "processing" ||
        a.status === "permission_requested" ||
        a.status === "stalled"
    );
    const payload = {
      timed_out: true,
      elapsed_minutes: 15,
      running: stillRunning.map((a) => buildRunningEntry(a, now)),
      hint: "15 minutes elapsed with no agent finishing. Call wait again to block for another 15 minutes or until the next agent finishes.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    };
  })
);

// Tool 8: orchestration-mode
server.tool(
  "orchestration-mode",
  "Toggle or query per-project ORCHESTRATION MODE. `enabled`: true = ON, false = OFF for THIS session only, omit = query. SOLE CHANNEL holds in BOTH states: subagent-mcp is the only sanctioned way to launch sub-agents; toggling OFF does not lift that. WHAT: when ON act as a delegate-ONLY orchestrator; delegate every step, inline-by-right does not exist, a non-delegable atomic step needs a one-time user-approved exception via the structured-question tool. Default is now OFF each session (metering-driven latch/handoff supersede the old manual-upgrade-ask model); enabled:true explicitly turns ON early (before any latch); enabled:false remains a session-scoped 2h-TTL opt-out, HONORED even after the 15% latch or metering fail-safe forces ON. PERSISTENCE: a permitted disable is session-keyed only, applies to THIS session only, resumes ON next new session or after the 2h backstop; keyless hosts get only the one-time non-persisted conversational opt-out. DISABLE: never on your own initiative; you may PROPOSE OFF on task-fit mismatch, but only EXPLICIT user permission may set enabled:false. Per-turn injection fires only in CLI hosts that load the bundled hook; desktop hosts toggle the marker but inject nothing.",
  {
    enabled: z.boolean().optional(),
  },
  withMaintenance(async (params: any) => {
    const cwd = process.cwd();
    const key = orchestrationMarker.readCurrentSession(cwd);
    if (params.enabled === true) {
      if (!key) {
        return errorResult(
          "cannot enable: no session pointer found for this project (the per-turn hook has not fired yet). Enable records are session-keyed only; send one prompt first, or check wiring with `subagent-mcp doctor`."
        );
      }
      if (!orchestrationMarker.isSessionScopedKey(key)) {
        return errorResult(
          "cannot enable: this host supplies no session identity (no session_id/transcript_path in hook payloads) and enable records are session-keyed only. Orchestration remains fail-safe ON for this anonymous host."
        );
      }
      orchestrationMarker.removeDisable(key);
      orchestrationMarker.writeEnable(key);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              orchestration_mode: "ON",
              message: "orchestration is ON for this session.",
            }),
          },
        ],
      };
    } else if (params.enabled === false) {
      if (!key) {
        return errorResult(
          "cannot disable: no session pointer found for this project (the per-turn hook has not fired yet). Disable records are session-keyed only; send one prompt first, or check wiring with `subagent-mcp doctor`."
        );
      }
      if (!orchestrationMarker.isSessionScopedKey(key)) {
        return errorResult(
          "cannot disable: this host supplies no session identity (no session_id/transcript_path in hook payloads) and disable records are session-keyed only. Offer the user the one-time, non-persisted conversational opt-out for this window; orchestration stays ON."
        );
      }
      orchestrationMarker.writeDisable(key);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              orchestration_mode: "disabled-this-session",
              message:
                "orchestration disabled for THIS session only; this opt-out overrides the 15% latch and metering fail-safe until the next new session or the 2h backstop.",
            }),
          },
        ],
      };
    }
    // enabled === undefined -> query only; no marker mutation.
    const active = computeEffectiveOrchestrationActive(cwd, key);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            orchestration_mode: active ? "ON" : "disabled-this-session",
            session_scope: key
              ? orchestrationMarker.isSessionScopedKey(key)
                ? "session"
                : "anonymous"
              : "none",
          }),
        },
      ],
    };
  })
);

// Tool 9: model-selection-mode
server.tool(
  "model-selection-mode",
  "Set or query per-project MODEL SELECTION MODE, which gates launch_agent's `provider`/`model`/`effort` selectors. `mode`: \"smart\" or \"user-approved-overrides\"; omit to query. \"smart\" is the DEFAULT (used whenever unset): launch_agent REJECTS any call supplying provider/model/effort and the server auto-picks the best model for the task_category. \"user-approved-overrides\" opens a 30-MINUTE window where selectors are HONORED, enforced LAZILY (reverts to smart on the next launch_agent call after the 30 min elapse); re-enabling does NOT extend an active window. HONOR-BASED, parallel to orchestration-mode: you MUST NOT set \"user-approved-overrides\" without explicit interactive USER authorization via the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex; a plain yes/no if neither exists). This tool CANNOT verify that authorization — never enable on your own initiative. PERSISTENCE: state keyed by stable repo identity when cwd is inside git, else cwd; both the mode and the override-window timestamp survive server restarts (remaining window is restored, not reset).",
  {
    mode: z.enum(["smart", "user-approved-overrides"]).optional(),
  },
  withMaintenance(async (params: any) => {
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
  })
);

// Verbatim handoff post-write response (plan Section 1.1). Defined as a
// top-level string constant here so mirror-fragments.test.mjs can assert
// byte-identity against handoff.md via source-text regex. Kept in lockstep
// with handoff.HANDOFF_WRITE_SUCCESS (single verbatim string, two surfaces).
const HANDOFF_WRITE_SUCCESS_MESSAGE =
  "We are ready to start a new session, to avoid wasting tokens, use the structured question tool to confirm that the user is ready to use the `smcp-handoff skill` in the next new session to resume work and has cleared the current /goal (if present) - or you will be compelled to keep working on a potential /goal that needs to be halted for a new session.";

// Tool 10: handoff-write
server.tool(
  "handoff-write",
  "Write a handoff for this working directory so the NEXT session can resume cleanly. UNLOCKS only at >=40% context utilization with readable metering; below that, or if context size is undetectable, this tool returns an affirmative unavailable error (never silent). BEFORE calling, ask the user 10 clarifying questions via the structured-question tool to build a /goal prompt for the next session. content <=4000 chars; use overflow (<=8000 more chars) for anything beyond that, referenced by full path inside content. On success, relay the tool's exact response to the user verbatim.",
  {
    content: z.string().min(1),
    overflow: z.string().optional(),
  },
  withMaintenance(async (params: any) => {
    const cwd = process.cwd();
    const key = orchestrationMarker.readCurrentSession(cwd);
    if (!key) return errorResult(handoff.UNAVAILABLE_NO_METERING);
    const result = handoff.writeHandoffIfAvailable(
      cwd,
      {
        content: params.content,
        overflowContent: params.overflow,
        createdBySession: key,
      },
      metering.readMetering(key)
    );
    if (!result.ok) return errorResult(result.error);
    return textResult(HANDOFF_WRITE_SUCCESS_MESSAGE);
  })
);

// Tool 11: handoff-read
server.tool(
  "handoff-read",
  "Read the saved handoff for this working directory (if any). Call this first; after reading any saved handoff, confirm the user's intent via EXACTLY 4 structured questions before acting on it (proves legitimacy, clears ambiguity). If found, this session becomes the ONLY session that gets the handoff re-appended to its periodic LONG reminders. If none is saved, explains that the previous session must write one first.",
  {},
  withMaintenance(async () => {
    const cwd = process.cwd();
    const key = orchestrationMarker.readCurrentSession(cwd);
    const record = handoff.readHandoff(cwd);
    if (record === null) return errorResult(handoff.NO_HANDOFF_FOUND);
    const marked = key ? handoff.markRead(cwd, key) ?? record : record;
    const overflowLine = marked.overflow_path
      ? `\n\nOverflow file: ${marked.overflow_path}`
      : "";
    return textResult(
      [
        "Saved handoff:",
        marked.content + overflowLine,
        "You have read this handoff. Before acting on it, confirm the user's intent via EXACTLY 4 structured questions. Confirm: resume objective, current blocker, files/state to preserve, and next concrete action plus permission to proceed in this session.",
      ].join("\n\n")
    );
  })
);

// Tool 12: handoff-clear
server.tool(
  "handoff-clear",
  "Delete the saved handoff for this working directory, including any overflow file. The write/read/clear cycle repeats at each successor session's own 40% unlock threshold.",
  {},
  withMaintenance(async () => {
    handoff.clearHandoff(process.cwd());
    return textResult("handoff cleared for this directory.");
  })
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
    "  setup [--dry-run] [--unattended]",
    "                     wire Claude Code CLI / Codex CLI and init instructions",
    "  init, --init [flags]",
    "                     upsert project instruction-file invariant blocks",
    "                     flags: --dry-run --remove --force --root <dir> --files <csv> --copilot --cursor",
    "                     --global  upsert into ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md",
    "  config init [--force]",
    "                     scaffold ~/.subagent-mcp/providers.jsonc and .env",
    "  config validate [--file <path>]",
    "                     validate providers.jsonc against .env and routing schema",
    "  rollback           restore user config files from the newest backup",
    "  uninstall          remove subagent-mcp hooks and MCP registrations",
    "  doctor             check install and wiring health",
    "  upgrade            one-command upgrade with backup, hook repair, init-block check, and doctor",
    "  update, --update   update to the latest release (npm install -g)",
    "                     flags: --force --quiet --unattended",
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
    const updateFlags = new Set(process.argv.slice(3));
    const forceUpdate = updateFlags.has("--force");
    const quietUpdate = updateFlags.has("--quiet");
    const unattendedUpdate = updateFlags.has("--unattended");
    for (const flag of updateFlags) {
      if (flag !== "--force" && flag !== "--quiet" && flag !== "--unattended") {
        console.error(`unknown update argument: ${flag}`);
        process.exit(1);
      }
    }
    const initRegistry = await prepareRegistryForUpdate({ force: forceUpdate, quiet: quietUpdate, unattended: unattendedUpdate });
    const pkg = readPkg();
    const scope = pkg.name.startsWith("@") ? pkg.name.split("/")[0] : null;
    const npmjsRegistryArgs = [
      "--registry=https://registry.npmjs.org",
      ...(scope ? [`--${scope}:registry=https://registry.npmjs.org`] : []),
    ];
    const npmArgs = [
      "install",
      "-g",
      ...npmjsRegistryArgs,
      `${pkg.name}@latest`,
    ];
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
    const cfgPath = join(installRoot, "dist", CONFIG_FILENAME);
    let previousRuleset: Buffer | null = null;
    let previousCfg: Buffer | null = null;
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
    if (existsSync(cfgPath)) {
      previousCfg = readFileSync(cfgPath);
      const backupPath = join(
        tmpdir(),
        `${CONFIG_FILENAME}.bak-update-${Date.now()}`
      );
      try {
        writeFileSync(backupPath, previousCfg);
        console.log(`backed up user ${CONFIG_FILENAME} to ${backupPath}`);
      } catch (e) {
        console.error(
          `update refused before install: failed to back up ${CONFIG_FILENAME}: ${
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
      if (previousCfg !== null) {
        try {
          const freshCfg = existsSync(cfgPath)
            ? readFileSync(cfgPath)
            : null;
          if (freshCfg === null || !previousCfg.equals(freshCfg)) {
            writeFileSync(cfgPath, previousCfg);
            console.log(
              `restored user ${CONFIG_FILENAME} (package update never overwrites user edits)`
            );
          }
        } catch (e) {
          console.error(
            `update failed to restore ${CONFIG_FILENAME}: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          process.exit(1);
        }
      }
      console.log(
        "Update complete. Restart your CLI sessions so the MCP server picks up the new build."
      );
      applyRegistryAfterUpdate(initRegistry, { force: forceUpdate, quiet: quietUpdate });
    }
    process.exit(code);
  }
  if (arg === "setup") {
    const setupArgs = process.argv.slice(3);
    if (!setupArgs.includes("--dry-run")) {
      await ensureFirstRunPermissionCeiling({
        isTTY: setupArgs.includes("--unattended") ? false : undefined,
        log: console.log,
      });
    }
    const { runSetup } = await import("./setup.js");
    await runSetup();
    process.exit(0);
  }
  if (arg === "upgrade") {
    const { runUpgrade } = await import("./upgrade.js");
    process.exit(await runUpgrade());
  }
  if (arg === "uninstall") {
    const { runUninstall } = await import("./uninstall.js");
    process.exit(await runUninstall());
  }
  if (arg === "init" || arg === "--init") {
    if (!process.argv.slice(3).includes("--dry-run")) {
      await ensureFirstRunPermissionCeiling({ log: console.log });
    }
    const { runInit } = await import("./init.js");
    process.exit(await runInit());
  }
  if (arg === "config" && process.argv[3] === "init") {
    await ensureFirstRunPermissionCeiling({ log: console.log });
    const { runConfigInit } = await import("./config-init.js");
    process.exit(await runConfigInit());
  }
  if (arg === "config" && process.argv[3] === "validate") {
    const { runConfigValidate } = await import("./config-validate.js");
    process.exit(await runConfigValidate());
  }
  if (arg === "rollback") {
    const { runRollback } = await import("./backup.js");
    process.exit(await runRollback());
  }
  if (arg === "doctor") {
    await ensureFirstRunPermissionCeiling({ log: console.log });
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor();
  }
  else if (arg !== undefined && arg !== "") {
    console.error(`unknown argument: ${arg}`);
    console.error(usage);
    process.exit(1);
  }
  else {
  // ORCHESTRATION MODE PERSISTS across restarts/sessions: the server does NOT
  // clear the marker on startup. DEFAULT ON now means ABSENCE of a disable
  // record — a project stays ON with no marker write needed; OFF is only a
  // per-session disable record that holds while it is active, cleared with
  // explicit user permission. On a new session a carried-over legacy ON marker
  // (if any) triggers a one-time prompt asking whether to remain enabled; under
  // default-ON this rarely fires.
  // (the tool's enabled:false writes only a session-keyed disable record via
  // writeDisable; keyless persistent-disable requests are refused.)
  getNpmPrefix();
  void checkForNpmUpdate().catch(() => {});
  startLivenessHeartbeat();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  }
}
