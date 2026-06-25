# Global Concurrent-Subagent Cap Contract

Normative. Defines the machine-global live-subagent cap, shared slot state,
zombie culling, config validation, enforcement, fail-open behavior, and tests.
Where this contract and implementation disagree, change this contract first.

## Scope

One machine-global cap limits subagents ALIVE AT ONCE across all sessions,
processes, users, and recursive descendants on the host. It is separate from
the per-provider in-memory `MAX_CLAUDE` / `MAX_CODEX` processing caps.

- Descendant counting is emergent: every descendant runs its own MCP server and
  reserves into the same shared slot directory.
- At cap, `launch_agent` is rejected immediately and never queued.
- Slots normally free when agents finish, are killed, or all launch candidates
  fail. Zombie culling may also free stale slots before cap rejection.

Config and live state are distinct: `global-concurrency.jsonc` travels with the
package install; slot files travel with the machine.

## Shared State
The live count is a lock-free directory of `slot-<uuid>.json` marker files.
Reservation writes the marker, recounts, and rolls back if the count exceeds
the cap.

```typescript
reserveSlot(agentId, max, dir = slotDir()):
  mkdir dir
  cullStaleSlots(dir)
  write slot-<agentId>.json
  n = count slot-* files
  if n > max: unlink own slot; reject with current = n - 1
  else accept
```

The algorithm may over-reject under contention, but never over-admits: the last
surviving recount observes all surviving markers and only survives if count is
`<= max`.

No lock is used. A stuck lock can wedge every launch; a stale marker only
rejects slightly early, and culling now removes stale markers opportunistically.

## Slot Directory
`slotDir()` resolves to:

```text
Windows:      %ProgramData%\subagent-mcp\slots
macOS/Linux:  /tmp/subagent-mcp/slots
```

POSIX uses `/tmp` because the cap tracks live processes and should recover on
reboot. Directory mode is `0o1777`; file mode is `0o600`. Slot filenames carry
only the UUID. Slot contents are metadata for culling and diagnostics:
`agent_id`, `server_pid`, `child_pid`, `cwd`, `started_at`, `started_at_ms`,
`last_activity_ms`, and `status`.

`SUBAGENT_SLOT_DIR` may override the directory for tests and controlled local
runs. The cap value itself has no environment-variable override.

## Slot Lifecycle
A slot is reserved once per `launch_agent` call before candidate attempts. The
winning `AgentState.slotPath` carries the marker path to release sites.

Slots are held until true driver process death, manual termination, failed
launch cleanup, or zombie culling. A stalled agent and a turn-finished
interactive agent still hold the slot while their driver remains open.

Release sites:

1. Driver close/exit handler calls `releaseSlot(agentState.slotPath)`.
2. `kill_agent` releases after process-tree force kill and marks `stopped`.
3. All-candidates-failed cleanup releases the pre-reserved slot.
4. Zombie culling releases stale live or terminal-but-alive slots.

`releaseSlot` is idempotent; null paths and missing files are no-ops.

## Zombie Culling
Zombie culling is enabled by default and has no config knob. It runs before
slot reservation inside `reserveSlot`, at the start of every MCP tool handler,
and from orchestration hooks.

Thresholds:

- `stale_live`: `processing` or `stalled` with no activity for more than
  `ZOMBIE_LIVE_IDLE_MS = 6 * 60 * 1000` (6 minutes).
- `terminal_but_alive`: `finished`, `errored`, or `stopped` whose driver is
  still open more than `ZOMBIE_TERMINAL_IDLE_MS = 30 * 1000` after `exitedAt`.
- Grace before force: `ZOMBIE_FORCE_GRACE_MS = 20 * 1000` (20 seconds).

Tool-path culling uses `SUBAGENT_ZOMBIE_LIVE_IDLE_MS`,
`SUBAGENT_ZOMBIE_TERMINAL_IDLE_MS`, and `SUBAGENT_ZOMBIE_FORCE_GRACE_MS` as
test seams. Hook-side force grace uses `SUBAGENT_ZOMBIE_FORCE_GRACE_MS`.

For stale live processes, culling first sends a graceful full process-tree
terminate, then force-kills after the grace window:

```text
Windows: graceful taskkill /PID <pid> /T; force taskkill /PID <pid> /T /F
POSIX:   graceful kill -TERM -<pid>;     force kill -KILL -<pid>
```

Terminal-but-alive entries are force-killed immediately on the tool path. The
owning server marks the agent `zombie_killed`, sets `exitCode` to `-1` if
unset, releases the slot, and makes it reportable through `wait`.

Cross-process hook culling records `zombie_killed` JSONL reports in the slot
directory and unlinks stale slots. The owning server drains those reports on
the next tool call, updates in-memory state, and preserves output tails already
captured by that server. Hook injections and tool responses append/report
`zombies: <agent_ids>`; JSON tool payloads receive `zombie_report` when
possible. Culling runs before cap rejection, so killed zombies free slots before
the cap check decides whether to reject.

If a process crashes and no hook/tool later culls its marker, the marker can
still over-count until reboot on POSIX or manual deletion on Windows.

## Config
- Canonical source: `src/global-concurrency.jsonc`.
- Installed path: `dist/global-concurrency.jsonc` beside compiled modules.
- Key: `globalConcurrentSubagents`.
- Default: `20`; minimum valid: `10`.
- Re-read on every `launch_agent`; no restart and no cache.
- JSONC supports whole-line `//` comments only.

Validation:

| Configured value | Result |
|---|---|
| missing, unset, null, non-integer, float, NaN, string | 20 |
| 0 or negative | 20 |
| 1-9 | 10 |
| 10 or greater | used as-is |

## Template
`src/global-concurrency.jsonc` is shipped and scaffolded byte-for-byte:

```jsonc
// subagent-mcp - Global Concurrent Subagent Cap
// ------------------------------------------------------------------
// SOLE source of truth for the machine-wide limit on how many subagents
// may be ALIVE AT ONCE across EVERY session, process, and user on this
// machine. There is NO environment-variable override.
//
// The whole recursive descendant tree counts toward this ONE number: a
// subagent that itself launches subagents adds to the same machine-wide
// total, and OTHER active agentic sessions count too.
//
// RE-READ on every launch_agent call - edits take effect immediately, no
// server restart required.
//
// Value rules (forcibly applied to the number below):
//   - missing / unset / non-integer / 0 / negative  -> reset to default 20
//   - 1 through 9                                    -> forced UP to minimum 10
//   - 10 or greater                                 -> used as-is
//
// Zombie culling is always enabled. There is no config knob. Before cap
// rejection, launch/tool/hook paths cull stale live agents idle for 6min and
// terminal-but-alive agents idle for 30s. Culling gracefully terminates the
// full process tree, then force-kills after 20s when needed.
//
// When the cap is reached after culling, launch_agent is REJECTED (never
// queued). Free a slot with list_agents + kill_agent, then retry.
{
  "globalConcurrentSubagents": 20
}
```

## Retention And Build
The config is preserved across updates by the same backup/restore bracket used
for `advanced-ruleset.py`: CLI self-update, installer deployment, and runtime
recreate-if-absent. Existing user config is never overwritten.

`scripts/gen-ruleset-scaffold.mjs` emits `src/config-scaffold.ts` from
`src/global-concurrency.jsonc` before `tsc`. `scripts/copy-provider.mjs` copies
the JSONC file into `dist/` and hard-fails if it is missing.

## Enforcement
`launch_agent` reads the cap and reserves a slot immediately before the
candidate loop. The reservation runs after input validation, model-selection
mode, routing-table build, and advanced-ruleset processing, and before any
spawn attempt. There is exactly one machine-global reservation per call.

Reject responses include current/max count, global/session/descendant scope,
never-queued semantics, `list_agents` + `kill_agent` remediation, and config
path/default/minimum details.

## Fail-Open Policy
Filesystem errors in cap state fail open: allow launch and warn on stderr.
`countSlots` returns `0` on read errors; `reserveSlot` returns an accepted null
slot on mkdir/write/count errors; `readGlobalCap` returns the default on config
read/parse errors.

## Tests
`test/global-concurrency-cap.test.mjs` covers config validation, JSONC parsing,
reserve/reject/rollback, release idempotence, and scaffold parsing.
`test/zombie.test.mjs` covers slot metadata, stale culling, graceful/force
process-tree commands, JSONL zombie reports, and hook/tool report behavior.
