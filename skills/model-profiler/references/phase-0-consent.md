# phase-0-consent.md — HARD GATE: Owner Consent

**Load when:** starting a run, before any sub-agent is dispatched. This phase is a **hard gate**.
No research, judging, or write happens until the owner answers.

---

## Why a hard gate

A full re-profile spends real budget across multiple provider families and rewrites a live routing
KB. Per `AGENTS.md` and `docs/spec/safety-scope.md`, work that spawns sub-agents, has external side
effects, and edits durable policy requires explicit consent first. Do not self-trigger; ask once,
clearly.

## Impartiality at the gate

Phase 0 confirms **scope only**. It must **not** preselect concrete models or efforts, and it must
not name a preferred member. The owner specifies which provider families and recency window are in
scope; **Phase 1 discovers the concrete model list** within that scope. Keep every question framed by
task/scope, never by a named model.

## Mechanism

Use **AskUserQuestion** (a single batched prompt) to confirm the six parameters below. Do not
proceed on assumed defaults. Persist the answers to `giga-research/phase-0-consent.md` for this run
(this also becomes the provenance that Phase 1 agents read).

## The six parameters to confirm

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | **Profiling scope:** which in-scope provider families + which recency window (e.g. last 6 months)? Or a specific model the owner already has in mind? | Bounds discovery. Phase 1 enumerates the concrete model list within this scope; the skill preselects nothing. |
| 2 | **Fast or Full** mode? | Scales fan-out (agent counts) and number of adversarial passes |
| 3 | **Runtime / budget** ceiling? (wall-clock + token/cost budget) | Long background jobs run detached; budget bounds fan-out |
| 4 | **Provider mix** available? (which provider families + effort tiers are reachable now) | Cross-family is mandatory; a missing required family = halt |
| 5 | **Model universe scope:** "current generation" (recommended) or a strict recency window? | **Tradeoff to surface impartially:** a strict recency window can exclude an older small/low-cost tier that currently anchors a low-complexity category's primary route — leaving that route without a replacement. State this consequence; recommend "current generation"; confirm the owner's choice before proceeding. Name no specific model. |
| 6 | **Authorize routing-table.json + routing-table-audit.json emission + build-wiring?** The run will write `src/routing-table.json` + the audit mirror, edit the `package.json` build script, and touch `scripts/copy-provider.mjs` + `scripts/validate_provider.mjs`. | These are code/config changes alongside the RAG-only writes; the owner must scope them in. |

> The taxonomy is **fixed** — there is no "authorize taxonomy change" question. The 10 categories +
> `fallback_default`@99 are immutable inputs (`.spec/references/work-categories.md`); this run only
> refreshes the per-category rankings against them.

## Decision after answers

- **All six answered + required provider families available + emission authorized** -> proceed to Phase 1.
- **Required provider family missing** -> halt; surface; ask the owner whether to wait, or to
  explicitly authorize a degraded single-family run (which weakens cross-family validation — flag the
  cost). Do not silently degrade.
- **Owner declines routing-table.json scope** -> continue as a RAG-only re-profile (skip
  routing-table.json + audit emission and build-wiring); surface what will be skipped.
- **Owner declines / defers** -> stop. No dispatch, no writes.
- **Scope unclear** (e.g., "profile the new one" with no family/window) -> ask a narrowing
  follow-up; do not guess the scope and do not preselect a model.

## Persisted record (example shape)

```md
# Phase 0 — Consent (run YYYY-MM-DD)
- Profiling scope: <provider families>; window <e.g. last 6 months>
- Mode: Fast | Full
- Runtime/budget: <wall-clock>, <token/cost ceiling>
- Provider mix: <families + effort tiers reachable now>
- Model universe scope: current-generation | strict-recency-window
- routing-table.json + audit + build-wiring authorized: yes | no
- Consent: granted by <owner> at <time>
- Notes/constraints: <...>
```

This record is an input to every Phase 1 agent (it tells them the discovery scope and the
corroboration posture to assume for a brand-new release).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
