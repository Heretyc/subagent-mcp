<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## context-metering.md : Provider-Metered Context Tracking

This leaf specifies how hooks lift provider usage, resolve the context window,
persist the record, and drive the `normal` / `plan` / `handoff` phase model
used by sections-00-04.md, handoff.md, and derivation-map.md.

### 1. Core Principle : Lift, Never Tokenize

Hooks lift provider-reported usage numbers already computed by the harness and
written to its transcript or rollout file. Hooks never tokenize, estimate token
counts from raw text, or ask the model to self-report a percentage. A settings
hint reads a declared tier value. A ratchet compares provider-reported
prompt-side tokens to a candidate window. Neither path estimates usage.

If usage cannot be found, the result is `null`. If usage exists but the
window is fully unknown, the resolver assumes `DEFAULT_CONTEXT_WINDOW`
(200000) with `window_source: "assumed-default"`. A larger observed floor
promotes that assumed window to the floor with
`window_source: "assumed-default+floor"`. Numeric utilization is always
computed when usage exists; `unknown` is retired to the dead-man fallback
where usage itself is unavailable.

### 2. Metering Record
```
{
  session_id: string,
  harness: "claude" | "codex",
  model: string,
  source_ref: string,
  context_window_size: number | null,
  window_source: "harness" | "mapping" | "hint" | "ratchet" | "prior" | "family-default" | "contradiction" | "assumed-default" | "assumed-default+floor" | null,
  window_floor: number | null,
  usage: { input: number, output: number, cache_creation: number, cache_read: number },
  used_tokens: number | null,
  used_percentage: number | null,
  near_limit: boolean,
  event: string,
  updated_at: number
}
```

`used_tokens` is the usage-field sum, or `null` when usage is absent.
`prompt_side_tokens` is non-persisted input + cache creation + cache read;
output is excluded because a completion can exceed a window after prompt fit.

`context_window_size: null` is valid only when usage is absent. Unknown
models, corrupt mapping data, and unsupported harness ids use the assumed
default ladder above. Contradictions resolve to the model's top known tier
and clamp percentage at 100%.

### 3. Phase Computation
Given `used_percentage`: `null` maps to `normal`, `>= 40` maps to
`handoff`, `>= 15` maps to `plan`, and all lower numeric values map to
`normal`.

`near_limit` is true only when `used_percentage !== null && used_percentage >= 50`.
`used_percentage === null` still maps to
`phase = "normal"`; the metering-undetectable fail-safe is separate
enforcement and forces orchestration ON.

### 4. Window Resolution Ladder

The resolver normalizes model ids by trimming, lowercasing, detecting and
stripping `[1m]` or trailing `-1m`, and stripping one trailing dated suffix
`-(20YYYYMMDD style)`, implemented as `-(20\d{6})`. The stripped marker is a
long-tier hint. Mapping data loads from `src/context-windows.json` in source
and `dist/context-windows.json` in builds. Missing, unreadable, or invalid
mapping data resolves every lookup to `null`.

Claude ladder:
1. A fresh statusline side-channel record supplies `harnessPercentage`, and
   when present `harnessContextWindow`; see statusline-signal.md. The
   percentage wins in `computeUsedPercentage` and is clamped to `[0,100]`.
   The window source is `harness`, ranked before every fallback below.
2. Exact mapping hit supplies `default` and optional `long` tier.
3. Unknown ids matching `/^claude-/i` use the shipped family default
   `{ default: 200000, long: 1000000 }` with
   `window_source: "family-default"`.
4. Non-Claude ids use the assumed default ladder.
5. The in-id marker or settings hint upgrades `default` to `long` only when
   the entry or family default has a non-null long tier. Transcript
   `message.model` is not expected to carry `[1m]`; logic keyed solely on
   transcript markers is defective.
6. Prompt-side ratchet upgrades to `long` when `prompt_side_tokens` exceeds
   the candidate and fits the long tier.
7. A prior session floor can keep the window high only when the prior source
   was `ratchet` or `prior`. Hint-derived windows must re-derive every turn.
8. If prompt-side tokens or a source-gated prior floor exceed the top tier,
   the result uses the model's top known tier with
   `window_source: "contradiction"` and later clamps utilization to 100%.

Codex ladder:
1. `token_count.info.model_context_window` plus
   `last_token_usage.total_tokens` is authoritative for current context
   occupancy when present. `total_token_usage` is cumulative accounting data;
   use it only as a guarded fallback when no last-turn usage exists.
2. Static fallback uses exact entries from `context-windows.json`. Values are
   effective usable windows, not raw catalog maxima.
3. The in-id marker upgrades to `long` only when the mapping entry has a
   non-null long tier.
4. Prompt-side ratchet, source-gated prior floor, and contradiction behavior
   match Claude.
5. Unknown Codex ids have no family default and use the assumed default
   ladder.

`computeUsedPercentage` clamps a computed percentage after the resolver
selects a numeric window. Contradictions are represented by the top known
tier and therefore honestly render as 100% when usage exceeds that tier.

### 5. Mapping File And Profiler Linkage

`src/context-windows.json` is the source of truth for model windows. The
published package copies it to `dist/context-windows.json`; the build hard
fails if the source file is absent. The table contains:

- `schema_version: 1`.
- `family_defaults.claude` for unknown `claude-*` ids.
- `claude` entries with `default` and nullable `long`.
- `codex` entries with effective fallback `default` and nullable `long`.

`scripts/validate_context_windows.mjs` validates shape, normalized keys, and
window ordering. Each model-profiler run refreshes or validates family-default
context windows because `scripts/build_routing_table.mjs` invokes it after
emitting routing artifacts. Routing remains owned by
`src/routing-table.json`; context-window coverage remains owned by
`src/context-windows.json`.

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
