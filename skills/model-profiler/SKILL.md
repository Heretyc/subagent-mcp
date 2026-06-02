---
name: model-profiler
version: 2.0.0
description: Re-profile the cross-provider Claude+Codex sub-agent fleet and reshuffle work-category routes whenever a new model ships (or on demand); file every current-generation Claude+Codex model+effort pairing into tier rankings across 10 generic-agentic task categories (best→worst); emit provider.json with performance + cost_efficiency branches; refresh all .spec/references RAG; update the routing knowledge base and its machine-consumable `assets/routing-table.json`. Use when a new model is released, when asked to profile new model, re-profile models, re-profile the fleet, reshuffle work categories, rebalance routing, update routing table, refresh model profiles, re-run model research, regenerate the routing KB, regenerate provider.json, refresh tier rankings, or to answer "which model for X now" after a model launch. Orchestrator-only giga-research pipeline: domain-partitioned research, pivotal-question interview, flagship synthesis + merge, KB decompose/update, 3-pass adversarial validation, and KB validator + scenario routing tests. Mixed Claude + Codex sub-agents mandatory, dispatched via `mcp__subagent-mcp__launch_agent`.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: May 2026
---

# Model Profiler

Re-profile the Claude+Codex fleet and reshuffle the work-category routes when a new model ships.
**Input** = the new model(s) to profile. **Output** = updated `.spec/references/` routing KB +
`assets/routing-table.json` (version bumped) + a change note in `decision-rationale.md`.

This SKILL.md is the index. Load the detail leaf for the phase you are in. Do **not** preload all
leaves. Each leaf is <=200 lines (AGENTS.md cap).

## Quick Decision Tree

| You are about to… | Load |
|-------------------|------|
| Understand goal, I/O, hard invariants, orchestrator contract | `references/overview.md` |
| Run Phase 0 consent gate (AskUserQuestion) | `references/phase-0-consent.md` |
| Dispatch Phase 1 research / Phase 1.5 interview | `references/phase-1-research.md` |
| Run Phase 2 synthesis + canonical merge | `references/phase-2-synthesis.md` |
| Decompose/update the KB + bump `routing-table.json` | `references/decompose-update.md` |
| Run the 3-pass adversarial loop | `references/adversarial-loop.md` |
| Validate (validator + checklist + scenario routes) | `references/validation.md` |
| Write a sub-agent prompt (dispatch via `mcp__subagent-mcp__launch_agent`) | `references/dispatch-mechanics.md` |
| Cite sources, apply labels, dogfood route tiers | `references/citations-labels.md` |
| Find the artifact being updated / provenance | `references/artifact-map.md` |
| Derive the 10 generic-agentic categories + old→new mapping | `references/category-derivation.md` |
| Understand tier ranking, interpolation, scoring formula, calibration gate | `references/tier-ranking-and-scoring.md` |
| Understand provider.json schema contract + validation rules | `references/provider-json-emission.md` |

## Hard Invariants (Always Active)

1. **Orchestrator-only.** Once you (the agent running this skill) have read the baseline workspace
   files (`AGENTS.md`, the `.spec/references/` leaves you will update, prior `giga-research/`),
   you delegate **all** research, synthesis, validation, and writing to sub-agents. You never
   execute research/synthesis/validation yourself. You dispatch, relay, persist, and decide.
2. **Sub-agents validate sub-agents.** A producing agent never reviews its own output. Critics are
   fresh, mixed-provider, and distinct from producers (Anti-Pattern D / self-review ban).
3. **Mixed Claude + Codex mandatory** when both providers are available. If a required provider is
   missing, **halt and surface** — do not silently single-provider it.
4. **Hub-and-spoke only.** Sub-agents never call sub-agents. All coordination goes through you.
   Inter-agent handoff is via `%TEMP%` scratch files: full content to disk, only **compact JSON
   status** returned to the orchestrator.
5. **Every sub-agent prompt begins with** `<this is a request from a parent process>` and the agent
   returns JSON `{status, summary, source_locators, risks, writes_requested}`.
6. **Consent before dispatch.** Phase 0 is a hard gate (`references/phase-0-consent.md`). No
   sub-agent is launched before the owner confirms model(s), mode, runtime/budget, provider mix.
7. **Provenance purity.** APA citations point to ORIGINAL external sources only. Never cite an
   internal `.spec/references/*.md` file as provenance. Label `[SEED]` / `[INFERRED]` /
   `[ASSUMPTION]` / `[UNVERIFIED]`. See `references/citations-labels.md`.
8. **Line caps.** Every KB leaf and every skill markdown file stays <=200 lines.
9. **One taxonomy.** `provider.json` and the `.spec/references/` RAG share exactly one category
   spine. A run that changes the taxonomy updates both atomically; a half-migrated state never
   reaches the default branch.
10. **DATA-ONLY boundary.** This skill produces `provider.json` + refreshes the RAG. It MUST NOT
    modify `src/index.ts` routing logic. The only code it may touch: `package.json` build script,
    `scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, and `validate_kb.py` taxonomy
    constants.

## Pipeline at a Glance

```
Phase 0   HARD GATE: AskUserQuestion — model(s)? Fast/Full? runtime/budget? provider mix?
   |          (no dispatch before consent)
Phase 1   5 domain-partitioned research agents (mix Sonnet + Codex GPT-5.5, web-enabled)
   |          -> giga-research/phase-1-agent-{1..5}.md
Phase 1.5 1 agent derives 10 pivotal questions -> orchestrator relays via AskUserQuestion
   |          -> persist answers
Phase 2   5 max-effort flagship synthesizers (Opus + Codex xhigh), independent syntheses
   |          -> 1 flagship MERGES into canonical core (new model reconciled into routes)
UPDATE    Re-architect manifest if categories shift; update .spec/references/ leaves +
   |          assets/routing-table.json (bump version) + source-ledger in lockstep;
   |          record reshuffle in decision-rationale.md. Every leaf <=200 lines.
3-PASS    Adversarial loop on updated KB: P1 coverage/activation; P2 RAG/token/citation;
   |          P3 structure/validation + scenario routing. Fresh mixed critics; repair between.
VALIDATE  Run .spec/references/scripts/validate_kb.py + spec checklist + 6 scenario routing tests.
```

Full phase detail, dispatch how-to, and the output contract live in the `references/` leaves above.
Start with `references/overview.md`, then follow the decision tree per phase.

## Output Contract

The skill run produces:
- Updated `.spec/references/` leaf files (whichever the new model changes), each <=200 lines.
- Updated `.spec/references/assets/routing-table.json` with **bumped `version` / `schema_version`**
  and `source` set to the new synthesis date, mirroring the markdown routing table.
- Updated `.spec/references/source-ledger.md` (new sources for the new model) and
  `.spec/references/decision-rationale.md` (the reshuffle recorded with rationale + residual risk).
- Canonical `src/provider.json` (committed source); copied to `dist/provider.json` at build time
  by `scripts/copy-provider.mjs`. `tsc` never emits it (excluded via tsconfig).
- New provenance under `giga-research/` (phase outputs for this run).
- A change note summarizing what reshuffled and why.

## Cross-Links

- **Artifact updated:** `.spec/references/` — entry point is `.spec/references/retrieval-map.md`
  (load it first to find the right leaf). Validator: `.spec/references/scripts/validate_kb.py`.
- **Provenance:** `giga-research/` holds the per-run research, interview, and synthesis outputs
  that back the KB. Prior runs are the template for new runs.
- **Routing dogfood:** when selecting sub-agent tiers, route by the KB's own rules
  (see `references/dispatch-mechanics.md` and `references/citations-labels.md`).
