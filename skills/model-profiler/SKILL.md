---
name: model-profiler
version: 3.0.0
description: Impartially PROFILE the cross-provider sub-agent fleet against the FIXED canonical 10 work-categories whenever a new model ships (or on demand). Discover every model published in the recent window by the in-scope provider families, gather ALL public benchmark scores + statistics, map them onto the fixed 10 categories, then JUDGE each model+effort pairing into per-category tier rankings (best→worst) SOLELY from the discovered research, with a recorded rationale per tier placement. Emits routing-table-audit.json (citeable audit trail) + routing-table.json (performance + cost_efficiency branches) and refreshes the .spec/references routing KB. The 10 categories are immutable inputs — this skill never derives, chooses, renames, reorders, or reshuffles them. Use when a new model is released, when asked to profile new model, re-profile models, re-profile the fleet, rebalance routing, update routing table, refresh model profiles, re-run model research, regenerate the routing KB, regenerate routing-table.json, refresh tier rankings, or to answer "which model for X now" after a model launch. Orchestrator-only giga-research pipeline: model discovery + maximalist benchmark research, pivotal-question interview, flagship judging + merge, KB decompose/update, 3-pass adversarial validation, and KB validator + scenario routing tests. Cross-family (mixed-provider) sub-agents mandatory, dispatched via `mcp__subagent-mcp__launch_agent`.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: May 2026
---

# Model Profiler

Impartially profile the sub-agent fleet against the **FIXED canonical 10 work-categories** when a
new model ships (or on demand). The skill is the **impartial judge of all models**: it discovers the
models, gathers their public benchmarks, and ranks each model+effort pairing per category — it does
**not** decide what the categories are.

**Input** = the profiling scope (in-scope provider families + recent window) confirmed in Phase 0.
**Output** = `routing-table-audit.json` (the citeable audit trail of the judged rankings) +
`routing-table.json` (version-bumped) + refreshed `.spec/references/` routing KB + a change note in
`decision-rationale.md`.

This SKILL.md is the index. Load the detail leaf for the phase you are in. Do **not** preload all
leaves. Each leaf is <=200 lines (AGENTS.md cap).

## Fixed Taxonomy (immutable input — never derived here)

The 10 categories + `fallback_default`@99 are **fixed and immutable**. Precedence order:

```
math_proof > security_review > debugging > quality_review > architecture >
agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical
```

`fallback_default` @99 — off-spine no-match catch-all; never one of the 10. Operational definitions
live in `.spec/references/work-categories.md`; determination methodology + rationale (incl. debate
provenance) live in `docs/spec/task-taxonomy/`. This skill profiles models **against** this spine.

## Quick Decision Tree

| You are about to… | Load |
|-------------------|------|
| Understand goal, I/O, hard invariants, orchestrator contract | `references/overview.md` |
| Run Phase 0 consent gate (AskUserQuestion) | `references/phase-0-consent.md` |
| Dispatch Phase 1 model-discovery + benchmark research / Phase 1.5 interview | `references/phase-1-research.md` |
| Check the canonical benchmark source list FIRST (run-to-run stability) | `references/benchmark-sources.md` |
| Run Phase 2 judging/arbitration + canonical merge | `references/phase-2-synthesis.md` |
| Decompose/update the KB + bump `routing-table.json` (machine mirror) | `references/decompose-update.md` |
| Run the 3-pass adversarial loop | `references/adversarial-loop.md` |
| Validate (validator + checklist + scenario routes) | `references/validation.md` |
| Write a sub-agent prompt (dispatch via `mcp__subagent-mcp__launch_agent`) | `references/dispatch-mechanics.md` |
| Cite sources, apply labels, dogfood route tiers | `references/citations-labels.md` |
| Find the artifact being updated / provenance | `references/artifact-map.md` |
| Confirm the FIXED 10-category taxonomy + where its methodology lives | `references/category-derivation.md` (pointer) → `.spec/references/work-categories.md` |
| Understand tier ranking, interpolation, scoring formula, calibration gate | `references/tier-ranking-and-scoring.md` |
| Understand routing-table.json schema contract + validation rules | `references/provider-json-emission.md` |

## Hard Invariants (Always Active)

1. **Fixed taxonomy.** The 10 categories + `fallback_default`@99 are **immutable inputs**, defined in
   `.spec/references/work-categories.md`. This skill profiles models **against** them. It never
   derives, chooses, renames, reorders, merges, or reshuffles categories. A run that "discovers a
   missing category" is out of scope — surface it to the owner; do not act on it.
2. **Impartial judging.** Per-category tier rankings are derived **solely** from the Phase-1
   discovered research, with a recorded one-line rationale per tier placement. No pre-baked rankings;
   the prior KB is read only to diff/flag changes, never as the source of truth. The skill's
   **directives name no preferred provider/model/effort** — only impartial role descriptors. The
   judged model+effort rankings live **exclusively** in the OUTPUT artifacts (`routing-table.json` /
   `routing-table-audit.json`), which are the profiler's product, not a directive.
3. **Orchestrator-only.** Once you have read the baseline workspace files (`AGENTS.md`, the
   `.spec/references/` leaves you will update, `work-categories.md`, prior `giga-research/`), you
   delegate **all** research, judging, validation, and writing to sub-agents. You dispatch, relay,
   persist, and decide — never execute the work yourself.
4. **Sub-agents validate sub-agents.** A producing agent never reviews its own output. Critics are
   fresh, cross-family, and distinct from producers (self-review ban / Anti-Pattern D).
5. **Cross-family mandatory.** Use ≥2 distinct provider families when available. If a required
   family is missing, **halt and surface** — do not silently single-family it.
6. **Hub-and-spoke only.** Sub-agents never call sub-agents. All coordination goes through you.
   Inter-agent handoff is via `%TEMP%` scratch files: full content to disk, only **compact JSON
   status** returned to the orchestrator.
7. **Every sub-agent prompt begins with** `<this is a request from a parent process>` and the agent
   returns JSON `{status, summary, source_locators, risks, writes_requested}`.
8. **Consent before dispatch.** Phase 0 is a hard gate (`references/phase-0-consent.md`). No
   sub-agent is launched before the owner confirms scope, mode, runtime/budget, and provider mix.
   Phase 0 confirms scope only — it must **not** preselect concrete models or efforts.
9. **Provenance purity.** APA citations point to ORIGINAL external sources only. Never cite an
   internal `.spec/references/*.md` file as provenance. Label `[SEED]` / `[INFERRED]` /
   `[ASSUMPTION]` / `[UNVERIFIED]`. See `references/citations-labels.md`.
10. **Line caps.** Every KB leaf and every skill markdown file stays <=200 lines.
11. **One spine, atomic update.** `routing-table.json` and the `.spec/references/` RAG share the one
    FIXED category spine. A run updates the rankings on both atomically; the spine itself never
    changes, and a half-migrated state never reaches the default branch.
12. **DATA-ONLY boundary.** This skill produces `routing-table.json` + `routing-table-audit.json` and
    refreshes the RAG. It MUST NOT modify `src/index.ts` routing logic. The only code it may touch:
    `package.json` build script, `scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, and
    `validate_kb.py` taxonomy constants.

## Pipeline at a Glance

```
Phase 0   HARD GATE: AskUserQuestion — scope (provider families + window)? Fast/Full?
   |          runtime/budget? provider mix? (impartial — do NOT preselect models/efforts;
   |          no dispatch before consent)
Phase 1   N domain-partitioned discovery+research agents (cross-family, web-enabled):
   |          DISCOVER every model published in the recent window by the in-scope provider families;
   |          gather ALL public benchmark scores + stats, mapped onto the FIXED 10 categories.
   |          Check references/benchmark-sources.md FIRST. -> giga-research/phase-1-agent-{1..N}.md
Phase 1.5 1 agent derives pivotal questions -> orchestrator relays via AskUserQuestion -> persist
Phase 2   N flagship judges (elevated effort, cross-family) independently ARBITRATE the discovered
   |          research into per-category, per-pairing TIER rankings (best→worst) + a rationale each;
   |          1 fresh flagship MERGES -> routing-table-audit.json (audit trail) -> routing-table.json
UPDATE    Write .spec/references/ leaves + assets/routing-table.json + routing-table-audit.json +
   |          source-ledger + decision-rationale in lockstep (fixed spine — never re-derive). Leaf <=200 lines.
3-PASS    Adversarial loop on the updated KB: P1 coverage/activation; P2 RAG/token/citation;
   |          P3 structure/validation + scenario routing. Fresh cross-family critics; repair between.
VALIDATE  Run .spec/references/scripts/validate_kb.py + spec checklist + scenario routing tests.
```

Full phase detail, dispatch how-to, and the output contract live in the `references/` leaves above.
Start with `references/overview.md`, then follow the decision tree per phase.

## Output Contract

The skill run produces:
- Updated `.spec/references/` leaf files (whichever the new rankings change), each <=200 lines.
- Emitted `.spec/references/assets/routing-table-audit.json` — the citeable audit trail of the judged
  rankings (per-pairing source URLs, ISO8601 retrieval times, one-sentence annotations, tier rationale).
- Updated `.spec/references/assets/routing-table.json` with **bumped `version` / `schema_version`** and
  `source` set to the synthesis date, mirroring the markdown routing table. Spine unchanged.
- Updated `.spec/references/source-ledger.md` (new sources) and `.spec/references/decision-rationale.md`
  (the refreshed rankings recorded with rationale + residual risk).
- Canonical `src/routing-table.json` (committed source); copied to `dist/routing-table.json` at build
  time by `scripts/copy-provider.mjs`. `tsc` never emits it (excluded via tsconfig).
- New provenance under `giga-research/` (phase outputs for this run).
- A change note summarizing which rankings shifted and why.

## Cross-Links

- **Artifact updated:** `.spec/references/` — entry point is `.spec/references/retrieval-map.md`
  (load it first to find the right leaf). Validator: `.spec/references/scripts/validate_kb.py`.
- **Fixed taxonomy:** definitions in `.spec/references/work-categories.md`; methodology + rationale
  in `docs/spec/task-taxonomy/`.
- **Provenance:** `giga-research/` holds the per-run research, interview, and judging outputs that
  back the KB. Prior runs are the template for new runs.
- **Routing dogfood:** when selecting sub-agent tiers, route by the KB's own rules
  (see `references/dispatch-mechanics.md` and `references/citations-labels.md`).
