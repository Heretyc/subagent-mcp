# phase-0-consent.md — HARD GATE: Owner Consent

**Load when:** starting a run, before any sub-agent is dispatched. This phase is a **hard gate**.
No research, synthesis, or write happens until the owner answers.

---

## Why a hard gate

A full re-profile spends real budget across two providers and rewrites a live routing KB. Per
`AGENTS.md` and `docs/spec/safety-scope.md`, work that spawns sub-agents, has external side effects,
and edits durable policy requires explicit consent first. Do not self-trigger; ask once, clearly.

## Mechanism

Use **AskUserQuestion** (a single batched prompt) to confirm the four parameters below. Do not
proceed on assumed defaults. Persist the answers to `giga-research/phase-0-consent.md` for this run
(this also becomes the provenance that Phase 1 agents read).

## The seven parameters to confirm

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | **Which model(s)** to profile? (exact names/tiers, e.g. the just-released model) | Defines the research target and the routes that may shift |
| 2 | **Fast or Full** mode? | Scales fan-out (agent counts) and number of adversarial passes |
| 3 | **Runtime / budget** ceiling? (wall-clock + token/cost budget) | Long Codex jobs run in background; budget bounds fan-out |
| 4 | **Provider mix** available? (Claude tiers + Codex/GPT tiers reachable now) | Mixed Claude+Codex is mandatory; missing required provider = halt |
| 5 | **Model universe scope:** "current generation" (recommended) or strict "last 6 months"? | **Tradeoff to surface:** "current generation" includes Haiku 4.5 (released Oct 2025). Today is 2026-06-02, so strict "last 6 months" (cutoff ≈ Dec 2025) excludes Haiku 4.5 — this empties the `mechanical` primary route, which currently has no replacement. Recommended default: "current generation." Confirm the owner's choice before proceeding. |
| 6 | **Authorize unify-taxonomy replacement?** The run will replace the current 9 specialized categories + `fallback_default` with 10 generic-agentic ones (see `category-derivation.md`). This is irreversible without a re-run. | Prevents accidental taxonomy migration; must be explicit. |
| 7 | **Authorize provider.json emission + build-wiring?** The run will write `src/provider.json`, edit `package.json` build script, and add `scripts/copy-provider.mjs` + `scripts/validate_provider.mjs`. | These are code/config changes alongside the RAG-only writes; the owner must scope them in. |

## Decision after answers

- **All seven answered + both providers available + authorizations granted** -> proceed to Phase 1.
- **Required provider missing** -> halt; surface; ask the owner whether to wait, or to explicitly
  authorize a degraded single-provider run (which weakens cross-provider validation — flag the
  cost). Do not silently degrade.
- **Owner declines taxonomy replacement or provider.json scope** -> continue as a routing-only
  re-profile (skip provider.json and build-wiring); surface what will be skipped.
- **Owner declines / defers** -> stop. No dispatch, no writes.
- **Scope unclear** (e.g., "profile the new one" with no name) -> ask a narrowing follow-up; do not
  guess the model.

## Persisted record (example shape)

```md
# Phase 0 — Consent (run YYYY-MM-DD)
- Models to profile: <names>
- Mode: Fast | Full
- Runtime/budget: <wall-clock>, <token/cost ceiling>
- Provider mix: Claude {tiers}; Codex {tiers}
- Model universe scope: current-generation | strict-6-months
- Unify-taxonomy (9→10) authorized: yes | no
- provider.json + build-wiring authorized: yes | no
- Consent: granted by <owner> at <time>
- Notes/constraints: <...>
```

This record is an input to every Phase 1 agent (it tells them the target model and the corroboration
posture to assume for a brand-new release).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
