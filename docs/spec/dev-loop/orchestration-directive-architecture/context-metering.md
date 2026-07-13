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

If usage or a resolvable window cannot be found, the result is `null`.
Undetectable metering fails safe to orchestration ON.

### 2. Metering Record

```
{
  session_id: string,
  harness: "claude" | "codex",
  model: string,
  source_ref: string,
  context_window_size: number | null,
  window_source: "mapping" | "hint" | "ratchet" | "prior" | "family-default" | "contradiction" | null,
  window_floor: number | null,
  usage: { input: number, output: number, cache_creation: number, cache_read: number },
  used_tokens: number | null,
  used_percentage: number | null,
  near_limit: boolean,
  event: string,
  updated_at: number
}
```

`used_tokens` is the sum of the usage fields, or `null` when usage is absent.
`prompt_side_tokens` is the non-persisted resolver input
`input + cache_creation + cache_read`; output is excluded because a completion
can push total used tokens over a real window even when the prompt fit.

`context_window_size: null` with non-null usage is valid for unknown models,
corrupt mapping data, or contradictions. Such records are still written.

### 3. Phase Computation

Given `used_percentage`:

```
phase = used_percentage === null ? "normal"
      : used_percentage >= 50 ? "handoff"
      : used_percentage >= 15 ? "plan"
      : "normal"
```

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

1. A harness-reported percentage, if Claude ever supplies one, wins in
   `computeUsedPercentage` and is clamped to `[0,100]`.
2. Exact mapping hit supplies `default` and optional `long` tier.
3. Unknown ids matching `/^claude-/i` use the shipped family default
   `{ default: 200000, long: 1000000 }` with
   `window_source: "family-default"`.
4. Non-Claude ids resolve `null`.
5. The in-id marker or settings hint upgrades `default` to `long` only when
   the entry or family default has a non-null long tier. Transcript
   `message.model` is not expected to carry `[1m]`; logic keyed solely on
   transcript markers is defective.
6. Prompt-side ratchet upgrades to `long` when `prompt_side_tokens` exceeds
   the candidate and fits the long tier.
7. A prior session floor can keep the window high only when the prior source
   was `ratchet` or `prior`. Hint-derived windows must re-derive every turn.
8. If prompt-side tokens or a source-gated prior floor exceed the top tier,
   the result is `null` with `window_source: "contradiction"`.

Codex ladder:

1. `token_count.info.model_context_window` plus
   `total_token_usage.total_tokens` is authoritative and provides a
   harness-reported percentage for that turn. It has primacy over the mapping.
2. Static fallback uses exact entries from `context-windows.json`. Values are
   effective usable windows, not raw catalog maxima.
3. The in-id marker upgrades to `long` only when the mapping entry has a
   non-null long tier.
4. Prompt-side ratchet, source-gated prior floor, contradiction, and `null`
   behavior match Claude.
5. Unknown Codex ids have no family default and resolve `null`.

`computeUsedPercentage` clamps a computed percentage only after the resolver
has ruled out contradictions. Therefore a fabricated `100%` or
`0% remaining` from an impossible window is forbidden. Contradictions render
as unknown and fail safe ON.

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
sub-agent contexts and may carry a different model or window. From the selected
line it reads:

- `usage.input = message.usage.input_tokens`
- `usage.output = message.usage.output_tokens`
- `usage.cache_creation = message.usage.cache_creation_input_tokens`
- `usage.cache_read = message.usage.cache_read_input_tokens`
- `model = message.model`

The adapter also reads a Claude long-context tier hint from, in order:
`ANTHROPIC_MODEL`, `<cwd>/.claude/settings.local.json`,
`<cwd>/.claude/settings.json`, then
`${CLAUDE_CONFIG_DIR || ~/.claude}/settings.json`. The first defined string
`model` value decides. The hint is tier evidence only, not model identity.
Every read or parse failure returns no hint and never throws.

Because `UserPromptSubmit` fires before the current assistant response exists,
Claude metering describes the last completed assistant turn. Turn 1 has no
prior assistant usage and is not treated as an error.

### 7. Codex Usage Lift

The Codex adapter tails the rollout JSONL file for the newest `token_count`
line with `info.total_token_usage`, and reads the model from the newest
`turn_context.model`. Codex supplies `input_tokens`, `output_tokens`, and
`cached_input_tokens`; `input_tokens` includes cached input. The adapter stores
`usage.input = max(0, input_tokens - cached_input_tokens)`,
`usage.output = output_tokens`, `usage.cache_creation = 0`, and
`usage.cache_read = cached_input_tokens`, so `used_tokens` matches
`total_tokens` instead of double-counting cache.

When `model_context_window` is present on the token-count line, the adapter
computes the harness percentage from `total_tokens / model_context_window`.
That percentage takes precedence over any static mapping window.

### 8. State And Latch Migration

Metering records live under `join(os.tmpdir(), "subagent-mcp")` as
`ctx-<hashKey(sessionKey)>.json`, written through `atomicWriteJson`. Reads use
the existing 2 hour `ORCH_DISABLE_TTL_MS` lazy-GC horizon. Stale metering is
strictly worse than no metering because it can understate current usage.

Plan latches use `LATCH_REV = 2`. Latch records without the current `rev` are
treated inactive and best-effort unlinked on read. This lazily invalidates
bug-era latches produced by the old 200k assumption. Latches are derived
state: if corrected metering still justifies a latch, the hook re-trips it in
the same invocation.

### 9. Display And Consumers

Hook code is the only writer of metering records. Internal consumers are
hook-core tag/footer composition and handoff gating. No MCP tool exposes raw
metering data.

Visible injection surfaces are limited to the tag utilization attribute and
the footer. Known percentages render as `utilization="NN%"` plus
`Remaining Context=NN%`. Unknown percentages render as
`utilization="unknown"` and suppress the footer. `Remaining Context=0%` is
allowed only when a resolved window or harness percentage honestly reaches the
clamp.

### 10. One-Turn Lag

Both adapters lift usage for the prior completed turn. Same-turn usage would
require estimation, which section 1 forbids. Threshold consumers treat a
one-turn-lagged crossing as sufficient to trip; the lag can delay detection by
one turn, but does not fabricate a percentage.
