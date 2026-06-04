# tier-ranking-and-scoring.md — Interpolation, Cost Figure, and Scoring Methodology

**Load when:** a run builds tier rankings, assigns scores, computes cost figures, or validates
the calibration gate. Encodes the rules and formula forms — NOT the calibrated values (those are
produced at run time and recorded to `routing-table.json` metadata).

---

## A. Interpolation Rule (deterministic)

Applies when model `M` at effort `E` is measured but a higher effort `E′` of the same model is
not yet measured.

**Algorithm:**

1. Order all measured pairings by score (descending) for the benchmark/category being ranked.
2. For each unmeasured `M@E′` (where `E′` > `E` on the effort ladder):
   - **Anchor:** the nearest measured lower-effort pairing for the same model (`M@E`).
   - **Clamp:** the lowest-scoring cross-model competitor that outscored the anchor (`M@E`) on
     this benchmark/category. If no such competitor exists, clamp = +∞ (no upper bound).
   - Insert `M@E′` at a score strictly between anchor and clamp; keep monotonic.
   - Mark `interpolated: true` on the pairing object.
3. Tie-breaking (reproducible): sort ties by model id ascending, then effort-ladder index ascending.

**Audit invariant:** performance is interpolated exactly once per pairing. Both the `performance`
and `cost_efficiency` branch scores for that pairing derive from this single measured-or-
interpolated performance value combined with the cost figure. Do not re-interpolate per-branch.

---

## B. Cost-Figure Methodology

**Source of truth: `.spec/references/cost-model.md`.** Do not duplicate rate tables here; cite
and reference that file. Every rate used must trace to a row in `cost-model.md` or be labelled
`[ASSUMPTION]` / `[UNVERIFIED]`.

One provider-neutral `$/token` scalar per model+effort pairing. Construction:

| Factor | Rule |
|---|---|
| **Blend** | Fixed 100K input / 20K visible output reference (matches `cost-model.md` §4 reference blend) |
| **Tokenizer inflation** | Apply each member's tokenizer-inflation factor from `cost-model.md` §3 to every pairing of any family whose tokenizer inflates token counts; members on a legacy/non-inflating tokenizer get no adjustment. The factor is a per-member datum in `cost-model.md`, never named here. |
| **Hidden-reasoning multipliers** | Apply the effort-tier hidden-output multipliers from `cost-model.md` §4 (the effort-ladder definition: none=0×, low=0.1×, med=0.25×, high=0.75×, xhigh=1.5×, max=2.5×). |
| **Efforts without a published multiplier** | Every effort in the validator ladder (`null, none, min, light, low, medium, high, xhigh, max, pro, ultracode`) must resolve to a multiplier so no pairing has undefined cost. Any effort lacking a published §4 value uses the **nearest lower documented tier** as its default: `null`→`none` (0×), `min`/`light`→`low` (0.1×), `pro`/`ultracode`→`max` (2.5×). State the default applied and label the pairing `[ASSUMPTION]`. |
| **Input price-cliff** | For any member with a published input price cliff (`cost-model.md` §2), determine whether the 100K-in/20K-out reference blend sits below or above that member's cliff; record the side in `routing-table.json` metadata (`cost_blend.price_cliff_side`), and use the below- or above-cliff rates accordingly. A member with no cliff records `"n/a"`. Threshold values are per-member data in `cost-model.md`, never named here. |
| **Gaps** | Any rate not in `cost-model.md` → label `[ASSUMPTION]` or `[UNVERIFIED]` on the pairing's `basis` field. |

---

## C. Scoring-Formula Methodology (form only; run calibrates values)

### Performance score

`performance = composite(normalized_benchmarks) + sentiment_adjustment`

- **Normalization:** the run picks ONE method and records it in `routing-table.json` `formula_definitions`:
  - `min-max` — rescale each benchmark to [0, 1] within the measured set, OR
  - `z-score-then-squash` — z-score then apply a sigmoid/tanh to bound to (0, 1).
- **Composite:** weighted mean of the normalized benchmark scores for the benchmarks relevant to
  that category. Weights are chosen and recorded by the run.
- **Sentiment adjustment:** anecdotal/qualitative evidence enters as a bounded, capped, labelled
  additive term only:
  - Cap form: `sentiment_adjustment ∈ [−cap, +cap]` where `cap < min(individual benchmark weight)`.
  - The cap magnitude is calibrated at run so no single sentiment signal can outweigh any
    individual measured benchmark. Record the cap value in `formula_definitions`.
  - Label each adjustment with its source in the pairing's `basis` field.

### Cost-efficiency score

`cost_efficiency = perf^a / cost^b`  where `a > b`

- `perf` = the performance score from the performance branch (interpolated or measured).
- `cost` = the `cost_figure_used` scalar for that pairing.
- `a`, `b` are calibrated by the run and recorded to `routing-table.json` `metadata.formula_definitions.calibrated_exponents`.
- The constraint `a > b` encodes a slight performance bias: a model that scores higher on
  performance is favored over a marginally cheaper but weaker one.

### Calibration gate (MUST pass before finalizing rankings)

The run must verify BOTH conditions before locking the rankings:

1. **Minimum effect size:** the `performance` and `cost_efficiency` rank orderings differ on at
   least **K** categories, each with rank-churn ≥ **M** positions between the two branches.
2. **Non-trivial winner:** the top `cost_efficiency` pick per category must NOT be the globally
   cheapest-AND-weakest pairing in the universe — trivial exponents that rubber-stamp the cheapest
   option fail this check.

The run records the gate to the canonical `metadata.calibration_gate` block:
`{ k_categories_min, m_rank_churn_min, k_observed, m_observed, passed }` (the floors are
`k_categories_min`/`m_rank_churn_min`; `k_observed`/`m_observed` are the run's measured effect
size; `passed` is the verdict). The exponents `a`, `b` go to
`metadata.formula_definitions.calibrated_exponents` (`a > b`). If either gate condition fails, the
run must recalibrate `a`/`b` and re-rank before emitting `routing-table.json`.

> `scripts/validate_provider.mjs` re-checks this gate **structurally**: it recomputes observed
> churn from the two branch orderings, asserts `k_observed ≥ k_categories_min`, asserts the recorded
> `k_observed`/`m_observed`/`passed` match the recomputation, and applies the cheapest-weakest ban.
> It does NOT re-derive the cross-model interpolation clamp (no per-benchmark data in
> `routing-table.json`) — that correctness is owned by this file's generation rules + the adversarial loop.

---

## D. Owner SOPs (BINDING — applied by the deterministic builder)

Three owner-mandated SOPs gate how the builder fills versions, prices cost, and weighs sources. They
are deterministic and example-backed; see the leaf:

| SOP | Rule (one line) | Leaf |
|---|---|---|
| **SOP-1 Version-promotion** | A missing lineage version is inserted immediately above its nearest-older listed predecessor (never above a different model); guard: no older version listed → no insert | [`tier-ranking-and-scoring/01-sops.md`](tier-ranking-and-scoring/01-sops.md) |
| **SOP-2 Worst-case cost** | Most-expensive defensible value: tokenizer inflation = **1.35×** max (1.4× DEPRECATED); gpt-5.5 cliff → post-cliff rate when `G_CTX_272` in play | [`tier-ranking-and-scoring/01-sops.md`](tier-ranking-and-scoring/01-sops.md) · `.spec/references/cost-model.md` |
| **SOP-3 Sourcing policy** | Thin-sourced (vendor-only/single-press) moves a pairing ≤±1 tier and only if the gap clears ~10pp; withdrawn vendor self-reports discarded; tier-2/3 corroboration lifts the cap | [`tier-ranking-and-scoring/01-sops.md`](tier-ranking-and-scoring/01-sops.md) |

This is distinct from §A: §A interpolates a missing **effort** of the same model; SOP-1 fills a missing
**version** of a lineage. Both set `interpolated: true`.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
