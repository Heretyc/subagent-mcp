<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## context-metering.md : Provider-Metered Context Tracking

This leaf is the full normative spec for context metering: how hook code
learns how much of a session's context window is used, how that number is
persisted, and how it drives the phase model (`normal` / `plan` / `handoff`)
consumed elsewhere in this architecture (sections-00-04.md section 4,
handoff.md, derivation-map.md R-START-OFF / R-LATCH-15 / R-HANDOFF-50).

### 1. Core principle : lift, never tokenize

Hooks LIFT provider-reported usage numbers that the harness already computed
and already wrote to its own transcript/rollout file. Hooks never run a
tokenizer, never estimate token counts from raw text, and never ask the
model to self-report a percentage. If no provider-reported number can be
found for a given turn, the result is `null` (undetectable), not a guess.
This is a hard rule : any code path that introduces token-counting (tiktoken
or otherwise) to fabricate a number is a bug, not an enhancement.

### 2. Metering record (state shape, copied verbatim from the plan's Section 0)

```
{
  session_id: string,
  harness: "claude" | "codex",
  model: string,
  source_ref: string,            // transcript_path (Claude) or rollout path (Codex)
  context_window_size: number | null,
  usage: { input: number, output: number, cache_creation: number, cache_read: number },
  used_tokens: number | null,    // sum of usage fields, or null if undetectable
  used_percentage: number | null,// harness-reported percentage preferred, else computed
  near_limit: boolean,
  event: string,                 // hook event name that produced this record
  updated_at: number             // epoch ms
}
```

`used_tokens` is the sum of the four `usage` fields, or `null` if usage is
entirely absent for the turn. `used_percentage` prefers a harness-reported
percentage when the adapter supplies one; otherwise it is computed as
`used_tokens / context_window_size * 100`, clamped to 100, or `null` if
either operand is `null`. `near_limit` is `used_percentage !== null &&
used_percentage >= 50` (HANDOFF_UNLOCK_THRESHOLD_PCT).

### 3. Phase computation

Given `used_percentage` (0-100, or `null` if undetectable):

```
phase = used_percentage === null ? "normal"
      : used_percentage >= 50 ? "handoff"    // HANDOFF_UNLOCK_THRESHOLD_PCT
      : used_percentage >= 15 ? "plan"       // PLAN_LATCH_THRESHOLD_PCT
      : "normal"
```

`used_percentage === null` still resolves to `phase = "normal"`; the
metering-undetectable fail-safe forces orchestration ON regardless of phase,
but phase itself only ever reflects measured metering, never enforcement
state. 15 and 50 are hardcoded named constants (`PLAN_LATCH_THRESHOLD_PCT`,
`HANDOFF_UNLOCK_THRESHOLD_PCT`); they are not configurable.

### 4. resolveContextWindow algorithm (copied verbatim from Section 0)

```
resolveContextWindow(harness, modelId):
  if not modelId: return null                                   // undetectable
  if harness === "claude":
    if not /^claude-/i.test(modelId): return null                // unrecognized family
    if /\[1m\]/i.test(modelId): return 1000000                   // LONG_CONTEXT_WINDOW
    return 200000                                                 // DEFAULT_CONTEXT_WINDOW
  if harness === "codex":
    if modelId not in CODEX_KNOWN_MODEL_IDS: return null
    if /-1m\b|\[1m\]/i.test(modelId): return 1000000              // LONG_CONTEXT_WINDOW
    return 200000                                                 // DEFAULT_CONTEXT_WINDOW
  return null
```

`CODEX_KNOWN_MODEL_IDS` is a DECISION DEFAULT, defined here as the single
source of truth that the code in `src/orchestration/metering.ts` must match
literally, character for character:

```
CODEX_KNOWN_MODEL_IDS = ["gpt-5", "gpt-5-codex", "gpt-5.5", "o3", "o3-mini", "o4-mini"]
```

This list is extendable over time; any model id not in it falls through to
`resolveContextWindow` returning `null` (undetectable), which in turn forces
the metering-undetectable fail-safe. If this array is ever edited in code,
this leaf must be re-edited to match, and vice versa, so doc and code never
drift out of lockstep.

### 5. Claude usage-lift mechanics

The Claude adapter piggybacks on the existing `UserPromptSubmit` hook event
(no new hook registration). On each invocation it tails the session
transcript file (bounded read, reusing the existing capped tail-read helper)
looking from the end for the LAST JSONL line whose `type === "assistant"`
and whose `message.usage` object is present. From that line it reads:

- `usage.input = message.usage.input_tokens`
- `usage.output = message.usage.output_tokens`
- `usage.cache_creation = message.usage.cache_creation_input_tokens`
- `usage.cache_read = message.usage.cache_read_input_tokens`
- `model = message.model`

Because `UserPromptSubmit` fires before the current turn's assistant message
exists, the usage lifted on turn N always reflects the LAST COMPLETED
assistant turn, i.e. turn N-1. This one-turn lag is accepted and documented
here as expected behavior, not a bug : metering is always at most one turn
behind. On turn 1 there is no prior assistant usage to lift; the lift is
skipped and no fail-safe is triggered purely because of that absence.

### 6. Codex usage-lift mechanics

The Codex adapter reads the rollout JSONL file (the same file the existing
turn-counting logic already reads), tailing from the end for the LAST line
carrying a `token_count` field, with a nested `info.total_token_usage`
object providing `input_tokens`, `output_tokens`, and `cached_input_tokens`
(Codex's cache-read equivalent; Codex has no separate cache-creation
concept, so `cache_creation` is always recorded as `0`). The model id is
read from the most recent `turn_context` line's `model` field.

Codex may additionally report a `model_context_window` value alongside the
token counts on that same line. When present, this is a genuine
harness-reported context window, and the harness-reported percentage
(`total_tokens / model_context_window * 100`) is preferred over the static
`resolveContextWindow` map for that turn, per the general rule that a
harness-reported percentage always wins over a computed one. When absent,
`resolveContextWindow(harness, modelId)` supplies the window via the
`CODEX_KNOWN_MODEL_IDS` map above.

### 7. State-dir path scheme

All metering state lives under the EXISTING state directory
`join(os.tmpdir(), "subagent-mcp")` (`stateDir` in `marker.ts`), directory
mode `0o700`, file mode `0o600`, written via the EXISTING `atomicWriteJson`
helper from `atomic-write.ts`. No new state directory is introduced.

```
metering record : ctx-<hashKey(sessionKey)>.json
```

`hashKey` is the EXISTING function in `marker.ts`, reused unchanged.

### 8. TTL cleanup

Metering records are garbage-collected using the same lazy-GC pattern the
existing marker code already uses for disable records : on read, if
`Date.now() - record.updated_at > ORCH_DISABLE_TTL_MS` (2 hours, the
EXISTING constant, unchanged), the file is unlinked and the read returns
`null`. Stale metering is treated as strictly worse than no metering, since
an old percentage could understate current usage and suppress a latch or
handoff that should have fired.

### 9. Hooks WRITE, MCP READS : no public usage tool

Metering data flows in exactly one direction. Hook code (Claude and Codex
adapters, via `hook-core.ts`) is the ONLY writer of metering records. The
metering record is read back by two internal consumers only:

1. `hook-core.ts`'s own tag composition, to compute `phase` and
   `utilization` for the injected `<subagent-mcp>` tag and footer.
2. The handoff gating logic (handoff.md), to decide whether
   handoff-write is unlocked (>=50% with readable metering).

No MCP tool exposes metering data directly to the model or the user. There
is no "get context usage" tool and none should be added; the only surfaces
by which a used-percentage figure becomes visible are the hook-injected tag
(`utilization="NN%"` or `"unknown"`) and the footer
(`Remaining Context=NN%`), both of which are internal to the hook injection
pipeline described in template.ts / hook-core.ts.

### 10. Off-by-one / one-turn-lag caveat, accepted

Both adapters lift usage that describes the PRIOR completed turn, never the
turn currently in progress (see sections 5 and 6 above). This means the
`used_percentage` seen on a given turn's injected tag can undercount actual
current usage by roughly one turn's worth of tokens. This is a deliberate,
accepted tradeoff, not a defect to fix : provider-reported usage is only
ever available after a turn completes, so any same-turn number would have
to be estimated, which section 1 forbids. Downstream consumers (latch,
handoff gating) must not assume `used_percentage` is exactly current; they
treat crossing a threshold on a one-turn-lagged reading as sufficient to
trip, since the lag only delays detection by a single turn, never prevents
it.
