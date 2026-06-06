# tier-ranking-and-scoring.md — Interpolation, Cost Figure, and Scoring Methodology

**Load when:** a run builds tier rankings, assigns scores, or computes cost figures. Encodes the
rules and formula forms — NOT the run-time values (composite weights, sentiment cap, and cost
figures are produced at run time and recorded to the **audit** metadata).

---

## A. Interpolation Rule (deterministic)

Applies when model `M` at effort `E` is measured but a higher effort `E′` of the same model is
not yet measured.

**Algorithm:**

1. For each model `M`, order its pairings by effort-ladder index (ascending) and walk upward,
   tracking the nearest measured lower-effort pairing as the running **anchor**.
2. For each unmeasured `M@E′` (where `E′` > `E` on the effort ladder):
   - **Anchor:** the nearest measured lower-effort pairing for the same model (`M@E`). If no
     measured lower-effort pairing exists, leave `M@E′` null (a data-free sentinel) — low-effort
     performance is never inferred from high-effort data.
   - **Inherit:** `M@E′` takes the anchor's score **exactly** (no cross-model clamp; no
     interpolation toward any competitor — the anchor value is copied verbatim).
   - Mark `interpolated: true` on the pairing object.
3. **Monotonic raise (same-model only):** in a separate downstream pass, walk each model's efforts
   low→high and raise any interpolated pairing **up** to the running maximum of its lower-effort
   same-model scores, so a higher effort never scores below a lower one. This raise consults only
   same-model scores — there is no cross-model competitor bound, and measured pairings are never
   altered.
4. Tie-breaking (reproducible): sort ties by model id ascending, then effort-ladder index ascending.

**Audit invariant:** performance is interpolated exactly once per pairing. Both the `performance`
and `cost_efficiency` branch scores for that pairing derive from this single measured-or-
interpolated performance value combined with the cost figure. Do not re-interpolate per-branch.

---

## B. Cost-Figure Methodology

**Source of truth: the dataset's per-model `pricing` block + the builder constants in
`build_routing_table.mjs`.** Per-model rates come from the ephemeral research dataset's `spec.pricing`;
the blend/multiplier/cliff constants are hardcoded in the builder. Do not duplicate rate tables here.
Every rate used must trace to a dataset `pricing` row or be labelled `[ASSUMPTION]` / `[UNVERIFIED]`.

One provider-neutral `$/token` scalar per model+effort pairing. Construction:

| Factor | Rule |
|---|---|
| **Blend** | Fixed 100K input / 20K visible output reference (the builder's reference blend) |
| **Tokenizer inflation** | Apply each member's tokenizer-inflation factor (from the dataset's per-member pricing data) to every pairing of any family whose tokenizer inflates token counts; members on a legacy/non-inflating tokenizer get no adjustment. The factor is a per-member datum, never named here. |
| **Hidden-reasoning multipliers** | Apply the effort-tier hidden-output multipliers from the builder's effort-ladder definition: none=0×, low=0.1×, med=0.25×, high=0.75×, xhigh=1.5×, max=2.5×. |
| **Efforts without a published multiplier** | Every effort in the validator ladder (`null, none, min, light, low, medium, high, xhigh, max, pro, ultracode`) must resolve to a multiplier so no pairing has undefined cost. Any effort lacking a published value uses the **nearest lower documented tier** as its default: `null`→`none` (0×), `min`/`light`→`low` (0.1×), `pro`/`ultracode`→`max` (2.5×). State the default applied and label the pairing `[ASSUMPTION]`. |
| **Input price-cliff** | For any member with a published input price cliff (from the dataset's per-member pricing data), determine whether the 100K-in/20K-out reference blend sits below or above that member's cliff; record the side in the **audit** metadata (`cost_blend.price_cliff_side`), and use the below- or above-cliff rates accordingly. A member with no cliff records `"n/a"`. Threshold values are per-member data, never named here. |
| **Gaps** | Any rate not in the dataset `pricing` block → label `[ASSUMPTION]` or `[UNVERIFIED]` on the pairing's `basis` field. |

No-effort sentinels (`null`, `none`, `n/a`) are costable only for members with no selectable
effort setting. If a member supports selectable efforts, exclude `none` from its model+effort
universe and score only concrete selectable tiers.

**Owner directive (absolute):** the ban on no-effort sentinels for effort-capable models is
enforced independent of the authority chain — even vendor documentation claiming a model supports
`@none` does not override this. Phase 2 judges and the merge must silently exclude any `<model>@none`
pairing from tier outputs if the model has any selectable effort tiers, regardless of Phase 1 notes.

**No-effort exclusion (per-category; SKILL.md invariant #14):** a model whose ONLY effort is a
no-effort sentinel (`null`/`none`/`n/a`) is excluded from the ranked universe in 6 categories —
`agentic_execution`, `architecture`, `security_review`, `debugging`, `quality_review`,
`knowledge_synthesis` — so those carry a REDUCED per-category universe. It REMAINS ranked in the other
4: `math_proof`, `data_analysis`, `coding`, `mechanical`. `build_routing_table.mjs` applies this at
ranking; distinct from the effort-capable `@none` ban above.

---

## C. Scoring-Formula Methodology (form only; run calibrates values)

### Capability composite (the `perf_norm` input to both branches)

`perf_norm = composite(normalized_benchmarks) + sentiment_adjustment`  (in `(0, 1]`)

- **Normalization:** the run picks ONE method and records it in the **audit** `formula_definitions`:
  - `min-max` — rescale each benchmark to [0, 1] within the measured set, OR
  - `z-score-then-squash` — z-score then apply a sigmoid/tanh to bound to (0, 1).
- **Composite:** weighted mean of the normalized benchmark scores for the benchmarks relevant to
  that category. Weights are chosen and recorded by the run. SOP-1 version-promotion and SOP-3
  sourcing apply to this capability component.
- **Sentiment adjustment:** anecdotal/qualitative evidence enters as a bounded, capped, labelled
  additive term only: `sentiment_adjustment ∈ [−cap, +cap]` where `cap < min(benchmark weight)`.
  Label each adjustment with its source on the audit pairing's `basis` field.

### Two-branch power-law scoring

Both branches rank by the **same** power law; only the exponents differ:

`score = perf_norm^a / cost_norm^b`

- `perf_norm` = the capability composite above, in `(0, 1]`.
- `cost_norm` = the normalized worst-case `$/token` in `(0, 1]` (SOP-2; each pairing's `$/token`
  divided by the universe max — rank-preserving, keeps the denominator bounded).
- **Performance-branch cost winsorization (refinement #6, owner approach B):** the `performance`
  branch is capability-dominant (`b = 0.2`), yet an extreme price ratio `R` still swings its score by
  `R^0.2` — a ~100× ratio swings the score ~2.5×, enough for a cheap-but-weaker tier to lift above a
  strong high-effort pairing. So on the **performance** branch ONLY, each pairing's `$/token` is
  **winsorized to the `[p05, p95]` window** of the universe `$/token` distribution **before** it is
  normalized into `cost_norm` (then renormalized by the winsorized max so `cost_norm` stays in
  `(0, 1]`). This clips only the single cheapest / single priciest outliers, leaves the entire
  in-window cost order intact, and is recorded in the **audit** metadata
  (`performance_cost_winsorization`: window, clip bounds, raw-vs-clipped cost ratio). The
  `cost_efficiency` branch is **unchanged** — it is intentionally cost-dominant, so clipping there
  would defeat its intent and it keeps the raw `cost_norm`.
- The `a:b` ratio sets the relative influence of performance vs cost (log-space weights):

| Branch | `a` | `b` | `a:b` | Intent |
|---|---|---|---|---|
| `performance` | 0.8 | 0.2 | 80:20 | capability-dominant; cost a light nudge |
| `cost_efficiency` | 0.4 | 0.6 | 40:60 | cost-dominant |

Each branch is re-ranked dense 1..N by its composite (higher score = rank 1). On the
**performance** branch, SOP-1 version-promotion adjacency still holds (the promoted version is
positionally spliced immediately above its same-effort predecessor). `cost_efficiency` keeps pure
composite order (a pricier newer version is legitimately less cost-efficient than its predecessor).

The realized exponents (`performance` 0.8/0.2; `cost_efficiency` 0.4/0.6), the performance-branch
cost winsorization bound, and the cost-figure methodology are recorded in the **audit** metadata
(`realized_exponents`, `performance_cost_winsorization`, `cost_figure_methodology`), not on the lean
canonical table.

### Retired (lean schema, `schema_version` 2)

- The **calibration_gate** (it required a perf-vs-cost divergence floor) is **retired** — the two
  fixed `a:b` ratios already guarantee the branches differ, and the gate metadata is gone.
- The **cheapest-AND-weakest ban** is **retired** — it fought the now cost-dominant
  `cost_efficiency` intent.
- The `a > b` constraint no longer applies as a validator check.

> `scripts/validate_provider.mjs` now checks only structure (two branches, spine-mirror,
> table-derived universe set-equality, dense ranks, lean key sets, provider/model/effort enums,
> lean metadata). Cross-model interpolation-clamp correctness remains owned by this file's
> generation rules + the adversarial loop.

---

## D. Owner SOPs (BINDING — applied by the deterministic builder)

Three owner-mandated SOPs gate how the builder fills versions, prices cost, and weighs sources. They
are deterministic and example-backed; see the leaf:

| SOP | Rule (one line) | Leaf |
|---|---|---|
| **SOP-1 Version-promotion** | A missing lineage version is inserted immediately above its nearest-older listed predecessor (never above a different model); guard: no older version listed → no insert | [`tier-ranking-and-scoring/01-sops.md`](tier-ranking-and-scoring/01-sops.md) |
| **SOP-2 Worst-case cost** | Most-expensive defensible value: tokenizer inflation = **1.35×** max (1.4× DEPRECATED); gpt-5.5 cliff → post-cliff rate when `G_CTX_272` in play | [`tier-ranking-and-scoring/01-sops.md`](tier-ranking-and-scoring/01-sops.md) · dataset `pricing` + builder constants |
| **SOP-3 Sourcing policy** | Thin-sourced (vendor-only/single-press) moves a pairing ≤±1 tier and only if the gap clears ~10pp; withdrawn vendor self-reports discarded; tier-2/3 corroboration lifts the cap | [`tier-ranking-and-scoring/01-sops.md`](tier-ranking-and-scoring/01-sops.md) |

This is distinct from §A: §A interpolates a missing **effort** of the same model; SOP-1 fills a missing
**version** of a lineage. Both set `interpolated: true`.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
