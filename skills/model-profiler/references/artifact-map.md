# artifact-map.md — What This Skill Reads & Updates

**Load when:** you need to find the artifact being updated or its provenance, or to use a prior run
as the template for a new run.

---

## The artifact being updated: `.spec/references/` routing KB

Entry point is `.spec/references/retrieval-map.md` — **load it first** to find the right leaf. It
routes; it does not teach. Leaves:

| File | Owns |
|------|------|
| `retrieval-map.md` | First-load router: trigger/alias/symptom -> leaf |
| `routing-contract.md` | The 3-step contract; precedence; gate-first/first-match rules |
| `work-categories.md` | Category definitions, classify signals, boundaries (the spine) |
| `routing-table.md` | Per-category `{provider, model, effort}` + fallback (md side of mirror) |
| `hard-gates.md` | G_MATH, G_CTX_*, G_SEC, G_COMMIT, G_SANDBOX, G_DATA, G_OPUS_LOCK |
| `model-profiles.md` | Per-model capabilities, ctx, effort ladder, benchmarks, cutoff, locks |
| `cost-model.md` | Pricing, priority tiers, tokenizer inflation / effective-cost constants |
| `synergy-patterns.md` | Multi-agent patterns/anti-patterns; topology; fan-out capacity |
| `failure-modes.md` | Symptoms: hallucination, stall, truncation, 429, wrong-file, injection |
| `governance-halts.md` | Commit gate, halt conditions, write scoping, data/telemetry |
| `decision-rationale.md` | WHY each route exists; conflict reconciliations; label key; residuals |
| `source-ledger.md` | APA citations (original sources only) + id->claim/leaf mapping |
| `assets/routing-table.json` | **Machine mirror** consumed at runtime by subagent-mcp |
| `scripts/validate_kb.py` | The validator (line caps, links, coverage, json<->md mirror, purity) |
| `scripts/validate_provider.mjs` | Standalone provider.json validator (schema, coverage, calibration gate) — created at build time |

All leaves <=200 lines; `routing-table.json` mirrors `routing-table.md`; the validator pins the
spine, gate set, valid `{provider, model}` values, and the metadata/version block.

## The tier-rankings artifact: `provider.json`

`src/provider.json` is the **canonical committed** build artifact; `dist/provider.json` is copied
at build time by `scripts/copy-provider.mjs` and is gitignored. The RAG is the knowledge base;
`provider.json` carries scores, ranks, and metadata only — prose stays in the RAG, cross-referenced
via `rag_pointer` + `basis` fields.

| File | Owns |
|------|------|
| `src/provider.json` | Canonical committed rankings + metadata (written by a run; read at build) |
| `dist/provider.json` | Build copy (gitignored); emitted by `scripts/copy-provider.mjs` |
| `scripts/copy-provider.mjs` | Build-time copy script (ESM, cross-platform, no-ops if src absent) |
| `scripts/validate_provider.mjs` | Validator: schema, full universe coverage, calibration gate |

## New skill reference leaves

Added in this build to encode derivation criteria, scoring, and schema contracts:

| File | Owns |
|------|------|
| `references/category-derivation.md` | Derivation procedure + criteria + old->new mapping + math/security decision |
| `references/tier-ranking-and-scoring.md` | Interpolation rule, cost-figure methodology, scoring-formula form + calibration gate |
| `references/provider-json-emission.md` | `provider.json` schema contract + validation rules |

## Provenance: `giga-research/`

Holds the per-run research, interview, and synthesis outputs that back the KB. A prior run is the
template for a new run:

| File(s) | Phase |
|---------|-------|
| `phase-0-consent.md` | Phase 0 consent record |
| `phase-1-agent-{1..5}.md` | Phase 1 domain-partitioned research |
| `phase-1.5-*interview*.md` | Phase 1.5 ten pivotal questions + owner answers |
| `phase-2-synth-{1..5}.md` | Phase 2 independent flagship syntheses |
| `phase-2-core-synthesis.md` | The merged canonical core |
| `kb-manifest.md` | The KB manifest (spine + structure); re-architect here if categories shift |

> `giga-research/` is provenance, **not** citable as a source in the KB (use original external
> sources via `source-ledger.md`). It records HOW the KB was produced, for audit and for re-runs.

## Read vs write

- **Read (orchestrator, at start):** `AGENTS.md`, the `.spec/references/` leaves you will update
  (start at `retrieval-map.md`), prior `giga-research/` run as template.
- **Write (via sub-agents only):** updated `.spec/references/` leaves + bumped
  `assets/routing-table.json` + `source-ledger.md` + `decision-rationale.md`; `src/provider.json`
  (canonical tier rankings); new `giga-research/` files for this run; validator constants in
  `scripts/validate_kb.py` and `scripts/validate_provider.mjs` if the taxonomy or schema evolved.
- **Do not modify** `src/index.ts` routing logic or unrelated repo files. The `AGENTS.md` backlink
  to this skill is handled separately.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
