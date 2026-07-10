# overview.md : Goal, I/O, Orchestrator Contract

**Load first.** Establishes what this skill does, the orchestrator's role, and the sub-agent
contract every later phase depends on. After this, follow the SKILL.md decision tree per phase.

---

## Purpose

When a new model is released (or on demand), this skill is the **impartial judge of all models**.
It does two things, and only these two:

1. **Discover + measure.** Discover every model published in the recent window by the in-scope
   provider families (operator-specified at consent time), and gather ALL public benchmark scores
   and statistics for each model+effort pairing, mapped onto the **directly benchmarked parent
   categories**; the 4 composite-inferred categories carry no direct benchmark and are composed from
   their parents downstream (never directly benchmarked).
2. **Judge.** Arbitrate that discovered research into per-category tier rankings (best→worst) for
   each model+effort pairing, with a recorded rationale per tier placement, and emit the audit
   trail + routing JSON.

- **Input:** the consented profiling scope (in-scope provider families + recent window), mode,
  runtime/budget, and provider mix from Phase 0, including the standing repository profile when its
  exact trigger matches.
- **Output : EXACTLY 3 persisted artifacts** (nothing else persists to the repo):
  1. `src/routing-table.json` : lean canonical routing table, `performance` + `cost_efficiency`
     branches → 14 fixed categories (directly benchmarked parents + 4 composite-inferred) →
     ordered model+effort pairings (copied to `dist/routing-table.json`
     at build by `copy-provider.mjs`).
  2. `src/routing-table-audit.json` : full-provenance audit trail of the rankings (per-pairing source
     URLs, ISO8601 retrieval times, one-sentence annotations, tier rationale). The SOLE provenance
     store; the change note lives in its metadata.
  3. `research-seed-sites.json` (repo root) : accumulating learned source registry, merged from this
     run's audit citations by `update_seed_sites.mjs`.

Phase research is EPHEMERAL : written to `%TEMP%\model-profiler\<run-id>\` scratch, consumed by the
builder, and never persisted to the repo. The audit carries provenance; `routing-table.json` carries
scores/ranks/metadata only. Both share the one fixed taxonomy.

**Fixed-taxonomy mandate.** The 14 categories (directly benchmarked parents + 4 composite-inferred)
+ `fallback_default`@99 are **immutable**. This skill
profiles models **against** them : it never derives, chooses, renames, reorders, merges, or
reshuffles categories. Operational definitions live in `.spec/references/work-categories.md`;
determination methodology + rationale (incl. debate provenance) in `docs/spec/task-taxonomy/`. If a
run surfaces evidence that the taxonomy itself is wrong, **surface that to the owner** as
`needs_user` : do not alter the spine inside this skill.

**Impartiality mandate (non-negotiable).** The skill's directives name **no** preferred provider,
model, or effort : only impartial role descriptors (a web-research member, a deterministic-extraction
member, a flagship-judging member, elevated effort, etc.). The operator binds concrete members at
dispatch time. Rankings are derived **solely** from discovered research; the only place judged
model+effort names legitimately appear is the OUTPUT artifacts, which are the profiler's product.

**DATA-ONLY rule.** This skill modifies: `src/routing-table.json`, `src/routing-table-audit.json`,
`research-seed-sites.json`, `package.json`, `scripts/copy-provider.mjs`,
`scripts/validate_provider.mjs`, `scripts/build_routing_table.mjs`, `scripts/update_seed_sites.mjs`,
and `scripts/validate_seed_sites.mjs`. It READS `.spec/references/work-categories.md` (the fixed
spine) as an input but never writes it. It MUST NOT touch `src/index.ts` routing logic.

This is a **re-profiling** of an existing routing table, not a greenfield build. Read the prior
`src/routing-table.json` + `research-seed-sites.json` first so the refreshed rankings are a recorded
delta : but the prior rankings are diffed, never inherited as the source of truth (Invariant:
impartial judging).

## Orchestrator-Only Contract

The agent running this skill is an **orchestrator**. Its only direct work:
1. Read baseline workspace files: `AGENTS.md`, `.spec/references/work-categories.md` (the fixed
   spine), and the prior `src/routing-table.json` + `research-seed-sites.json` as the diff template
   for the run.
2. Dispatch sub-agents, relay interview questions to the owner or run the standing-profile
   adjudication path, persist answers/resolutions, and decide merges/repairs based on returned JSON.

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
| Only one provider family reachable | NOT a halt and NOT a degrade : single-family (e.g. Claude-only) is a fully-supported, first-class path (invariant #5). Critics stay FRESH within-family agents distinct from producers. No risk logging required |
| No Phase 0 consent or matching standing repository profile | Do not dispatch |
| Two hard gates / specs irreducibly conflict | Surface to owner (`needs_user`) |
| Evidence suggests the FIXED taxonomy is wrong | Surface to owner (`needs_user`); never alter the spine here |
| A KB leaf would exceed 200 lines | Split into an index + same-named subdir before writing |
| One or more Phase-1 agents stall, fail, or hit provider limits | Apply finite-wait + fallback + GAP-stub policy (`dispatch-mechanics.md`); continue to Phase 2 with GAP stubs |
| Provider/model fallback chain exhausted mid-run | Report `blocked`; persist partial provenance |
| Brand-new model has sparse corroboration | Use task-split framing; mark assumption-based claims |

## Mode: Fast vs Full

This skill encodes the **Fast-mode** adaptation of the giga-research pipeline (the proven run):
domain-partitioned discovery+research agents, a pivotal-question interview, several flagship judges +
1 merge, a 3-pass adversarial loop. Full mode widens fan-out and adds passes; confirm the mode in
Phase 0 and scale the agent counts accordingly without changing the phase structure or invariants.

## Pipeline at a Glance

The run is wrapped by the fixed execution lifecycle (SKILL.md invariant #15 /
`references/execution-lifecycle.md`): the SETUP box (worktree gate) and the DELIVER box (commit ->
push -> PR -> deliver) bracket the Phase 0 -> VALIDATE pipeline.

```
SETUP     Worktree/branch gate FIRST (before Phase 0): node scripts/check_worktree.mjs ->
   |          WORKTREE-GATE: PASS. Compliant linked worktree, <type>/<subject>, OUTSIDE repo;
   |          else STOP and create one. (references/execution-lifecycle.md)
   |
   v
Phase 0   HARD GATE: AskUserQuestion or exact standing repository profile : scope? Fast/Full?
   |          runtime/budget? provider mix? (impartial : do NOT preselect models/efforts;
   |          no dispatch before consent/profile match)
   |
   v
CHECK:    For exact bare prompt ONLY: if pre-existing phase-1-agent-*.md files are present in
   |       %TEMP%\model-profiler\<run-id>\, do NOT reuse them to skip Phase 1 (FRESH-DATA mandate).
   |       Run a genuinely fresh Phase 1, or ABORT as blocked if fresh data cannot be gathered this
   |       run. There is NO bounded-continuation / skip-Phase-1 path.
   |
   v
Phase 1   [MANDATORY : fresh every run] N domain-partitioned discovery+research agents (web-enabled; any provider mix):
               DISCOVER every model published in the recent window by the in-scope provider families;
               gather ALL public benchmark scores + stats, mapped onto the directly benchmarked
               parent categories (composites inferred from parents, never directly benchmarked).
               Check references/benchmark-sources.md FIRST. -> %TEMP%\...\phase-1-agent-{1..N}.md
   |
   v
Phase 1.5 1 agent derives pivotal questions -> AskUserQuestion, or standing-profile adjudication -> persist
   |
   v
Phase 2   N flagship judges (elevated effort; any provider mix) independently ARBITRATE the discovered
   |          research into per-category, per-pairing TIER rankings (best->worst) + a rationale each;
   |          1 fresh flagship MERGES -> routing-table-audit.json (audit trail) -> routing-table.json
   |
   v
EMIT      Assemble ephemeral structured-dataset.json under %TEMP%; run the deterministic builder ->
   |          src/routing-table.json + src/routing-table-audit.json; run update_seed_sites.mjs ->
   |          research-seed-sites.json (fixed spine : never re-derive). No .spec/references writes.
   |
   v
3-PASS    Adversarial loop on the 3 artifacts: P1 coverage/activation; P2 citation honesty;
   |          P3 structure/validation + scenario routing. Fresh critics; repair between.
   |
   v
VALIDATE  Run scripts/validate_provider.mjs + audit-mirror + scripts/validate_seed_sites.mjs +
   |          run-level existence/growth check (validation.md section 1c) + spec checklist + scenario routing tests.
   |
   v
DELIVER   commit (3 artifacts) -> push -> PR -> resolve merge conflicts -> PR ready ->
          PR hyperlink + concise summary of src/routing-table.json changes since last merged update.
```

---

*Author: Lexi Blackburn : https://github.com/Heretyc/ : May 2026*
