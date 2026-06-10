#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, execSync, ChildProcess } from "child_process";
import { unlinkSync, existsSync, realpathSync } from "node:fs";
import { randomUUID } from "crypto";
import { isAbsolute, basename } from "node:path";
import { pathToFileURL } from "url";
import { Provider, buildCommand } from "./effort.js";
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
import * as orchestrationMarker from "./orchestration/marker.js";

interface AgentState {
  id: string;
  provider: Provider;
  model: string;
  status: AgentStatus;
  process: ChildProcess;
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
  // Rolling buffer of the last 3 parsed visible provider stream items.
  // Each item is stamped with its capture time (`at`, ms).
  visibleStream: VisibleStreamItem[];
  // Carried-over partial stdout line (a provider JSONL event split across two
  // stdout chunks). Held until its terminating newline arrives so a valid event
  // is never dropped. Flushed on close.
  streamBuf: string;
}

const agents = new Map<string, AgentState>();
const MAX_CLAUDE = 5;
const MAX_CODEX = 5;
const deadlockWindow = createDeadlockWindow();

// TASK_CATEGORIES, AUTO_HINT, SPLIT_HINT, and validatePresence are the pure,
// side-effect-free presence layer — defined in ./routing.js and imported above
// so the handler-validation test can exercise them without importing this entry
// module (which would open the stdio transport).

// Caveman self-classification gloss for the task_category param (tool-description.md).
const TASK_CATEGORY_GLOSS =
  "REQUIRED. Task shape -> routing category (the server picks the best model for it). Pick ONE: math_proof: proof/derivation/formally-checkable result; deductive step-validity under axioms; verified by a proof-checker not tests. security_review: security verdict/threat-assessment/demonstrated exploit; adversarial reasoning over attack surface — vuln, auth/authz, crypto, exploitability. debugging: verified fix/root-cause; ONLY with an observed failure (error, crash, red test, regression, flake); done when the symptom is resolved. quality_review: evaluative verdict on an existing NON-security artifact with NO observed failure; review diff/PR, compare A-vs-B, validate-vs-spec; never self-review. architecture: cross-module design/plan, NO code, NO execution loop; system structure, interface/migration strategy, decompose-into-tasks; >2 files or public API. agentic_execution: reach a target end-state by iterating in a mutating env (act/observe/adapt loop); run/deploy/provision/browse, tool/function-call, iterate-until-tests-pass. data_analysis: empirical finding/model ABOUT a structured dataset; query/SQL/dataframe answer, statistic, fit-model-report-drivers; the finding is the deliverable even if code runs. coding: bounded runnable code artifact, one-pass; implement function/module/feature/script, write tests, single-module refactor; compiles/passes tests. knowledge_synthesis: novel integrated prose over sources; synthesize/summarize/translate/draft/explain-across-files; judged by faithfulness/coherence not exact-match. mechanical: deterministic single-pass transform/leaf op, exact-match checkable; find/grep/list/rename/reformat/convert/extract-to-fixed-schema; minimal reasoning. fallback_default: no category fits with confidence (under-specified/mixed/tied); read-only sentinel — PREFER splitting the work into smaller atomic steps that each map to one category.";

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
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
const ORCHESTRATION_INSTRUCTIONS =
  "ORCHESTRATION MODE (orchestration-mode tool). WHAT: per-project toggle for LONG-HORIZON work that would fill the context window if run inline. OPERATING MODEL: when ON, act as a workflow orchestrator, delegate-default — decompose and delegate/offload by default. INLINE BY RIGHT: steps bound to main-session-only capability may stay inline (MCP tools sub-agents can't inherit, interactive/consent tools, tight verify loops); state which and why. MUST DELEGATE/OFFLOAD: pure compute and any payload >50KB or >200 lines go via temp scratch-file path handoff (%TEMP% on Windows, /tmp on POSIX); keep the orchestrator context lean. CONFLICT ORDER: safety-scope > user instruction this turn > delegate-default. A user tool-pin re-partitions work; it does not suspend mode. PERSISTENCE: enabling writes a per-project marker that PERSISTS across restarts/sessions until disabled with explicit user permission (does NOT reset on a new session). CARRYOVER: if mode was already ON at session start (inherited), the bundled hook prepends a CARRYOVER notice ONCE per marker; you MUST tell the user it auto-activated, ask whether to keep it ON, and advise whether it fits this session's request. DISABLE: never disable on your own initiative — only with EXPLICIT user permission. You MAY propose disabling when task fit is wrong (bounded, interactive, or MCP-bound). Either way, first explain WHAT mode is and WHY, then request permission via the provider tool: AskUserQuestion on Claude, request-user-input on Codex. Only explicit approval may call orchestration-mode enabled:false; if declined, continue under inline-by-right, ask once per topic, never re-nag. Per-turn injection fires only in CLI hosts loading the bundled hook; desktop hosts toggle the marker but inject nothing (documented degradation).";

const server = new McpServer(
  {
    name: "subagent-mcp",
    version: "2.3.9",
    description:
      "Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes. Does NOT call the Anthropic or OpenAI HTTP APIs directly (no API keys, no SDK) and there are no plans to — all model access is via the local CLIs.",
  },
  {
    instructions: ORCHESTRATION_INSTRUCTIONS,
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
// successful spawn, or a launch-time failure reason string (never throws/rejects).
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
  routingTier?: "cost_efficiency" | "performance" | "manual"
): Promise<{ agentId: string } | { reason: string }> {
  // Concurrency cap for this provider.
  const running = countProcessing(candidate.provider);
  const max = candidate.provider === "claude" ? MAX_CLAUDE : MAX_CODEX;
  if (running >= max) {
    return {
      reason: `Maximum ${max} concurrent ${candidate.provider} agents already running. Current: ${running}`,
    };
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
      prompt,
      agentCwd
    );
    cmd = resolveExe(candidate.provider);
  } catch (e) {
    return { reason: e instanceof Error ? e.message : String(e) };
  }

  // Fast-fail absolute paths only. Bare names intentionally rely on PATH; spawn
  // below resolves them and reports ENOENT/EACCES through the same failure path.
  if (isAbsolute(cmd) && !existsSync(cmd)) {
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    return { reason: `CLI executable not found: ${cmd}` };
  }

  const stdinMode = candidate.provider === "claude" ? ("pipe" as const) : ("ignore" as const);
  let childProcess: ChildProcess;
  try {
    childProcess = spawn(cmd, buildResult.args, {
      cwd: agentCwd,
      env: { ...process.env, SUBAGENT_MCP_SUBAGENT: "1" },
      stdio: [stdinMode, "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    // Synchronous spawn throw (rare) — clean up and report as a launch failure.
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    return { reason: error instanceof Error ? error.message : String(error) };
  }

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
      childProcess.kill();
    } catch {}
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    return { reason: err instanceof Error ? err.message : String(err) };
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
    status: "processing",
    process: childProcess,
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

  if (candidate.provider === "claude" && childProcess.stdin) {
    childProcess.stdin.write(prompt);
    childProcess.stdin.end();
  }

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
      // Codex emits JSONL; turn.completed signals task done — kill process. Scan
      // COMPLETE lines only so a marker split across chunks is matched once
      // fully assembled (never on a partial fragment).
      if (
        agentState.provider === "codex" &&
        lines.some((l) => l.includes('"type":"turn.completed"'))
      ) {
        agentState.status = "finished";
        agentState.exitCode = 0;
        if (agentState.exitedAt === null) agentState.exitedAt = at;
        childProcess.kill();
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
      // Already finalized by turn.completed; exitedAt already stamped
      return;
    }
    // Normal exit: set exit code and derive status
    agentState.exitCode = code !== null ? code : -1;
    agentState.status = code === 0 ? "finished" : "errored";
  });

  agents.set(agentId, agentState);
  return { agentId };
}

// Tool 1: launch_agent
server.tool(
  "launch_agent",
  "Spawn a sub-agent. AUTO MODE (preferred): pass only `prompt` + `task_category`; the server picks the best provider/model/effort for that category from its routing table, launches the top candidate, and silently falls back to the next-best on launch failure. `provider`/`model`/`effort` are OPTIONAL overrides — omit for auto-selection; if you pass `model` you must also pass `provider`, and if you pass `effort` you must pass both `provider` and `model`. Unsure which task_category fits? Don't submit one amorphous task — SPLIT into atomic steps that each map to a single category, one agent per step. ultracode effort is Opus-4.8+ only (induced via a temp `--settings {\"ultracode\":true}` file; the CLI rejects `--effort ultracode`). Each sub-agent is a separate claude/codex CLI child that does NOT inherit this session's MCP servers; children run with env SUBAGENT_MCP_SUBAGENT=1 so the orchestration hooks skip them (they are not orchestrators and don't re-trigger carryover). Launch returns status `processing` (alive); a later `stalled` is alive-but-quiet (thinking or awaiting a temp-file handoff), NOT dead — wait or re-poll, don't kill (see poll_agent). DEADLOCK RULE: you MUST ALWAYS set `deadlock=true` when more than 2 launch attempts have already been made for the SAME atomic task (i.e. the 3rd attempt onward), and NEVER otherwise.",
  {
    task_category: z.enum(TASK_CATEGORIES).describe(TASK_CATEGORY_GLOSS),
    prompt: z.string().min(1),
    provider: z.enum(["claude", "codex"]).optional(),
    model: z.enum(["haiku", "sonnet", "opus", "opus-4-8", "gpt-5.5"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max", "ultracode"]).optional(),
    cwd: z.string().optional(),
    deadlock: z.boolean().optional().describe("MANDATE: ALWAYS set deadlock=true when, and ONLY when, more than 2 launch attempts have already been made for the SAME atomic task — the 3rd attempt onward. NEVER set it on a 1st or 2nd attempt, NEVER for a different task, NEVER speculatively. Auto mode only: cannot be combined with provider/model/effort. Passing false is identical to omitting it."),
  },
  async (params) => {
    const { task_category, provider, model, effort, prompt, deadlock } = params;
    const agentCwd = params.cwd || process.cwd();

    // 1-5. Param-presence validation (zod already constrains task_category, but
    //       hard-validate so the spec error text — valid list + hints, and the
    //       effort-before-model ordering — is what the caller sees). Pure,
    //       exported, and unit-tested (test/handler-validation.test.mjs).
    const presenceError = validatePresence({ task_category, provider, model, effort, deadlock });
    if (presenceError) {
      return errorResult(presenceError);
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

    // 6. Attempt loop: best→worst. Register on first successful spawn; silently
    //    advance on launch-time failure. Sub-agent task outcome is NEVER a trigger.
    const skipped: { model: string; effort: string; provider: string; reason: string }[] = [];
    for (const candidate of result.candidates) {
      const outcome = await tryLaunchCandidate(candidate, prompt, agentCwd, routingTier);
      if ("agentId" in outcome) {
        if (branch === "performance") {
          deadlockWindow.consume();
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
      });
    }

    // 7. All candidates failed.
    if (isExplicit) {
      const f = skipped[0];
      return errorResult(
        `Error: explicit launch ${f.model}@${f.effort} (${f.provider}) failed: ${f.reason}.\n${AUTO_HINT}`
      );
    }
    const lines = skipped
      .map((s, i) => `  ${i + 1}. ${s.model}@${s.effort} (${s.provider}): ${s.reason}`)
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
  "Terminate a live agent (status `processing` or `stalled`) by immediately force-killing its managed process tree. No-op for already-terminal agents.",
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

    // Kill applies to ALL live states (processing OR stalled). A terminal agent
    // (finished/errored/stopped) is a no-op.
    const isLive = agent.status === "processing" || agent.status === "stalled";
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
  "Send a message to a running agent's stdin",
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

    const isLive = agent.status === "processing" || agent.status === "stalled";
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

    if (!agent.process.stdin) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent stdin is not available`,
          },
        ],
        isError: true,
      };
    }

    try {
      agent.process.stdin.write(params.message + "\n");
      agent.lastActivity = Date.now();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agent.id,
              status: "sent",
              message: "Message written to agent stdin",
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
  "Blocks until one or more sub-agents reach a terminal state (finished/errored/stopped), returning each one's exit code + local-time exit timestamp; or returns the live-job list after a 15-minute timeout. A `stalled` agent is still ALIVE and does NOT end the wait — only a terminal exit does. Pass `verbose: true` to add each finished agent's `final_output` (its final assistant turn, extracted from captured stdout).",
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
  "Toggle or query per-project ORCHESTRATION MODE. `enabled`: true = ON, false = OFF, omit = query current state. The FULL operating model + governance is carried in this server's MCP `instructions` (read once at initialize) — this is the operational summary only; do not act on the mode without that detail. WHAT: a per-project toggle for LONG-HORIZON work that would fill the context window if run to completion inline; when ON, act as an orchestrator with delegate-default, but steps bound to main-session-only capability stay INLINE BY RIGHT (state which + why). PERSISTENCE: a per-project marker keyed by cwd; absence of the marker = OFF = no injection; once ON it persists across restarts/sessions until a permitted disable (it does NOT reset on a new session). CARRYOVER: if ON was inherited from a PRIOR session (provenance = carried-over, not user-enabled this session), the bundled hook prepends a ONE-TIME notice (once per marker, never per turn) — you MUST then notify the user it auto-activated and confirm whether to keep it ON. DISABLE: never on your own initiative; you MAY PROPOSE turning it OFF on task-fit mismatch, but only EXPLICIT user permission (AskUserQuestion on Claude, request-user-input on Codex) may set enabled:false. Per-turn injection fires only in CLI hosts that load the bundled hook; desktop hosts toggle the marker but inject nothing (documented degradation).",
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

// Connect the stdio transport only when run as the entry point (the bin), NOT
// when this module is imported (e.g. test/handler-validation.test.mjs importing
// the exported validatePresence). Connecting on import would block the test on
// an open stdio transport. argv[1] is the invoked script; compare to this URL.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  if (process.argv[2] === "setup") {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    process.exit(0);
  }
  // ORCHESTRATION MODE PERSISTS across restarts/sessions: the server does NOT
  // clear the marker on startup. DEFAULT OFF now means ABSENCE of a marker — a
  // project never enabled stays OFF; a project explicitly enabled persists ON
  // until disabled with explicit user permission. On a new session the bundled
  // hook detects the carried-over marker and prompts the user to confirm.
  // (orchestrationMarker.disable is still used by the tool's enabled:false.)
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
