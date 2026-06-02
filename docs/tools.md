# Tool Reference

The six tools exposed by `subagent-mcp`. See [README.md](../README.md) for the
overview and [docs/SPEC.md](SPEC.md) for full parameter schemas and return
shapes.

---

## `launch_agent`

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

---

## `poll_agent`

Get current status and output tail of an agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | UUID returned by `launch_agent` |

Returns: `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd, alive, idle_seconds }` plus `hint` when `status` is `processing`.

`stdout_tail` is capped at the last 2000 characters; `stderr_tail` at 1000 characters. `alive` is `true` while the process is running/processing; `idle_seconds` is whole seconds since last output. Exit is reconciled synchronously on each call, so an already-exited process is reported `completed`/`failed` immediately. A `processing` agent is alive but quiet -- prefer `wait`/re-poll over killing it.

---

## `kill_agent`

Terminate a running agent. Sends SIGTERM, then `taskkill /pid /t /f` (Windows) or SIGKILL (macOS/Linux) after 5 seconds if still alive.

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |

Returns: `{ agent_id, status, message }`

---

## `send_message`

Write a message to an agent's stdin (newline appended). Only works while status is `running`.

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |
| `message` | string | Yes |

Returns: `{ agent_id, status, message }`

---

## `list_agents`

List all agents known to the server (all statuses).

No parameters. Returns: `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd, alive, idle_seconds }] }`, each agent also carrying a `hint` when its `status` is `processing`. Exit is reconciled synchronously per agent on each call.

---

## `wait`

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
