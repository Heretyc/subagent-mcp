# Tool Reference

The six tools exposed by `subagent-mcp`. See [README.md](../README.md) for the
overview and [docs/SPEC.md](SPEC.md) for full parameter schemas and return
shapes.

---

## `launch_agent`

Spawn a new sub-agent process.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_category` | one of `math_proof`, `security_review`, `debugging`, `quality_review`, `architecture`, `agentic_execution`, `data_analysis`, `coding`, `knowledge_synthesis`, `mechanical`, `fallback_default` | Yes | Task shape; routes to the best provider/model/effort for that category |
| `prompt` | string | Yes | Initial prompt text |
| `provider` | `"claude" \| "codex"` | No | Override; omit to auto-select |
| `model` | `"haiku" \| "sonnet" \| "opus" \| "opus-4-8" \| "gpt-5.5"` | No | Override; omit to auto-select |
| `effort` | `"low" \| "medium" \| "high" \| "xhigh" \| "max" \| "ultracode"` | No | Override; omit to auto-select |
| `deadlock` | boolean | No | MANDATE: ALWAYS set deadlock=true when, and ONLY when, more than 2 launch attempts have already been made for the SAME atomic task — the 3rd attempt onward. NEVER set it on a 1st or 2nd attempt, NEVER for a different task, NEVER speculatively. Auto mode only: cannot be combined with provider/model/effort. Passing false is identical to omitting it. |
| `cwd` | string | No | Working directory for the agent process |

Returns: `{ agent_id, status, provider, model, effort, task_category }`, plus `ruleset_applied: true` and `ruleset_original_selection` ONLY when the advanced ruleset altered the routing decision ([docs/spec/advanced-ruleset/visibility-and-failover.md](spec/advanced-ruleset/visibility-and-failover.md)).

**Auto mode (recommended):** pass only `prompt` + `task_category`. The server reads its routing table, builds a best→worst candidate list for that category, launches the first candidate that spawns, and silently falls back to the next-best on a launch-time failure.

**Overrides:** `provider`/`model`/`effort` are optional and usually unnecessary. Rules: if you pass `model` you must pass `provider`; if you pass `effort` you must pass both `provider` and `model`. Passing all three is `explicit` mode — a single direct attempt with no fallback. Omitting or partially supplying them on a bad combination is a hard error (see the spec).

Provider/model constraints: Claude accepts `haiku`, `sonnet`, `opus`, `opus-4-8`. Codex accepts only `gpt-5.5`.

Spec: [docs/spec/auto-mode/_INDEX.md](spec/auto-mode/_INDEX.md) (param contract, presence→behavior matrix, exact error text).

---

## `poll_agent`

Get current status and output tail of an agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | UUID returned by `launch_agent` |
| `verbose` | boolean | No | When `true`, also return `final_output` (default: `false`) |

Returns: `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd, alive, idle_seconds, recent_stream, routing_tier }` plus `hint` when `status` is `stalled`, plus `final_output` when `verbose` is `true`, plus `ruleset_applied` and `ruleset_original_selection` ONLY when the advanced ruleset altered the routing decision.

`stdout_tail` is capped at the last 2000 characters; `stderr_tail` at 1000 characters. `recent_stream` holds exactly the last 3 parsed visible provider-stream items, each with its timestamp. `alive` is `true` while the process is processing/stalled; `idle_seconds` is whole seconds since the last visible-stream heartbeat. Exit is reconciled synchronously on each call, so an already-exited process is reported `finished`/`errored` immediately. A `stalled` agent is alive but quiet -- prefer `wait`/re-poll over killing it. With `verbose: true`, `final_output` holds the agent's final assistant turn text extracted from its full captured stdout (falls back to the raw stdout if it cannot be parsed). `routing_tier` is `cost_efficiency`, `performance`, or `manual` (`manual` = launched with explicit provider+model+effort overrides); it is omitted for agents launched before this feature (tier unknown). `ruleset_applied` and `ruleset_original_selection` are present ONLY when the advanced ruleset altered the routing decision for the launch (see [docs/spec/advanced-ruleset/visibility-and-failover.md](spec/advanced-ruleset/visibility-and-failover.md)).

---

## `kill_agent`

Immediately force-kill any live agent (`processing` or `stalled`): `taskkill /pid /t /f` (Windows) or SIGKILL (macOS/Linux). Reports terminal `stopped`. Killing an already-terminal agent is not an error.

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |

Returns: `{ agent_id, status, message }`

---

## `send_message`

Write a message to an agent's stdin (newline appended). Only works while the agent is live (`processing` or `stalled`).

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |
| `message` | string | Yes |

Returns: `{ agent_id, status, message }`

---

## `list_agents`

List all agents known to the server (all statuses).

No parameters and no `verbose` arg. Returns token-efficient core metrics: `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd_basename, alive, idle_seconds }] }`. No `hint`, no tails, no `recent_stream`, no `final_output` -- use `poll_agent` for those. Exit is reconciled synchronously per agent on each call.

---

## `wait`

Block until one or more sub-agents reach a terminal state (finished/errored/stopped) and return their exit details. A `stalled` agent is still live, so `wait` does NOT return on it. Returns immediately if terminal-unreported agents already exist. Returns after a 15-minute hard timeout with a list of still-live agents if nothing reaches terminal in time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `verbose` | boolean | No | When `true`, add `final_output` to each finished entry (default: `false`) |

With `verbose: true`, every entry in `finished` gains a `final_output` field carrying that agent's final assistant turn text (falls back to raw stdout if it cannot be parsed).

**Happy-path return** (one or more agents just finished):
```json
{
  "finished": [
    {
      "id": "...",
      "provider": "claude",
      "model": "sonnet",
      "status": "finished",
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
