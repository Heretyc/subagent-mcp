# artifact-map.md — What This Skill Reads & Updates

**Load when:** you need to find the artifact being updated or its provenance, or to use a prior run
as the template for a new run.

---

## The 3 persisted artifacts (everything a run emits)

A run persists EXACTLY 3 artifacts to the repo and nothing else:

| File | Owns |
|------|------|
| `src/routing-table.json` | **Lean canonical** tier rankings + lean metadata (written by a run; read at build → `dist/`) |
| `src/routing-table-audit.json` | **Full provenance** — per-pairing `citations[]` (url, retrieved_at, one-sentence annotation, label) + scoring/cost metadata. The **SOLE provenance store**. |
| `research-seed-sites.json` (repo root) | **Accumulating learned source registry** — harvested from the audit's citations each run; merge/dedupe by url, monotonic growth |

`dist/routing-table.json` is copied at build time by `scripts/copy-provider.mjs` and is gitignored
(not a 4th persisted artifact). `research-seed-sites.json` must NEVER reach `dist/` — `copy-provider.mjs`
copies only `src/routing-table.json`.

| Script | Owns |
|------|------|
| `scripts/build_routing_table.mjs` | Deterministic builder: reads ephemeral `DATASET_PATH` (%TEMP%) + the committed spine; emits `src/routing-table.json` + `src/routing-table-audit.json` |
| `scripts/update_seed_sites.mjs` | Merges this run's audit citations into `research-seed-sites.json` (accumulate; dedupe by url) |
| `scripts/copy-provider.mjs` | Build-time copy `src/routing-table.json` → `dist/` (ESM, cross-platform, no-ops if src absent) |
| `scripts/validate_provider.mjs` | Validator: schema, full universe coverage, dense ranks, lean shape, provider/model/effort enums |
| `scripts/validate_seed_sites.mjs` | Schema gate for `research-seed-sites.json` (NOTICE-skips when absent on a fresh clone) |

The builder reads the FIXED category spine from `.spec/references/assets/routing-table.json` (a READ
input, never rewritten); `validate_provider.mjs` checks category keys/order against it.

## New skill reference leaves

Added in this build to encode the fixed-taxonomy pointer, benchmark sources, scoring, and schema
contracts:

| File | Owns |
|------|------|
| `references/category-derivation.md` | **Fixed-taxonomy pointer leaf** → spine in `work-categories.md`; determination methodology + rationale (incl. debate provenance) live in `docs/spec/task-taxonomy/`. The skill never derives the categories. |
| `references/benchmark-sources.md` | Canonical benchmark source list (check FIRST for run-to-run stability) + per-category benchmark-family map onto the directly benchmarked parents |
| `references/tier-ranking-and-scoring.md` | Interpolation rule, cost-figure methodology, scoring-formula form + calibration gate |
| `references/provider-json-emission.md` | `routing-table.json` schema contract + validation rules |

## Provenance: ephemeral `%TEMP%` scratch + the durable audit

Phase research is **ephemeral**: written under `%TEMP%\model-profiler\<run-id>\` (phase-0 consent,
phase-1 research, phase-1.5 interview, phase-2 syntheses + the merged core + the assembled
`structured-dataset.json`), consumed by the builder, and **discarded** — never persisted to the repo.

Durable provenance is the **audit file's `citations[]`** plus the **seed registry**:

- `src/routing-table-audit.json` `citations[]` records HOW each pairing was sourced (original external
  sources only — APA, never an internal `.spec/references/*.md` path).
- `research-seed-sites.json` accumulates the learned source URLs across runs (harvested from those
  citations) so a prior run seeds the next.

## Read vs write

- **Read (orchestrator, at start):** `AGENTS.md`, `work-categories.md` (the fixed taxonomy), prior
  `src/routing-table.json` + `research-seed-sites.json` (the diff template for a new run).
- **Write (via sub-agents only):** the 3 persisted artifacts — `src/routing-table.json`,
  `src/routing-table-audit.json`, `research-seed-sites.json`; ephemeral phase files under `%TEMP%`;
  validator/builder scripts only if the `provider-json-emission.md` schema evolved.
- **Do not modify** `src/index.ts` routing logic or unrelated repo files. The `AGENTS.md` backlink
  to this skill is handled separately.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
