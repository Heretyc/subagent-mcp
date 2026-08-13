<!-- Part of auto-mode spec (split from routing-table-contract.md). Retrieval map: _INDEX.md -->

## Attempt loop with SILENT fallback

Pure auto advances silently through the FULL ranked list on any launch-time
failure. Provider-only mode likewise advances through its requested-provider
candidates, then de-duplicated auto fallbacks. Provider+model is pinned to one
rank-1 matching candidate; adding effort pins the exact requested triple.
Pinned failures return a loud error with no substitute. The same
`{provider,model,effort}` triple is never retried in one `launch_agent` call.

For each candidate in order (best->worst):

1. Normalize to `{provider, launchModel, launchEffort}` (skip on unknown
   model/effort).
2. Reuse the EXISTING launch path from `src/index.ts`:
   `buildCommand(provider, launchModel, launchEffort, prompt, cwd)` ->
   `resolveExe(provider)` -> `spawn(...)`. The machine-global concurrency slot is
   reserved ONCE per `launch_agent` call before the candidate loop
   (`cap-contract.md`), not per candidate; if that single reservation is
   REJECTED (at cap, or fail-closed on a slot-state I/O error) the whole call
   fails before any candidate is attempted. There are no per-provider caps.
3. **"Fails for any reason" = LAUNCH-TIME failure**, specifically:
   - `buildCommand`/`resolveEffort` throws;
   - `resolveExe` returns a path that does not exist / driver spawn throws
     (missing exe, ENOENT, EACCES, etc.);
   - provider driver startup rejects before the agent is registered.
   On ANY of these -> classify the failure. When an API candidate is
   `"transient_provider"`, retry that same candidate exactly once before
   advancing. No permanent API failure, CLI candidate failure, or failed retry
   gets another same-candidate attempt. If still failed, record
   `{model,effort,provider,reason,failure_type}`. Cascading modes SILENTLY
   advance; pinned modes exhaust and return `ERR_ALL_FAILED`.
   - `failure_type` is `classifyFailureReason(reason, stderr)` ->
     `"transient_provider"` (provider-side limits and availability errors:
     session limit, usage cap/limit, spend/spending limit, credits exhausted,
     billing block, quota, rate limit, 429/too-many-requests, overload,
     HTTP-status 5xx, network timeouts, connection resets :
     ETIMEDOUT/ECONNRESET/ECONNREFUSED) or `"permanent"` (everything else:
     ENOENT, EACCES, bad option, missing config, and bare three-digit numbers
     without HTTP-status context). Except for the single
     transient API retry above, it is a label only; cascading modes advance to
     the next candidate either way (same-call failover).
4. On the FIRST successful driver start: register the agent with `AgentState`,
   stdout/stderr handlers, close handler, and `agents.set`, then return the
   success payload (`param-contract.md`). If any candidate was skipped before
   this success, the payload additionally carries `failover_occurred: true`,
   `failover_from` (the skipped candidates), and `failover_note`
   (`param-contract.md`). This same-call failover is scoped to the single
   `launch_agent` call: `skipped[]` is local to the handler invocation : no
   persisted cooldown or cross-call state. After the agent is "definitely
   started", no further failover occurs (`../advanced-ruleset/visibility-and-failover.md`).

CRITICAL : launch-time only: a launch succeeds when the driver starts AND
survives the post-spawn grace window; ANY exit inside that window (any code or
signal) is a launch-time failure that silently advances the loop. Exceptions:
a provider driver already finalized by its turn-completion marker, or a driver
that crossed the `definitelyStarted` boundary
(`../advanced-ruleset/visibility-and-failover.md`).
`launch_agent` does NOT await the sub-agent's task: a later death is observed
via `poll_agent`/`wait` and is NEVER a fallback trigger.

If ALL candidates fail -> `ERR_ALL_FAILED` listing each
`<model>@<effort> (<provider>) [<failure_type>]: <reason>` (`resolution-matrix.md`);
each numbered line carries the `[transient_provider]`/`[permanent]` label.
For provider+model modes the list has exactly one pinned entry; provider-only
may list its requested-provider and de-duplicated auto candidates.

## Empty / missing table behavior (summary)
| Condition | auto/provider/provider_model | explicit |
|---|---|---|
| `dist/routing-table.json` missing/unreadable | `ERR_TABLE_MISSING` | requested triple only |
| category has zero pairings | `ERR_NO_CANDIDATES` (`<scope>`=empty) | works |
| constraint matches no pairing | `ERR_NO_CANDIDATES` (`<scope>`=provider/model) | n/a |
