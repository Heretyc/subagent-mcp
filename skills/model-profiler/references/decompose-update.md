# decompose-update.md — Update the KB Rankings In Lockstep (Fixed Taxonomy)

**Load when:** the canonical core synthesis is ready and you are updating `.spec/references/`.
Prereq: `giga-research/phase-2-core-synthesis.md` with per-category, per-pairing tier rankings +
rationale (the spine is a fixed input, never a verdict to be re-decided here).

---

## 1. The category spine is FIXED — never re-architected here

The 10 categories + `fallback_default`@99 and their precedence are an **immutable input**
(`work-categories.md`; determination methodology in `docs/spec/task-taxonomy/`). A run refreshes the
per-category **rankings** (the member+effort ordering) and the prose explaining them — it never adds,
merges, renames, reorders, or drops a category. Keep the existing manifest spine as-is. If a run
surfaces evidence the spine itself is wrong, **surface it to the owner as `needs_user`** — do not
mutate the spine in this skill. The validator pins the spine and fails any drift — see `validation.md`.

## 2. Files to update IN LOCKSTEP

Dispatch write sub-agents (mechanical writes → a mechanical-write member; structured/JSON edits → a
deterministic-extraction member; keep the fan-out cross-family) to update, together, so the KB never
drifts:

| File | Update |
|------|--------|
| `.spec/references/model-profiles.md` | Newly profiled members' capabilities, ctx, effort ladder, benchmarks, cutoff, sampling locks |
| `.spec/references/work-categories.md` | **Fixed spine — read, not rewritten on a ranking run.** Touch only if the owner has separately ratified a spine change in `docs/spec/task-taxonomy/` (out of normal scope) |
| `.spec/references/routing-table.md` | Per-category `{provider, model, effort}` + fallback (refresh the routes; precedence order is fixed) |
| `.spec/references/routing-contract.md` | **Precedence string is fixed — do not rewrite it.** Refresh only the per-category routes; preserve gate IDs + gate-first/first-match rules |
| `.spec/references/hard-gates.md` | Any gate thresholds/severities the new model changes (ctx caps, G_SEC scope) |
| `.spec/references/cost-model.md` | New model pricing, priority tiers, inflation/effective-cost constants |
| `.spec/references/synergy-patterns.md` | New producer/critic pairings, fan-out involving the new model |
| `.spec/references/failure-modes.md` | New failure signatures (hallucination, stall, 429) for the new model |
| `.spec/references/governance-halts.md` | Commit/data/sandbox authority changes for the new model |
| `.spec/references/assets/routing-table.json` | **Machine mirror** — see "routing-table.json (machine mirror) — bump version, keep mirror exact" |
| `.spec/references/source-ledger.md` | New APA sources for the newly profiled members (original sources only) |
| `.spec/references/decision-rationale.md` | **Record the ranking refresh** — see "Record the ranking refresh in decision-rationale.md" |
| `.spec/references/retrieval-map.md` | Add any new leaf/alias so coverage stays complete |
| `src/routing-table.json` | **Tier rankings artifact** — rewrite all category orderings (see "routing-table.json — write in lockstep, validate before merge") |
| `.spec/references/assets/routing-table-audit.json` | **Audit sibling of routing-table.json** — same branch/category/pairing structure + per-pairing `citations[]` (url, retrieved_at, one-sentence annotation). Emitted with routing-table.json. |
| `scripts/validate_kb.py` | Refresh `VALID_MODELS` + metadata version/source pin each run; spine constants (`EXPECTED_CATEGORIES`/`EXPECTED_PRECEDENCE`) change **only** on an owner-ratified spine change |
| `scripts/validate_provider.mjs` | Standalone routing-table.json validator — created at build time; a run ensures-it-exists and updates it only if the `provider-json-emission.md` schema evolves (idempotent) |

**Every leaf <=200 lines.** If a leaf would exceed it, split into an index + same-named subdir.

## 2a. Build-wiring files (idempotent; created at build time)

`scripts/copy-provider.mjs` and `scripts/validate_provider.mjs` are wired by the build (not the
run). A run only ensures-they-exist and updates them if the `provider-json-emission.md` schema
evolves. Do **not** rewrite them on a run that produces no schema change.

## 3. routing-table.json (machine mirror) — bump version, keep mirror exact

`assets/routing-table.json` is consumed at runtime by subagent-mcp. It must mirror
`routing-table.md` exactly and pass `validate_kb.py`. When updating:

- **Bump `version` AND `schema_version`** (e.g. `2.0.0` -> next). Update `metadata.source` to the
  new synthesis date (`phase-2-core-synthesis/<date>`) and `metadata.generated` to the new month.
- Keep `classification_precedence`, `default_category` (`fallback_default`), `hard_gates` (ids +
  order), and `categories` (keys + order) **identical** to the markdown spine.
- Each category record keeps all required fields (`id, definition, classify_signals, precedence,
  primary, fallback, gates, synergy_pattern, cost_note, risk_flags`); `primary`/`fallback` use only
  valid `{provider, model}` values; `precedence` integer matches spine position (`fallback_default`
  = 99). The md route-table order must equal the json category order (validator checks the mirror).

> The validator's expected metadata/version are pinned to constants. If you bump the version,
> update those constants in `scripts/validate_kb.py` in the SAME change, or validation will fail.
> Treat the validator as part of the lockstep.

## 5. routing-table.json — write in lockstep, validate before merge

`src/routing-table.json` is a **committed build artifact** (canonical). `dist/routing-table.json` is copied
at build time and gitignored. A run writes `src/routing-table.json`; the build copies it to `dist/`.

## 5a. Atomicity invariant

All ranking-refresh edits (RAG prose + routing-table.json + `src/routing-table.json`, plus validator
constants only if the schema itself evolved) happen on a short-lived topic branch. The merge gate is:

1. `python .spec/references/scripts/validate_kb.py` — **PASS**
2. `node scripts/validate_provider.mjs` — **PASS**
3. `npm run build` — green (emits `dist/routing-table.json`; `tsc` must not emit a compiled routing-table.json)

A half-updated KB (rankings refreshed on one artifact but not its mirror) must never reach the
default branch.

## 5b. Pre-defined split strategy for files at the 200-line cap

The files most at risk are `retrieval-map.md` (~190/200 now) and `decision-rationale.md` (it grows
each run). When a run rewrites either and the file approaches 200 lines, split it using this layout —
**do not improvise a different structure mid-write**:

- Keep the original filename as an **index file** (<=200 lines): overview + a table of links to leaves.
- Place per-section content in a same-named subdirectory (e.g., `retrieval-map/`,
  `decision-rationale/`) as individual leaf files, each <=200 lines.
- Update `retrieval-map.md` to reference the new leaf paths; update cross-links in other files.

## 6. Record the ranking refresh in decision-rationale.md

Add: each newly profiled member's seed-corroboration row, each conflict reconciliation (CR-N) the
merge produced with resolution + residual uncertainty, any mandate-overrides-benchmark calls, and the
label key if new labels were used. This is the auditable "why" for the route changes.

### Checkpoint

All listed files updated together; `routing-table.json` version bumped and validator constants
matched; `src/routing-table.json` written; `validate_kb.py` + `validate_provider.mjs` both PASS;
every leaf <=200 lines; ranking refresh recorded; routing-table-audit.json emitted and its branch/category/pairing structure matches routing-table.json. Then run the adversarial loop (`adversarial-loop.md`).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
