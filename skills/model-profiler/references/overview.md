# overview.md — Goal, I/O, Orchestrator Contract

**Load first.** Establishes what this skill does, the orchestrator's role, and the sub-agent
contract every later phase depends on. After this, follow the SKILL.md decision tree per phase.

---

## Purpose

When a new model is released (or on demand), this skill is the **impartial judge of all models**.
It does two things, and only these two:

1. **Discover + measure.** Discover every model published in the recent window by the in-scope
   provider families (operator-specified at consent time), and gather ALL public benchmark scores
   and statistics for each model+effort pairing, mapped onto the **FIXED 10 categories**.
2. **Judge.** Arbitrate that discovered research into per-category tier rankings (best→worst) for
   each model+effort pairing, with a recorded rationale per tier placement, and emit the audit
   trail + routing JSON.

- **Input:** the consented profiling scope (in-scope provider families + recent window), mode,
  runtime/budget, and provider mix from Phase 0.
- **Output (audit trail):** `assets/routing-table-audit.json` — the citeable mirror of the rankings
  (per-pairing source URLs, ISO8601 retrieval times, one-sentence annotations, tier rationale).
- **Output (routing):** updated `.spec/references/` leaves + bumped `assets/routing-table.json` +
  canonical `src/routing-table.json` (copied to `dist/routing-table.json` at build), each carrying
  `performance` and `cost_efficiency` branches → 10 fixed categories → ordered model+effort pairings;
  plus updated `source-ledger.md`, `decision-rationale.md`, new `giga-research/` provenance, a change note.

The RAG carries prose; `routing-table.json` carries scores/ranks/metadata only. Both share the one
fixed taxonomy (`rag_pointer` in `routing-table.json` metadata links back).

**Fixed-taxonomy mandate.** The 10 categories + `fallback_default`@99 are **immutable**. This skill
profiles models **against** them — it never derives, chooses, renames, reorders, merges, or
reshuffles categories. Operational definitions live in `.spec/references/work-categories.md`;
determination methodology + rationale (incl. debate provenance) in `docs/spec/task-taxonomy/`. If a
run surfaces evidence that the taxonomy itself is wrong, **surface that to the owner** as
`needs_user` — do not alter the spine inside this skill.

**Impartiality mandate (non-negotiable).** The skill's directives name **no** preferred provider,
model, or effort — only impartial role descriptors (a web-research member, a deterministic-extraction
member, a flagship-judging member, elevated effort, etc.). The operator binds concrete members at
dispatch time. Rankings are derived **solely** from discovered research; the only place judged
model+effort names legitimately appear is the OUTPUT artifacts, which are the profiler's product.

**DATA-ONLY rule.** This skill modifies: `.spec/references/` RAG leaves, `assets/routing-table.json`,
`assets/routing-table-audit.json`, `src/routing-table.json`, `package.json` build script,
`scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, and `validate_kb.py` taxonomy constants.
It MUST NOT touch `src/index.ts` routing logic.

This is a **re-profiling** of an existing KB, not a greenfield build. Read the current KB first so
the refreshed rankings are a recorded delta — but the prior rankings are diffed, never inherited as
the source of truth (Invariant: impartial judging).

## Orchestrator-Only Contract

The agent running this skill is an **orchestrator**. Its only direct work:
1. Read baseline workspace files: `AGENTS.md`, `.spec/references/work-categories.md` (the fixed
   spine), the `.spec/references/` leaves it will update (start at `retrieval-map.md`), and prior
   `giga-research/` outputs as the run template.
2. Dispatch sub-agents, relay interview questions to the owner, persist answers, and decide
   merges/repairs based on returned JSON.

The orchestrator **never** performs discovery, research, judging, validation, or file authorship
itself. Every such unit of work is delegated to a sub-agent. Producing agents never review their own
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

- **Handoff via `%TEMP%`:** full content (research notes, judgments, critiques) is written to a
  `%TEMP%` scratch file by the sub-agent; only the compact JSON status returns to the orchestrator.
  The orchestrator reads the scratch file when it needs the full content. This keeps the
  orchestrator context lean across a long multi-phase run.

## Hard Halts (surface, do not proceed)

| Condition | Action |
|-----------|--------|
| A required provider family is unavailable | Halt; surface; do not single-family |
| Owner has not consented in Phase 0 | Do not dispatch |
| Two hard gates / specs irreducibly conflict | Surface to owner (`needs_user`) |
| Evidence suggests the FIXED taxonomy is wrong | Surface to owner (`needs_user`); never alter the spine here |
| A KB leaf would exceed 200 lines | Split into an index + same-named subdir before writing |
| Provider/model fallback chain exhausted mid-run | Report `blocked`; persist partial provenance |
| Brand-new model has sparse corroboration | Use task-split framing; mark assumption-based claims |

## Mode: Fast vs Full

This skill encodes the **Fast-mode** adaptation of the giga-research pipeline (the proven run):
domain-partitioned discovery+research agents, a pivotal-question interview, several flagship judges +
1 merge, a 3-pass adversarial loop. Full mode widens fan-out and adds passes; confirm the mode in
Phase 0 and scale the agent counts accordingly without changing the phase structure or invariants.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
