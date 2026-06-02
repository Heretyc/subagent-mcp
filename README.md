# subagent-mcp

MCP server that launches and manages locally installed `claude` and `codex` CLI binaries as child sub-agent processes. Runs on **macOS, Linux, and Windows**.

**No direct API calls.** subagent-mcp does NOT use the Anthropic or OpenAI HTTP APIs and has no plans to. It invokes your locally installed and authenticated `claude` (Claude Code) and `codex` CLIs. No API keys, no SDKs beyond the CLIs themselves.

**License:** Apache-2.0 | **Author:** Lexi Blackburn | **Repo:** https://github.com/Heretyc/subagent-mcp

---

## Features

- Spawn `claude` or `codex` CLI processes as managed sub-agents from any MCP host
- Poll status, stream stdout/stderr tails, and send stdin messages to live agents
- Concurrency caps: 5 concurrent Claude agents + 5 concurrent Codex agents
- Automatic stall detection: agents with no output for 60 seconds enter `stalled` state
- Ultracode mode for Opus 4.8 -- headless activation via `--settings {"ultracode":true}` (see below)
- Cross-platform exe resolution (Windows: npm-prefix .exe paths; macOS/Linux: PATH + Homebrew/usr-local fallbacks); SIGTERM/taskkill kill flow
- stdio MCP transport; built with `@modelcontextprotocol/sdk` + `zod`

---

## Prerequisites

- **Node.js >= 18**
- **`claude` CLI** (Claude Code) installed globally and authenticated (`claude login`)
- **`codex` CLI** (OpenAI Codex CLI) installed globally and authenticated (`codex auth`)
- Both CLIs must be installed and on `PATH` (macOS/Linux: standard npm global bin or Homebrew; Windows: resolved via npm global prefix automatically)

---

## Install

```bash
git clone https://github.com/Heretyc/subagent-mcp
cd subagent-mcp
npm install
npm run build
```

The server entry point after build: `dist/index.js`.

---

## Registering the MCP Server

Replace the path below with the absolute path where you cloned the repo.

### Claude Code CLI

**macOS / Linux** — run once from any directory:

```bash
claude mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

**Windows:**

```bash
claude mcp add subagent-mcp -- node "C:\Users\YourName\Dropbox\subagent-mcp\dist\index.js"
```

To make it available across all projects (user scope), add `--scope user`. Or add it to a project's `.mcp.json` for team sharing:

**macOS / Linux `.mcp.json`:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["/abs/path/to/subagent-mcp/dist/index.js"]
    }
  }
}
```

**Windows `.mcp.json`:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Dropbox\\subagent-mcp\\dist\\index.js"]
    }
  }
}
```

The Claude Desktop config lives at:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Verify with `claude mcp list` or `/mcp` inside a Claude Code session.

### Codex CLI

**macOS / Linux** — edit `~/.codex/config.toml` (create if it doesn't exist):

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/abs/path/to/subagent-mcp/dist/index.js"]
```

**Windows** — edit `C:\Users\YourName\.codex\config.toml`:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

Forward or double-backslash paths both work in TOML. Verify with `/mcp` inside a Codex session.

### Gemini CLI

**macOS / Linux** — edit `~/.gemini/settings.json` (merge into existing file):

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["/abs/path/to/subagent-mcp/dist/index.js"]
    }
  }
}
```

**Windows** — edit `C:\Users\YourName\.gemini\settings.json`:

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Dropbox\\subagent-mcp\\dist\\index.js"]
    }
  }
}
```

Restart the Gemini CLI session after editing.

---

## Tool Reference

### `launch_agent`

Spawn a new sub-agent process.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `"claude" \| "codex"` | Yes | Which CLI to use |
| `model` | `"haiku" \| "sonnet" \| "opus" \| "opus-4-8" \| "gpt-5.5"` | Yes | Model alias |
| `effort` | `"low" \| "medium" \| "high" \| "xhigh" \| "max" \| "ultracode"` | No | Reasoning effort (default: `"high"`) |
| `prompt` | string | Yes | Initial prompt text |
| `cwd` | string | No | Working directory for the agent process |

Returns: `{ agent_id, status, provider, model }`

Provider/model constraints: Claude accepts `haiku`, `sonnet`, `opus`, `opus-4-8`. Codex accepts only `gpt-5.5`.

### `poll_agent`

Get current status and output tail of an agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | UUID returned by `launch_agent` |

Returns: `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd }`

`stdout_tail` is capped at the last 2000 characters; `stderr_tail` at 1000 characters.

### `kill_agent`

Terminate a running agent. Sends SIGTERM, then `taskkill /pid /t /f` (Windows) or SIGKILL (macOS/Linux) after 5 seconds if still alive.

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |

Returns: `{ agent_id, status, message }`

### `send_message`

Write a message to an agent's stdin (newline appended). Only works while status is `running`.

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |
| `message` | string | Yes |

Returns: `{ agent_id, status, message }`

### `list_agents`

List all agents known to the server (all statuses).

No parameters. Returns: `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd }] }`

### `wait`

Block until one or more sub-agents finish (completed/failed/killed) and return their exit details. Returns immediately if terminal-unreported agents already exist. Returns after a 15-minute hard timeout with a list of still-running agents if nothing finishes in time.

No parameters.

**Happy-path return** (one or more agents just finished):
```json
{
  "finished": [
    {
      "id": "...",
      "provider": "claude",
      "model": "sonnet",
      "status": "completed",
      "exit_code": 0,
      "exited_at": "2024-03-15T10:30:45+00:00 (UTC)",
      "elapsed_ms": 12345
    }
  ]
}
```

**Timeout return** (nothing finished in 15 minutes):
```json
{
  "timed_out": true,
  "elapsed_minutes": 15,
  "running": [...],
  "hint": "15 minutes elapsed with no agent finishing. Call wait again to block for another 15 minutes or until the next agent finishes."
}
```

Each finished job is reported exactly once per `wait` call (deduplicated by an internal `waitReported` flag). Calling `wait` again after a timeout will block for another 15 minutes.

---

## Model and Effort Matrix

| Provider | Model | Valid Efforts | Notes |
|----------|-------|---------------|-------|
| claude | haiku | (any value accepted, effort ignored) | CLI takes no `--effort` for Haiku |
| claude | sonnet | low, medium, high, xhigh, max | Passed as `--effort <value>` |
| claude | opus / opus-4-8 | low, medium, high, xhigh, max, **ultracode** | `opus` and `opus-4-8` both map to `claude-opus-4-8` |
| codex | gpt-5.5 | low, medium, high, xhigh | Passed as `-c model_reasoning_effort="<value>"` |

**Ultracode mechanism:** The Claude CLI rejects `--effort ultracode` with an error. Ultracode is the Claude Code interactive reasoning mode (sets reasoning effort to xhigh AND grants standing dynamic-workflow permission). To activate it headlessly, the server writes a temporary JSON file `{"ultracode":true}` to the OS temp directory and passes `--settings <file>` to the CLI instead of an `--effort` flag. The temp file is deleted on agent exit. Requesting `ultracode` on any non-Opus-4.8 model (including `gpt-5.5`) returns an error.

---

## Underlying CLI Invocations

**Claude:**
```
claude -p --model <mapped-id> [--effort <e> | --settings <ultracode.json>]
  --permission-mode bypassPermissions --tools default --max-turns 50
  --output-format json
```
Prompt is sent via stdin.

**Codex:**
```
codex exec -C <cwd> -m gpt-5.5 -c 'model_reasoning_effort="<e>"'
  --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json "<prompt>"
```

---

## Usage Examples

**Launch an Opus 4.8 ultracode agent:**

```json
{
  "tool": "launch_agent",
  "arguments": {
    "provider": "claude",
    "model": "opus-4-8",
    "effort": "ultracode",
    "prompt": "Refactor the authentication module to use JWTs.",
    "cwd": "C:\\Users\\YourName\\project"
  }
}
```

Returns `{ "agent_id": "abc-123", "status": "running", ... }`. Then poll:

```json
{ "tool": "poll_agent", "arguments": { "agent_id": "abc-123" } }
```

**Launch a Codex gpt-5.5 xhigh agent:**

```json
{
  "tool": "launch_agent",
  "arguments": {
    "provider": "codex",
    "model": "gpt-5.5",
    "effort": "xhigh",
    "prompt": "Write a Python script that parses JSON logs and summarizes error rates.",
    "cwd": "C:\\Users\\YourName\\project"
  }
}
```

---

## Agent Lifecycle

Each agent transitions through these states:

| Status | Meaning |
|--------|---------|
| `running` | Process is alive and has produced output recently |
| `stalled` | No stdout or stderr activity for 60 seconds (process still alive) |
| `completed` | Process exited with code 0, or Codex emitted `turn.completed` event |
| `failed` | Process exited with non-zero code |
| `killed` | Terminated by `kill_agent` |

A health monitor runs every 10 seconds. Stalled agents recover to `running` if output resumes. Codex agents complete via JSONL `turn.completed` event detection (process is then killed cleanly). All agents remain in memory for the server's lifetime -- restart the server to clear the list.

---

## License

Apache-2.0 -- Copyright 2026 Lexi Blackburn

See [docs/SPEC.md](docs/SPEC.md) for the full technical specification.
