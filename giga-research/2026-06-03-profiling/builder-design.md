# builder-design.md — Deterministic routing-table builder (DESIGN ONLY)

**Status:** design. No builder code written. Authority chain: `phase-1.5-answers.md` > vendor
docs/verified benchmarks > seed. Inputs: `structured-dataset.json` (7 models, 22 pairings, 301
benchmark rows, 192 gap rows, 2 withdrawn). SOPs: `tier-ranking-and-scoring.md` +
`tier-ranking-and-scoring/01-sops.md`. Cost numbers: `.spec/references/cost-model.md`.

## 0. Output contract map (which validator targets which file)

| File | Shape | Validated by | Builder action |
|---|---|---|---|
| `src/routing-table.json` | root `{metadata, performance, cost_efficiency}`; each branch cat → **direct array** of pairing objects | `scripts/validate_provider.mjs` | **WRITE (populated)** |
| `.spec/references/assets/routing-table.json` | `{metadata(v2.1.0,pending), categories{}, performance{cat:{...pairings:[]}}, cost_efficiency{...}}` machine-mirror | `validate_kb.py` (`check_pending_branch` requires `pairings == []`) | **DO NOT repopulate** — read-only SPINE source |
| `.spec/references/assets/routing-table-audit.json` | same pending shape, `citations:[]` required EMPTY | `validate_kb.py` (`check_routing_table_audit`) | **DO NOT repopulate** — see §7 conflict |
| populated audit sibling | mirrors `src/routing-table.json` + per-pairing `citations[]` | none today (`validate_provider.mjs` ignores it) | **WRITE to `src/routing-table-audit.json`** (see §7) |
| `dist/routing-table.json` | copy of `src/routing-table.json` | `copy-provider.mjs` | not the builder's job |

`validate_provider.mjs` reads `.spec/references/assets/routing-table.json` ONLY through `buildSpine`
(`categories` keys = `classification_precedence` + `default_category`) → the 10-category spine, ordered
`math_proof…mechanical`. It does NOT read that file's `performance` branch. So the machine-mirror stays
frozen/pending and still serves as the spine. **Two distinct artifacts; never merge them.**

## 1. Per-category composite score (per measured pairing)

For category `C` and universe pairing `P = model@effort`:

1. **Select rows.** From `category_benchmarks[C]`, take rows where `row.model == P.model`. Match effort:
   exact `row.effort == P.effort` first; ALSO admit `row.effort == "any"` (model-level, no canonical
   tier) as evidence for every effort of that model in `C`. Drop rows for non-universe models (they are
   not ranked) but KEEP them as the normalization population (§1.2) so competitor scores anchor the
   scale. Drop all `withdrawn` rows (gpt-5.5 SWE-bench Verified, coding+debugging) — never normalized,
   never cited (SOP-3).
2. **Normalize per benchmark (min-max).** Chosen method = `min-max` (recorded in
   `formula_definitions.normalization`). For each distinct `benchmark` string in `C`, rescale `raw` to
   `[0,1]` across ALL rows for that benchmark (universe + competitor) so the scale is anchored:
   `n = (raw − min)/(max − min)`; if `max==min`, `n = 1`. `unit` (`pct`/`score`) never mixed —
   normalization is per-benchmark so units are isolated. **Assumed:** higher-is-better for every
   benchmark; the two "bug density / false-number-report" benchmarks are lower-is-better → invert
   (`n = 1 − n`). [ASSUMPTION — dataset gives no polarity flag; recorded in `formula_definitions`.]
3. **Composite.** `composite(P,C) = Σ_b w_b · mean(n_b over P's rows for b) / Σ_b w_b`, over benchmarks
   `b` that `P` has at least one row for. **`composite_weights`:** equal weight per benchmark within a
   category (default `1.0` each) UNLESS a benchmark is tier-1 vendor-only and a tier-2/3 benchmark
   exists — then down-weight thin benchmarks (see §1.5). Record the final per-category weight vector in
   `formula_definitions.composite_weights[C]`. **Assumed equal-weight** because the dataset supplies no
   per-benchmark importance prior; equal-weight is the least-opinionated defensible choice.
4. **Sentiment adjustment.** No free-text sentiment corpus is in the dataset → `sentiment_adjustment = 0`
   for every pairing, but the mechanism stays defined. `sentiment_cap` recorded as a positive value
   strictly `< min(individual benchmark weight)` (with equal weights = 1.0, set `sentiment_cap = 0.05`).
   `performance_raw(P,C) = composite(P,C) + sentiment_adjustment`.
5. **SOP-3 sourcing gate (tier-move clamp).** Compute `tier_floor` = best (lowest-number) `tier` among
   `P`'s non-withdrawn rows in `C`. A pairing whose evidence is THIN (all rows `[UNVERIFIED]` vendor-only
   or single `[ASSUMPTION]`, tier ≥ to nothing better) may move at most **±1 rank tier** vs its
   neighbours, and only when its composite gap to the adjacent pairing clears **≥0.10 normalized**
   (~10pp proxy) or the benchmark noise band. Tier-2/3 corroboration (any `[INFERRED][Tier2…]`/`[T3]`
   row) **lifts the cap** → normal scoring. Implementation: after raw ranking (§2), for each THIN
   pairing whose move from its data-free neighbour exceeds 1 tier without a ≥0.10 gap, clamp it back to
   1 tier and downgrade `confidence`. Deterministic, data-driven, no LLM call.

`confidence`: `measured` if ≥1 exact-effort non-thin row; `high` if exact-effort thin OR any-effort
non-thin; `medium` if only `any`-effort thin; `low` if interpolated/promoted (§3) or zero rows.

## 2. Dense best→worst ranking

Per branch, per category: sort pairings by branch score **descending**, assign dense ranks `1..N`
(`N=22`), monotonic non-increasing score (validator rule 4: `rank[i]=i+1`, `score[i] ≤ score[i−1]`).
**Cross-lineage tie-break** (reproducible, from §A): equal score → model id ascending, then
effort-ladder index ascending. **Same-lineage tie-break** (SOP-1): newer version → smaller rank index.
Pairings with NO score after §1+§3 (genuinely data-free, guard-blocked from promotion) sort to the
bottom at a sentinel `score = 0` (or `min_observed − ε`), `interpolated:true`, `confidence:"low"` — they
must still appear (validator requires every universe pairing exactly once per category array).

## 3. SOP-1 version-promotion fill (per category C, per lineage)

Uses `models[].version_lineage` + `version_rank`. Lineages with ≥2 universe members: **opus** (4-6 is
NOT in universe; universe opus = 4-7 rank47, 4-8 rank48). gpt-5.5 lineage = `gpt-5.5`(55) +
`gpt-5.5-pro`(55, **same rank** — treat as siblings, NOT a version chain; SOP-1 needs strictly-older).
sonnet/haiku/gpt-5.4 are singletons → SOP-1 inert.

Algorithm (after §1 produces measured/any scores, before final ranks lock):

1. For category `C`, order the lineage's **listed** versions (those with a score) best→worst.
2. For each universe version `V_new` of that lineage with **no score in C** (it only has a gap row):
   find `V_old` = nearest **strictly-older** (`version_rank` lower) lineage version that IS listed in C.
3. **GUARD:** no older listed version → **do NOT insert** `V_new`; it falls to the data-free sentinel
   (§2). SOP-1 never seeds a lineage from nothing.
4. Else insert `V_new` **immediately above** `V_old`: `V_new` takes `V_old`'s rank; `V_old` and all below
   shift down one. Set `score = V_old.score` (inherited equal), `interpolated:true`,
   `basis += "version-promotion(SOP-1) from <V_old_id>"`, `confidence:"low"`.
5. **Chain oldest→newest** (4-7 above 4-6 if 4-6 listed, then 4-8 above 4-7). In THIS universe only 4-8
   promotes above 4-7 when 4-7 is listed and 4-8 is not. Never leapfrogs a different model above `V_old`
   (insertion is positional, immediately-above only).

This runs **once on the performance branch**; the promoted performance score then feeds BOTH branches
(audit invariant in §A: interpolate/promote exactly once). cost_efficiency re-ranks the SAME pairing set
with the same `cost_figure_used`. §A effort-interpolation (missing higher *effort*, same model+version)
also applies here and is distinct from SOP-1; in this dataset most efforts are gap-only, so promoted/
interpolated pairings dominate — flagged as an open risk (§8).

## 4. cost_efficiency branch + SOP-2 worst-case cost

`cost_efficiency(P,C) = perf(P,C)^a / cost_figure_used(P)^b`, `a > b` (slight perf bias). `perf` = the
performance-branch score (measured or promoted, §3). One `cost_figure_used` scalar per pairing, shared
across all categories and both branches.

**`cost_figure_used` (SOP-2 worst-case $/token), per cost-model.md:**
- Blend = 100000 input + 20000 output tokens (cost-model.md §4; recorded in `metadata.cost_blend`).
- Base rates from cost-model.md §1; effort hidden-output multiplier from §4 ladder
  (`none/null=0, low=0.1, med=0.25, high=0.75, xhigh=1.5, max=2.5`). Efforts off-ladder resolve to
  nearest-lower documented tier (`n/a`→treat as `none`/fixed=0×; label `[ASSUMPTION]`).
- **Tokenizer inflation = 1.35× MAX** for opus 4-7/4-8 (`tokenizer_inflation:1.35`); 1.4× DEPRECATED.
  Sonnet/Haiku/GPT (`tokenizer_inflation:null`) get 1.0×.
- **gpt-5.5 cliff (SOP-2):** the 100K-in blend is **provably sub-cliff** (272K threshold) → base
  ($5/$30) rate, `price_cliff_side:"below"`. gpt-5.5-pro likewise sub-cliff at 100K (`"below"`). No
  member's blend exceeds its cliff → `cost_blend.price_cliff_side` records `"below"` (or `"n/a"` for
  members with `cliff:null`). **Worst-case caveat:** owner directive says "use cliff when uncertain";
  here the 100K blend is *certain* sub-cliff, so `below` is defensible — flagged §8.
- Formula (per MTok, then /1e6 → $/token): `cost = (in_rate·0.1 + out_rate·(0.02 + 0.02·hidden_mult)) ·
  tok_inflation`, where visible-out=20K, hidden-out = 20K·hidden_mult (billed at output rate).
  `cost_figure_used` must be `> 0` (validator). Record per-pairing in `basis` if any `[ASSUMPTION]` rate.

**`a`,`b` calibration:** start `a=1.0, b=0.5`; the run searches the smallest `a>b` (e.g. step b down /
a up) such that the calibration gate (§5) passes. Record final to
`formula_definitions.calibrated_exponents{a,b}` with `a>b`.

## 5. calibration_gate metadata (validator-enforced)

`metadata.calibration_gate = {k_categories_min, m_rank_churn_min, k_observed, m_observed, passed}`.
The builder must compute these to MATCH what `validateCalibration` recomputes, or the run fails:
- Set floors first: `m_rank_churn_min = 3`, `k_categories_min = 3` (proposed; floors are policy, must be
  positive ints). Then recompute exactly as the validator does:
  - For each category, `maxDelta_C = max over pairings |perf_rank − cost_rank|`.
  - `m_observed = max_C maxDelta_C`; `k_observed = #{C : maxDelta_C ≥ m_rank_churn_min}`.
  - `passed = (k_observed ≥ k_categories_min) AND (m_observed ≥ m_rank_churn_min)`.
- Builder writes the **recomputed** `k_observed`/`m_observed`/`passed` verbatim (validator fails on any
  mismatch). If `passed==false`, **recalibrate `a`,`b`** (widen the perf/cost divergence) and re-rank
  until true, THEN emit. The exponents directly drive churn: larger `a−b` spread reorders cheap-weak vs
  expensive-strong pairings, lifting churn.
- **Cheapest-AND-weakest ban:** the validator computes the globally cheapest pairing (min averaged
  `cost_figure_used`) ∩ globally weakest (max averaged performance rank); the rank-1
  `cost_efficiency` pick in every category must NOT be that pairing. With `a>b` perf-bias this is
  satisfied structurally (the cheapest-weakest pairing — likely `gpt-5.4-mini@null` or
  `claude-haiku-4-5@null` if it also ranks worst — cannot top cost_efficiency once perf is weighted).
  The builder asserts this pre-emit; if violated, increase `a` and re-rank.

## 6. EXACT output shapes

**`src/routing-table.json`** (validate_provider.mjs): root keys EXACTLY `metadata`, `performance`,
`cost_efficiency`. `performance.<cat>` and `cost_efficiency.<cat>` are **direct arrays** (NOT objects)
of pairing objects, ordered rank 1..22. Pairing object required fields: `model`, `effort`, `rank`,
`score`, `cost_figure_used`, `interpolated`, `confidence`, plus `basis` (string[]) or `provenance`.
`metadata` required: `version`,`schema_version`,`generated`(YYYY-MM `"2026-06"`),`author`(`"Lexi
Blackburn"`),`author_url`(`"https://github.com/Heretyc/"`),`model_effort_universe`(22 strings),
`formula_definitions`(`normalization`,`composite_weights`,`sentiment_cap`,`calibrated_exponents{a>b}`),
`cost_blend`(`input_tokens:100000`,`output_tokens:20000`,`price_cliff_side`),`rag_pointer`
(`".spec/references/retrieval-map.md"`),`calibration_gate`(§5).

**`src/routing-table-audit.json`** (populated audit): mirrors `src/routing-table.json` exactly + each
pairing adds `citations[]` of `{url, retrieved_at(ISO8601), annotation(one sentence), source_id?,
label?}` built from the `source_url`/`retrieved_at`/`annotation`/`label`/`tier` of the dataset rows that
fed that pairing's score. `metadata` adds `audits` (path to the audited table), `generated_at`(ISO8601),
`source_ledger_pointer` (`".spec/references/source-ledger.md"`). Promoted/interpolated pairings cite the
predecessor's rows + the SOP tag.

**`metadata.model_effort_universe` normalization:** dataset universe uses `@n/a` for
haiku/gpt-5.5-pro/gpt-5.4-mini. The validator effort ladder has **`null` but NOT `n/a`**. Builder MUST
emit these pairings as `effort: null` and list them as `"…@null"` in `model_effort_universe` so
`effortKey(null)=="null"` passes rule 9 and universe set-equality holds. (`effortKey` maps JSON `null`
→ `"null"`.) This is a builder-side normalization, not a contract conflict.

## 7. Conflict resolved by routing, not blocking

The task names the populated audit path as `.spec/references/assets/routing-table-audit.json`, but
**that exact path is frozen by `validate_kb.py`** (`check_routing_table_audit` requires empty
`pairings`/`citations` + the v2.1.0 pending manifest). Writing populated citations there breaks
`validate_kb.py`. **Resolution (no user needed):** emit the populated audit to
**`src/routing-table-audit.json`** (beside the provider table it audits, `audits` field pointing to
`src/routing-table.json`). The `.spec/references/assets/` mirror + audit stay frozen/pending and serve
only as the spine source + KB manifest. Both validators then pass simultaneously. This is consistent
with `validate_provider.mjs` reading `assets/routing-table.json` for the spine ONLY.

## 8. Open risks (surfaced, not silenced)

1. **Data sparsity dominates.** Most of the 22×10 = 220 (pairing×category) cells have NO exact-effort
   measured row; many categories (`mechanical` has 0 universe rows; `quality_review` 0 exact-effort)
   rely entirely on `any`-effort rows + SOP-1 promotion + sentinels. Rankings in those categories are
   low-confidence by construction. `mechanical` cannot rank from data → every pairing is a data-free
   sentinel unless owner supplies a tie-break (flag: needs research backfill per phase-1.5 downstream).
2. **`any`-effort double-counting.** Admitting `any` rows as evidence for every effort of a model makes
   sibling efforts of one model share scores → ties → tie-break ordering carries weight. Acceptable but
   reduces intra-model effort discrimination.
3. **gpt-5.5 vs gpt-5.5-pro same `version_rank` (55).** Not a SOP-1 chain (needs strictly-older); treated
   as distinct models, never auto-promoted across each other.
4. **Polarity assumption** (higher-is-better; 2 inverted benchmarks) is a builder assumption — verify
   against source benchmarks before emit.
5. **Cliff worst-case vs certainty.** SOP-2 says "cliff when uncertain"; the 100K blend is certainly
   sub-cliff so `below` is used. If owner wants the literal worst-case cliff rate regardless, flip the
   cliff selection to `above` for gpt-5.5/-pro.
