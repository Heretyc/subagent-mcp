# Runtime Model

## Concurrency Model

Admission is governed by ONE machine-global, provider-agnostic cap on subagents
alive at once across every session, process, user, and recursive descendant on
the host. There are NO per-provider caps (`MAX_CLAUDE`/`MAX_CODEX`/`countProcessing`
no longer exist). The cap value is `globalConcurrentSubagents` in
`global-subagent-mcp-config.jsonc` (sole source of truth; default 20, minimum 10,
re-read every launch). See `permissions.md` section 4 for the 2.12.5 rename;
`global-concurrency.jsonc` is a deprecated fallback. The live count is a shared directory of `slot-<uuid>.json`
marker files; `launch_agent` reserves a slot before spawning and is REJECTED
immediately at cap (never queued). On a slot-state I/O error the launch is
REJECTED (fail-closed). A slot is reserved at launch admission and released ONLY
when the agent's driver closes (or via kill / failed-launch cleanup / zombie
culling) -- a `stalled` agent still holds its slot. The authoritative contract
is [global-concurrency/cap-contract.md](global-concurrency/cap-contract.md).

Agents are stored in a module-level `Map<string, AgentState>` keyed by UUID. There is no persistence -- the map is cleared on server restart.

## Provider Driver IPC and Output Handling

See [interactive-drivers.md](interactive-drivers.md) for the
normative interactive-only driver model.

### Claude

- Driver: Claude Agent SDK `query()` with an async input stream.
- Launch enqueues the prompt as the first user input; `send_message` enqueues later inputs into the same SDK stream.
- SDK events are captured as JSONL in `agentState.stdout` and parsed with per-agent line buffering. Parsed visible items refresh `lastActivity`; provider-internal thinking blocks do not.
- If the SDK is unavailable or lacks the streaming API, launch fails loudly. There is no raw CLI one-shot fallback.

### Codex

- Driver: `codex app-server --stdio`.
- Launch initializes app-server, starts a configured thread, then starts the first turn.
- `send_message` enqueues the next user turn; queued turns submit through `turn/start` after the active turn completes.
- app-server JSONL notifications are captured in `agentState.stdout`; `turn/completed` marks the current turn `finished` without killing the session.
- If app-server startup or protocol negotiation fails, launch fails loudly. There is no `codex exec` fallback.

### Output Tails

`poll_agent` returns the last 2000 characters of stdout and last 1000 characters of stderr. Full output is stored in memory for the server's lifetime; there is no disk buffering.

## Status Lifecycle and Health Monitor

The full status table (`processing`, `stalled`, `finished`, `errored`,
`stopped`, `zombie_killed`, `permission_requested`), the visible-stream heartbeat,
the `alive`/`idle_seconds`/`hint` fields, the `computeStatusTransition` ordering,
the `HEARTBEAT_TIMEOUT_MS = 600000` (10-minute) boundary, and synchronous exit
reconciliation are documented in [../reference/status-lifecycle.md](../reference/status-lifecycle.md).
`permission_requested` means a gated sub-agent is parked on a permission request,
awaiting `respond_permission` (or a 5-minute auto-deny); it recovers to
`processing` once answered, holds its slot, and is exempt from the stalled flip.
`stalled` is a live, non-failure state; `processing` is the active live state.
Tool and hook maintenance cull stale live and terminal-but-alive agents after
the same 6-minute idle window (`ZOMBIE_TERMINAL_IDLE_MS`), anchored on the later
of `exitedAt` and `lastActivity`; `poll_agent` and `send_message` refresh that
clock, and the concurrency slot is already freed at turn-finish. All tool and
hook paths still run culling, but only `poll_agent` and `list_agents` surface
`zombie_report`; culled agents remain `zombie_killed` via `poll_agent`,
`list_agents`, and `wait`.
