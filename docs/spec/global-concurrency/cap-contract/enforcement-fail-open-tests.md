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
slot on mkdir/write/count errors; `readGlobalCap` and `readCheckForUpdates`
return defaults on config read/parse errors.

## Tests
`test/global-concurrency-cap.test.mjs` covers config validation, JSONC parsing,
reserve/reject/rollback, release idempotence, and scaffold parsing.
`test/update-check.test.mjs` covers update-check fetch failures, persistence,
notice throttling/session suppression, stale notice cleanup, and opt-outs.
`test/zombie.test.mjs` covers slot metadata, stale culling, graceful/force
process-tree commands, JSONL zombie reports, and hook/tool report behavior.
