#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, execSync, ChildProcess } from "child_process";
import { unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";
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
  loadRoutingTable,
  buildCandidates,
  validatePresence,
  TASK_CATEGORIES,
  AUTO_HINT,
  SPLIT_HINT,
  type Candidate,
  type SelectionMode,
} from "./routing.js";

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
}

const agents = new Map<string, AgentState>();
const MAX_CLAUDE = 5;
const MAX_CODEX = 5;

// TASK_CATEGORIES, AUTO_HINT, SPLIT_HINT, and validatePresence are the pure,
// side-effect-free presence layer — defined in ./routing.js and imported above
// so the handler-validation test can exercise them without importing this entry
// module (which would open the stdio transport).

// Caveman self-classification gloss for the task_category param (tool-description.md).
const TASK_CATEGORY_GLOSS =
  "REQUIRED. Task shape -> routing category (server picks best model for it). Pick ONE: math_proof: deliverable=proof/derivation/formally-checkable result; proof IS deliverable; deductive step-validity under axioms; verified by proof-checker not tests. security_review: deliverable=security verdict/threat-assessment/demonstrated-exploit; adversarial reasoning over attack surface; vuln, auth/authz, crypto, exploitability. debugging: deliverable=verified fix/root-cause; ONLY when observed failure (error, crash, red test, regression, flake) preconditions work; done when symptom resolved. quality_review: deliverable=evaluative verdict on existing NON-security artifact, NO observed failure; review diff/PR, compare A-vs-B, validate-vs-spec; never self-review. architecture: deliverable=cross-module design/plan, NO code, NO execution loop; system structure, interface/migration strategy, decompose-into-tasks; >2 files or public API. agentic_execution: deliverable=target end-state via iterate in mutating env (act/observe/adapt loop); run/deploy/provision/browse, tool/function-call, iterate-until-tests-pass. data_analysis: deliverable=empirical finding/model ABOUT structured dataset; query/SQL/dataframe answer, statistic, fit-model-report-drivers; finding scored even if code runs. coding: deliverable=bounded runnable code artifact, one-pass; implement function/module/feature/script, write tests, single-module refactor; compiles/passes-tests. knowledge_synthesis: deliverable=novel integrated prose over sources; synthesize/summarize/translate/draft/explain-across-files; verified by faithfulness/coherence not exact-match. mechanical: deliverable=deterministic single-pass transform/leaf op, exact-match checkable; find/grep/list/rename/reformat/format-convert/extract-to-fixed-schema; minimal reasoning. fallback_default: no category matches with confidence (under-specified/mixed/tied); read-only; PREFER splitting work into smaller atomic steps each mapping to one category.";

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

function countRunning(provider: Provider): number {
  let count = 0;
  for (const a of agents.values()) {
    if (a.provider === provider && a.status === "running") count++;
  }
  return count;
}

// Synchronously reconcile a single agent's status against the pure transition
// helper. Folds the live process exitCode into AgentState first so an already-
// exited process is reported as completed/failed immediately (no monitor lag).
function reconcileAgent(agent: AgentState, now: number): void {
  if (
    (agent.status === "running" || agent.status === "processing") &&
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

const server = new McpServer({
  name: "subagent-mcp",
  version: "2.2.0",
  description:
    "Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes. Does NOT call the Anthropic or OpenAI HTTP APIs directly (no API keys, no SDK) and there are no plans to — all model access is via the local CLIs.",
});

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
  agentCwd: string
): Promise<{ agentId: string } | { reason: string }> {
  // Concurrency cap for this provider.
  const running = countRunning(candidate.provider);
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

  // Fast-fail: a missing exe would otherwise surface as an async 'error' event.
  if (!existsSync(cmd)) {
    cleanupUcSettingsPath(buildResult.ucSettingsPath);
    return { reason: `CLI executable not found: ${cmd}` };
  }

  const stdinMode = candidate.provider === "claude" ? ("pipe" as const) : ("ignore" as const);
  let childProcess: ChildProcess;
  try {
    childProcess = spawn(cmd, buildResult.args, {
      cwd: agentCwd,
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
    status: "running",
    process: childProcess,
    stdout: "",
    stderr: "",
    exitCode: null,
    exitedAt: null,
    startedAt: now,
    lastActivity: now,
    cwd: agentCwd,
    ucSettingsPath: buildResult.ucSettingsPath,
    waitReported: false,
  };

  childProcess.on("error", (err) => {
    agentState.stderr += `\n[process error] ${err instanceof Error ? err.message : String(err)}`;
    agentState.lastActivity = Date.now();
  });

  if (candidate.provider === "claude" && childProcess.stdin) {
    childProcess.stdin.write(prompt);
    childProcess.stdin.end();
  }

  if (childProcess.stdout) {
    childProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      agentState.stdout += chunk;
      agentState.lastActivity = Date.now();
      // Codex emits JSONL; turn.completed signals task done — kill process
      if (agentState.provider === "codex" && chunk.includes('"type":"turn.completed"')) {
        agentState.status = "completed";
        agentState.exitCode = 0;
        if (agentState.exitedAt === null) agentState.exitedAt = Date.now();
        childProcess.kill();
      }
    });
  }

  // Capture stderr
  if (childProcess.stderr) {
    childProcess.stderr.on("data", (data) => {
      agentState.stderr += data.toString();
      agentState.lastActivity = Date.now();
    });
  }

  childProcess.on("close", (code) => {
    // Always clean up ultracode settings file on close
    cleanupUcSettings(agentState);

    // Always record actual close time (unless already finalized)
    if (agentState.exitedAt === null) agentState.exitedAt = Date.now();

    if (agentState.status === "killed") {
      // Record real exit code but preserve "killed" status
      if (agentState.exitCode === null) agentState.exitCode = code !== null ? code : -1;
      return;
    }
    if (agentState.status === "completed") {
      // Already finalized by turn.completed; exitedAt already stamped
      return;
    }
    // Normal exit: set exit code and derive status
    agentState.exitCode = code !== null ? code : -1;
    agentState.status = code === 0 ? "completed" : "failed";
  });

  agents.set(agentId, agentState);
  return { agentId };
}

// Tool 1: launch_agent
server.tool(
  "launch_agent",
  "Spawn a sub-agent. AUTO MODE: pass just `prompt` + `task_category` and the server picks the best provider/model/effort for that category from its routing table, launching the best candidate and silently falling back to the next-best if a launch fails. `provider`/`model`/`effort` are OPTIONAL overrides and are usually unnecessary — omit them to get the auto-selected best combination (rules: if you pass `model` you must pass `provider`; if you pass `effort` you must pass both `provider` and `model`). If you are unsure which task_category fits, do NOT submit one large amorphous task — break the work into smaller atomic steps that each map to a single category and launch one agent per step. Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes; does NOT call the Anthropic or OpenAI HTTP APIs (no API keys, no SDK). Note: ultracode effort is Opus-4.8+ only (induced via a temp `--settings {\"ultracode\":true}` file; the CLI rejects `--effort ultracode`). Status `processing` means the agent is ALIVE but has been quiet for >=60s (thinking or awaiting a temp-file handoff), NOT dead — wait or re-poll rather than killing.",
  {
    task_category: z.enum(TASK_CATEGORIES).describe(TASK_CATEGORY_GLOSS),
    prompt: z.string().min(1),
    provider: z.enum(["claude", "codex"]).optional(),
    model: z.enum(["haiku", "sonnet", "opus", "opus-4-8", "gpt-5.5"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max", "ultracode"]).optional(),
    cwd: z.string().optional(),
  },
  async (params) => {
    const { task_category, provider, model, effort, prompt } = params;
    const agentCwd = params.cwd || process.cwd();

    // 1-4. Param-presence validation (zod already constrains task_category, but
    //       hard-validate so the spec error text — valid list + hints, and the
    //       effort-before-model ordering — is what the caller sees). Pure,
    //       exported, and unit-tested (test/handler-validation.test.mjs).
    const presenceError = validatePresence({ task_category, provider, model, effort });
    if (presenceError) {
      return errorResult(presenceError);
    }

    // 5. Build the candidate list per mode.
    const overrides = { provider, model, effort };
    const isExplicit = !!(provider && model && effort);

    // explicit mode never reads the table; all other modes do.
    const table = isExplicit ? null : loadRoutingTable();
    if (!isExplicit && table === null) {
      return errorResult(
        `Error: routing table not populated for ${task_category} (routing-table file missing or unreadable). Either run the model-profiler to populate it, or pass provider+model+effort explicitly for a fully-specified launch.\n${AUTO_HINT}`
      );
    }

    const result = buildCandidates(table, task_category, overrides);
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
      const outcome = await tryLaunchCandidate(candidate, prompt, agentCwd);
      if ("agentId" in outcome) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                agent_id: outcome.agentId,
                status: "running",
                provider: candidate.provider,
                model: candidate.model,
                effort: candidate.effort,
                task_category,
                selection_mode: mode,
                candidates_skipped: skipped.length,
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
  "Get current status and output of an agent. Status `processing` means ALIVE but quiet for >=60s (thinking or awaiting a temp-file handoff), NOT dead; `alive` and `idle_seconds` are always returned, and a `hint` is included while processing. Prefer `wait`/re-poll over killing a processing agent. Pass `verbose: true` to also return `final_output`, the agent's final assistant turn text extracted from its captured stdout.",
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
  "Terminate a running agent",
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

    if (agent.status !== "running") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agent.id,
              status: agent.status,
              message: `Agent is not running (status: ${agent.status})`,
            }),
          },
        ],
      };
    }

    try {
      // Send SIGTERM
      agent.process.kill("SIGTERM");
      agent.status = "killed";

      // Set up 5-second timeout for force kill
      const timeout = setTimeout(() => {
        if (agent.process.exitCode === null) {
          // Process still alive, force kill using taskkill
          if (isWindows) {
            spawn("taskkill", ["/pid", String(agent.process.pid), "/t", "/f"], { windowsHide: true });
          } else {
            process.kill(agent.process.pid!, "SIGKILL");
          }
        }
      }, 5000);

      // Clear timeout if process exits naturally (cleanup handled by close handler on agentState)
      agent.process.once("close", () => {
        clearTimeout(timeout);
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agent.id,
              status: "killed",
              message: "Kill signal sent",
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

    if (agent.status !== "running") {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent is not running (status: ${agent.status})`,
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
  "List all agents with their current status. Status `processing` means ALIVE but quiet for >=60s, NOT dead; each agent includes `alive` and `idle_seconds` (and a `hint` while processing). Prefer `wait`/re-poll over killing a processing agent.",
  {},
  async () => {
    const now = Date.now();
    const agentList = Array.from(agents.values()).map((agent) => {
      // Reconcile exit synchronously so already-exited processes are reported
      // as completed/failed immediately (no health-monitor lag).
      reconcileAgent(agent, now);
      return {
        id: agent.id,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        started_at: agent.startedAt,
        last_activity: agent.lastActivity,
        cwd: agent.cwd,
        ...buildLivenessFields(
          agent.status,
          agent.exitCode,
          agent.lastActivity,
          now
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
  "Blocks until one or more sub-agents exit (completed/failed/killed) and returns their exit code + local-time exit timestamp, or returns the running-job list after a 15-minute timeout. Pass `verbose: true` to add `final_output` (each finished agent's final assistant turn text extracted from its captured stdout) to every finished entry.",
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

    // Step 2: nothing alive and nothing unreported (includes killed-but-not-yet-closed)
    const TERMINAL_SET = new Set(["completed", "failed", "killed"]);
    const hasPending = Array.from(agents.values()).some(
      (a) =>
        a.status === "running" ||
        a.status === "processing" ||
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
      (a) => a.status === "running" || a.status === "processing"
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

// Connect the stdio transport only when run as the entry point (the bin), NOT
// when this module is imported (e.g. test/handler-validation.test.mjs importing
// the exported validatePresence). Connecting on import would block the test on
// an open stdio transport. argv[1] is the invoked script; compare to this URL.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
