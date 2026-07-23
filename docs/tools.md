# Tool Reference

The tools exposed by `subagent-mcp`. See [README.md](../README.md) for the
overview and [docs/SPEC.md](SPEC.md) for full parameter schemas and return
shapes.

---

## `launch_agent`

Start a new always-interactive sub-agent session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_category` | one of `math_proof`, `security_review`, `debugging`, `quality_review`, `architecture`, `agentic_execution`, `data_analysis`, `coding`, `knowledge_synthesis`, `mechanical`, `prompt_engineering`, `vulnerability_research`, `molecular_biology`, `ml_accelerator_design`, `fallback_default` | Yes | Task shape; routes to the best provider/model/effort for that category |
| `prompt` | string | Yes | Initial prompt text |
| `provider` | `"claude" \| "codex"` | No | Override; omit to auto-select |
| `model` | `"haiku" \| "sonnet" \| "opus" \| "opus-4-8" \| "fable" \| "gpt-5.5" \| "gpt-5.6"` | No | Override; omit to auto-select |
| `effort` | `"medium" \| "high" \| "xhigh" \| "max" \| "ultracode"` | No | Override; omit to auto-select. See haiku note.[^haiku-effort] |
| `deadlock` | boolean | No | MANDATE: ALWAYS set deadlock=true when, and ONLY when, 2 launch attempts for the SAME atomic task have already failed or been unsatisfactory - the 3rd attempt onward. Re-wording or splitting unchanged work does NOT reset attempts. Auto mode only: cannot be combined with provider/model/effort; from the 3rd attempt, drop those params. Passing false is identical to omitting it. |
| `sub-orchestrator` | boolean | No | Launch this child as a delegate-only sub-orchestrator for one disjoint plan section (swarm dispatch stage). The server injects an orchestration directive into the prompt and marks the child's env. The child's own sub-agents are normal workers and never inherit the flag. Available to the main orchestrator only (depth 0); rejected at greater depth. Omitting or `false` = normal sub-agent. |
| `cwd` | string | No | Working directory for the agent session |

[^haiku-effort]: `haiku` accepts any effort value but the effort is ignored : the Claude Agent SDK session takes no effort for Haiku.

Returns: `{ agent_id, status, provider, model, effort, task_category }`, plus `ruleset_applied: true` and `ruleset_original_selection` ONLY when the advanced ruleset altered the routing decision, plus `failover_occurred: true`, `failover_from[]`, and `failover_note` when a later candidate launched after one or more launch-time failures ([docs/spec/advanced-ruleset/visibility-and-failover.md](spec/advanced-ruleset/visibility-and-failover.md); [docs/spec/auto-mode/param-contract.md](spec/auto-mode/param-contract.md)). `launch_agent` runs zombie maintenance silently before launching; it does not return `zombie_report`. Culled agents remain observable as `zombie_killed` via `poll_agent`, `list_agents`, and `wait`.

**Auto mode (recommended):** pass only `prompt` + `task_category`. The server builds a fresh best-to-worst ranking for every call and silently traverses the full list on any launch-time failure, including provider-limit results before visible output; it keeps no cooldown or cross-call failure memory. Exhaustion returns one loud error listing every candidate and reason. Only pure-auto cost-efficiency routing receives eligible `providers.jsonc` API slots; performance and manual/override routing exclude them. The advanced ruleset runs afterward and retains final authority. A transient API launch-time failure gets one immediate retry of that same candidate before fallback advances; no other failure gets a same-candidate retry.

**Overrides:** `provider`/`model`/`effort` are optional and usually unnecessary. A provider-only override tries its matching candidates first, then de-duplicated auto fallbacks. Adding `model` pins the rank-1 matching candidate to one attempt; adding `effort` pins that exact triple. Pinned failures are loud and never substitute another candidate. `model` requires `provider`; `effort` requires both.

Provider/model constraints: Claude accepts `haiku`, `sonnet`, `opus`, `opus-4-8`, `fable`. Codex accepts `gpt-5.5` or `gpt-5.6`.

Spec: [docs/spec/auto-mode/_INDEX.md](spec/auto-mode/_INDEX.md) (param contract, presence→behavior matrix, exact error text).

---

## `get_status`

Return live in-memory MCP server session state.

No parameters.

Returns: `{ providers_loaded, agent_count, session_start_time, last_routing_decisions, swarm }`. `session_start_time` is the MCP server process boot time; hook processes do not write a state file. `swarm` is a snapshot of the agentic-swarm session: `{ active, current_stage, stage_name, pin_active, pin_expires_at }`. When `active` is false, `current_stage` and `stage_name` are null and `pin_active` is false.

---

## `poll_agent`

Get current status and output tail of an agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | UUID returned by `launch_agent` |
| `verbose` | boolean | No | When `true`, also return `final_output` (default: `false`) |

Returns: `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd, alive, idle_seconds, recent_stream, routing_tier }` plus `hint` when `status` is `stalled`, plus `final_output` when `verbose` is `true`, plus `ruleset_applied` and `ruleset_original_selection` ONLY when the advanced ruleset altered the routing decision. When maintenance culls stale processes, `poll_agent` reports `zombie_report: "zombies: <agent_ids>"`.

`stdout_tail` is capped at the last 2000 characters; `stderr_tail` at 1000 characters. `recent_stream` holds exactly the last 3 parsed visible provider-stream items, each with its timestamp. `alive` is `true` while the driver is open (`processing`, `stalled`, or a `finished` turn that can still accept `send_message`); `idle_seconds` is whole seconds since the last visible-stream heartbeat. Exit is reconciled synchronously on each call, so a closed driver is reported `finished`/`errored` immediately. A `stalled` agent is alive but quiet -- prefer `wait`/re-poll over killing it. A turn-`finished` agent stays alive and `send_message`-able; it keeps its concurrency slot until driver close, kill, or zombie culling. Polling it refreshes its idle clock, and it is force-killed only after 6 minutes of no `send_message`/`poll_agent` activity. With `verbose: true`, `final_output` holds the agent's final assistant turn text extracted from captured stdout; JSONL streams are scanned from the end with the same selection semantics, falling back to raw stdout if parsing fails. `routing_tier` is `cost_efficiency`, `performance`, or `manual` (`manual` = launched with explicit provider+model+effort overrides); it is omitted for agents launched before this feature (tier unknown). `ruleset_applied` and `ruleset_original_selection` are present ONLY when the advanced ruleset altered the routing decision for the launch (see [docs/spec/advanced-ruleset/visibility-and-failover.md](spec/advanced-ruleset/visibility-and-failover.md)).

---

## `kill_agent`

Immediately force-kill any open agent session (`processing`, `stalled`, or a turn-`finished` session still marked `alive`): `taskkill /pid /t /f` (Windows) or SIGKILL (macOS/Linux). Reports terminal `stopped`. Killing an already-closed agent is not an error. A turn-`finished` agent is force-killed automatically after 6 minutes of no `send_message`/`poll_agent` activity; call `kill_agent` sooner to release its process resources and concurrency slot immediately.

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

No parameters and no `verbose` arg. Returns token-efficient core metrics: `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd_basename, alive, idle_seconds }] }`. No `hint`, no tails, no `recent_stream`, no `final_output` -- use `poll_agent` for those. Exit is reconciled synchronously per agent on each call. When maintenance culls stale processes, `list_agents` reports `zombie_report: "zombies: <agent_ids>"`.

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

`wait` also returns unreported `permission_requested` agents (alongside `finished`) so a parked sub-agent surfaces promptly : see [`respond_permission`](#respond_permission).

---

## `respond_permission`

Answer a parked permission request for a gated sub-agent (parents only : children have no such tool). One-time only; creates no session-wide approvals. Available when `permissionsCeiling` is `auto`/`manual` (see [docs/spec/permissions.md](spec/permissions.md)).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | The agent whose request to answer |
| `request_id` | string | No | Which pending request; omitted answers the oldest |
| `decision` | `"allow"` \| `"deny"` | Yes | Approve or deny the parked action |
| `reason` | string | No | Note delivered to the sub-agent; required when allowing a request flagged `escalate_to_human` |

The sub-agent continues regardless of the decision : a deny never kills it. Unanswered requests auto-deny after 5 minutes; the per-agent pending queue caps at 16. When a request is parked the agent's status is `permission_requested` and it appears in `poll_agent` (`pending_permissions`) and `list_agents` (`pending_permission_count`). `send_message` is rejected while any request is pending. In `auto` mode, irreversible residue with `escalation: "irreversible-only"` is surfaced as `escalate_to_human: true`; the orchestrator must route it to the human.

---

## `orchestration-mode`

Toggle or query per-project ORCHESTRATION MODE state (keyed by cwd).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | boolean | No | `true` = ON, `false` = OFF, omit = query current state |

Returns: `{ orchestration_mode, marker_path }`.

When ON, act as a delegate-only orchestrator: every step runs in a sub-agent; inline-by-right does not exist; a non-delegable atomic step needs a one-time user-approved exception. ON/OFF is governed by session-keyed state; `orch-<cwdHash>.flag` is claim/carryover state only. DISABLE is never on your own initiative : you may PROPOSE OFF, but only explicit user permission (via the structured-question tool) may set `enabled:false`. Per-turn injection fires only in CLI hosts that load the bundled hook; desktop hosts toggle state but inject nothing.

---

## `model-selection-mode`

Set or query the per-project MODEL SELECTION MODE, which gates `launch_agent`'s `provider`/`model`/`effort` selectors: smart (auto-pick) or user-approved-overrides (30-min override window).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | `"smart" \| "user-approved-overrides"` | No | Omit to query current state |

Returns: `{ model_selection_mode, enabled_at, window_remaining_ms, marker_path }`.

`smart` is the DEFAULT (used whenever unset): `launch_agent` REJECTS any call supplying provider/model/effort (`value !== undefined`, including empty strings) and the server auto-picks the best model for the `task_category`. `user-approved-overrides` opens a 30-MINUTE window where selectors are HONORED, enforced LAZILY (reverts to smart on the next `launch_agent` call after 30 minutes); re-enabling does NOT extend an active window. HONOR-BASED: you MUST NOT set `user-approved-overrides` without explicit interactive user authorization via the structured-question tool; never enable it on your own initiative. State (mode + enable-timestamp) persists across MCP server restarts.

---

## `configure`

List, read, or update subagent-mcp configuration by canonical key.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `"list" \| "get" \| "set"` | Yes | Operation to perform |
| `key` | string | Required for `get` and `set`; rejected for `list` | Canonical config key (discover with `action=list`) |
| `value` | string | Required for `set` on settable keys; rejected for `get`/`list` | New value as a string; read-only keys return a coaching message instead |

### Actions

**`list`**: Returns all known config keys with their effective values, metadata, and four dynamic key patterns. Results are sorted lexically by key. `value` and `key` must be omitted. Response: `{ ok: true, action: "list", restart_required: false, keys: ConfigRow[], patterns: string[] }`.

**`get`**: Returns the effective value and metadata for exactly one canonical key. `key` is required; `value` must be omitted. Response: `{ ok: true, action: "get", key, value, scope, path, settable, restart_required: false, restart_required_on_set, source? }`.

**`set`**: Writes a new value for a settable key after validation. Read-only keys (all `global.*`, `update.*`, and `mode.*`) never write; they return `{ ok: true, action: "set", key, status: "coached", path, backup: null, restart_required: false, message }` -- this is not an MCP error, it is returned even when `value` is omitted, and any supplied `value` is ignored. Unchanged writes return `status: "unchanged"` and create no backup. Successful writes return `{ ok: true, action: "set", key, value, status: "updated", path, backup, restart_required }`.

### Key catalog

The key catalog is discoverable at runtime and is not restated here:
`{"action": "list"}` returns one row per key with `key`, `value`, `type`,
`default`, `valid_values`, `scope`, `path`, `settable`,
`restart_required_on_set`, and `redacted`, plus the four dynamic key patterns
(`providers.<provider>`,
`providers.<provider>.{api_style|base_url|model|key_env}`,
`providers.<provider>.routing.<category>`, and `env.<ENV_NAME>`). See
[skills/smcp-config/references/settings.md](../skills/smcp-config/references/settings.md)
for behavior a list row does not spell out.

Two row fields take non-obvious values:

- `restart_required_on_set` is a boolean except on whole-provider
  `providers.<provider>` rows, where it is the literal string
  `"if key_env changes"`.
- `get`/`list` rows may carry `source`. Besides env-override and
  `settings.local.json` labels, it can be the literal strings
  `"fallback (global file absent)"` (global keys read while the machine-global
  file is absent) or `"fallback (registry absent)"` (`update.autoUpdate` when
  the init registry is absent).

### Resolved config file paths

| Scope | Resolved path |
|-------|--------------|
| machine-global | installed `dist/global-subagent-mcp-config.jsonc`; falls back to `dist/global-concurrency.jsonc` when the primary is absent |
| providers | `<configHome>/providers.jsonc`; `configHome` honors `SUBAGENT_CONFIG_HOME`, else `~/.subagent-mcp` |
| env | `<configHome>/.env` |
| user settings write target | `<configHome>/settings.json` |
| user settings local override | `<configHome>/settings.local.json` (list/get return the merged effective value; set still writes `settings.json`) |
| auto-update registry | `~/.subagent-mcp/init-registry.json` (ignores `SUBAGENT_CONFIG_HOME`) |

`configure` always reports absolute resolved paths. It never calls a loader that scaffolds a missing global config file.

### Redaction

Values are redacted before serialization. Any canonical key or nested object property matching `/token|key|password|secret/i` has its value masked. All `env.*` values are always masked regardless of the variable name. Values shorter than 6 characters become `******`; values 6 characters or longer become the first 4 characters, a one-character ellipsis (the single U+2026 character, not three dots), and the last 2 characters (for example, `abcdefghxy` becomes `abcd` + ellipsis + `xy`). Submitted values never appear in errors, logs, or debug output.

### Global-scope read-only rule

All `global.*` keys are read-only through MCP because they affect all users on
the machine; `update.autoUpdate` and the `mode.*` keys are read-only as well. A
`set` on any of them succeeds with `status: "coached"` and a message naming the
fully resolved file a human must edit (`global.*`, `update.autoUpdate`) or the
tool to use instead (`orchestration-mode` for `mode.orchestration`,
`model-selection-mode` for `mode.modelSelection`). The exact message strings
live in `src/configure.ts` and are intentionally not copied here.

### `restart_required` semantics

`restart_required: true` in a set response means the changed value is in process environment state (`.env` entries, `key_env` field changes) and will not take effect until the MCP server process is restarted. `restart_required: false` means the value is re-read per-launch or per-evaluation with no restart needed. `list` and `get` always return `restart_required: false` because they make no change; each list row carries `restart_required_on_set` for reference.

### Provider and `.env` writes

Provider writes are validated before touching the real config: a candidate file is written atomically to a sibling path, validated, then removed; the real config is written only on success. `.env` writes are not schema-validated -- the submitted value is only checked for being non-empty and single-line (no CR, LF, or NUL). Every changed pre-existing file receives an atomic sibling backup (`<file>.bak-<epoch-ms>`) before replacement; a newly created file reports `backup: null`. An unchanged write creates neither backup nor real-file change and returns `status: "unchanged"`.

Error response (any action): `{ ok: false, action, key?, restart_required: false, error }` with `isError: true` set in the MCP envelope.

## `swarm`

Agentic-swarm staged workflow coach. Offer it when an objective is projected to
span multiple sessions. Available to the main orchestrator only; not registered
for sub-agent or sub-orchestrator sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `stage` | number \| null | No | Omit or `null` to start the swarm (returns stage-1 coaching). Pass N (1-7) to report "stage N is done" and receive the next stage's coaching. Pass 0 to abandon an active swarm. Out-of-order or invalid values return corrective coaching without changing state. |

Returns: coaching text (plain string; never `isError`). Out-of-order, repeated,
idle, or invalid calls return corrective coaching that embeds the current
stage's coaching so the caller always holds the instructions it needs.

**State** is in-memory, per server process, and resets on server restart.
Seven fixed stages (in order):

1. `planning-team` -- launch a planning team of 3 architects + 1 critic
2. `critic-judgment` -- critic judges every draft plan before it is written
3. `write-plan-files` -- approved plans written to temp files; orchestrator handles paths only
4. `master-goal-prompt` -- goal prompt printed in chat for the user to copy/paste
5. `handoff-resume` -- handoff to a new session and resume
6. `dispatch` -- parallel sub-orchestrator launch, one per plan file path
7. `test-complete` -- verify all work, re-dispatch until sufficient, complete

`swarm(5)` from idle is the designated post-handoff re-entry: in-memory state
does not survive the session boundary, so the resumed session calls `swarm(5)`
to register stage 5 as done and receive stage-6 coaching. Cold calls for other
stages (1-4, 6, 7) return not-active coaching.

`get_status.swarm` exposes the live snapshot: `active`, `current_stage`,
`stage_name`, `pin_active` (whether routing is optimized for the current stage),
and `pin_expires_at` (epoch ms expiry, null when inactive).

Full transition table and sub-orchestrator contract:
[docs/spec/swarm/_INDEX.md](spec/swarm/_INDEX.md).
