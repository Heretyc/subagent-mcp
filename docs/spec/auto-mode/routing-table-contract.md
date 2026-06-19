# Routing-Table Loader and Resolver Contract

Normative. Defines how `src/routing.ts` loads the table, builds the candidate
list, normalizes effort, and runs the attempt loop with silent fallback.

## Load path

- Runtime reads `dist/routing-table.json`, resolved relative to the running
  module (`new URL("./routing-table.json", import.meta.url)`), matching how
  `scripts/copy-provider.mjs` copies `src/routing-table.json` →
  `dist/routing-table.json` at build.
- The source `src/routing-table.json` is emitted by the model-profiler run and
  is ABSENT until then; the copy script already skips silently when absent
  (`scripts/copy-provider.mjs`). So `dist/routing-table.json` may not exist.
- Loading: read + `JSON.parse` inside try/catch. On ENOENT, parse error, or any
  read failure → treat as "table missing" → `ERR_TABLE_MISSING`
  (`resolution-matrix.md`). Never throw uncaught; never crash the server.
- Fresh read per launch (no process-lifetime cache): re-read + `JSON.parse`
  `dist/routing-table.json` on every launch. The file is tiny and launches are
  infrequent, so a freshly-emitted table needs no restart — a profiler run that
  writes the table AFTER server start is picked up on the next launch.

## Branch selection

The table holds two branches: `cost_efficiency` (canonical default) and
`performance`. Each branch's `<task_category>` value is a direct array of pairing
objects (no `.pairings` wrapper), per `provider-json-emission.md`. The resolver
reads exactly ONE branch per launch and NEVER merges or crosses over: every
table-backed launch reads `cost_efficiency.<task_category>` by default;
`performance` is reached ONLY by a PURE-AUTO launch (no provider/model/effort)
while a deadlock window is armed.

### Deadlock window (in-memory, per-process)

A single integer counter scoped to the server PROCESS and shared across all
concurrent callers. Starts at 0 (disarmed); not persisted; a restart resets it.

- `deadlock=true` arms it (counter = 3) — ONLY after full validation passes
  (`resolution-matrix.md` step 7); a rejected call never arms.
- `deadlock=true` while armed RE-ARMS to 3 (not additive).
- `deadlock=false` is identical to omitting it: neither arms nor disarms.
- Cannot be cancelled; survives until consumed to 0 (or process exit).

A PURE-AUTO launch reads `performance.<task_category>` when counter > 0, else
`cost_efficiency.<task_category>`. The counter decrements by 1 ONLY on a
SUCCESSFUL pure-auto launch that read `performance`. The `deadlock=true` call is
itself pure-auto, routes `performance`, and consumes 1 of 3 on its own success —
so one `deadlock=true` covers up to 3 successful pure-auto `performance` launches
(trigger + 2 followers), then pure-auto reverts to `cost_efficiency`.

NEVER decrement (window stays ARMED) on: validation errors; table errors
(`ERR_TABLE_MISSING`/`ERR_NO_CANDIDATES`); all-candidates-failed
(`ERR_ALL_FAILED`); or any override launch. `provider`/`provider_model` ALWAYS
read `cost_efficiency` (a window never diverts them) and never decrement;
`explicit` reads no branch. None of the three may pass `deadlock`
(→ `ERR_DEADLOCK_WITH_OVERRIDES`).

Shared-scope caveat (stated honestly): the counter is per-PROCESS, not per-task
or per-caller. A window armed for one atomic task is consumed by ANY concurrent
pure-auto launch in the same process — including unrelated tasks from other
callers; no task affinity, no cancellation. Under concurrency the 3 `performance`
launches are not guaranteed to be the arming caller's own.

No cross-branch fallback: if the selected branch's `<task_category>` is
empty/missing → `ERR_NO_CANDIDATES`; the resolver does NOT retry the other branch
in EITHER direction.

### Tool-surface opacity (INVARIANT)

Tool descriptions and error texts NEVER name tiers, branches, counters, or
windows. The only agent-visible deadlock metadata strings are the verbatim
`DEADLOCK RULE:` tool-description line and the `deadlock` param MANDATE gloss
(`tool-description.md`). One additional agent-visible runtime error string
exists for `deadlock=true` combined with provider/model/effort; it is error text,
not metadata, and must use attempts+task-identity/drop-overrides vocabulary.
Sanctioned diagnostic exposures (payload fields, never description/error text)
are exactly: `routing_tier` (poll), `ruleset_applied`,
`ruleset_original_selection`, `failover_occurred`, `failover_from`, and
`failover_note`
(`../advanced-ruleset/visibility-and-failover.md`).

## Pairing object schema (authoritative source)

Each element of the selected branch's `<task_category>` array conforms to
`skills/model-profiler/references/provider-json-emission.md` (the authoritative
contract). The fields THIS resolver consumes:

| Field | Use |
|---|---|
| `model` | Model id; mapped to provider + to the launch model enum (below). |
| `effort` | Table effort tier; normalized to the launch effort enum (below). |
| `rank` | Dense 1..N, monotonic by `score`. Candidate ordering key (ascending = best→worst). |

`score`, `cost_figure_used`, `basis`, `interpolated`, `confidence` are NOT
consumed by the resolver (they exist for the profiler/validator). The resolver
trusts `rank` for ordering and does not re-derive it from `score`.

Pairings within a category are ALREADY ordered best→worst by `rank` per the
emission contract; the resolver sorts by `rank` ascending defensively rather
than assuming array order.

## model → provider map

Derive provider from the pairing's `model`:

| `model` value(s) | provider |
|---|---|
| `haiku`, `sonnet`, `opus`, `opus-4-8` | `claude` |
| `gpt-5.5` (and any codex sibling id, e.g. `gpt-5.4-mini`, `gpt-5.5-pro`) | `codex` |

Rule: Claude model ids map to `claude`; any GPT/codex-family id maps to
`codex`. An unknown model id that maps to neither → skip that pairing (treat as
a launch-time failure for that candidate; advance). Note: the launch model enum
is currently `["haiku","sonnet","opus","opus-4-8","gpt-5.5"]`; if a future
pairing names a codex sibling not in that enum, it cannot be launched by the
current `buildCommand` and is skipped — flag for B2 as a known limitation, do
not silently coerce it to `gpt-5.5`.

## effort normalization (table tier → launch enum)

Launch enum: `["medium","high","xhigh","max","ultracode"]`. Normalize the
pairing's `effort` before passing to `buildCommand`:

1. If the tier is already a launch-enum value, pass it through, THEN apply the
   model-specific clamps below.
2. `none` (haiku has no effort) → for `haiku`, effort is ignored by
   `buildCommand`; pass `none` as a placeholder (it is dropped) and report the
   pairing tier `none`-equivalent as the launched effort label.
3. Model-specific clamps (mirror `src/effort.ts` so the resolver never feeds an
   invalid combo into `buildCommand`):
   - `ultracode` is valid ONLY on `opus`/`opus-4-8`. On any other model →
     clamp DOWN to `xhigh`.
   - codex (`gpt-5.5`) has no `max`/`ultracode`: `max` → `xhigh`;
     `ultracode` → `xhigh`.
   - haiku ignores effort entirely.
4. Unknown / unrecognized tier (not in the enum, not `none`) → skip this
   candidate (advance). Do NOT guess.

The resolver should produce a `{ provider, launchModel, launchEffort }` triple
per surviving candidate. `buildCommand` + `resolveEffort` remain the final
authority; if they still throw for an edge combo, the attempt loop treats it as
a launch failure and advances (auto/partial modes) — defense in depth.

## Candidate-list construction (by mode)

From the selected branch's `<task_category>` array (per §Branch selection), sorted by `rank` asc:

- `auto`: all pairings.
- `provider`: pairings whose mapped provider == the supplied provider.
- `provider_model`: pairings whose `model` == the supplied model (mapped
  provider must also equal supplied provider; mismatch is impossible if the
  existing provider↔model check passed, but filter on model).
- `explicit`: do NOT read the table for candidates. Build exactly ONE candidate
  from the user's `{provider, model, effort}` and attempt it directly, even if
  it is absent from the table (explicit user choice). No fallback.

After filtering, if the list is empty in auto/provider/provider_model mode →
`ERR_NO_CANDIDATES` with the matching `<scope>` (`resolution-matrix.md`).

## Attempt loop with SILENT fallback

This fallback loop applies to pure `auto` mode only. Override selector modes
(`provider`, `provider_model`, `explicit`) make one launch attempt; on failure
they stop and return the matching hard-fail shape with the auto-mode hint.

For each candidate in order (best→worst):

1. Normalize to `{provider, launchModel, launchEffort}` (skip on unknown
   model/effort).
2. Reuse the EXISTING launch path from `src/index.ts` unchanged:
   `buildCommand(provider, launchModel, launchEffort, prompt, cwd)` →
   `resolveExe(provider)` → `spawn(...)`, plus the concurrency-cap check
   (`countProcessing` vs `MAX_CLAUDE`/`MAX_CODEX`).
3. **"Fails for any reason" = LAUNCH-TIME failure**, specifically:
   - concurrency limit for that provider already reached;
   - `buildCommand`/`resolveEffort` throws;
   - `resolveExe` returns a path that does not exist / driver spawn throws
     (missing exe, ENOENT, EACCES, etc.);
   - provider driver startup rejects before the agent is registered.
   On ANY of these → classify the failure and record
   `{model,effort,provider,reason,failure_type}`, SILENTLY advance to the next
   candidate. Do not surface intermediate failures to the caller.
   - `failure_type` is `classifyFailureReason(reason, stderr)` →
     `"transient_provider"` (usage caps, quota 429, HTTP 5xx, network timeouts,
     connection resets — ETIMEDOUT/ECONNRESET) or `"permanent"` (everything
     else: ENOENT, EACCES, bad option, missing config). It is a label only;
     auto mode advances to the next candidate either way (same-call failover).
4. On the FIRST successful driver start: register the agent with `AgentState`,
   stdout/stderr handlers, close handler, and `agents.set`, then return the
   success payload (`param-contract.md`). If any candidate was skipped before
   this success, the payload additionally carries `failover_occurred: true`,
   `failover_from` (the skipped candidates), and `failover_note`
   (`param-contract.md`). This same-call failover is scoped to the single
   `launch_agent` call: `skipped[]` is local to the handler invocation — no
   persisted cooldown or cross-call state. After the agent is "definitely
   started", no further failover occurs (`../advanced-ruleset/visibility-and-failover.md`).

CRITICAL — launch-time only: a launch succeeds when the driver starts AND
survives the post-spawn grace window; ANY exit inside that window (any code or
signal) is a launch-time failure that silently advances the loop. Exceptions:
a provider driver already finalized by its turn-completion marker, or a driver
that crossed the `definitelyStarted` boundary
(`../advanced-ruleset/visibility-and-failover.md`).
`launch_agent` does NOT await the sub-agent's task: a later death is observed
via `poll_agent`/`wait` and is NEVER a fallback trigger.

If ALL candidates fail → `ERR_ALL_FAILED` listing each
`<model>@<effort> (<provider>) [<failure_type>]: <reason>` (`resolution-matrix.md`);
each numbered line now carries the `[transient_provider]`/`[permanent]` label.

Override selector modes: one attempt; on failure -> hard-fail (no loop).

## Empty / missing table behavior (summary)
| Condition | auto/provider/provider_model | explicit |
|---|---|---|
| `dist/routing-table.json` missing/unreadable | `ERR_TABLE_MISSING` | works; table not read |
| category has zero pairings | `ERR_NO_CANDIDATES` (`<scope>`=empty) | works |
| constraint matches no pairing | `ERR_NO_CANDIDATES` (`<scope>`=provider/model) | n/a |

