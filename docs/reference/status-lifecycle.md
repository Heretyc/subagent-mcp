# Status Lifecycle and Health Monitor

Status semantics, the `alive`/`idle_seconds`/`hint` fields, the health monitor,
and synchronous exit reconciliation. Part of the
[subagent-mcp technical specification](../SPEC.md).

---

## Status Semantics

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `running` | Process alive and produced output recently (< 60s ago) | no (live) |
| `processing` | Process STILL ALIVE but no stdout/stderr for >= 60s -- working, thinking, or awaiting a temp-file handoff. Recovers to `running` if output resumes. **Renamed from `stalled`; it is not a failure.** | no (live) |
| `completed` | Exit code 0 (or Codex `turn.completed`) | yes |
| `failed` | Non-zero exit | yes |
| `killed` | Terminated by `kill_agent` | yes |

`alive === true` for `running`/`processing` (exitCode === null); only `completed`/`failed`/`killed` are terminal.

The per-provider concurrency cap (max 5, see [SPEC.md](../SPEC.md#concurrency-model)) counts only `running` agents on purpose: its job is to limit API rate-limit pressure, and a `processing` agent is quiet by definition (no output for >= 60s) so it adds no rate-limit load and does not reserve a cap slot. More than 5 live processes per provider can coexist when some are `processing` -- intended.

---

## Health Monitor

The status-transition decision is a pure, unit-tested function `computeStatusTransition({ status, exitCode, lastActivity, now, exitedAt }) -> { status, exitedAt }` in `src/status-helpers.ts`, with the idle boundary exported as `STALL_THRESHOLD = 60000`. Its order is:

1. If status is live (`running`/`processing`) and `exitCode !== null` -> `completed` (code 0) or `failed`; stamp `exitedAt` to `now` if unset (exit reconciliation is first and authoritative).
2. Else if `processing` and `now - lastActivity <= 60000` -> `running` (output resumed).
3. Else if `running` and `now - lastActivity > 60000` -> `processing` (alive but quiet).
4. Otherwise unchanged (terminal states are inert; Codex `turn.completed` -> `completed` is handled in the stdout handler, not here).

`setInterval` every 10,000 ms folds each live agent's `process.exitCode` into `AgentState` and applies the helper. `poll_agent` and `list_agents` additionally run the same reconcile synchronously before returning, eliminating the up-to-10s lag for already-exited processes. `processing` agents are never auto-killed; prefer `wait`/re-poll (or checking the agent's temp output) over `kill_agent`.
