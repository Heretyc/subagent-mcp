# subagent-mcp

MCP server that launches and manages locally installed `claude` and `codex` CLI binaries as child sub-agent processes.

**No direct API calls.** subagent-mcp does NOT use the Anthropic or OpenAI HTTP APIs and has no plans to. It invokes your locally installed and authenticated `claude` (Claude Code) and `codex` CLIs. No API keys, no SDKs beyond the CLIs themselves.

**License:** Apache-2.0 | **Author:** Lexi Blackburn | **Repo:** https://github.com/Heretyc/subagent-mcp

---

## Features

- Spawn `claude` or `codex` CLI processes as managed sub-agents from any MCP host
- Poll status, stream stdout/stderr tails, and send stdin messages to live agents
- Concurrency caps: 5 concurrent Claude agents + 5 concurrent Codex agents
- Automatic stall detection: agents with no output for 60 seconds enter `stalled` state
- Ultracode mode for Opus 4.8 -- headless activation via `--settings {"ultracode":true}` (see below)
- Windows-safe exe resolution via npm global prefix; cross-platform SIGTERM/taskkill kill flow
- stdio MCP transport; built with `@modelcontextprotocol/sdk` + `zod`

---

## Prerequisites

- **Node.js >= 18**
- **`claude` CLI** (Claude Code) installed globally and authenticated (`claude login`)
- **`codex` CLI** (OpenAI Codex CLI) installed globally and authenticated (`codex auth`)
- Both CLIs must be on `PATH` (Windows: resolved via npm global prefix automatically)

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

Replace `C:\Users\YourName\Dropbox\subagent-mcp` with the absolute path where you cloned the repo.

### Claude Code CLI

Run once from any directory:

```bash
claude mcp add subagent-mcp -- node "C:\Users\YourName\Dropbox\subagent-mcp\dist\index.js"
```

To make it available across all projects (user scope):

```bash
claude mcp add --scope user subagent-mcp -- node "C:\Users\YourName\Dropbox\subagent-mcp\dist\index.js"
```

Or add it to a project's `.mcp.json` for team sharing:

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

Verify with `claude mcp list` or `/mcp` inside a Claude Code session.

### Codex CLI

Edit `C:\Users\YourName\.codex\config.toml` (create it if it doesn't exist):

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

Forward or double-backslash paths both work in TOML. Verify with `/mcp` inside a Codex session.

### Gemini CLI

Edit `C:\Users\YourName\.gemini\settings.json` (merge into existing file):

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

Terminate a running agent. Sends SIGTERM, then `taskkill /f` (Windows) or SIGKILL (Unix) after 5 seconds if still alive.

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
