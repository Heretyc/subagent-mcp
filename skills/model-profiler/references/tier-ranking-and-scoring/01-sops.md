# 01-sops.md : Owner SOPs (BINDING, deterministic): version-promotion, worst-case cost, sourcing

**Load when:** the deterministic builder constructs `routing-table.json` / `routing-table-audit.json`
and must apply the three owner-mandated Standard Operating Procedures. Parent index:
`../tier-ranking-and-scoring.md`. Authority: the run's ephemeral Phase-1.5 adjudication record (under
`%TEMP%\model-profiler\<run-id>\`) : owner answers > vendor docs/verified benchmarks > seed. These SOPs
are **deterministic**: a code builder applies them, not free-hand LLM ranking. Worked examples are
owner-supplied and **normative**.

---

## SOP-1 : Version-Promotion (monotonic-newer-fill)

**Scope.** Distinct from section A effort-interpolation (same model, higher *effort*). SOP-1 fills a missing
*version* within ONE model-family lineage (e.g. Opus `4.6 < 4.7 < 4.8`), **per category C**, after the
category's measured pairings are ordered best→worst.

**Rule (per category C, per lineage):**

1. Let `V_new` be a lineage version with **no measured score in C**. Let `V_old` be the **nearest-older**
   version of the SAME lineage that **is** listed in C.
2. If `V_old` exists: insert `V_new` **immediately above** `V_old`. `V_new` takes `V_old`'s rank;
   `V_old` and everything below it shift down exactly one tier.
   - This **inherently never** lets `V_new` leapfrog a *different* model that already outranks `V_old`
     (a different model sitting above `V_old` stays above `V_new`).
3. **Chaining (upward).** If multiple newer versions are missing, apply oldest-to-newest: each missing
   version is inserted immediately above the prior version, ending exactly **one tier** higher than the
   version directly below it. (4.7 above 4.6, then 4.8 above 4.7.)
4. **GUARD (no anchor → no insert).** If **no** older version of the lineage is listed in C, `V_new` is
   **NOT** inserted by this rule. SOP-1 never seeds a lineage into a category from nothing.

**Inherited attributes for the promoted `V_new` at that C / effort:**

| Field | Value |
|---|---|
| `score` | `V_old`'s score for C (inherited, equal value) |
| other per-category attributes | inherited from `V_old` |
| `interpolated` | `true` |
| `basis` | includes the tag `version-promotion(SOP-1) from <V_old>` |
| `confidence` | `"low"` |

**Tie-break (determinism).** `V_new` inherits `V_old`'s score (equal value). Equal score is admissible
under the validator's non-increasing-score rule (`score[i] ≤ score[i-1]`). To place `V_new` strictly
above `V_old` at equal score, break the tie **in favor of the newer version within the same lineage**
(newer version → smaller rank index). Cross-lineage ties keep the existing section A tie-break (model id asc,
then effort-ladder index asc).

**Worked examples (owner-supplied : NORMATIVE, reproduce verbatim):**

- Category X = `{4.6:#1}`, 4.8 missing → `{4.8:#1, 4.6:#2}`.
- Category Y = `{GPT-5.5:#1, 4.7:#2}`, 4.8 missing → `{GPT-5.5:#1, 4.8:#2, 4.7:#3}`.
  - 4.8 lands at #2 (immediately above its nearest-older listed predecessor 4.7); it does **not** pass
    GPT-5.5 (#1), a different model.
- Chain example: Category Z = `{4.6:#1}`, both 4.7 and 4.8 missing →
  `{4.8:#1, 4.7:#2, 4.6:#3}` (4.7 inserted immediately above 4.6, then 4.8 immediately above 4.7;
  each exactly one tier higher than the prior version).

**Validator note.** Rule 6 (same-model higher-effort monotonicity) does NOT apply across versions :
distinct versions are distinct `model` ids. The cross-model clamp is unaffected because SOP-1 never
moves `V_new` above a different model.

---

## SOP-2 : Worst-Case ("Most Expensive") Cost

**Rule.** For any cost figure that has a range or a cliff, use the **most-expensive DEFENSIBLE** value.
Per-model rates live in the dataset's `pricing` block; the blend/multiplier constants are hardcoded in
`build_routing_table.mjs`. This SOP encodes the selection rule, never the numbers.

- **Tokenizer inflation (Opus 4.7 / 4.8).** Adopt the documented **MAXIMUM = 1.35×** (vendor-documented
  ceiling). The prior **1.4× assumption is DEPRECATED** : it exceeds the vendor-documented max. Owner
  directive was "most expensive"; 1.35× is the most-expensive *defensible* (documented-ceiling) value.
  *(Surfaced: if the owner intends a literal 1.4×, flip the tokenizer-inflation constant in `build_routing_table.mjs`.)*
- **gpt-5.5 272K price cliff.** Price at the **post-cliff** rate (`$10` in / `$45` out) whenever
  `context_size` / the `G_CTX_272` modifier is in play. Use the base ≤272K rate **only when the route is
  provably sub-cliff**. When uncertain, use the cliff (worst-case) rate.

Records: the blend's cliff side is recorded as `cost_blend.price_cliff_side` (`"above"`/`"below"`/
`"n/a"`) in the **audit** metadata (`routing-table-audit.json`) : the lean canonical table
(`schema_version` 2) no longer carries `cost_blend` (see `../provider-json-emission.md`). (#19)
`cost_blend.above_cliff_cost_figure` is also recorded **audit-only**: the blend cost at the
post-cliff rates ($10 in / $45 out), at the reference blend (100K in / 20K out), hiddenMult=0
excluded. Non-null only when a cliff exists. This figure is for `G_CTX_272` route-time context : it
is never used in the scoring formula, only in the audit for informational provenance.

---

## SOP-3 : Sourcing Policy (tier-move gate)

**Rule.** A thin-sourced number constrains how far it may move a pairing:

- **Thin-sourced** = `[UNVERIFIED]` vendor-only, or single-press `[ASSUMPTION]`.
- A thin-sourced number may move a pairing **by at most ±1 tier**, and **only** when the gap clears
  **~10pp** (or the benchmark's noise band), whichever is wider.
- **WITHDRAWN vendor self-reports are DISCARDED** entirely (e.g. gpt-5.5 SWE-bench Verified). They do
  not move a pairing at all and are not recorded as evidence.
- **Tier-2/3 corroboration lifts the ±1-tier cap.** Once an independent (non-vendor) source corroborates
  the figure, the move is governed by the normal scoring formula, not the thin-source cap.

Label provenance on the pairing's `basis` field per `citations-labels.md` (`[UNVERIFIED]`,
`[ASSUMPTION]`, unlabeled = vendor-doc/verified). Confidence downgrades accordingly.

---

*Author: Lexi Blackburn : https://github.com/Heretyc/ : June 2026*
