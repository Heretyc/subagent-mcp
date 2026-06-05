# adversarial-loop.md — 3-Pass Adversarial Review on the Emitted Artifacts

**Load when:** the 3 artifacts are emitted and you are stress-testing them before validation. Prereq:
the emission from `decompose-update.md` ("Emit the 3 Artifacts") complete.

---

## Principles

- **Fresh, mixed-provider critics** each pass (cross-family preferred when ≥2 families reachable; on
  the Claude-only logged degrade, critics are FRESH within-family agents). A critic never reviewed an
  earlier pass of the same artifact, and never reviews its own producer's output (self-review ban /
  Anti-Pattern D).
- **Repair between passes:** after each pass, dispatch a repair sub-agent (a research/build/repair
  member) to fix the findings, then re-validate before the next pass. Do not batch all three passes
  against the un-repaired artifacts.
- Critics write full findings to `%TEMP%\model-profiler\<run-id>\` scratch; return JSON status only.

## Pass 1 — Coverage & Activation

Do the emitted artifacts *fire* correctly for the new model?
- New model present in every category of both branches it should be?
- No orphaned route, no category with a stale model, no dangling reference to a retired tier?
- Gaps where the new model *should* have changed a route but didn't?
- **routing-table.json coverage:** every model+effort pairing appears in every category in both
  `performance` and `cost_efficiency` branches; `interpolated` flags consistent with the
  interpolation rule (`tier-ranking-and-scoring.md`) — each unmeasured higher-effort variant
  marked `true`, measured variants marked `false`.

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
  `math_proof` task must still route per `G_MATH`, and a security task authored by one family must
  still trigger `G_SEC` cross-review rendered by a member of a **different** family than the author.

## Exit criteria

Loop exits when a pass returns no must-fix findings and the repaired artifacts still pass the prior
passes' checks. Then run `validation.md` (the automated validators + checklist + scenario tests) as
the final gate.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
