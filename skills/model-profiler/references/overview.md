# overview.md — Goal, I/O, Orchestrator Contract

**Load first.** Establishes what this skill does, the orchestrator's role, and the sub-agent
contract every later phase depends on. After this, follow the SKILL.md decision tree per phase.

---

## Purpose

When a new model is released (or on demand): (1) re-profile the cross-provider sub-agent fleet
(Claude Code + Codex CLI) and reshuffle work across providers so the subagent-mcp router stays
optimal; (2) file every current-generation Claude+Codex model+effort pairing into tier rankings
across 10 generic-agentic task categories (best→worst) and emit `provider.json` with `performance`
and `cost_efficiency` branches.

- **Input:** the new model(s) to profile, plus the consented mode, model universe scope, and
  provider mix from Phase 0.
- **Output (first deliverable):** updated `.spec/references/` leaves + bumped
  `assets/routing-table.json` + updated `source-ledger.md` and `decision-rationale.md` + new
  `giga-research/` provenance + a change note.
- **Output (second deliverable):** canonical `src/provider.json` (copied to `dist/provider.json`
  at build) containing `performance` and `cost_efficiency` branches, each → 10 categories →
  ordered model+effort pairings. The RAG carries prose; `provider.json` carries scores/ranks/
  metadata only. Both share one taxonomy (`rag_pointer` in `provider.json` metadata links back).

**Unify-taxonomy mandate.** A run REPLACES the current 9 specialized categories + `fallback_default`
with 10 generic-agentic ones. The new spine must satisfy the criteria in
`references/category-derivation.md`. Both outputs (RAG + `provider.json`) are migrated atomically;
a half-migrated state never reaches the default branch.

**DATA-ONLY rule.** This skill modifies: `.spec/references/` RAG leaves, `assets/routing-table.json`,
`src/provider.json`, `package.json` build script, `scripts/copy-provider.mjs`,
`scripts/validate_provider.mjs`, and `validate_kb.py` taxonomy constants. It MUST NOT touch
`src/index.ts` routing logic.

This is a **re-profiling** of an existing KB, not a greenfield build. Read the current KB first so
the reshuffle is a delta, not a rewrite.

## Orchestrator-Only Contract

The agent running this skill is an **orchestrator**. Its only direct work:
1. Read baseline workspace files: `AGENTS.md`, the `.spec/references/` leaves it will update
   (start at `retrieval-map.md`), and prior `giga-research/` outputs as the run template.
2. Dispatch sub-agents, relay interview questions to the owner, persist answers, and decide
   merges/repairs based on returned JSON.

The orchestrator **never** performs research, synthesis, validation, or file authorship itself.
Every such unit of work is delegated to a sub-agent. Producing agents never review their own
output; critics are fresh and distinct (self-review ban / Anti-Pattern D).

## Sub-Agent I/O Contract

- Every sub-agent prompt **begins with** the literal line `<this is a request from a parent
  process>`.
- Every sub-agent returns JSON:

```json
{
  "status": "ok | blocked | needs_user",
  "summary": "<=80 words",
  "source_locators": ["original-source-or-file refs"],
  "risks": ["..."],
  "writes_requested": ["paths the agent wants written"]
}
```

- **Handoff via `%TEMP%`:** full content (research notes, syntheses, critiques) is written to a
  `%TEMP%` scratch file by the sub-agent; only the compact JSON status returns to the orchestrator.
  The orchestrator reads the scratch file when it needs the full content. This keeps the
  orchestrator context lean across a long multi-phase run.

## Hard Halts (surface, do not proceed)

| Condition | Action |
|-----------|--------|
| A required provider (Claude or Codex) is unavailable | Halt; surface; do not single-provider |
| Owner has not consented in Phase 0 | Do not dispatch |
| Two hard gates / specs irreducibly conflict | Surface to owner (`needs_user`) |
| A KB leaf would exceed 200 lines | Split into an index + same-named subdir before writing |
| Provider/model fallback chain exhausted mid-run | Report `blocked`; persist partial provenance |
| Brand-new model has sparse corroboration | Use task-split framing; mark assumption-based claims |

## Mode: Fast vs Full

This skill encodes the **Fast-mode** adaptation of the giga-research pipeline (the proven run):
5 research agents, a 10-question interview, 5 flagship synthesizers + 1 merge, a 3-pass adversarial
loop. Full mode widens fan-out and adds passes; confirm the mode in Phase 0 and scale the agent
counts accordingly without changing the phase structure or invariants.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
