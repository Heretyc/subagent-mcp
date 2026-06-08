# adversarial-loop.md — 3-Pass Adversarial Review on the Emitted Artifacts

**Load when:** the 3 artifacts are emitted and you are stress-testing them before validation. Prereq:
the emission from `decompose-update.md` ("Emit the 3 Artifacts") complete.

---

## Principles

- **Fresh critics** each pass — distinct agents from producers regardless of provider family.
  Cross-family critics are available when ≥2 families are reachable; on a single-family run, critics are
  FRESH within-family agents (provider mix is optional, invariant #5 — single-family is not a degrade).
  A critic never reviewed an earlier pass of the same artifact, and never reviews its own producer's
  output (self-review ban / Anti-Pattern D).
- **Within-family adversary (#30):** when `run_manifest.provider_mix = "single_family"` or `"partial"`,
  the adversarial loop MUST still run fresh within-family critics. A `"partial"` run (multi-scope intent,
  single-family realization) additionally requires owner sign-off before shipping, surfaced via a
  `needs_user` return noting which families were requested but unreachable.
- **Repair between passes:** after each pass, dispatch a repair sub-agent (a research/build/repair
  member) to fix the findings, then re-validate before the next pass. Do not batch all three passes
  against the un-repaired artifacts.
- Critics write full findings to `%TEMP%\model-profiler\<run-id>\` scratch; return JSON status only.

## Pass 1 — Coverage & Activation

Do the emitted artifacts *fire* correctly for the new model?
- New model present in every category of both branches it should be?
- No orphaned route, no category with a stale model, no dangling reference to a retired tier?
- Gaps where the new model *should* have changed a route but didn't?
- **routing-table.json coverage (per-category, invariant #14):** in `math_proof`, `data_analysis`,
  `coding`, `mechanical` — every model+effort pairing of the full universe appears in both branches.
  In `agentic_execution`, `architecture`, `security_review`, `debugging`, `quality_review`,
  `knowledge_synthesis` — the REDUCED universe appears (full universe minus pairings of no-effort-only
  models); no-effort-only models must be absent from these 6. `interpolated` flags consistent with the
  interpolation rule (`tier-ranking-and-scoring.md`) — each unmeasured higher-effort variant marked
  `true`, measured variants marked `false`.

## Pass 2 — Audit / Citation Honesty

Is the audit lean, complete, and honestly sourced?
- Every pairing in `src/routing-table-audit.json` carries a non-empty `citations[]`; each citation has
  an ISO8601 `retrieved_at` and a single-sentence `annotation`?
- Citations point to **original external sources only**; no internal `.spec/references/*.md` cited as
  provenance; labels (`[SEED]/[INFERRED]/[ASSUMPTION]/[UNVERIFIED]`) applied correctly, especially for
  the new (sparsely corroborated) model?
- **Audit cross-reference:** the audit `basis` fields cite original external sources only (no
  `.spec/references/*.md` paths as provenance); no prose duplicated into the lean
  `src/routing-table.json` (provenance lives in the audit, not the canonical table).

## Pass 2b — Seed-sites pass

Is `research-seed-sites.json` consistent with this run's audit?
- No duplicate URLs; `sites` sorted ascending by `url`; every `url` normalized (no tracking params, no
  bare trailing slash, lowercased scheme+host).
- Monotonic growth: `sites.length >= prior committed sites.length` (the list never shrank).
- Schema valid per `validate_seed_sites.mjs` (`tier` ∈ 0..5, `times_seen >= 1`,
  `site_count === sites.length`) — mirrors `validation.md §1c`.

## Pass 2c — Semantic-Soundness Critic (#10)

Do the rankings make sense? Run deterministic sanity asserts BEFORE any judgment-layer critique:

- **Effort inversion check:** for each model on the performance branch, confirm that if a higher effort
  pairing ranks ABOVE a lower effort of the same model, it genuinely has a higher or equal `perf_norm`
  (not just a lower cost). A higher-effort pairing scoring lower would be an inversion. (#1 fix guards
  this for equal-perf; flag any case where a lower-effort genuinely outperforms a higher-effort of
  the same model as a suspicious data point requiring a citation audit.)
- **Zero-score with high confidence:** any pairing showing `score = 0` or near-zero (< epsilon_floor)
  with `confidence: "high"` or `"measured"` is implausible — this was the `opus-4-7` `math_proof`
  bug. Flag for source review.
- **Blog as sole #1 citation:** if rank=1 pairing has only a single citation and it is a blog or
  vendor marketing copy (tier 0 or 1), flag as suspect.
- **These are sign-off-required warnings, NOT silent auto-edits.** A critic finding a semantic
  anomaly surfaces it for owner adjudication; the build does not auto-correct a ranking based on
  the critic's opinion. Record findings in `adversarial_passes` metadata.

## Pass 3 — Structure / Validation + Scenario Routing

Are the artifacts internally consistent and do they route real tasks correctly?
- Spine (categories + precedence) identical between `src/routing-table.json` and the spine asset
  `.spec/references/assets/routing-table.json`; the audit mirrors the canonical table's
  branch/category/pairing structure.
- **routing-table.json structure + validation:** schema valid per `provider-json-emission.md`; both
  branches have the same categories in the same order as the fixed spine; dense 1-based ranks with no
  gaps or ties; lean pairing/metadata key sets. (The calibration gate is retired under `schema_version`
  2 — the two fixed `a:b` ratios guarantee the branches differ; see `tier-ranking-and-scoring.md`.)
- **Scenario routing + gate-preservation:** feed the 6 scenario prompts (see `validation.md`) to a
  critic and confirm each routes to its expected `{fixed category → run-produced member+effort route}`
  after the refresh, including any route the new profiling just changed. Gate-preservation: a
  `math_proof` task must still route per `G_MATH`, and a security task must still trigger `G_SEC`
  cross-review rendered by a FRESH member distinct from the author (a different family when ≥2 are
  reachable; otherwise a fresh within-family member — never the author itself).

## Adversarial-pass audit record (#4)

The orchestrator must inject each pass result into the builder via `ADVERSARIAL_PASSES_JSON` env var
so the offline builder can embed it in `audit.metadata.adversarial_passes`. The schema:

```json
{
  "status": "complete",
  "passes": [
    {
      "pass_name": "pass-1-coverage",
      "critic_id": "<agent-id>",
      "critic_model": "<model@effort>",
      "producers_excluded": ["<agent-id>", ...],
      "input_hash": "<sha256 of audit before pass>",
      "output_hash": "<sha256 of critic output>",
      "findings_count": 0,
      "result": "pass"
    }
  ],
  "inter_judge_dissent": {
    "per_category": { "<category>": { "judges": [...], "variance": null } }
  },
  "reconciliation_note": "judge tier calls mapped to dataset via ..."
}
```

If no adversarial loop ran (offline build), the audit emits `status: "unavailable_offline"` (honest).

## Exit criteria

Loop exits when a pass returns no must-fix findings and the repaired artifacts still pass the prior
passes' checks. Then run `validation.md` (the automated validators + checklist + scenario tests) as
the final gate.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
