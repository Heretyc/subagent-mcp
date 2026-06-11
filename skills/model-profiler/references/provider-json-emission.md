# provider-json-emission.md — routing-table.json Schema Contract and Validation Rules

**Load when:** a run emits or validates `src/routing-table.json`. Encodes the **lean**
(`schema_version` `"2"`) shape and the rules enforced by `scripts/validate_provider.mjs`. The
canonical table carries only routing identity (provider/model/effort/rank); **all** explanatory
detail — scores, cost figures, provenance, citations — lives ONLY in the audit sibling
`src/routing-table-audit.json`.

---

## Top-Level Structure

```jsonc
{
  "metadata": { ... },       // EXACTLY 5 keys (below)
  "performance": { ... },    // RAG-spine categories (10) → ordered pairing arrays
  "cost_efficiency": { ... } // RAG-spine categories (10) → ordered pairing arrays
}
```

---

## `metadata` Object — EXACTLY these 5 keys (no more, no less)

| Field | Type | Content |
|---|---|---|
| `version` | string | Semver of this emission (e.g. `"2.0.0"`) |
| `schema_version` | string | Schema version this file conforms to (`"2"` for the lean schema) |
| `generated` | string | `"YYYY-MM"` — month the run produced this file |
| `author` | string | `"Lexi Blackburn"` |
| `author_url` | string | `"https://github.com/Heretyc/"` |

The lean metadata drops `model_effort_universe`, `formula_definitions`, `cost_blend`,
`rag_pointer`, and the (retired) `calibration_gate`. Those fields, plus the realized exponents
and cost-figure methodology, are retained in the audit sibling's metadata.

---

## Branch Structure (`performance` and `cost_efficiency`)

Each branch has the same category keys in the same order as the RAG spine
(`assets/routing-table.json` machine mirror) — the **fixed 10-category spine** (immutable input;
never derived here). The validator mirrors the spine key-for-key. Each category value is an array
of pairing objects, ordered best→worst by the branch's power-law score.

---

## Pairing Object — EXACTLY these 4 keys

| Field | Type | Notes |
|---|---|---|
| `provider` | string | `"claude"` for `claude-*` model ids, `"codex"` for `gpt-*` |
| `model` | string | Real model id (e.g. `claude-opus-4-8`, `gpt-5.5`) |
| `effort` | string or null | Effort ladder tier (e.g. `"high"`, `"low"`, `null`) |
| `rank` | integer | Dense 1..N within the branch/category (1 = best) |

`rank` is branch-specific (the two branches order the same universe differently). `provider`,
`model`, `effort` identify the pairing. No `score`, `cost_figure_used`, `basis`, `interpolated`,
or `confidence` on the canonical table — read the audit sibling for those.

No-effort sentinels (`null`, `"none"`, or `"n/a"`) are valid only for models whose discovered
effort ladder has no selectable tiers. If a model supports selectable effort settings, every emitted
pairing for that model must use a concrete selectable tier; never emit `<model>@none` for it.

---

## Audit Sibling: `routing-table-audit.json`

Every run that emits `routing-table.json` also emits `src/routing-table-audit.json` — the **only**
place the removed detail is retained. It mirrors the canonical branches/categories/order and, on
each pairing, adds the full object: `score`, `cost_figure_used`, `interpolated`, `confidence`,
`basis`, plus a required `citations` array. Each citation is
`{url, retrieved_at(ISO8601), annotation, source_id?, label?}` where `annotation` is one sentence
explaining why that source supports the pairing's ranking. The audit's `metadata` MAY carry richer
fields and records `audits`, `generated_at`, `source_ledger_pointer`, `model_effort_universe`,
`formula_definitions`, `cost_blend`, `realized_exponents` (per branch), and `cost_figure_methodology`.

---

## Validation Rules (`scripts/validate_provider.mjs`)

The standalone checker enforces all of the following; any failure exits non-zero:

1. **Two branches only** — root keys are exactly `metadata`, `performance`, `cost_efficiency`.
2. **Category keys match RAG spine** — category ids in both branches equal the spine derived from
   the machine-mirror asset (`assets/routing-table.json`), in the same order.
3. **Per-branch, per-category coverage (table-derived; invariants #14 + #16)** — the model@effort
   universe is the union of all pairings across both branches. **`performance`**: the expected set
   per category is the universe filtered to **effort >= `high`** (the performance effort floor,
   invariant #16 — below-high pairings, including all no-effort sentinels, are hard-rejected).
   **`cost_efficiency`**: in the 6 no-effort-exclusion categories (`agentic_execution`,
   `architecture`, `security_review`, `debugging`, `quality_review`, `knowledge_synthesis`) the
   expected set is the universe MINUS pairings of no-effort-only models (whose only effort is
   `null`/`none`/`n/a`); in the other 4 (`math_proof`, `data_analysis`, `coding`, `mechanical`) it
   is the full universe. Each category must contain exactly its branch's expected set, each pairing
   once. `metadata.model_effort_universe` is NOT consulted (it no longer exists on the lean table).
4. **Dense ranks** — within each category array, ranks are 1, 2, … N with no gaps, and
   `rank[i]` equals ordered array position `i`. (No score-monotonicity check — `score` is gone.)
5. **Lean pairing keys** — every pairing has EXACTLY `{provider, model, effort, rank}`.
6. **Valid provider** — `provider` ∈ `{claude, codex}` and consistent with the model family.
7. **Closed model/effort enums** — every `model` is a known real model id; every `effort` is a
   known ladder tier. Unknown values are flagged, never silently skipped. A no-effort sentinel on a
   model with selectable effort settings is invalid and fails validation.
8. **Lean metadata** — `metadata` has EXACTLY the 5 keys above; `author`/`author_url` exact;
   `generated` matches `YYYY-MM`; `schema_version`/`version` non-empty strings.

> **Retired (lean schema):** the `calibration_gate` check, the cheapest-AND-weakest ban, the
> exponent `a > b` check, the `cost_blend` check, the `score`-monotonicity check, and the
> interpolation-flag check are all REMOVED — those fields no longer live on the canonical table.

> **Scope note (no over-claiming):** these checks are **structural** — two branches, spine-mirror,
> table-derived universe set-equality, dense ranks, lean key sets, valid provider/model/effort
> enums, and metadata well-formedness. Deep cross-model clamp correctness is owned by generation
> (`tier-ranking-and-scoring.md`) and the adversarial loop, not this validator.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
