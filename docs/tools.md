# Tool Reference

The eight tools exposed by `subagent-mcp`. See [README.md](../README.md) for the
overview and [docs/SPEC.md](SPEC.md) for full parameter schemas and return
shapes.

---

## `launch_agent`

Start a new always-interactive sub-agent session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_category` | one of `math_proof`, `security_review`, `debugging`, `quality_review`, `architecture`, `agentic_execution`, `data_analysis`, `coding`, `knowledge_synthesis`, `mechanical`, `fallback_default` | Yes | Task shape; routes to the best provider/model/effort for that category |
| `prompt` | string | Yes | Initial prompt text |
| `provider` | `"claude" \| "codex"` | No | Override; omit to auto-select |
| `model` | `"haiku" \| "sonnet" \| "opus" \| "opus-4-8" \| "gpt-5.5"` | No | Override; omit to auto-select |
| `effort` | `"medium" \| "high" \| "xhigh" \| "max" \| "ultracode"` | No | Override; omit to auto-select |
| `deadlock` | boolean | No | MANDATE: ALWAYS set deadlock=true when, and ONLY when, 2 launch attempts for the SAME atomic task have already failed or been unsatisfactory - the 3rd attempt onward. Re-wording or splitting unchanged work does NOT reset attempts. Auto mode only: cannot be combined with provider/model/effort; from the 3rd attempt, drop those params. Passing false is identical to omitting it. |
| `cwd` | string | No | Working directory for the agent session |

Returns: `{ agent_id, status, provider, model, effort, task_category }`, plus `ruleset_applied: true` and `ruleset_original_selection` ONLY when the advanced ruleset altered the routing decision ([docs/spec/advanced-ruleset/visibility-and-failover.md](spec/advanced-ruleset/visibility-and-failover.md)). `launch_agent` runs zombie maintenance silently before launching; it does not return `zombie_report`. Culled agents remain observable as `zombie_killed` via `poll_agent`, `list_agents`, and `wait`.

**Auto mode (recommended):** pass only `prompt` + `task_category`. The server reads its routing table, builds a best→worst candidate list for that category, starts the first interactive candidate that accepts startup, and silently falls back to the next-best on a launch-time failure.

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

Returns: `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd, alive, idle_seconds, recent_stream, routing_tier }` plus `hint` when `status` is `stalled`, plus `final_output` when `verbose` is `true`, plus `ruleset_applied` and `ruleset_original_selection` ONLY when the advanced ruleset altered the routing decision. When maintenance culls stale processes, non-`launch_agent` responses also report `zombie_report` / `zombies: <agent_ids>`.

`stdout_tail` is capped at the last 2000 characters; `stderr_tail` at 1000 characters. `recent_stream` holds exactly the last 3 parsed visible provider-stream items, each with its timestamp. `alive` is `true` while the driver is open (`processing`, `stalled`, or a `finished` turn that can still accept `send_message`); `idle_seconds` is whole seconds since the last visible-stream heartbeat. Exit is reconciled synchronously on each call, so a closed driver is reported `finished`/`errored` immediately. A `stalled` agent is alive but quiet -- prefer `wait`/re-poll over killing it. With `verbose: true`, `final_output` holds the agent's final assistant turn text extracted from its full captured stdout (falls back to the raw stdout if it cannot be parsed). `routing_tier` is `cost_efficiency`, `performance`, or `manual` (`manual` = launched with explicit provider+model+effort overrides); it is omitted for agents launched before this feature (tier unknown). `ruleset_applied` and `ruleset_original_selection` are present ONLY when the advanced ruleset altered the routing decision for the launch (see [docs/spec/advanced-ruleset/visibility-and-failover.md](spec/advanced-ruleset/visibility-and-failover.md)).

---

## `kill_agent`

Immediately force-kill any open agent session (`processing`, `stalled`, or a turn-`finished` session still marked `alive`): `taskkill /pid /t /f` (Windows) or SIGKILL (macOS/Linux). Reports terminal `stopped`. Killing an already-closed agent is not an error.

| Parameter | Type | Required |
|-----------|------|----------|
| `agent_id` | string | Yes |

Returns: `{ agent_id, status, message }`

---

## `send_message`

Enqueue a user message on the agent's existing interactive session. Only works while the driver is open (`processing`, `stalled`, or a turn-`finished` session still marked `alive`). Callers observe output with `poll_agent` or `wait`; `send_message` only reports that the provider driver accepted the input.

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

Block until one or more sub-agents reach a reportable turn/process state (`finished`, `errored`, `stopped`, or `zombie_killed`) and return their details. A `stalled` agent is still live, so `wait` does NOT return on it. Returns immediately if unreported finished agents already exist. Returns after a 15-minute hard timeout with a list of still-live agents if nothing reaches a reportable state in time.

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

---

## `orchestration-mode`

Toggle or query the per-project ORCHESTRATION MODE marker (keyed by cwd).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | boolean | No | `true` = ON, `false` = OFF, omit = query current state |

Returns: `{ orchestration_mode, marker_path }`.

When ON, act as a delegate-only orchestrator: every step runs in a sub-agent; inline-by-right does not exist; a non-delegable atomic step needs a one-time user-approved exception. The marker persists across restarts/sessions until a permitted disable. DISABLE is never on your own initiative — you may PROPOSE OFF, but only explicit user permission (via the structured-question tool) may set `enabled:false`. Per-turn injection fires only in CLI hosts that load the bundled hook; desktop hosts toggle the marker but inject nothing.

---

## `model-selection-mode`

Set or query the per-project MODEL SELECTION MODE, which gates `launch_agent`'s `provider`/`model`/`effort` selectors: smart (auto-pick) or user-approved-overrides (30-min override window).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | `"smart" \| "user-approved-overrides"` | No | Omit to query current state |

Returns: `{ model_selection_mode, enabled_at, window_remaining_ms, marker_path }`.

`smart` is the DEFAULT (used whenever unset): `launch_agent` REJECTS any call supplying provider/model/effort and the server auto-picks the best model for the `task_category`. `user-approved-overrides` opens a 30-MINUTE window where selectors are HONORED, enforced LAZILY (reverts to smart on the next `launch_agent` call after 30 minutes); re-enabling does NOT extend an active window. HONOR-BASED: you MUST NOT set `user-approved-overrides` without explicit interactive user authorization via the structured-question tool; never enable it on your own initiative. State (mode + enable-timestamp) persists across MCP server restarts.
