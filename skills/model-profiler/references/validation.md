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
- **routing-table.json (machine mirror) mirror + precedence** — metadata block, `schema_version`, version,
  `classification_precedence`, `default_category`, `hard_gates` (ids + order), and `categories`
  (keys + order) all match the manifest spine; each category record has all required fields with
  valid `{provider, model}` and correct integer `precedence`; the markdown route-table order equals
  the json category order.
- **Provenance purity** — no leaf cites an internal `.spec/references/` path as a source.

> If you bumped `version`/`schema_version` in `decompose-update.md`, the validator's pinned
> constants must already match (you updated them in the same change). A version mismatch fails here.

## 1a. Run the routing-table.json validator

```powershell
node scripts/validate_provider.mjs
```

It must print `PASS`. Its enforcement scope is **structural** (the schema contract in
`provider-json-emission.md`) — it does NOT re-derive the full cross-model interpolation clamp from
benchmarks (that needs per-benchmark data not present in `routing-table.json`; see the disclaimer
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
> not in `routing-table.json`. Deep clamp correctness is enforced by generation (`tier-ranking-and-scoring.md`)
> and the adversarial loop, not by this checker.

> `validate_provider.mjs` is wired into `npm test`. If you bumped the schema, the validator's
> constants must already match (updated in the same lockstep change).

## 1b. Audit-mirror check (routing-table-audit.json)

Confirm `.spec/references/assets/routing-table-audit.json` exists and structurally mirrors
`routing-table.json`: identical branch keys, identical category keys/order, identical per-pairing
`model`/`effort` set per category. Every pairing carries a non-empty `citations` array; each
citation has a non-empty `url`, an ISO8601 `retrieved_at`, and a single-sentence `annotation`.
A missing audit file, a structural drift from routing-table.json, or any pairing with zero citations
FAILS validation (no silent default).

## 2. Spec checklist

Confirm the AGENTS.md / spec obligations for a structural + policy change:
- `git status --short --branch` inspected before writes; changes scoped to the KB + this skill.
- Topic branch + PR for the multi-file change (not a direct protected-branch edit).
- Pre-commit contradiction-checker sub-agent dispatched (strongest model) before committing source/
  executable changes; if it reports `blocked`/`needs_user`, no writes.
- No AI attribution / co-author lines in any KB file or generated metadata.

## 3. Six scenario routing tests + gate-preservation

Dispatch a fresh critic to route these and assert the **behavior** below. Categories are **FIXED**, so
an assertion may name the category a task lands in; what a run produces is the per-category
**member+effort route**, so assert against the run-produced route **without naming a specific
member/effort**. Key gate behavior to the gate ID. Cover at least one route the newly profiled
members just changed.

| # | Scenario task description | Required behavior (asserts) |
|---|--------------------------|-----------------------------|
| 1 | A formal-proof / derivation task ("prove this theorem / formal derivation") | Classified `math_proof`; routes per `G_MATH` to its forced verification target (run-produced member, unnamed here) |
| 2 | A security change authored by one provider family ("audit this auth code for vulns") | Classified `security_review`; triggers `G_SEC` cross-review rendered by a member of a **different** family than the author (no self-review) |
| 3 | A cross-cutting design / decomposition task | Classified `architecture`; the `architecture_complexity` modifier fires plan-before-build + independent cross-review; routes to that category's run-produced primary |
| 4 | A closed-loop terminal / "iterate until tests pass" task | Classified `agentic_execution`; routes to its run-produced primary and fires its mandatory-before-commit synergy pattern |
| 5 | A leaf file read / search / reformat task | Classified `mechanical`; routes to its run-produced low-cost primary, subject to its context-cap gate |
| 6 | A "which member for X now?" question (post-launch) | Resolves via `retrieval-map.md` to the run-produced route for the matched category |

Scenarios 1 and 2 are **gate-preservation tests** — `G_MATH` and `G_SEC` must fire correctly against
the fixed spine. Scenarios 3–6 exercise fixed categories whose **routes** the new profiling may have
changed: name the fixed category, but assert against the run-produced member+effort route — do **not**
hard-code which member/effort serves a category here.

## 4. Sign-off → deliver

When validator = PASS, checklist clear, and all six scenarios route as expected, emit the change
note and the output contract (updated leaves + bumped `routing-table.json` + `source-ledger.md` +
`decision-rationale.md` + new `giga-research/` provenance). Surface any residual uncertainty
(e.g., a same-day model launch with [PRESS]-only figures) rather than hiding it.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
