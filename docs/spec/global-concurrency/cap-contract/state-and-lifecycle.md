# Global Concurrent-Subagent Cap Contract

Normative. Defines the machine-global live-subagent cap, shared slot state,
zombie culling, config validation, enforcement, fail-open behavior, and tests.
Where this contract and implementation disagree, change this contract first.

## Scope

One machine-global cap limits subagents ALIVE AT ONCE across all sessions,
processes, users, and recursive descendants on the host. This machine-global cap
is the SOLE admission control; no per-provider caps exist.

- Descendant counting is emergent: every descendant runs its own MCP server and
  reserves into the same shared slot directory.
- At cap, `launch_agent` is rejected immediately and never queued.
- Slots normally free when agents finish, are killed, or all launch candidates
  fail. Zombie culling may also free stale slots before cap rejection.

Config and live state are distinct: `global-subagent-mcp-config.jsonc` travels with the
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
The slot directory is **per-user**: `slotDir()` = `slotBaseDir()` joined with a
`currentUserSlotNamespace()` subdirectory.

```text
base   Windows:      %ProgramData%\subagent-mcp\slots
base   macOS/Linux:  /tmp/subagent-mcp/slots
slotDir = <base>/<namespace>   e.g. /tmp/subagent-mcp/slots/uid-1000
```

The namespace is `uid-<uid>` on POSIX (falls back to a sanitized username, then a
hashed token) so each OS user owns a distinct slot subtree. POSIX uses `/tmp`
because the cap tracks live processes and should recover on reboot. The shared
base dir is created mode `0o1777`; the per-user `slotDir()` is created **owner-only
`0o700`** (POSIX); file mode is `0o600`. `countSlots` reads only the current user's
`slotDir()`, so **only that user's slots count toward the cap** and legacy flat
slot files written directly under the base dir are ignored. Slot filenames carry
only the UUID. Slot contents are metadata for culling and diagnostics:
`agent_id`, `server_pid`, `child_pid`, `cwd`, `started_at`, `started_at_ms`,
`last_activity_ms`, and `status`.

`SUBAGENT_SLOT_DIR` may override the directory for tests and controlled local
runs. The cap value itself has no environment-variable override.

## Slot Lifecycle
A slot is reserved once per `launch_agent` call before candidate attempts. The
winning `AgentState.slotPath` carries the marker path to release sites.

Slots are held for the driver's whole lifetime -- released only on true driver
process death, manual termination, failed launch cleanup, or zombie culling.
Turn-completion does NOT release: a turn-finished but still-open interactive
agent keeps its slot (as does a stalled agent) until the driver closes.

Release sites:

1. Driver close/exit handler calls `releaseSlot(agentState.slotPath)`.
2. `kill_agent` releases after process-tree force kill and marks `stopped`.
3. All-candidates-failed cleanup releases the pre-reserved slot.
4. Zombie culling releases stale live or terminal-but-alive slots.

`releaseSlot` is idempotent; null paths and missing files are no-ops.
