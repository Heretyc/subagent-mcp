<!-- Part of docs/tools.md (split). See ../tools.md for full tool reference index. -->

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
[docs/spec/swarm/_INDEX.md](../spec/swarm/_INDEX.md).
