<!-- Part of orchestration-directive-architecture (split from context-metering.md). Retrieval map: ../orchestration-directive-architecture.md -->

## context-metering-usage-lift.md : Usage Lift, State, and Display

Sections 6-10 of the context-metering spec. Load this leaf when implementing
or debugging how hooks lift provider usage numbers, how metering state is
persisted, or how percentages are displayed.

### 6. Claude Usage Lift

The Claude adapter tails the transcript for the newest main-chain JSONL line
where `type === "assistant"` and `message.usage` is present. Lines with
top-level `isSidechain === true` are skipped because they belong to delegated
sub-agent contexts and may carry a different model or window. Lines whose
`message.model` is missing, blank, or `<synthetic>` are skipped, because they
are not real provider model evidence. From the selected line it reads
`usage.input`, `usage.output`, `usage.cache_creation`, `usage.cache_read`,
and `model` from the corresponding `message.usage.*` and `message.model`
fields.

The adapter also reads a Claude long-context tier hint from, in order:
`ANTHROPIC_MODEL`, `<cwd>/.claude/settings.local.json`,
`<cwd>/.claude/settings.json`, then
`${CLAUDE_CONFIG_DIR || ~/.claude}/settings.json`. The first defined string
`model` value decides. The hint is tier evidence only, not model identity;
read or parse failure returns no hint and never throws.

Claude Code computes a context percentage for statusLine stdin as
`context_window.used_percentage`. The shim records that payload in a 24h side
channel; the hook reads it as rung 1, while transcript remains model/usage source.

Because `UserPromptSubmit` fires before the current assistant response exists,
Claude metering describes the last completed assistant turn. Turn 1 has no
prior assistant usage and is not treated as an error.

### 7. Codex Usage Lift

The Codex adapter tails the rollout JSONL file for the newest `token_count`
line, and reads the model from the newest `turn_context.model`. It prefers
`info.last_token_usage` (the last completed turn's usage, the correct signal for
current context occupancy) and falls back to `info.total_token_usage` only when
no last-turn usage exists. `total_token_usage` is cumulative accounting data; an
absurd fallback whose `total_tokens` exceeds `model_context_window` by more than
4x is rejected (returns `null`) so cached billing totals cannot force a false
100%. Codex supplies `input_tokens`, `output_tokens`, and `cached_input_tokens`;
`input_tokens` includes cached input. The adapter stores non-cached input,
output, zero cache creation, and cached input separately so `used_tokens`
matches `total_tokens` instead of double-counting cache.

When `model_context_window` is valid (finite and positive) the adapter forwards
it as `harnessContextWindow`, so shared metering resolves
`window_source: "harness"` with `context_window_size` equal to that window even
when no percentage can be derived. When the selected usage also carries a finite
`total_tokens`, the adapter computes the harness percentage from
`total_tokens / model_context_window` (USED occupancy), which takes precedence
over any static mapping window. Percentages are never inverted: e.g. 155000
used against a 258400 window is ~60% USED / ~40% remaining.

Turn 0 (Codex `SessionStart`) cannot lift the in-flight turn's usage, so the
dispatcher reads any still-fresh persisted metering record for the current owner
(`readMetering`, subject to the `ORCH_DISABLE_TTL_MS` freshness horizon) and
renders its USED utilization and phase on the turn-0 tag; a stale or absent
record yields `unknown`. Stale data is never lifted forward.

### 8. State And Latch Migration

Metering records live under `join(os.tmpdir(), "subagent-mcp")` as
`ctx-<hashKey(sessionKey)>.json`, written through `atomicWriteJson`. The key
uses the carryover owner ladder: non-empty `session_id`, then normalized
`transcript_path` hash. Moved transcripts can re-key, but case and slash drift
do not. Reads use the existing 2 hour `ORCH_DISABLE_TTL_MS` lazy-GC horizon.
Stale metering is worse than no metering because it can understate usage.

Plan latches use `LATCH_REV = 2`. Records without the current `rev` are
inactive and best-effort unlinked on read or by the hourly sweep. This lazily
invalidates bug-era latches from the old 200k assumption. Latches are derived
state: if corrected metering still justifies one, the hook re-trips it in the
same invocation.

### 9. Display And Consumers

Hook code is the only writer of `ctx-*`; the shim is the only writer of `sl-*`
and `sl-cwd-*`. Consumers are hook-core tag/footer and handoff gating; no MCP
tool exposes raw records. Harness outranks mapping, hint, ratchet, prior,
contradiction, and assumed defaults.

Visible injection surfaces are limited to the tag utilization attribute and
the footer. Numeric percentages render as `utilization="NN%"` plus
`Remaining Context=NN%`. `utilization="unknown"` is allowed only for the
dead-man fallback where usage is unavailable. `Remaining Context=0%` is
allowed only when a resolved window or harness percentage honestly reaches the
clamp.

### 10. One-Turn Lag

Both adapters lift usage for the prior completed turn; same-turn usage would
require forbidden estimation. Threshold consumers may trip from a one-turn
lagged crossing; the lag can delay detection but never fabricates a percentage.
