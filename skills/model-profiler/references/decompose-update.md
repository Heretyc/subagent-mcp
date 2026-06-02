# decompose-update.md — Re-Architect Manifest & Update the KB In Lockstep

**Load when:** the canonical core synthesis is ready and you are updating `.spec/references/`.
Prereq: `giga-research/phase-2-core-synthesis.md` with per-category routes + a taxonomy verdict.

---

## 1. Re-architect the manifest only if categories shift

If the core synthesis says the taxonomy is stable, **keep the existing manifest** and update leaf
contents only. If it says categories shift (new/merged/renamed category), dispatch a sub-agent to
update `giga-research/kb-manifest.md` first, then propagate the new spine everywhere. The spine
(category list + precedence) is enforced by the validator — see `validation.md`.

## 2. Files to update IN LOCKSTEP

Dispatch write sub-agents (mechanical writes -> Haiku; structured JSON edits -> Codex) to update,
together, so the KB never drifts:

| File | Update |
|------|--------|
| `.spec/references/model-profiles.md` | New model's capabilities, ctx, effort ladder, benchmarks, cutoff, sampling locks |
| `.spec/references/work-categories.md` | Category definitions/signals/boundaries if taxonomy shifted |
| `.spec/references/routing-table.md` | Per-category `{provider, model, effort}` + fallback; precedence order |
| `.spec/references/routing-contract.md` | Rewrite the precedence string + gate-first/first-match rules to the new taxonomy (preserve gate IDs) |
| `.spec/references/hard-gates.md` | Any gate thresholds/severities the new model changes (ctx caps, G_SEC scope) |
| `.spec/references/cost-model.md` | New model pricing, priority tiers, inflation/effective-cost constants |
| `.spec/references/synergy-patterns.md` | New producer/critic pairings, fan-out involving the new model |
| `.spec/references/failure-modes.md` | New failure signatures (hallucination, stall, 429) for the new model |
| `.spec/references/governance-halts.md` | Commit/data/sandbox authority changes for the new model |
| `.spec/references/assets/routing-table.json` | **Machine mirror** — see "routing-table.json — bump version, keep mirror exact" |
| `.spec/references/source-ledger.md` | New APA sources for the new model (original sources only) |
| `.spec/references/decision-rationale.md` | **Record the reshuffle** — see "Record the reshuffle in decision-rationale.md" |
| `.spec/references/retrieval-map.md` | Add any new leaf/alias so coverage stays complete |
| `src/provider.json` | **Tier rankings artifact** — rewrite all category orderings (see "provider.json — write in lockstep, validate before merge") |
| `scripts/validate_kb.py` | `EXPECTED_CATEGORIES`, `EXPECTED_PRECEDENCE`, `VALID_MODELS`, metadata version/source pin — update in the same change as any taxonomy shift |
| `scripts/validate_provider.mjs` | Standalone provider.json validator — created at build time; a run ensures-it-exists and updates it only if the `provider-json-emission.md` schema evolves (idempotent) |

**Every leaf <=200 lines.** If a leaf would exceed it, split into an index + same-named subdir.

## 2a. Build-wiring files (idempotent; created at build time)

`scripts/copy-provider.mjs` and `scripts/validate_provider.mjs` are wired by the build (not the
run). A run only ensures-they-exist and updates them if the `provider-json-emission.md` schema
evolves. Do **not** rewrite them on a run that produces no schema change.

## 3. routing-table.json — bump version, keep mirror exact

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

## 5. provider.json — write in lockstep, validate before merge

`src/provider.json` is a **committed build artifact** (canonical). `dist/provider.json` is copied
at build time and gitignored. A run writes `src/provider.json`; the build copies it to `dist/`.

## 5a. Atomicity invariant

All taxonomy-migration edits (RAG spine + routing-table.json + validator constants +
`src/provider.json`) happen on a short-lived topic branch. The merge gate is:

1. `python .spec/references/scripts/validate_kb.py` — **PASS**
2. `node scripts/validate_provider.mjs` — **PASS**
3. `npm run build` — green (emits `dist/provider.json`; `tsc` must not emit a compiled provider.json)

A half-migrated taxonomy must never reach the default branch.

## 5b. Pre-defined split strategy for files at the 200-line cap

The files most at risk are `retrieval-map.md` (~190/200 now), `decision-rationale.md`, and
`work-categories.md`. When a run rewrites any of these and the file approaches 200 lines, split it
using this layout — **do not improvise a different structure mid-write**:

- Keep the original filename as an **index file** (<=200 lines): overview + a table of links to leaves.
- Place per-section content in a same-named subdirectory (e.g., `retrieval-map/`, `decision-rationale/`,
  `work-categories/`) as individual leaf files, each <=200 lines.
- Update `retrieval-map.md` to reference the new leaf paths; update cross-links in other files.

## 6. Record the reshuffle in decision-rationale.md

Add: the new model's seed-corroboration row, each conflict reconciliation (CR-N) the merge produced
with resolution + residual uncertainty, any mandate-overrides-benchmark calls, and the label key if
new labels were used. This is the auditable "why" for the route changes.

### Checkpoint

All listed files updated together; `routing-table.json` version bumped and validator constants
matched; `src/provider.json` written; `validate_kb.py` + `validate_provider.mjs` both PASS;
every leaf <=200 lines; reshuffle recorded. Then run the adversarial loop (`adversarial-loop.md`).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
