# adversarial-loop.md — 3-Pass Adversarial Review on the Updated KB

**Load when:** the KB is updated and you are stress-testing it before validation. Prereq: lockstep
update from `decompose-update.md` complete.

---

## Principles

- **Fresh, mixed-provider critics** each pass. A critic never reviewed an earlier pass of the same
  artifact, and never reviews its own producer's output (self-review ban / Anti-Pattern D).
- **Repair between passes:** after each pass, dispatch a repair sub-agent (Sonnet for
  research/build/repair) to fix the findings, then re-validate the repaired leaves before the next
  pass. Do not batch all three passes against the un-repaired KB.
- Critics write full findings to `%TEMP%`/`giga-research/`; return JSON status only.

## Pass 1 — Coverage & Activation

Does the updated KB *fire* correctly for the new model?
- Every new capability/route reachable from `retrieval-map.md` (trigger phrases, aliases, the
  "which model for X now" questions resolve to the right leaf)?
- New model present everywhere it should be (profiles, routing-table, cost-model, json mirror)?
- No orphaned route, no category with a stale model, no dangling reference to a retired tier?
- Gaps where the new model *should* have changed a route but didn't?
- **provider.json coverage:** every model+effort pairing appears in every category in both
  `performance` and `cost_efficiency` branches; `interpolated` flags consistent with the
  interpolation rule (`tier-ranking-and-scoring.md`) — each unmeasured higher-effort variant
  marked `true`, measured variants marked `false`.

## Pass 2 — RAG / Token / Citation

Is the KB retrievable, lean, and honestly sourced?
- Each leaf is single-purpose, <=200 lines, and front-loads its "load when / skip when"?
- Citations point to **original external sources only**; no internal `.spec/references/*.md` cited
  as provenance; labels (`[SEED]/[INFERRED]/[ASSUMPTION]/[UNVERIFIED]`) applied correctly,
  especially for the new (sparsely corroborated) model?
- Token economy: no bloat, no duplicated tables across leaves, retrieval-map still the cheapest
  entry?
- **provider.json RAG / citation:** `provider.json` cross-references the RAG via `rag_pointer` and
  `basis` fields — no prose duplicated from the RAG into `provider.json`; each `basis` entry cites
  original external sources only (no `.spec/references/*.md` paths as provenance).

## Pass 3 — Structure / Validation + Scenario Routing

Is the KB internally consistent and does it route real tasks correctly?
- Spine (categories + precedence + gates) identical across `work-categories.md`,
  `routing-table.md`, and `assets/routing-table.json`; version bumped; json mirrors md.
- Cross-links resolve; no broken relative links; no leaf over the line cap.
- **provider.json structure + validation:** schema valid per `provider-json-emission.md`; both
  branches have the same categories in the same order as the RAG spine; calibration gate satisfied —
  `performance` and `cost_efficiency` orderings differ beyond the recorded minimum-effect-size floor
  (`k_observed ≥ k_categories_min` with per-category churn ≥ `m_rank_churn_min`, and top
  cost-efficiency pick per category is not the globally cheapest-and-weakest pairing).
- **Scenario routing + gate-preservation:** feed the 6 scenario prompts (see `validation.md`) to a
  critic and confirm each routes to the expected `{category -> provider, model, effort}` after the
  reshuffle, including any route the new model just changed. Gate-preservation: a math task must
  still route per G_MATH and a GPT-5.5-authored security task must still trigger G_SEC cross-review,
  regardless of whether math/security became first-class categories or orthogonal modifiers.

## Exit criteria

Loop exits when a pass returns no must-fix findings and the repaired KB still passes the prior
passes' checks. Then run `validation.md` (the automated validator + checklist + scenario tests) as
the final gate.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
