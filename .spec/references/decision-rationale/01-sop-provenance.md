# 01-sop-provenance.md — Owner SOP Rationale & Label Provenance (version-promotion · worst-case cost · sourcing)

**Load when:** auditing WHY the three owner SOPs exist, their label provenance, or how they interact
with the conflict reconciliations. Parent index: `../decision-rationale.md`.
**Authority:** `giga-research/2026-06-03-profiling/phase-1.5-answers.md` (Phase 1.5 owner answers =
binding steering, top of the authority chain). Operative encoding for the builder:
`skills/model-profiler/references/tier-ranking-and-scoring/01-sops.md`.

---

## SOP-1 — Version-Promotion (monotonic-newer-fill)

**Rationale.** Opus 4.6/4.7/4.8 are **distinct models** (Q1) — not collapsed to an `opus` alias. When a
newer version has no measured score in a category, free-hand LLM ranking is where judgment mistakes
creep in. The owner mandated a **deterministic** fill: a newer version inherits its nearest-older listed
predecessor's per-category attributes and ranks exactly one tier higher — but **never above a different
model** that already outranks the predecessor. A code builder applies it, eliminating ranking drift.

**Provenance.** `[ASSUMPTION]` — Phase 1.5 Q1 mandated working premise; overrides inference. The
inherited score is not a measurement: promoted pairings carry `interpolated: true`, `confidence: "low"`,
and a `version-promotion(SOP-1) from <V_old>` tag in `basis`. Guard: no older version listed in the
category → no insert (the SOP never seeds a lineage from nothing). Ties favor the newer version within a
lineage. Relationship to §CR-7 (Opus 4.8 task-split framing): SOP-1 is the *mechanical* fill rule;
CR-7's "not blanket superiority" still holds because SOP-1 cannot leapfrog a different leading model.

---

## SOP-2 — Worst-Case ("Most Expensive") Cost

**Rationale.** Owner directive (Q6/Q7): always assume the most-expensive **defensible** calculation so
budgets never under-estimate. Two levers:
- **Tokenizer inflation → 1.35× (documented MAX).** Supersedes the prior **1.4×** planning constant
  (§CR-8). The owner said "most expensive," and 1.35× is the vendor-**documented ceiling**; 1.4× exceeds
  it and is therefore **DEPRECATED** — "most expensive" means most-expensive *defensible*, not
  arbitrarily high. *(Surfaced to owner: a literal 1.4× would be a one-constant flip in `cost-model.md`
  §3.)*
- **gpt-5.5 272K cliff → post-cliff rate** ($10 in / $45 out) whenever `context_size` / `G_CTX_272` is in
  play; base ≤272K only when provably sub-cliff; uncertain → cliff.

**Provenance.** `[ASSUMPTION]` — Phase 1.5 Q6/Q7. Numbers owned by `./cost-model.md` (§2 cliff, §3
inflation); this file owns the *why*. Updates §CR-8 below: the modeling figure moves 1.4× → **1.35×**.

---

## SOP-3 — Sourcing Policy

**Rationale.** Prevents thin evidence from distorting rankings. A `[UNVERIFIED]` vendor-only or
single-press `[ASSUMPTION]` figure may move a pairing **≤ ±1 tier**, and only when the gap clears **~10pp**
(or the benchmark noise band). **Withdrawn vendor self-reports are discarded** (e.g. gpt-5.5 SWE-bench
Verified — see §CR-4). Independent (tier-2/3) corroboration lifts the ±1-tier cap and the normal scoring
formula governs.

**Provenance.** Phase 1.5 Q2 binding steering. Consistent with the label key: unlabeled vendor-doc/
verified benchmark = highest authority; `[UNVERIFIED]`/`[ASSUMPTION]` are rate-limited movers. Resolves
the un-asked pivotal questions (coding anchor, agentic tier-1, architecture zero-data) under this gate
plus the interview agent's recommended defaults (Phase 1.5 cascade).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
