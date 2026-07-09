## Config

- Canonical source: `src/global-subagent-mcp-config.jsonc`.
- Installed path: `dist/global-subagent-mcp-config.jsonc` beside compiled modules.
- Keys: `globalConcurrentSubagents`, `checkForUpdates`.
- See `docs/spec/permissions.md` §4 for the 2.12.5 rename; `global-concurrency.jsonc` is a deprecated fallback.
- Default: `20`; minimum valid: `10`.
- Re-read on every `launch_agent`; no restart and no cache.
- JSONC supports whole-line `//` comments only.

`checkForUpdates` defaults true on missing, invalid, or unreadable config. False
skips the startup npmjs metadata fetch and suppresses hook update notices.
`SUBAGENT_UPDATE_CHECK=0` or `SUBAGENT_UPDATE_CHECK=false` (case-insensitive)
also disables both paths for the process. Hook notices dedupe by payload
`session_id` when present; hosts that omit it use timestamp-only throttling.

Validation:

| Configured value | Result |
|---|---|
| missing, unset, null, non-integer, float, NaN, string | 20 |
| 0 or negative | 20 |
| 1-9 | 10 |
| 10 or greater | used as-is |

## Template
`src/global-subagent-mcp-config.jsonc` is shipped and scaffolded byte-for-byte:

```jsonc
// subagent-mcp - Global Concurrent Subagent Cap
// ------------------------------------------------------------------
// SOLE source of truth for the machine-wide limit on how many subagents
// may be ALIVE AT ONCE across EVERY session, process, and user on this
// machine. There is NO environment-variable override for the cap.
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
// rejection, launch/tool/hook paths refresh live owned slots, preserve stale
// slots whose owner server is still alive, and cull stale slots whose owner is
// gone. Managed stale slots terminate the child process tree, then force-kill
// after 20s when needed; unmanaged stale slots are only unlinked.
//
// When the cap is reached after culling, launch_agent is REJECTED (never
// queued). Free a slot with list_agents + kill_agent, then retry.
//
// checkForUpdates controls the silent npmjs update check started when the MCP
// server connects. Default true. Set to false to skip the registry fetch and
// suppress hook notices. SUBAGENT_UPDATE_CHECK=0 or false also disables it.
{
  "globalConcurrentSubagents": 20,
  "checkForUpdates": true
}
```

## Retention And Build
The config is preserved across updates by the same backup/restore bracket used
for `advanced-ruleset.py`: CLI self-update, installer deployment, and runtime
recreate-if-absent. Existing user config is never overwritten.

`scripts/gen-ruleset-scaffold.mjs` emits `src/config-scaffold.ts` from
`src/global-subagent-mcp-config.jsonc` before `tsc`. `scripts/copy-provider.mjs` copies
the JSONC file into `dist/` and hard-fails if it is missing.
