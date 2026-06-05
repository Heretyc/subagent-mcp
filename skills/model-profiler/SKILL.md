---
name: model-profiler
version: 3.0.0
description: Impartially PROFILE the cross-provider sub-agent fleet against the FIXED canonical 10 work-categories whenever a new model ships (or on demand). Discover every model published in the recent window by the in-scope provider families, gather ALL public benchmark scores + statistics, map them onto the fixed 10 categories, then JUDGE each model+effort pairing into per-category tier rankings (best→worst) SOLELY from the discovered research, with a recorded rationale per tier placement. Emits exactly 3 artifacts: routing-table.json (lean), routing-table-audit.json (full provenance), research-seed-sites.json (accumulating learned source list). Single-family and multi-family are both fully-supported, first-class paths; provider mix is optional. The 10 categories are immutable inputs — this skill never derives, chooses, renames, reorders, or reshuffles them. Use when a new model is released, when asked to profile new model, re-profile models, re-profile the fleet, rebalance routing, update routing table, refresh model profiles, re-run model research, regenerate routing-table.json, refresh tier rankings, or to answer "which model for X now" after a model launch. Orchestrator-only pipeline: model discovery + maximalist benchmark research, pivotal-question interview, flagship judging + merge, 3-artifact emission, 3-pass adversarial validation, and provider/seed validators + scenario routing tests. Sub-agents dispatched via `mcp__subagent-mcp__launch_agent`; cross-family critics are available when ≥2 families are reachable.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: May 2026
---

# Model Profiler

Impartially profile the sub-agent fleet against the **FIXED canonical 10 work-categories** when a
new model ships (or on demand). The skill is the **impartial judge of all models**: it discovers the
models, gathers their public benchmarks, and ranks each model+effort pairing per category — it does
**not** decide what the categories are.

**Input** = the profiling scope (in-scope provider families + recent window) confirmed in Phase 0
or supplied by the standing repository profile when its exact trigger matches.
**Output** = EXACTLY 3 persisted artifacts (`src/routing-table.json`, `src/routing-table-audit.json`,
`research-seed-sites.json`); nothing else persists. See the Output Contract below.

This SKILL.md is the index. Load the detail leaf for the phase you are in. Do **not** preload all
leaves. Each leaf is <=200 lines (AGENTS.md cap).

## Required Runner (read first)

**Never run this skill on Haiku, or any model lacking sub-agent-launch support or
long-horizon reasoning.** It is orchestrator-only: the runner dispatches every
research/judging/validation step via `mcp__subagent-mcp__launch_agent` and must
sustain multi-phase reasoning across the run. Such a model silently degrades the
pipeline — **halt and escalate to the owner**; do not run it.

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
| Run Phase 0 consent gate or apply the standing repository profile | `references/phase-0-consent.md` |
| Dispatch Phase 1 model-discovery + benchmark research / Phase 1.5 interview | `references/phase-1-research.md` |
| Check the canonical benchmark source list FIRST (run-to-run stability) | `references/benchmark-sources.md` |
| Run Phase 2 judging/arbitration + canonical merge | `references/phase-2-synthesis.md` |
| Emit the 3 artifacts (run builder + seed merge) | `references/decompose-update.md` |
| Run the 3-pass adversarial loop | `references/adversarial-loop.md` |
| Validate (validator + checklist + scenario routes) | `references/validation.md` |
| Write a sub-agent prompt (dispatch via `mcp__subagent-mcp__launch_agent`) | `references/dispatch-mechanics.md` |
| Cite sources, apply labels, dogfood route tiers | `references/citations-labels.md` |
| Find the artifact being updated / provenance | `references/artifact-map.md` |
| Confirm the FIXED 10-category taxonomy + where its methodology lives | `references/category-derivation.md` (pointer) → `.spec/references/work-categories.md` |
| Understand tier ranking, interpolation, scoring formula, calibration gate | `references/tier-ranking-and-scoring.md` |
| Understand routing-table.json schema contract + validation rules | `references/provider-json-emission.md` |

## Orchestration Entry Point: Phase 0 Detection

**Exact prompt** (whitespace-trimmed): `Run the model-profiler skill.` → apply standing repository profile without consent prompts. Authorized bare default run.

**Pre-conditions:** CWD=repo root; prompt exact; no credentials/deletes/git-writes/taxonomy-changes/outbound-messages/out-of-allowlist requests.

**When matched:**
1. Use standing-profile answers: current-generation fleet, all reachable families, Fast mode, 90 min + session budget, provider mix optional (single-family and multi-family both fully supported; neither halts). Persist to `%TEMP%\model-profiler\<run-id>\phase-0-consent.md`.
2. **MANDATORY FIRST CHECK — before Phase 1 dispatch:** does the `%TEMP%\model-profiler\<run-id>\` run dir contain all 5 valid `phase-1-agent-{1..5}.md`?
   - **YES** → bounded-continuation mode: skip Phase 1 dispatch; jump to Phase 1.5 + Phase 2. Note: `Continuation mode: bounded (reusing current-day Phase 1)`.
   - **NO** → proceed to dirty-tree check (§Dirty-tree policy) + Phase 1 dispatch as normal.
3. **Token-budget fallback:** if Phase 1 fan-out exceeds session budget AND no reuse from step 2, enter bounded-continuation: reuse existing agents, write GAP stubs for missing, proceed to Phase 1.5 + Phase 2. Emit routing-table.json (bounded or full); block only on safety rules, never budget alone.
4. **Phase 1.5→Phase 2 budget gate (exact bare prompt only):** After Phase 1.5 is complete (both `phase-1.5-pivotal-questions.md` and `phase-1.5-adjudications.md` exist), if Phase 2 synthesis would exceed remaining session budget, do **not** ask continue/checkpoint/hybrid. Instead, automatically:
   - Run deterministic routing artifact emission: `node scripts/build_routing_table.mjs && node scripts/validate_provider.mjs`
   - Emit/regenerate `src/routing-table.json` and `src/routing-table-audit.json`
   - Record in the run note: Phase 2 synthesis deferred (budget constraint); routing table refreshed from Phase 1 data via deterministic builder
   - Return completion status with Phase 2 synthesis debt clearly labeled deferred/non-blocking

**Non-matching prompts:** load `references/phase-0-consent.md` and run full AskUserQuestion consent flow.

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
3. **Orchestrator-only.** Once you have read the baseline workspace files (`AGENTS.md`,
   `work-categories.md`, prior `src/routing-table.json`, prior `research-seed-sites.json`), you
   delegate **all** research, judging, validation, and writing to sub-agents. You dispatch, relay,
   persist, and decide — never execute the work yourself.
4. **Sub-agents validate sub-agents.** A producing agent never reviews its own output. Critics are
   FRESH agents distinct from producers (self-review ban / Anti-Pattern D), regardless of provider
   family. Cross-family critics are **available** when ≥2 families are reachable; on a single-family
   run, critics are fresh within-family agents — either way, never the producing agent itself.
5. **Provider mix is optional.** Single-family and multi-family are BOTH fully-supported, first-class
   paths — neither is a degrade, neither is logged as risk; the profiler never requires a provider
   blend. A single-family run (e.g. Claude-only web-research) is equally valid. The only invariant is
   the fresh-critic / self-review ban (#4): critics must be distinct agents from producers in every case.
6. **Hub-and-spoke only.** Sub-agents never call sub-agents. All coordination goes through you.
   Inter-agent handoff is via `%TEMP%` scratch files: full content to disk, only **compact JSON
   status** returned to the orchestrator.
7. **Every sub-agent prompt begins with** `<this is a request from a parent process>` and the agent
   returns JSON `{status, summary, source_locators, risks, writes_requested}`.
8. **Consent before dispatch.** Phase 0 is a hard gate (`references/phase-0-consent.md`). No
   sub-agent is launched before the owner confirms scope, mode, runtime/budget, and provider mix,
   or the exact standing repository profile trigger applies. Phase 0 confirms scope only — it must
   **not** preselect concrete models or efforts, and it never relaxes credential, destructive-action,
   outbound-message, git-write, or out-of-scope file protections.
9. **Provenance purity.** APA citations point to ORIGINAL external sources only. Never cite an
   internal `.spec/references/*.md` file as provenance. Label `[SEED]` / `[INFERRED]` /
   `[ASSUMPTION]` / `[UNVERIFIED]`. See `references/citations-labels.md`.
10. **Line caps.** Every KB leaf and every skill markdown file stays <=200 lines.
11. **One spine, atomic update.** The spine is still the one FIXED category spine; a run atomically
    emits the 3 routing artifacts together; the spine itself never changes, and a half-emitted state
    never reaches the default branch.
12. **Owner directive (absolute).** Models with selectable effort settings must never emit `none` or
    other no-effort sentinels in the routing table, regardless of Phase 1 notes, vendor documentation,
    or other authority. Phase 1 agents exclude such pairings; Phase 2 judges silently drop them if
    discovered in research; the validator rejects them. This is enforced independent of the authority
    chain and overrides all cross-family research consensus.
13. **DATA-ONLY boundary.** This skill produces the 3 artifacts (`src/routing-table.json` +
    `src/routing-table-audit.json` + `research-seed-sites.json`). It MUST NOT modify `src/index.ts`
    routing logic. The only code it may touch: `package.json`, `scripts/copy-provider.mjs`,
    `scripts/validate_provider.mjs`, `scripts/build_routing_table.mjs`, `scripts/update_seed_sites.mjs`,
    and `scripts/validate_seed_sites.mjs`.
14. **No-effort exclusion (6 categories).** Models whose ONLY effort is a no-effort sentinel
    (`null`/`none`/`n/a` — e.g. `claude-haiku-4-5`, `gpt-5.5-pro`, `gpt-5.4-mini`) are EXCLUDED from
    ranking in `agentic_execution`, `architecture`, `security_review`, `debugging`, `quality_review`,
    `knowledge_synthesis` (those 6 carry a REDUCED per-category universe), but REMAIN ranked in the
    other 4 (`math_proof`, `data_analysis`, `coding`, `mechanical`, full universe).
    `build_routing_table.mjs` enforces this at ranking; `validate_provider.mjs` checks per-category
    coverage against the reduced set. **Distinct from #12** (which bans emitting `none` for
    EFFORT-CAPABLE models): #14 EXCLUDES genuinely no-effort models from 6 categories.

## Pipeline at a Glance

```
Phase 0   HARD GATE: AskUserQuestion or exact standing repository profile — scope? Fast/Full?
   |          runtime/budget? provider mix? (impartial — do NOT preselect models/efforts;
   |          no dispatch before consent/profile match)
   |
   v
CHECK:    For exact bare prompt ONLY: are all 5 phase-1-agent-*.md files present + valid in
   |       %TEMP%\model-profiler\<run-id>\? If YES → enter bounded-continuation mode;
   |       skip Phase 1 dispatch; jump to Phase 1.5. If NO → proceed to Phase 1.
   |
   v
Phase 1   [OPTIONAL] N domain-partitioned discovery+research agents (web-enabled; any provider mix):
(skip)         DISCOVER every model published in the recent window by the in-scope provider families;
or run         gather ALL public benchmark scores + stats, mapped onto the FIXED 10 categories.
               Check references/benchmark-sources.md FIRST. -> %TEMP%\...\phase-1-agent-{1..N}.md
   |
   v
Phase 1.5 1 agent derives pivotal questions -> AskUserQuestion, or standing-profile adjudication -> persist
   |
   v
Phase 2   N flagship judges (elevated effort; any provider mix) independently ARBITRATE the discovered
   |          research into per-category, per-pairing TIER rankings (best→worst) + a rationale each;
   |          1 fresh flagship MERGES -> routing-table-audit.json (audit trail) -> routing-table.json
   |
   v
EMIT      Assemble ephemeral structured-dataset.json under %TEMP%; run the deterministic builder ->
   |          src/routing-table.json + src/routing-table-audit.json; run update_seed_sites.mjs ->
   |          research-seed-sites.json (fixed spine — never re-derive). No .spec/references writes.
   |
   v
3-PASS    Adversarial loop on the 3 artifacts: P1 coverage/activation; P2 citation honesty;
   |          P3 structure/validation + scenario routing. Fresh critics; repair between.
   |
   v
VALIDATE  Run scripts/validate_provider.mjs + audit-mirror + scripts/validate_seed_sites.mjs +
          run-level existence/growth check (validation.md §1c) + spec checklist + scenario routing tests.
```

Full phase detail and dispatch how-to live in the `references/` leaves above; start with `references/overview.md`, then follow the decision tree per phase.

## Output Contract

The skill run produces **EXACTLY 3 persisted artifacts** — nothing else persists to the repo:
- `src/routing-table.json` — lean canonical routing table (`performance` + `cost_efficiency` →
  10 fixed categories → ordered pairings). Copied to `dist/routing-table.json` by `copy-provider.mjs`.
- `src/routing-table-audit.json` — full-provenance audit trail (per-pairing source URLs, ISO8601
  retrieval times, annotations, tier rationale). SOLE provenance store; the change note (what shifted +
  why) lives in its metadata.
- `research-seed-sites.json` (repo root) — accumulating learned source registry, merged from this run's
  audit citations by `update_seed_sites.mjs`.

Phase research is EPHEMERAL — written to `%TEMP%\model-profiler\<run-id>\`, consumed, never persisted.

## Cross-Links

- **Validators:** provider = `scripts/validate_provider.mjs`; seed = `scripts/validate_seed_sites.mjs`.
- **Fixed taxonomy:** definitions in `.spec/references/work-categories.md`; methodology + rationale
  in `docs/spec/task-taxonomy/`.
- **Provenance:** durable provenance = the audit file's `citations[]` + `research-seed-sites.json`;
  prior `src/routing-table.json` + `research-seed-sites.json` are the diff template for new runs.
- **Routing dogfood:** when selecting sub-agent tiers, route by the routing table's own rules
  (see `references/dispatch-mechanics.md` and `references/citations-labels.md`).
