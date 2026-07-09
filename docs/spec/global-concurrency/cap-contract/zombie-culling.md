## Zombie Culling

Zombie culling is enabled by default and has no config knob. It runs before
slot reservation inside `reserveSlot`, at the start of every MCP tool handler,
and from orchestration hooks.

Thresholds:

- `stale_live`: slot metadata older than `ZOMBIE_LIVE_IDLE_MS = 6 * 60 * 1000`
  and owner `server_pid` missing or no longer alive; live owners refresh slots.
- `terminal_but_alive`: `finished`, `errored`, or `stopped` whose driver is
  still open after 6 minutes with no `send_message` or `poll_agent` activity;
  both tools refresh the idle clock.
- Grace before force: `ZOMBIE_FORCE_GRACE_MS = 20 * 1000` (20 seconds).

Tool-path maintenance uses `SUBAGENT_ZOMBIE_LIVE_IDLE_MS` for heartbeat pacing
and `SUBAGENT_ZOMBIE_TERMINAL_IDLE_MS` / `SUBAGENT_ZOMBIE_FORCE_GRACE_MS` as
test seams. Hook-side force grace uses `SUBAGENT_ZOMBIE_FORCE_GRACE_MS`.

For stale slots, culling first checks owner `server_pid`; live owners are skipped.
If owner is gone and `child_pid` exists, culling terminates the full tree:

```text
Windows: graceful taskkill /PID <pid> /T; force taskkill /PID <pid> /T /F
POSIX:   graceful kill -TERM -<pid>;     force kill -KILL -<pid>
```

Unmanaged stale slots (no `server_pid`) are unlinked without killing child PIDs.
Terminal-but-alive entries are force-killed immediately; the owning server marks
them `zombie_killed`, sets `exitCode` to `-1`, releases slot, reports via `wait`.

Cross-process hook culling records `zombie_killed` JSONL reports in the slot
directory and unlinks stale slots. The owning server drains those reports on
the next tool call, updates in-memory state, and preserves output tails already
captured by that server. All tool and hook paths still run culling, but only
`poll_agent` and `list_agents` surface the caller-visible
`zombie_report: "zombies: <agent_ids>"` message. Killed zombies free slots
before cap checks and remain visible through `poll_agent`, `list_agents`, and
`wait` as `zombie_killed`.

If a process crashes and no hook/tool later culls its marker, the marker can
still over-count until reboot on POSIX or manual deletion on Windows.
