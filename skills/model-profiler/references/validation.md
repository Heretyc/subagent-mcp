# validation.md — Final Validation Gate

**Load when:** the adversarial loop has exited and you are signing off the emitted artifacts. This is
the last gate before delivery.

---

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
- **Per-category coverage (invariant #14)** — each category's expected set appears exactly once in
  both branches (set-equality, no duplicates, no omissions). The 6 no-effort-exclusion categories
  (`agentic_execution`, `architecture`, `security_review`, `debugging`, `quality_review`,
  `knowledge_synthesis`) expect the table-derived universe MINUS no-effort-only model pairings; the
  other 4 (`math_proof`, `data_analysis`, `coding`, `mechanical`) expect the full universe.
- **Dense ranks** — `rank` is a 1-based integer sequence with no gaps or ties and equals array
  position.
- **Lean shape** — pairings carry exactly `{provider, model, effort, rank}` and lean metadata
  carries exactly the 5 schema-versioned fields from `provider-json-emission.md`.
- **Valid provider/model/effort** — every provider matches the model family, every model is a known
  real model id, and every effort is a known ladder tier.
- **Effort capability** — no-effort sentinels (`null`, `none`, `n/a`) appear only on models with no
  selectable effort setting; effort-capable models use concrete selectable tiers.

> **Scope disclaimer (no over-claiming):** the structural validator does NOT re-derive the full
> cross-model interpolation clamp — that requires the per-benchmark data, which lives in the RAG,
> not in `routing-table.json`. Deep clamp correctness is enforced by generation (`tier-ranking-and-scoring.md`)
> and the adversarial loop, not by this checker.

> `validate_provider.mjs` is wired into `npm test`. If you bumped the schema, the validator's
> constants must already match (updated in the same lockstep change).

## 1b. Audit-mirror check (routing-table-audit.json)

Run the automated audit validator (#11):

```powershell
node scripts/validate_routing_audit.mjs
```

It must print `PASS`. It checks: `src/routing-table-audit.json` exists and structurally mirrors
`src/routing-table.json` (identical branch keys, category keys/order, per-pairing model+effort sets);
every pairing has a non-empty `citations` array; each citation has ISO8601 `retrieved_at`,
single-sentence `annotation`, and `url` or `[SENTINEL]`/`[SOP-1]` label. Tier and label are checked
(soft-warn if absent). **Sentinel-never-#1 (#16):** hard-fails if any category's rank=1 pairing is a
no-effort sentinel (effort `null`/`"none"`/`"n/a"`). This validator does NOT require non-null
run-manifest fields (those are honestly `unavailable_offline` in the offline build — DO-NOT-ADOPT #5).
Wired into `npm test`.

> **Runtime join (#16):** The lean `src/routing-table.json` carries no confidence metadata. At
> dispatch-time, a router may join `src/routing-table-audit.json` to read
> `metadata.category_completeness` (per-category completeness state: `"measured"` / `"gap_stubbed"`
> / `"thin_coverage"`) and `metadata.pairing_coverage_ratios` for a confidence signal. If a category
> is `"gap_stubbed"` or `"thin_coverage"`, the dispatcher should apply a fallback or escalation
> strategy (owner's choice) rather than routing silently to an under-evidenced pick.

## 1c. Seed-sites existence + growth gate (run-level — NOT the npm-test skip path)

First run the schema validator:

```powershell
node scripts/validate_seed_sites.mjs   # must PASS (schema)
```

Then, against the run that just completed, this leaf MUST assert:

- `research-seed-sites.json` EXISTS. A completed profiling run that produced it is mandatory; absence
  here is a **FAIL**, not a NOTICE-skip. (The NOTICE-skip in `validate_seed_sites.mjs` is only for a
  fresh clone before any profiling run has ever happened — never for a run that was supposed to emit it.)
- `metadata.last_run_at` equals THIS run's stamp (proves the run actually merged into it).
- `metadata.run_id` equals the SINGLE recorded run-id for this run — the same id carried by
  `src/routing-table-audit.json` at `metadata.run_manifest.run_id` (refinement #21). Both scripts
  derive this id deterministically from `DATASET_DATE` (env `RUN_ID` or a `<temp>/model-profiler/run-id`
  file may pin it), so a mismatch means the audit and seed came from DIFFERENT runs → **FAIL**.
  (`DATASET_DATE` is now REQUIRED: both scripts fail loud rather than default to a stale date.)
- `sites.length >= prior committed sites.length` (the list never shrank).

If the file is absent, stale (`last_run_at` not this run's stamp), or shrank → **FAIL the run**
(Rule 12: a run cannot exit green having emitted only 2 of the 3 artifacts).

## 2. Spec checklist

Confirm the AGENTS.md / spec obligations for a structural + policy change:
- `git status --short --branch` inspected before writes; changes scoped to the 3 artifacts + this skill.
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
| 2 | A security change authored by one provider family ("audit this auth code for vulns") | Classified `security_review`; triggers `G_SEC` cross-review by a **fresh** critic distinct from the author (no self-review) — a different family when ≥2 families are reachable, otherwise a fresh within-family member (per absolute invariant #5) |
| 3 | A cross-cutting design / decomposition task | Classified `architecture`; the `architecture_complexity` modifier fires plan-before-build + independent cross-review; routes to that category's run-produced primary |
| 4 | A closed-loop terminal / "iterate until tests pass" task | Classified `agentic_execution`; routes to its run-produced primary and fires its mandatory-before-commit synergy pattern |
| 5 | A leaf file read / search / reformat task | Classified `mechanical`; routes to its run-produced low-cost primary, subject to its context-cap gate |
| 6 | A "which member for X now?" question (post-launch) | Resolves via the `src/routing-table.json` performance branch to the run-produced route for the matched category |

Scenarios 1 and 2 are **gate-preservation tests** — `G_MATH` and `G_SEC` must fire correctly against
the fixed spine. Scenarios 3–6 exercise fixed categories whose **routes** the new profiling may have
changed: name the fixed category, but assert against the run-produced member+effort route — do **not**
hard-code which member/effort serves a category here.

## 4. Sign-off → deliver

When validators = PASS, checklist clear, and all six scenarios route as expected, confirm the output
contract: EXACTLY 3 persisted artifacts — `src/routing-table.json`, `src/routing-table-audit.json`,
`research-seed-sites.json`. Nothing else persists to the repo. The change note lives in the audit
metadata, not a separate prose file. Surface any residual uncertainty (e.g., a same-day model launch
with [PRESS]-only figures) rather than hiding it.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
