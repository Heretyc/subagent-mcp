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
  sample_seq: number,
  sample_kind: "current" | "cumulative",
  compaction_generation?: string | null,
  sub_agent: boolean,
  event: string,
  updated_at: number
}
```

`compaction_generation` persists the last-observed structural compaction proof
used by handoff.md Compaction Detection. For Claude, only the newest main-chain
system `compact_boundary` is considered; that exact boundary must be auto-
triggered and carry a canonical top-level UUID, so a newer manual or invalid
boundary masks older valid auto boundaries. For Codex, proof is the latest
compacted `window_id` / `window_number`. The field is optional; an absent or
`null` value means that sample carries no structural compaction proof. It reuses
this existing record; no new config key, state file, or dependency is added.

`sample_seq` is the monotonic per-session sample counter and must advance by
exactly one for adjacent-pair detection. `sample_kind` distinguishes current
per-turn usage from cumulative accounting; only `"current"` pairs qualify.
`sub_agent` is `true` for sub-agent samples, which never qualify for compaction
detection.

`used_tokens` is the usage-field sum, or `null` when usage is absent.
`prompt_side_tokens` is non-persisted input + cache creation + cache read;
output is excluded because a completion can exceed a window after prompt fit.

`context_window_size: null` is valid only when usage is absent. Unknown
models, corrupt mapping data, and unsupported harness ids use the assumed
default ladder above. Contradictions resolve to the model's top known tier
and clamp percentage at 100%.

### 3. Phase Computation

Three fixed constants drive phase and mandatory-lifecycle derivation:

| Constant | Value | Role |
|---|---|---|
| `PLAN_LATCH_THRESHOLD_PCT` | 15 | Triggers the 15% orchestration latch. |
| `HANDOFF_UNLOCK_THRESHOLD_PCT` | 20 | Unlocks voluntary handoff-write for goal-context capture. |
| `HANDOFF_REQUIRED_THRESHOLD_PCT` | 80 | Mandatory handoff write threshold (H = CODEX_AUTOCOMPACT_PCT - 10). |
| `CODEX_AUTOCOMPACT_PCT` | 90 | Fixed threshold value used by Codex metering and by setup when writing Claude Code `settings.json` `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "90"`. |
| `COMPACTION_DROP_THRESHOLD_PCT` | 10 | Minimum adjacent-sample percentage-point drop; necessary but not sufficient (a fresh structural compaction-generation proof is also required, see handoff.md) to classify a pair as auto-compaction. |

Given `used_percentage`: `null` maps to `normal`, `>= 20` maps to
`handoff`, `>= 15` maps to `plan`, and all lower numeric values map to
`normal`. All phase constants are FIXED and never user-configurable.

`write_required` is a **derived** condition, not a stored phase: it is true
when `used_percentage >= HANDOFF_REQUIRED_THRESHOLD_PCT` (80%) AND no eligible
prepared handoff record exists for the current session. Mandatory lifecycle
injection fires when `write_required` is true; it is directive-only with no
tool gate, and fires regardless of the `contextCoaching` setting.

`used_percentage === null` still maps to `phase = "normal"`; the
metering-undetectable fail-safe is separate enforcement and forces orchestration ON.

### 3.1 contextCoaching Setting

`contextCoaching` (default `true`) is a USER-LEVEL ONLY setting in
`~/.subagent-mcp/settings.json` / `settings.local.json`. A missing key silently
resolves to `true`. `contextCoaching: false` does NOT affect phase computation,
the 15% latch, the 20% handoff-write unlock, the 80% mandatory handoff
directive, or compaction-detection lifecycle injections. Mandatory lifecycle
injections fire regardless of this setting (coaching-off isolation).

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

Usage lift (Claude and Codex adapters), state and latch migration, display
consumers, and one-turn lag: [context-metering-usage-lift.md](context-metering-usage-lift.md).
