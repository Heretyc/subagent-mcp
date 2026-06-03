# provider-json-emission.md — routing-table.json Schema Contract and Validation Rules

**Load when:** a run emits or validates `src/routing-table.json`. Encodes the required shape and the
rules enforced by `scripts/validate_provider.mjs`. The file carries scores/ranks/metadata only —
explanatory prose stays in the RAG, referenced via `rag_pointer` and per-pairing `basis` fields.

---

## Top-Level Structure

```jsonc
{
  "metadata": { ... },       // versioning, formula, universe, pointer to RAG
  "performance": { ... },    // RAG-spine categories (10) → ordered pairing arrays
  "cost_efficiency": { ... } // RAG-spine categories (10) → ordered pairing arrays
}
```

---

## `metadata` Object (required fields)

| Field | Type | Content |
|---|---|---|
| `version` | string | Semver of this routing-table.json emission (e.g. `"1.0.0"`) |
| `schema_version` | string | Schema version this file conforms to (e.g. `"1"`) |
| `generated` | string | `"YYYY-MM"` — month the run produced this file |
| `author` | string | `"Lexi Blackburn"` |
| `author_url` | string | `"https://github.com/Heretyc/"` |
| `model_effort_universe` | string[] | Ordered list of all `"model@effort"` pairings the run evaluated |
| `formula_definitions` | object | `normalization` (name + params), `composite_weights` per category, `sentiment_cap`, `calibrated_exponents` (`a`, `b` with `a > b`) |
| `cost_blend` | object | `input_tokens: 100000`, `output_tokens: 20000`, `price_cliff_side: "below"\|"above"\|"n/a"` (impartial: records whether the reference blend sits below/above any member's published input price cliff — see `tier-ranking-and-scoring.md`) |
| `calibration_gate` | object | `k_categories_min`, `m_rank_churn_min`, actual `k_observed`, `m_observed`, `passed: true`. **Required**; the validator enforces it via a dedicated fail-closed check (`readCalibrationGate`), not via its generic required-metadata array, so its absence from that array is not a contradiction — a missing `calibration_gate` still fails. |
| `rag_pointer` | string | `".spec/references/retrieval-map.md"` |

---

## Branch Structure (`performance` and `cost_efficiency`)

Each branch has the same category keys in the same order as the RAG spine
(`work-categories.md` / `assets/routing-table.json` machine mirror) — the **fixed 10-category spine**
(immutable input; never derived here). The validator mirrors the spine (count-agnostic): it checks
key-for-key equality against the spine derived from the machine-mirror asset
(`assets/routing-table.json`), not a hardcoded count. Each category value is
an array of pairing objects, ordered best→worst by score.

---

## Pairing Object (required fields)

| Field | Type | Shared? | Notes |
|---|---|---|---|
| `model` | string | shared | Model id from `model_effort_universe` |
| `effort` | string | shared | Effort tier (e.g. `"high"`, `"medium"`, `"none"`) |
| `rank` | integer | branch-specific | Dense 1..N, monotonic vs score within the branch/category |
| `score` | number | branch-specific | Normalized score for this branch (see scoring formula) |
| `cost_figure_used` | number | shared | `$/token` scalar from cost-figure methodology |
| `basis` | string[] | shared | Original source ids or labels (`[ASSUMPTION]`, `[UNVERIFIED]`); the validator also accepts the alias `provenance` for this field |
| `interpolated` | boolean | shared | `true` if this pairing was not directly measured |
| `confidence` | string | shared | `"measured"\|"high"\|"medium"\|"low"` — run's assessed confidence |

Both branches carry full pairing objects. `score` and `rank` are branch-specific;
`cost_figure_used`, `interpolated`, and `basis` are shared values (identical in both branches).

---

---

## Audit Sibling: `routing-table-audit.json`

Every run that emits `routing-table.json` also emits `.spec/references/assets/routing-table-audit.json`.
It mirrors `routing-table.json` exactly — same `performance`/`cost_efficiency` branches, same category
keys and order, same per-pairing `model`/`effort`/`rank`/`score`/`cost_figure_used`/`interpolated`/
`confidence`/`basis` — and adds, on each pairing, a required `citations` array. Each citation is
`{url, retrieved_at(ISO8601), annotation, source_id?, label?}` where `annotation` is exactly one
sentence explaining why that source supports this pairing's ranking. The audit's `metadata` adds
`audits` (path of the routing-table.json audited), `generated_at` (ISO8601), and `source_ledger_pointer`.
The audit is the citeable provenance layer for the rankings; `routing-table.json` stays lean.

## Validation Rules (`scripts/validate_provider.mjs`)

The standalone checker enforces all of the following; any failure exits non-zero:

1. **Two branches only** — root keys are exactly `metadata`, `performance`, `cost_efficiency`.
2. **Category keys match RAG spine** — category ids in both branches equal `EXPECTED_CATEGORIES`
   from `validate_kb.py` constants, in the same order.
3. **Universe completeness** — each category array in both branches contains every
   `model_effort_universe` entry exactly once (no duplicates, no omissions).
4. **Dense monotonic ranks** — within each category array, ranks are 1, 2, … N with no gaps;
   rank[i] > rank[i-1]; score[i] ≤ score[i-1] (non-increasing by score).
5. **Valid models** — every `model` value appears in `metadata.model_effort_universe`.
6. **Interpolation flag + same-model monotonicity** — for any pairing with `interpolated: true`,
   verify same-model score monotonicity within a branch: a higher-effort variant does not score
   below a lower-effort variant of the **same** model. The structural checker does NOT re-derive
   the cross-model clamp (`M@E′.score < competitor`) — that needs per-benchmark data absent from
   `routing-table.json`; see the scope note below.
7. **Calibration gate** — reads `metadata.calibration_gate {k_categories_min, m_rank_churn_min,
   k_observed, m_observed, passed}`. Recomputes observed churn from the performance vs
   cost_efficiency orderings (k = #categories whose max per-category rank-churn ≥ `m_rank_churn_min`;
   m = the max per-category churn), asserts `k_observed ≥ k_categories_min`, asserts the recorded
   `k_observed`/`m_observed`/`passed` are consistent with the recomputation (fail on mismatch), and
   bans the rank-1 cost_efficiency pick per category from being the globally cheapest-AND-weakest
   pairing. **If `calibration_gate` is absent the validator FAILS** — no silent default.
8. **Exponent constraint** — `metadata.formula_definitions.calibrated_exponents.a > b`.
9. **Closed effort/confidence/model enums** — every `model` is a known real model id; every
   `effort` is a known ladder tier; `confidence`, when present and non-empty, is in
   `measured|high|medium|low`. Unknown values are flagged, never silently skipped.
10. **Metadata well-formed** — all required metadata fields present and non-empty; `generated`
    matches `YYYY-MM` pattern; `schema_version` is a non-empty string.

> **Scope note (no over-claiming):** these checks are **structural** — two branches, spine-mirror,
> universe set-equality, dense monotonic ranks, valid models, interpolation flag + same-model
> monotonicity, the calibration-gate floor + cheapest-weakest ban, and metadata well-formedness
> (incl. `a > b`). The validator does NOT re-derive the full cross-model interpolation clamp (that
> needs per-benchmark data in the RAG); deep clamp correctness is enforced by generation
> (`tier-ranking-and-scoring.md`) and the adversarial loop.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
