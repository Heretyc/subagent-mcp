# Emit the 3 Artifacts

**Load when:** the canonical core synthesis is ready and you are emitting the run's persisted output.
Prereq: `%TEMP%\model-profiler\<run-id>\phase-2-core-synthesis.md` with per-category, per-pairing tier
rankings + rationale (the spine is a fixed input, never a verdict to be re-decided here).

---

## 1. The category spine is FIXED — never re-architected here

The 10 categories + `fallback_default`@99 and their precedence are an **immutable input**
(`work-categories.md`; determination methodology in `docs/spec/task-taxonomy/`). A run refreshes the
per-category **rankings** (the member+effort ordering) — it never adds, merges, renames, reorders, or
drops a category. Keep the spine as-is. If a run surfaces evidence the spine itself is wrong, **surface
it to the owner as `needs_user`** — do not mutate the spine in this skill. The builder reads the spine
from `.spec/references/assets/routing-table.json` and asserts its category keys; `validate_provider.mjs`
checks category keys/order — see `validation.md`.

## 2. The output contract — EXACTLY 3 persisted artifacts

A run persists EXACTLY 3 artifacts to the repo and nothing else:

| Artifact | Produced by | Owns |
|----------|-------------|------|
| `src/routing-table.json` | the deterministic builder (`build_routing_table.mjs`) | Lean canonical tier rankings (the runtime table) |
| `src/routing-table-audit.json` | the same builder, same run | Full provenance: per-pairing `citations[]`, scoring/cost metadata (the SOLE provenance store) |
| `research-seed-sites.json` (repo root) | `update_seed_sites.mjs` (merges this run's audit citations) | Accumulating learned source registry |

NO `.spec/references` writes. NO `validate_kb.py`. NO `source-ledger.md` / `retrieval-map.md` /
`decision-rationale.md` / `model-profiles.md` / `routing-table.md` prose — those KB leaves are gone.
The "why" of each route lives in the audit's `basis` / `citations[]`, not a separate prose file.

## 3. Emission steps (after the Phase-2 merge)

Phase research is EPHEMERAL — written to `%TEMP%` scratch, consumed by the builder, never persisted to
the repo. The emission is **deterministic code** (sanity Rule 5), not free-hand LLM ranking:

1. **Assemble the ephemeral dataset.** From the Phase-2 merge, assemble `structured-dataset.json` under
   `%TEMP%\model-profiler\<run-id>\` (per-model `pricing`, benchmarks, effort ladders, tier-ordering
   inputs). It is never committed.
2. **Point the builder at it + stamp the run.** Set env (see `tier-ranking-and-scoring.md` §D.6 / the
   builder header):
   ```powershell
   $env:DATASET_PATH = "$env:TEMP\model-profiler\<run-id>\structured-dataset.json"
   $env:DATASET_DATE = "<YYYY-MM-DD>"; $env:GENERATED_MONTH = "<YYYY-MM>"
   $env:SEED_SOURCES_PATH = "$env:TEMP\model-profiler\<run-id>\source-locators.json"  # optional; counters survivorship bias (#28)
   ```
3. **Run the deterministic builder.** It reads only `DATASET_PATH` (ephemeral) + the committed spine,
   applies the SOPs (`tier-ranking-and-scoring/01-sops.md`), and writes
   `src/routing-table.json` + `src/routing-table-audit.json`:
   ```powershell
   node scripts/build_routing_table.mjs
   ```
4. **Merge this run's citations into the seed registry.** `update_seed_sites.mjs` reads
   `src/routing-table-audit.json`, harvests every non-empty-url citation, and accumulates into
   `research-seed-sites.json` (the spine is fixed — never re-derive it):
   ```powershell
   node scripts/update_seed_sites.mjs
   ```
5. **Validate.** Run `validate_provider.mjs` + the audit-mirror check + `validate_seed_sites.mjs` + the
   run-level §1c existence/growth gate (`validation.md`):
   ```powershell
   node scripts/validate_provider.mjs
   node scripts/validate_seed_sites.mjs
   ```

## 4. Build-wiring files (idempotent; created at build time)

`scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, `scripts/build_routing_table.mjs`,
`scripts/update_seed_sites.mjs`, and `scripts/validate_seed_sites.mjs` are wired by the build, not the
run. A run only ensures-they-exist and updates them if the `provider-json-emission.md` schema evolves.
Do **not** rewrite them on a run that produces no schema change.

## 5. Atomicity invariant

All 3 artifacts move TOGETHER on a short-lived topic branch. The merge gate is:

1. `node scripts/validate_provider.mjs` — **PASS**
2. `node scripts/validate_seed_sites.mjs` — **PASS** (plus the §1c existence/growth gate)
3. `npm run build` — green (emits `dist/routing-table.json` from `src/routing-table.json`; `tsc` must
   not emit a compiled routing-table.json)

A half-emitted state (one artifact refreshed but not its siblings) must never reach the default branch.

### Checkpoint

Ephemeral dataset assembled under `%TEMP%`; the builder emitted `src/routing-table.json` +
`src/routing-table-audit.json`; `update_seed_sites.mjs` merged this run's citations into
`research-seed-sites.json`; `validate_provider.mjs` + audit-mirror + `validate_seed_sites.mjs` + §1c all
PASS; all 3 artifacts move together; no `.spec/references` writes. Then run the adversarial loop
(`adversarial-loop.md`).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
