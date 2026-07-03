# Status Lifecycle and Health Monitor

Status semantics, the visible-stream heartbeat, the `alive`/`idle_seconds`/`hint`
fields, the health monitor, and synchronous exit reconciliation. Part of the
[subagent-mcp technical specification](../SPEC.md).

---

## Visible Stream Heartbeat

Liveness is driven by the agent's **visible provider stream** only: provider
stream events, turn summaries, and assistant messages. Claude SDK events and
Codex app-server JSONL notifications are captured with per-agent line buffering
so an event split across stdout chunks is never dropped. Each PARSED visible
item is a heartbeat that stamps `lastActivity`.

Launch time is the **initial heartbeat**: a freshly spawned agent starts with
`lastActivity` set to its start time, so it begins `processing`.

---

## Status Semantics

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `processing` | Driver alive with a visible-stream heartbeat in the last 10 minutes -- actively working | no (live) |
| `stalled` | Driver STILL ALIVE but no parsed visible provider stream item for >= 10 minutes -- quiet. Recovers to `processing` if the visible stream resumes. Not a failure | no (live) |
| `finished` | Current turn completed, or driver exited 0 | reportable; may still be alive |
| `stopped` | Terminated by `kill_agent` | yes |
| `errored` | Non-zero exit | yes |
| `zombie_killed` | Stale live or terminal-but-alive process tree culled by tool/hook maintenance | yes |

`alive === true` for `processing`/`stalled`, and also for `finished` when the
driver remains open (`exitCode === null`). A turn-finished but alive agent can
accept `send_message`, which moves it back to `processing` for the next turn.
`stopped`/`errored`/`zombie_killed` are closed terminal states.

Concurrency admission is one machine-global, provider-agnostic cap (see
[SPEC.md](../SPEC.md#concurrency-model) and
[cap-contract.md](../spec/global-concurrency/cap-contract.md)); there are no
per-provider caps. A slot is reserved when the agent is admitted at launch and
is released ONLY when its driver closes (or via kill / failed-launch cleanup /
zombie culling). Status is orthogonal to slot occupancy: a `stalled` agent keeps
its slot until driver close, exactly like a `processing` one.

---

## Health Monitor

The status-transition decision is a pure, unit-tested function
`computeStatusTransition({ status, exitCode, lastActivity, now, exitedAt }) ->
{ status, exitedAt }` in `src/status-helpers.ts`, with the idle boundary
exported as `HEARTBEAT_TIMEOUT_MS = 600000` (10 minutes). Its order is:

1. If status is live (`processing`/`stalled`) and `exitCode !== null` ->
   `finished` (code 0) or `errored`; stamp `exitedAt` to `now` if unset (exit
   reconciliation is first and authoritative).
2. Else if `stalled` and `now - lastActivity <= HEARTBEAT_TIMEOUT_MS` -> `processing` (visible
   stream resumed).
3. Else if `processing` and `now - lastActivity > HEARTBEAT_TIMEOUT_MS` -> `stalled` (alive
   but quiet).
4. Otherwise unchanged. Provider turn-completion markers (`result` for Claude,
   `turn/completed` for Codex app-server) set `finished` in the stdout handler.

`setInterval` every 10,000 ms folds each live agent's `process.exitCode` into
`AgentState` and applies the helper. Tool handlers also run zombie maintenance:
live agents idle for more than 6 minutes and terminal-but-alive agents idle for
more than 30 seconds are marked `zombie_killed`; stale live process trees are
gracefully terminated, then force-killed after 20 seconds. `poll_agent` and
`list_agents` reconcile synchronously before returning, eliminating the
up-to-10s lag for already-closed drivers. Stalled does not by itself end a
`wait`; `wait` returns on unreported `finished`, `errored`, `stopped`, or
`zombie_killed` states. All tool and hook paths still run zombie maintenance,
but only `poll_agent` and `list_agents` surface the `zombie_report` message.
Culled status remains visible through `poll_agent`, `list_agents`, and `wait`.
