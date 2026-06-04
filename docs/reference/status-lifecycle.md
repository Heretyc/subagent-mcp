# Status Lifecycle and Health Monitor

Status semantics, the visible-stream heartbeat, the `alive`/`idle_seconds`/`hint`
fields, the health monitor, and synchronous exit reconciliation. Part of the
[subagent-mcp technical specification](../SPEC.md).

---

## Visible Stream Heartbeat

Liveness is driven by the agent's **visible provider stream** only: provider
stream events, turn summaries, and assistant messages. Claude is read as
`--output-format stream-json`; Codex is read as its `--json` JSONL stream, both
with per-agent line buffering so an event split across stdout chunks is never
dropped. Each PARSED visible item is a heartbeat that stamps `lastActivity`.

Launch time is the **initial heartbeat**: a freshly spawned agent starts with
`lastActivity` set to its start time, so it begins `processing`.

---

## Status Semantics

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `processing` | Process alive with a visible-stream heartbeat in the last 10 minutes -- actively working | no (live) |
| `stalled` | Process STILL ALIVE but no parsed visible provider stream item for >= 10 minutes -- quiet. Recovers to `processing` if the visible stream resumes. Not a failure | no (live) |
| `finished` | Exit code 0 (or Codex `turn.completed`) | yes |
| `stopped` | Terminated by `kill_agent` | yes |
| `errored` | Non-zero exit | yes |

`alive === true` for `processing`/`stalled` (exitCode === null); only `finished`/
`stopped`/`errored` are terminal.

The per-provider concurrency cap (max 5, see
[SPEC.md](../SPEC.md#concurrency-model)) counts only `processing` agents. A
`processing` agent is actively emitting visible stream content and so carries
real provider load; a `stalled` agent is quiet by definition (no visible stream
for >= 10 minutes) and does NOT reserve a cap slot. More than 5 live processes
per provider can coexist when some are `stalled` -- intended.

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
4. Otherwise unchanged (terminal states are inert; Codex `turn.completed` ->
   `finished` is handled in the stdout handler, not here).

`setInterval` every 10,000 ms folds each live agent's `process.exitCode` into
`AgentState` and applies the helper. `poll_agent` and `list_agents`
additionally run the same reconcile synchronously before returning, eliminating
the up-to-10s lag for already-exited processes. Stalled does not by itself end a
`wait`; `wait` returns only on terminal transitions. `stalled` agents are never
auto-killed; prefer `wait`/re-poll (or checking the agent's temp output) over
`kill_agent`.
