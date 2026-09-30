# Routing-Table Loader and Resolver Contract

Normative. Defines how `src/routing.ts` loads the table, builds the candidate
list, normalizes effort, and runs the attempt loop with silent fallback.

## Load path

- Runtime reads `dist/routing-table.json`, resolved relative to the running
  module (`new URL("./routing-table.json", import.meta.url)`), matching how
  `scripts/copy-provider.mjs` copies `src/routing-table.json` →
  `dist/routing-table.json` at build.
- The source `src/routing-table.json` is emitted by the model-profiler run and
  is a required build input. `scripts/copy-provider.mjs` hard-fails the build
  when it is absent, so packaged builds must include `dist/routing-table.json`.
- Loading: read + `JSON.parse` inside try/catch. On ENOENT, parse error, or any
  read failure → treat as "table missing" → `ERR_TABLE_MISSING`
  (`resolution-matrix.md`). Never throw uncaught; never crash the server.
- Fresh read per launch (no process-lifetime cache): re-read + `JSON.parse`
  `dist/routing-table.json` on every launch. The file is tiny and launches are
  infrequent, so a freshly-emitted table needs no restart : a profiler run that
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

- `deadlock=true` arms it (counter = 3) : ONLY after full validation passes
  (`resolution-matrix.md` step 7); a rejected call never arms.
- `deadlock=true` while armed RE-ARMS to 3 (not additive).
- `deadlock=false` is identical to omitting it: neither arms nor disarms.
- Cannot be cancelled; survives until consumed to 0 (or process exit).

A PURE-AUTO launch reads `performance.<task_category>` when counter > 0, else
`cost_efficiency.<task_category>`. The counter decrements by 1 ONLY on a
SUCCESSFUL pure-auto launch that read `performance`. The `deadlock=true` call is
itself pure-auto, routes `performance`, and consumes 1 of 3 on its own success :
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
pure-auto launch in the same process : including unrelated tasks from other
callers; no task affinity, no cancellation. Under concurrency the 3 `performance`
launches are not guaranteed to be the arming caller's own.

No cross-branch fallback: if the selected branch's `<task_category>` is
empty/missing → `ERR_NO_CANDIDATES`; the resolver does NOT retry the other branch
in EITHER direction.

### Swarm pin (in-memory, per-process)

A timestamp-based window inside the swarm session object (created by `createSwarmSession()` from
`src/swarm.ts`). Scoped to the server PROCESS, shared across all concurrent callers (same
shared-scope caveat as the deadlock window). Not persisted; a restart resets it.

- **ARM:** `swarm(null)` (idle start) sets `pinExpiresAt = now + SWARM_PIN_WINDOW_MS` (1h).
- **RESTART (replace expiry):** accepted `swarm(1)`, `swarm(2)`, `swarm(3)` each REPLACE the
  expiry with `now + SWARM_PIN_WINDOW_MS`. A REPEATED call to an already-reported stage NEVER
  restarts the window; only an ACCEPTED FORWARD ADVANCE does. Out-of-order, already-active, idle,
  and invalid calls never touch the pin.
- **AUTO-OFF trigger 1 (handoff-next):** accepted `swarm(4)` sets `pinExpiresAt = null`
  immediately (stage 5 = handoff is now next). Force-cleared regardless of remaining time.
- **AUTO-OFF trigger 2 (1h lazy):** `pinActive(now)` is false once `now >= pinExpiresAt`. Strict
  boundary: active strictly BEFORE expiry. No background timers; same lazy pattern as
  `src/orchestration/model-mode.ts`.
- **Pure-auto-only:** `resolveBranch(pureAuto, deadlockActive, pinActive)` in `src/swarm.ts`
  puts the pin inside the `pureAuto` guard. `provider`/`provider_model` launches ALWAYS read
  `cost_efficiency` regardless of pin state. Swarm coaching mandates pure-auto (no
  provider/model/effort), so all swarm-session launches route `performance` while pinned.
- **slotInsert exclusion:** `slotInsert` is keyed on `branch === "cost_efficiency" &&
  !subOrchestrator`, so pinned auto launches AND sub-orchestrator launches both lose API slots.
- **consume() interplay:** `deadlockWindow.consume()` at line 1626-1628 fires when
  `branch === "performance"`. It is a no-op when the deadlock counter is 0, and sub-orchestrator
  launches that reach `performance` via the swarm pin are not deadlock-triggered and never
  consumed by the deadlock counter.
- **Sub-orchestrator launches:** sub-orchestrator=true launches exclude `slotInsert` (the
  `!subOrchestrator` gate). They still read the branch selected by `resolveBranch`. Full contract:
  `docs/spec/swarm/_INDEX.md`.

Shared-process caveat (stated honestly): the pin is per-PROCESS, not per-task or per-caller. A
window armed by a swarm in one task is consumed by ANY concurrent pure-auto launch in the same
process. Under concurrency, performance launches are not guaranteed to be the swarm's own.

Anti-gaming note (condensed; full rationale in `docs/spec/swarm/_INDEX.md`): the pin is bounded
to 1 hour, armed only by a genuine swarm start, restarted ONLY by an accepted forward advance
into a pre-handoff stage, and force-cleared the moment handoff becomes the next stage. A repeated
call to an already-reported stage does NOT restart the window. There is no standalone lever,
flag, or parameter that selects the performance band; no swarm response or tool description ever
names it. Pinning exists only inside swarm pre-handoff stages and dies with them.

### Tool-surface opacity (INVARIANT)

Tool descriptions and error texts NEVER name tiers, branches, counters, or windows. The only
agent-visible deadlock metadata strings are the verbatim `DEADLOCK RULE:` tool-description line
and the `deadlock` param MANDATE gloss (`tool-description.md`). The swarm tool description and
coaching text NEVER name the performance band, routing tier, pin, or window. One additional
agent-visible runtime error string exists for `deadlock=true` combined with provider/model/effort;
it is error text, not metadata, and must use attempts+task-identity/drop-overrides vocabulary.
Sanctioned diagnostic exposures (payload fields, never description/error text) are exactly:
`routing_tier` (poll), `ruleset_applied`, `ruleset_original_selection`, `failover_occurred`,
`failover_from`, `failover_note` (`../advanced-ruleset/visibility-and-failover.md`), and
`get_status.swarm.*` (the five swarm snapshot fields: `active`, `current_stage`, `stage_name`,
`pin_active`, `pin_expires_at`). The `get_status.swarm` fields expose the pin state for
observability (smoke tests, ops) without naming the branch or window in any tool description.

## Pairing object schema (authoritative source)

Each element of the selected branch's `<task_category>` array conforms to
`skills/model-profiler/references/provider-json-emission.md` (the authoritative
contract). The shipped `src/routing-table.json` contains only launchable model
ids; benchmarked but non-launchable ids stay in `src/routing-table-audit.json`
and are projected out by shared validator helper
`scripts/lib/launchable-models.mjs`. The fields THIS resolver consumes:

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

## Cross-category inference provenance (audit)

The resolver consumes only `rank`. The fields below shape how the profiler and
`scripts/validate_routing_audit.mjs` record score provenance; they are
audit-visible in `src/routing-table-audit.json`, not resolver inputs.

Most pairings carry a directly measured capability score for their category. A
directly benchmarked parent category can, in a given run, have no admissible
comparative evidence. When that happens the profiler MAY opt in to
cross-category inference: it fills only the null cells of that one target
category from sibling categories so the category stays rankable instead of
dropping out. This is a profiler composition step, distinct from the
composite-inferred tiles (`../task-taxonomy/composite-inferred-tiles.md`, always
inferred by construction) and from same-model effort interpolation and version
promotion. All of these remain separate provenance kinds and are never collapsed
into one "inferred" tag.

Invariants the audit enforces when cross-category inference is present:

- Frozen direct snapshot. Inference reads a direct capability snapshot taken
  before any fill. A proxy output, and any composite descendant, is never a
  parent input: no recursion.
- Exact pairing join. A fill joins only the same model at the same effort. No
  second effort interpolation, no version promotion, and no downward effort copy
  is applied to the synthesized cell.
- Equal-weight mean of available parents. The synthesized value is the equal
  mean of the available parent capability composites for that exact pairing.
  Availability is `score !== null`: a finite `0` is valid low evidence and
  counts; a `null` parent contributes no value and is not backfilled. If every
  parent is null the cell stays the null sentinel, never a synthetic `0`.
- Direct wins. Only null direct cells are filled; a real direct score is never
  overwritten.
- Cost once. Cost is excluded from the synthesis; parents are pre-cost
  capability composites, and cost enters exactly once downstream through the
  existing branch scorer.
- `inferred_low` provenance. Every synthesized cell is labeled `inferred_low`
  (uncalibrated) and its basis carries `[INFERRED]`; the audit rejects any such
  row that claims `confidence: "measured"`. Per pairing it records method,
  formula id, parent set, `coverage_weight`, source and missing categories, and
  per-parent id, score, and status.
- Separate coverage states. Measured coverage counts direct admissible evidence
  only; inferred (cross-category) pairings are counted apart. A category state is
  `measured`, `mixed`, `inferred`, or `DATA_MISSING`. Inferred coverage can make
  a category rankable but never raises a measured ratio or satisfies a measured
  evidence floor. A composite inherits an `inferred_parent` marker when any
  contributing parent is inferred.
- Fixed set preserved. The 14 categories, `fallback_default` at precedence 99,
  and the composite parent map are unchanged. `fallback_default` keeps its
  existing sentinel algorithm and is not part of proxy synthesis.
- Disconnected comparison components. Where a category's evidence comes from
  scaffolds with no measured bridge between them, ordering holds only within a
  component. There is no measured cross-scaffold scalar; the between-component
  order is nonsemantic, is not counted as measured discrimination, and is never
  created by cost.

A single dataset opt-in (`dataset.proxy_synthesis.enabled`) governs synthesis
(issue #325): with it off no category synthesizes and the coverage gate is
unchanged; with it on all eight declared targets synthesize: `security_review`,
`quality_review`, `architecture`, `data_analysis`, `coding`,
`knowledge_synthesis`, `mechanical`, and `debugging`. There is no per-target
opt-in. `coding` fills null cells from the equal mean of its available original
direct parents `debugging` + `agentic_execution`; when `debugging` carries no
admissible direct signal for a pairing (its frozen snapshot is null) the
available mean is `agentic_execution` alone. It never uses `debugging`'s own
proxy fill, since parents are read from the frozen pre-fill snapshot (no
proxy-to-proxy). `debugging` fills its own null cells from `agentic_execution`;
its lone thin direct cell is a non-discriminating neutral, excluded as a proxy
parent, and `debugging` as a parent of `security_review`/`quality_review`/
`coding` is still read at its original direct value so its fill never propagates
upstream. Under the opt-in, cross-model version-promotion (SOP-1) is disabled
before base and proxy composition, so proxy anchors rest only on same-model
measured or upward-effort-interpolated values; no unsupported cross-model
capability copy enters the direct snapshot.

Coverage gate. The default (no opt-in, or opt-in without owner authorization)
gate is measured-only: a run blocks when any category is `DATA_MISSING` or the
overall measured pairing ratio is below the 0.30 minimum. When the opt-in is on
AND the dataset carries an explicit
`dataset.proxy_synthesis.owner_authorized_inferred_ranking === true` record, a
distinct owner-authorized inferred-ranking gate applies: direct measured
coverage is still reported honestly (`thin_coverage`; never relabeled measured;
never satisfied by a `gap_stub_override`), but the run may proceed when the
signal coverage clears the SAME 0.30 minimum, with admissible direct measured
plus audited cross-category inferred counted apart, AND every required base
category carries a non-null direct-or-inferred signal. Inferred is never counted
as measured and the measured floor is not weakened; the unmeasured tail stays
honestly null. The audit records the gate's method, authorization, threshold,
and actual measured/inferred/signal ratios under
`metadata.cross_category_inference.coverage_gate`, and
`scripts/validate_routing_audit.mjs` rejects a missing authorization or any
mislabel (inferred-as-measured, gap-stub misuse, `signal < measured`, or a
`full` state that hides thin measured coverage).

## model → provider map and effort normalization

The `model` → provider map and the `effort` tier → launch-enum normalization
(with model-specific clamps) are extracted to the leaf
[routing-table-model-effort.md](routing-table-model-effort.md). The resolver
produces a `{ provider, launchModel, launchEffort }` triple per surviving
candidate; `buildCommand` + `resolveEffort` remain the final authority.

## Candidate-list construction (by mode)

From the selected branch's `<task_category>` array (per section Branch selection), sorted by `rank` asc:

- `auto`: all pairings.
- `provider`: pairings whose mapped provider == the supplied provider, followed
  by de-duplicated valid auto candidates for the category.
- `provider_model`: pairings whose `model` == the supplied model (mapped
  provider must also equal supplied provider; mismatch is impossible if the
  existing provider↔model check passed, but filter on model), truncated to the
  rank-1 match. This one candidate is pinned; no auto candidates are appended.
- `explicit`: build the user's `{provider, model, effort}` candidate. No
  de-duplicated auto candidates are appended; the fully-pinned triple is the
  sole candidate. Failure returns a loud error with no substitute.

Before the advanced ruleset runs, `slotInsert` augments only pure-auto
`cost_efficiency` routing with eligible `providers.jsonc` API slots. Pure-auto
`performance` and all manual/override modes exclude slot candidates. The
ruleset retains final authority over the actual candidate list.

If the list is empty in auto/provider/provider_model mode ->
`ERR_NO_CANDIDATES` with the matching `<scope>` (`resolution-matrix.md`).

Attempt loop, SILENT fallback, and empty-table behavior: [routing-attempt-loop.md](routing-attempt-loop.md).

