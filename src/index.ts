#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, execSync, ChildProcess } from "child_process";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { Provider, mapModel, resolveEffort, buildCommand } from "./effort.js";

type AgentStatus = "running" | "completed" | "failed" | "stalled" | "killed";

interface AgentState {
  id: string;
  provider: Provider;
  model: string;
  status: AgentStatus;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: number;
  lastActivity: number;
  cwd: string;
  ucSettingsPath?: string;
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
  if (!isWindows) return provider === "claude" ? "claude" : "codex";

  const prefix = getNpmPrefix();
  if (provider === "claude") {
    const exe = join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  } else {
    const exe = join(prefix, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    if (existsSync(exe)) return exe;
  }
  return provider === "claude" ? "claude" : "codex";
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

setInterval(() => {
  const now = Date.now();
  for (const agent of agents.values()) {
    if (agent.status === "stalled") {
      if (now - agent.lastActivity <= 60000) {
        agent.status = "running";
      }
      if (agent.process.exitCode !== null) {
        agent.exitCode = agent.process.exitCode;
        agent.status = agent.process.exitCode === 0 ? "completed" : "failed";
      }
      continue;
    }
    if (agent.status !== "running") continue;
    if (agent.process.exitCode !== null) {
      agent.exitCode = agent.process.exitCode;
      agent.status = agent.process.exitCode === 0 ? "completed" : "failed";
      continue;
    }
    if (now - agent.lastActivity > 60000) {
      agent.status = "stalled";
    }
  }
}, 10000);

const server = new McpServer({
  name: "subagent-mcp",
  version: "2.0.0",
  description:
    "Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes. Does NOT call the Anthropic or OpenAI HTTP APIs directly (no API keys, no SDK) and there are no plans to — all model access is via the local CLIs.",
});

// Tool 1: launch_agent
server.tool(
  "launch_agent",
  "Spawn a new sub-agent (Claude or Codex) with a prompt. Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes. Does NOT call the Anthropic or OpenAI HTTP APIs directly (no API keys, no SDK) and there are no plans to — all model access is via the local CLIs. Note: ultracode effort is Opus-4.8+ only and is induced via a temp `--settings {\"ultracode\":true}` file (the CLI rejects `--effort ultracode`).",
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
        startedAt: now,
        lastActivity: now,
        cwd: agentCwd,
        ucSettingsPath: buildResult.ucSettingsPath,
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

        if (agentState.status === "killed" || agentState.status === "completed") {
          return;
        }
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
  "Get current status and output of a running agent",
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

    const stdoutTail =
      agent.stdout.length > 2000
        ? agent.stdout.slice(-2000)
        : agent.stdout;
    const stderrTail =
      agent.stderr.length > 1000
        ? agent.stderr.slice(-1000)
        : agent.stderr;

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
  "List all agents with their current status",
  {},
  async () => {
    const agentList = Array.from(agents.values()).map((agent) => ({
      id: agent.id,
      provider: agent.provider,
      model: agent.model,
      status: agent.status,
      started_at: agent.startedAt,
      last_activity: agent.lastActivity,
      cwd: agent.cwd,
    }));

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

const transport = new StdioServerTransport();
await server.connect(transport);
