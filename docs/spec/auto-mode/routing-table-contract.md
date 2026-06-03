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
- Cache the parsed table in module memory after first successful load. The
  server is long-lived; a re-read per launch is unnecessary. (A missing table
  stays missing for the process lifetime — acceptable; document that a profiler
  run requires a server restart to pick up a newly-emitted table.)

## Branch consumed

Only `performance`. Read `performance.<task_category>` — it IS the pairings
array directly (no `.pairings` wrapper). This matches the emitted/validated
runtime artifact: `scripts/validate_provider.mjs` (`validateCategoryEntries`)
requires `performance[<category>]` to be an Array of pairing objects, and
`provider-json-emission.md` states "Each category value is an array of pairing
objects". The `cost_efficiency` branch is ignored by this feature (future work,
`param-contract.md §Out of scope`).

## Pairing object schema (authoritative source)

Each element of the `performance.<task_category>` array conforms to
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

Launch enum: `["low","medium","high","xhigh","max","ultracode"]`. Normalize the
pairing's `effort` before passing to `buildCommand`:

1. If the tier is already a launch-enum value, pass it through, THEN apply the
   model-specific clamps below.
2. `none` (haiku has no effort) → for `haiku`, effort is ignored by
   `buildCommand`; pass `high` as a placeholder (it is dropped) and report the
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

From the `performance.<task_category>` array, sorted by `rank` asc:

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

For each candidate in order (best→worst):

1. Normalize to `{provider, launchModel, launchEffort}` (skip on unknown
   model/effort).
2. Reuse the EXISTING launch path from `src/index.ts` unchanged:
   `buildCommand(provider, launchModel, launchEffort, prompt, cwd)` →
   `resolveExe(provider)` → `spawn(...)`, plus the concurrency-cap check
   (`countRunning` vs `MAX_CLAUDE`/`MAX_CODEX`).
3. **"Fails for any reason" = LAUNCH-TIME failure**, specifically:
   - concurrency limit for that provider already reached;
   - `buildCommand`/`resolveEffort` throws;
   - `resolveExe` returns a path that does not exist / `spawn` throws (missing
     exe, ENOENT, EACCES, etc.);
   - any exception before the child is registered.
   On ANY of these → record `{model,effort,provider,reason}`, SILENTLY advance
   to the next candidate. Do not surface intermediate failures to the caller.
4. On the FIRST successful spawn: register the agent exactly as today (same
   `AgentState`, stdout/stderr handlers, close handler, `agents.set`), and
   return the success payload (`param-contract.md`) including
   `candidates_skipped` = number of prior failures.

CRITICAL — launch-time only: `launch_agent` returns immediately after a
successful `spawn`; it does NOT await the sub-agent's task. The agent's eventual
success/failure (exit code, `turn.completed`, a wrong answer) is observed later
via `poll_agent`/`wait` and is NEVER a fallback trigger. The fallback chain is
strictly over the act of starting a process.

If ALL candidates fail → `ERR_ALL_FAILED` listing each
`<model>@<effort> (<provider>): <reason>` (`resolution-matrix.md`).

`explicit` mode: one attempt; on failure → `ERR_EXPLICIT_FAILED` (no loop).

## Empty / missing table behavior (summary)

| Condition | auto/provider/provider_model | explicit |
|---|---|---|
| `dist/routing-table.json` missing/unreadable | `ERR_TABLE_MISSING` | works (table not read) |
| category has zero pairings | `ERR_NO_CANDIDATES` (`<scope>`=empty) | works |
| constraint matches no pairing | `ERR_NO_CANDIDATES` (`<scope>`=provider/model) | n/a |

Explicit, fully-specified launches MUST keep working with no table present —
they never read it.
