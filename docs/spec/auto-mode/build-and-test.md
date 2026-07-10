# Auto-Mode Build Track (B2) and Test Plan

Normative for the implementation track. Defines non-overlapping file ownership
and a fixture-based test plan that does NOT depend on the profiler output.

## B2 file partition (non-overlapping ownership)

Each file is owned by exactly one work-unit; no two units edit the same file.

| File | Ownership / change |
|---|---|
| `src/routing.ts` (NEW) | Loader + resolver: `loadRoutingTable()` (path, cache, missing→null), `buildCandidates(table, task_category, {provider,model,effort}) -> mode + ordered triples`, `mapModelToProvider()`, `normalizeEffort()`. Pure/injectable where possible (inject the table for tests). No spawning here. |
| `src/index.ts` | WIRING ONLY: new `task_category` enum param; remove `effort.default("high")`; make provider/model/effort optional; param-presence validation + exact error text (`resolution-matrix.md`); call `src/routing.ts` to get candidates; run the attempt loop reusing the EXISTING `buildCommand`/`resolveExe`/`spawn`/`agents.set` path; success payload superset; rewritten tool description + `task_category` gloss (`tool-description.md`). Do NOT change `effort.ts`/`platform.ts`. |
| `test/routing.test.mjs` (NEW) | Unit tests for `src/routing.ts` against the fixture (below). |
| `test/fixtures/routing-table.fixture.json` (NEW) | Hand-authored minimal table; profiler-independent. |
| `package.json` | Add `node test/routing.test.mjs` to the `test` script chain (after the existing entries, before `validate_provider.mjs`). No other change. |
| `README.md` / `docs/tools.md` / `docs/usage.md` | Document auto mode + `task_category`; link this spec dir. Markdown <=200 lines each. |
| `AGENTS.md` | Add the auto-mode load trigger (see `_INDEX.md`); keep <=100 lines. |

Build note: `src/routing.ts` compiles to `dist/routing.js`; no change to
`scripts/copy-provider.mjs` is needed (it already copies the JSON when present).
`src/effort.ts` and `src/platform.ts` are UNCHANGED : the resolver wraps them,
it does not modify them (surgical-change invariant).

## Fixture table (`test/fixtures/routing-table.fixture.json`)

Shape matches the emitted/validated runtime artifact per
`provider-json-emission.md` and `scripts/validate_provider.mjs`: each
`performance.<category>` IS the pairings array directly :
`performance.<category> = [ {model,effort,rank,score,cost_figure_used,
interpolated,confidence,basis}, ... ]` (NO per-category object wrapper, NO
`.pairings` key). Hand-authored and small. Must include, at minimum, in
`performance`:

- A category with multiple pairings spanning BOTH providers and varied ranks
  (e.g. `architecture`: `opus-4-8@high` rank 1, `gpt-5.5@xhigh` rank 2,
  `sonnet@medium` rank 3, `haiku@none` rank 4).
- A category with a single pairing.
- A category present but empty (`performance.<cat>: []`).
- A pairing whose `effort` needs normalization (e.g. `gpt-5.5@max` → clamp
  `xhigh`; `sonnet@ultracode` → clamp `xhigh`).
- (Optional) a pairing with an unknown model id to exercise the skip path.

The fixture lets tests assert ordering/filtering/normalization deterministically
without the profiler ever having run.

## Test plan (`test/routing.test.mjs`)

Follow the existing harness style (`test/effort.test.mjs`): a `test(name, fn)`
runner, `assert/strict`, exit non-zero on any failure. Import the compiled
`../dist/routing.js`. Cases:

1. **auto ordering** : all pairings, sorted by `rank` asc (best→worst); assert
   provider/model/effort of the first triple.
2. **provider filter** : `provider:"codex"` yields only codex-mapped pairings,
   rank order.
3. **provider_model filter** : `provider:"claude",model:"sonnet"` yields only
   sonnet pairings.
4. **effort normalization** : `gpt-5.5@max` resolves to launch effort `xhigh`;
   `sonnet@ultracode` → `xhigh`; `opus-4-8@ultracode` stays `ultracode`;
   `haiku@none` → effort ignored/placeholder.
5. **model→provider map** : haiku/sonnet/opus/opus-4-8/fable → claude; gpt-5.5 →
   codex.
6. **empty category** : empty category array (`[]`) → resolver signals "no candidates"
   (the value the handler turns into `ERR_NO_CANDIDATES`).
7. **missing table** : `loadRoutingTable()` on a non-existent path returns the
   missing sentinel (null), not a throw (the value → `ERR_TABLE_MISSING`).
8. **unknown model id** : pairing with unknown model is skipped, not coerced.
9. **explicit mode** : resolver returns the single user triple unchanged and
   does NOT consult the table (pass a null/empty table; still returns it).

Tests encode INTENT (Rule 9): each asserts WHY (e.g. case 4 asserts the clamp
exists because an un-normalized `max` would make `buildCommand` throw for
codex). Do NOT spawn real processes in unit tests : the resolver is pure;
attempt-loop/spawn behavior is out of unit-test scope (it reuses already-tested
`buildCommand`/`resolveExe`).

## Verification gate (before any source commit)

- `npm run build` then `npm test` (now includes `test/routing.test.mjs`).
- Existing tests (`effort`, `platform`, `wait`, `status`, `output`,
  `validate_provider`) still pass : auto-mode does not change their inputs.
- `node scripts/check_mcp_compliance.mjs` PASS : vendor metadata limits (server
  instructions, tool names/descriptions, hook additionalContext, directive
  budgets). Also runs inside `npm test` via `test/mcp-compliance.test.mjs`.
- Dispatch the pre-commit contradiction-checker sub-agent per `AGENTS.md`
  "Always Enforce" before committing `src/**`.
