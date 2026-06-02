# validation.md — Final Validation Gate

**Load when:** the adversarial loop has exited and you are signing off the updated KB. This is the
last gate before delivery.

---

## 1. Run the KB validator

```powershell
python .spec/references/scripts/validate_kb.py
```

It must print `PASS`. The validator enforces (pure stdlib, path-relative):

- **Line caps** — every `.spec/references/**/*.md` <=200 lines.
- **Relative cross-links** — no broken `.md`/`.json` links; nothing links outside the KB.
- **retrieval-map coverage** — every leaf and `assets/routing-table.json` is referenced in
  `retrieval-map.md`.
- **routing-table.json mirror + precedence** — metadata block, `schema_version`, version,
  `classification_precedence`, `default_category`, `hard_gates` (ids + order), and `categories`
  (keys + order) all match the manifest spine; each category record has all required fields with
  valid `{provider, model}` and correct integer `precedence`; the markdown route-table order equals
  the json category order.
- **Provenance purity** — no leaf cites an internal `.spec/references/` path as a source.

> If you bumped `version`/`schema_version` in `decompose-update.md`, the validator's pinned
> constants must already match (you updated them in the same change). A version mismatch fails here.

## 1a. Run the provider.json validator

```powershell
node scripts/validate_provider.mjs
```

It must print `PASS`. Its enforcement scope is **structural** (the schema contract in
`provider-json-emission.md`) — it does NOT re-derive the full cross-model interpolation clamp from
benchmarks (that needs per-benchmark data not present in `provider.json`; see the disclaimer
below). It checks:

- **Exactly two root branches** (`performance`, `cost_efficiency`); each has the same category keys
  in the same order as the RAG spine.
- **Full universe coverage** — each category array contains every `model_effort_universe` pairing
  exactly once (set-equality, no duplicates, no omissions).
- **Dense monotonic ranks** — `rank` is a 1-based integer sequence with no gaps or ties; `score`
  ordering matches rank order.
- **Valid models** — every `model` is a known real model id AND every `model`+`effort` pair is in
  `metadata.model_effort_universe`; every `effort` is a known ladder tier.
- **Interpolation flag + same-model monotonicity** — `interpolated:true` entries do not score below
  a lower-effort variant of the **same** model. (Cross-model clamp correctness is NOT re-derived
  here — see disclaimer.)
- **Calibration gate** — reads `metadata.calibration_gate {k_categories_min, m_rank_churn_min,
  k_observed, m_observed, passed}`. Recomputes observed churn from the performance vs
  cost_efficiency orderings, asserts `k_observed ≥ k_categories_min` (the floor), asserts the
  recorded `k_observed`/`m_observed`/`passed` match the recomputation, and bans the rank-1
  cost_efficiency pick per category from being the globally cheapest-AND-weakest pairing. If
  `calibration_gate` is absent the validator FAILS (no silent default).
- **Metadata well-formed** — `version`, `schema_version`, `generated` (YYYY-MM), `author`,
  `rag_pointer` all present; `formula_definitions` includes `calibrated_exponents` (with `a > b`)
  and `cost_blend`; `confidence`, when present, is in the allowed enum.

> **Scope disclaimer (no over-claiming):** the structural validator does NOT re-derive the full
> cross-model interpolation clamp — that requires the per-benchmark data, which lives in the RAG,
> not in `provider.json`. Deep clamp correctness is enforced by generation (`tier-ranking-and-scoring.md`)
> and the adversarial loop, not by this checker.

> `validate_provider.mjs` is wired into `npm test`. If you bumped the schema, the validator's
> constants must already match (updated in the same lockstep change).

## 2. Spec checklist

Confirm the AGENTS.md / spec obligations for a structural + policy change:
- `git status --short --branch` inspected before writes; changes scoped to the KB + this skill.
- Topic branch + PR for the multi-file change (not a direct protected-branch edit).
- Pre-commit contradiction-checker sub-agent dispatched (strongest model) before committing source/
  executable changes; if it reports `blocked`/`needs_user`, no writes.
- No AI attribution / co-author lines in any KB file or generated metadata.

## 3. Six scenario routing tests + gate-preservation

Dispatch a fresh critic to route these and assert the **behavior** below. Express each assertion as
the required behavior keyed to a gate ID and the task description — **not** by naming a specific new
category or pinning a fixed category→route mapping (the run's 10 categories are not known until the
run produces them; presuming them here would freeze future taxonomy output). Cover at least one
route the new model just changed.

| # | Scenario task description | Required behavior (asserts) |
|---|--------------------------|-----------------------------|
| 1 | A formal-proof / derivation task ("prove this theorem / formal derivation") | Routes per `G_MATH` to its forced target — regardless of whether math is a first-class category or an orthogonal modifier |
| 2 | A GPT-5.5-authored security change ("audit this GPT-5.5-authored auth code for vulns") | Triggers the `G_SEC` cross-review (reviewer family ≠ generator; no self-review) — regardless of whether security is a category or a modifier |
| 3 | A cross-cutting design / decomposition task (illustrative, not the deliverable) | Resolves to whichever category the run assigned design/decomposition work, at that category's recorded primary route |
| 4 | A closed-loop terminal / "iterate until tests pass" task (illustrative, not the deliverable) | Resolves to whichever category the run assigned closed-loop execution, and fires its mandatory-before-commit synergy pattern |
| 5 | A leaf file read / search / reformat task (illustrative, not the deliverable) | Resolves to whichever category the run assigned cheap leaf work, subject to its context-cap gate |
| 6 | A "which model for X now?" question (post-launch) | Resolves via `retrieval-map.md` to the new route the reshuffle produced |

Scenarios 1 and 2 are **gate-preservation tests** — they must produce correct gate behavior keyed to
the gate ID, whether math and security ended up as categories or orthogonal modifiers in the new
taxonomy. Scenarios 3–6 are **illustrative task shapes** (not the deliverable taxonomy): tune them to
exercise exactly the routes the new model contested, and assert behavior against whatever categories
the run actually produced — do not hard-code a category name or route here.

## 4. Sign-off → deliver

When validator = PASS, checklist clear, and all six scenarios route as expected, emit the change
note and the output contract (updated leaves + bumped `routing-table.json` + `source-ledger.md` +
`decision-rationale.md` + new `giga-research/` provenance). Surface any residual uncertainty
(e.g., a same-day model launch with [PRESS]-only figures) rather than hiding it.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
