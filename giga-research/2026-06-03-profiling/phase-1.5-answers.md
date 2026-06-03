# Phase 1.5 — Owner Answers (BINDING STEERING, run 2026-06-03)

Authority chain: these answers > vendor docs/verified benchmarks > seed. They feed Phase 2 (now a DETERMINISTIC builder), the new SOPs, and `decision-rationale.md`.

## Q1 — `opus` alias / distinct versions / NEW version-promotion SOP
Opus 4.6, 4.7, 4.8 are **distinct models** — do not collapse them. Dispatch subagents to establish any **missing per-version metrics**.

**NEW SOP (version-promotion / monotonic-newer-fill) — to be documented in the skill and encoded in the deterministic builder:**
- A newer version inherits the **same per-category attributes/scores** of its nearest listed predecessor, ranked **exactly one tier higher** than that predecessor — **but never above a *different* model** that already outranks the predecessor.
- Worked example: predecessor Opus 4.6 = #1 in Category X; in Category Y, Opus 4.7 = #2 behind GPT-5.5; Opus 4.8 missing from both.
  - Category X → 4.8 becomes #1, 4.6 drops to #2.
  - Category Y → 4.8 becomes #2 (still under GPT-5.5, a different model), 4.7 drops to #3.
- **Guard:** if a model version is **never listed** for a category, it is **NOT** inserted by this rule.
- Make this **deterministic** to eliminate judgment mistakes: a code builder (subagent-planned + subagent-written, orchestrated) constructs routing-table.json + routing-table-audit.json from the structured Phase-1 data + encoded SOPs, not free-hand LLM ranking.

## Q2 — Sourcing policy (gates the coding/agentic/architecture tier calls)
**±1 tier AND ≥10pp (or noise band) to move a tier; discard withdrawn vendor self-reports** (e.g. gpt-5.5 SWE-bench Verified). Vendor-only/single-press may move at most ±1 tier and only when the gap clears the band.

## Q6 + Q7 — NEW SOP: worst-case ("most expensive") cost
**Always assume the most-expensive defensible calculation — document in skill.**
- Tokenizer inflation: use the documented MAXIMUM. Vendor ceiling = **1.35×** (1.4× was the prior baseline assumption but exceeds the vendor-documented max, so it is marked DEPRECATED; 1.35× is the worst-case *defensible* value). [Surfaced to owner: if literal 1.4× is intended, flip one constant.]
- gpt-5.5 272K price cliff: price at the **most-expensive applicable** rate — apply the post-cliff ($10/$45) rate whenever the context_size / G_CTX_272 modifier is in play; base ≤272K rate only when the route is provably sub-cliff. When uncertain, use the cliff (worst-case) rate.

## Cascade for the un-asked pivotal questions (q3/q4 from the interview file → resolved by the above)
- q2 (interview: coding tier anchor), q3 (agentic tier-1), q5 (architecture zero-data) → resolved by the deterministic builder under the **Q2 sourcing policy** + the interview agent's **recommended defaults** (SWE-bench Pro anchor for coding/architecture with low-confidence tag; agentic co-tier-1 with cost tie-break to gpt-5.5). Owner did not override these.

## Downstream actions
1. Phase 1.6 — research agents fill missing per-version metrics (Opus 4.6/4.7/4.8 distinct; flagged gaps: data_analysis Opus 4.8, agentic disagreements, etc.).
2. Document the two new SOPs (version-promotion, worst-case cost) + the sourcing policy in `skills/model-profiler/references/` (tier-ranking-and-scoring.md / a new sop leaf) and `.spec/references/decision-rationale.md`.
3. Plan + build the DETERMINISTIC routing-table/audit builder (orchestrated subagents) → emit `src/routing-table.json` + `.spec/references/assets/routing-table.json` + `routing-table-audit.json`.
4. Validate (validate_provider.mjs + validate_kb.py + adversarial) → update `.spec/references/` RAG leaves.
