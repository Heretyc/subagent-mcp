#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, execSync, ChildProcess } from "child_process";
import { unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { Provider, mapModel, resolveEffort, buildCommand } from "./effort.js";
import { resolveExeFor } from "./platform.js";
import { formatLocalIso, selectUnreported } from "./wait-helpers.js";
import type { AgentStatus } from "./status-helpers.js";
import {
  computeStatusTransition,
  buildLivenessFields,
} from "./status-helpers.js";
import { extractFinalTurn } from "./output-helpers.js";

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

setInterval(() => {
  const now = Date.now();
  for (const agent of agents.values()) {
    reconcileAgent(agent, now);
  }
}, 10000);

const server = new McpServer({
  name: "subagent-mcp",
  version: "2.2.0",
  description:
    "Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes. Does NOT call the Anthropic or OpenAI HTTP APIs directly (no API keys, no SDK) and there are no plans to — all model access is via the local CLIs.",
});

// Tool 1: launch_agent
server.tool(
  "launch_agent",
  "Spawn a new sub-agent (Claude or Codex) with a prompt. Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes. Does NOT call the Anthropic or OpenAI HTTP APIs directly (no API keys, no SDK) and there are no plans to — all model access is via the local CLIs. Note: ultracode effort is Opus-4.8+ only and is induced via a temp `--settings {\"ultracode\":true}` file (the CLI rejects `--effort ultracode`). Status `processing` means the agent is ALIVE but has been quiet for >=60s (thinking or awaiting a temp-file handoff), NOT dead — wait or re-poll rather than killing.",
  {
    provider: z.enum(["claude", "codex"]),
    model: z.enum(["haiku", "sonnet", "opus", "opus-4-8", "gpt-5.5"]),
    effort: z
      .enum(["low", "medium", "high", "xhigh", "max", "ultracode"])
      .default("high"),
    prompt: z.string().min(1),
    cwd: z.string().optional(),
  },
  async (params) => {
    // Validate provider+model match
    if (params.provider === "claude") {
      if (!["haiku", "sonnet", "opus", "opus-4-8"].includes(params.model)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Claude provider only supports haiku, sonnet, opus, or opus-4-8. Got: ${params.model}`,
            },
          ],
          isError: true,
        };
      }
    } else if (params.provider === "codex") {
      if (params.model !== "gpt-5.5") {
        return {
          content: [
            {
              type: "text",
              text: `Error: Codex provider only supports gpt-5.5. Got: ${params.model}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Check concurrency limits
    const running = countRunning(params.provider);
    const max = params.provider === "claude" ? MAX_CLAUDE : MAX_CODEX;
    if (running >= max) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Maximum ${max} concurrent ${params.provider} agents already running. Current: ${running}`,
          },
        ],
        isError: true,
      };
    }

    const agentId = randomUUID();
    const now = Date.now();
    const agentCwd = params.cwd || process.cwd();

    let buildResult: { args: string[]; ucSettingsPath?: string };
    let cmd: string;
    try {
      buildResult = buildCommand(
        params.provider,
        params.model,
        params.effort,
        params.prompt,
        agentCwd
      );
      cmd = resolveExe(params.provider);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const stdinMode = params.provider === "claude" ? "pipe" as const : "ignore" as const;
      const childProcess = spawn(cmd, buildResult.args, {
        cwd: agentCwd,
        stdio: [stdinMode, "pipe", "pipe"],
        windowsHide: true,
      });

      if (params.provider === "claude" && childProcess.stdin) {
        childProcess.stdin.write(params.prompt);
        childProcess.stdin.end();
      }

      const agentState: AgentState = {
        id: agentId,
        provider: params.provider,
        model: params.model,
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
          if (agentState.exitCode === null) agentState.exitCode = (code !== null ? code : -1);
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_id: agentId,
              status: "running",
              provider: params.provider,
              model: params.model,
            }),
          },
        ],
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      // Clean up settings file on spawn error
      if (buildResult.ucSettingsPath) {
        try {
          if (existsSync(buildResult.ucSettingsPath)) {
            unlinkSync(buildResult.ucSettingsPath);
          }
        } catch {}
      }
      return {
        content: [
          {
            type: "text",
            text: `Error launching agent: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
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

const transport = new StdioServerTransport();
await server.connect(transport);
