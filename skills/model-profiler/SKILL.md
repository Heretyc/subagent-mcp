---
name: model-profiler
version: 3.1.0
description: Impartially PROFILE the cross-provider sub-agent fleet against the FIXED 14 work-categories (directly benchmarked parents + 4 composite-inferred) whenever a new model ships (or on demand). Discover every model published in the recent window by the in-scope provider families, gather ALL public benchmark scores + statistics, map them onto the directly benchmarked parent categories (composites composed from parents, never directly benchmarked), then JUDGE each model+effort pairing into per-category tier rankings (best→worst) SOLELY from the discovered research, with a recorded rationale per tier placement. Emits exactly 3 artifacts: routing-table.json (lean), routing-table-audit.json (full provenance), research-seed-sites.json (accumulating learned source list). Single-family and multi-family are both fully-supported, first-class paths; provider mix is optional. The 14 categories are immutable inputs — this skill never derives, chooses, renames, reorders, or reshuffles them. Use when a new model is released, when asked to profile new model, re-profile models, re-profile the fleet, rebalance routing, update routing table, refresh model profiles, re-run model research, regenerate routing-table.json, refresh tier rankings, or to answer "which model for X now" after a model launch. Orchestrator-only pipeline: model discovery + maximalist benchmark research, pivotal-question interview, flagship judging + merge, 3-artifact emission, 3-pass adversarial validation, and provider/seed validators + scenario routing tests. Sub-agents dispatched via `mcp__subagent-mcp__launch_agent`; cross-family critics are available when ≥2 families are reachable.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: May 2026
updated: 2026-07-02
---

# Model Profiler

Impartially profile the sub-agent fleet against the **FIXED 14 work-categories** (directly benchmarked parents + 4 composite-inferred) when a
new model ships (or on demand). The skill is the **impartial judge of all models**: it discovers the
models, gathers their public benchmarks, and ranks each model+effort pairing per category — it does
**not** decide what the categories are.

**Input** = the profiling scope (in-scope provider families + recent window) confirmed in Phase 0
or supplied by the standing repository profile when its exact trigger matches.
**Output** = EXACTLY 3 persisted artifacts (`src/routing-table.json`, `src/routing-table-audit.json`,
`research-seed-sites.json`); nothing else persists. See the Output Contract below.

This SKILL.md is the index — load only the current phase's detail leaf, never all of them. Each md file stays <=200 lines (AGENTS.md cap).

## Required Runner (read first)

**Run ONLY on the highest available flagship model the operating provider offers (whatever
that currently is), at its highest OR second-highest effort setting** (i.e. a top-tier
reasoning model at high effort; the provider-equivalent top model+effort otherwise). Note:
binding an explicit runner model/effort for sub-agents is itself gated — see the gating
preamble in `references/dispatch-mechanics.md` (`smart` mode rejects selector-bearing launches
unless the `user-approved-overrides` window is open). It is
orchestrator-only: the runner dispatches every research/judging/validation step via
`mcp__subagent-mcp__launch_agent` and must sustain multi-phase reasoning across the whole
run. **Never run on Haiku, a non-flagship tier, an effort below second-highest, or any
model lacking sub-agent-launch support or long-horizon reasoning** — these silently
degrade the pipeline. If the runner does not meet this bar, **halt and escalate to the
owner**; do not run it. (Runner requirement only — distinct from invariant #2's ban on the
skill naming a preferred model for the JUDGED routing output.)

## Fixed Taxonomy (immutable input — never derived here)

The 14 categories (directly benchmarked parents + 4 composite-inferred) + `fallback_default`@99
are **fixed and immutable**. Precedence order:

```
math_proof > security_review > debugging > quality_review > architecture >
agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical >
prompt_engineering > vulnerability_research > molecular_biology > ml_accelerator_design
```

Tiles 11–14 are **composite-inferred**: no benchmark alias, never directly benchmarked — competency
composed from their parent tiles (`docs/spec/task-taxonomy/composite-inferred-tiles.md`).

`fallback_default` @99 — off-spine no-match catch-all; never one of the 14. Operational definitions
live in `.spec/references/work-categories.md`; determination methodology + rationale (incl. debate
provenance) live in `docs/spec/task-taxonomy/`. This skill profiles models **against** this spine.

## Quick Decision Tree

| You are about to… | Load |
|-------------------|------|
| Set up the worktree/branch gate + run the full git lifecycle (setup → commit → push → PR → deliver) — DO THIS FIRST | `references/execution-lifecycle.md` |
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
| Confirm the FIXED 14-category taxonomy + where its methodology lives | `references/category-derivation.md` (pointer) → `.spec/references/work-categories.md` |
| Understand tier ranking, interpolation, scoring formula, calibration gate | `references/tier-ranking-and-scoring.md` |
| Understand routing-table.json schema contract + validation rules | `references/provider-json-emission.md` |

## Orchestration Entry Point: Phase 0 Detection

**Exact prompt** (whitespace-trimmed): `Run the model-profiler skill.` → apply the standing repository profile without consent prompts (authorized bare default run). **Pre-conditions:** CWD=repo root; prompt exact; no credentials/deletes/git-writes/taxonomy-changes/outbound-messages/out-of-allowlist requests.

**When matched:** apply the standing-profile answers (current-generation fleet, all reachable families, Fast mode, 90 min + session budget, provider mix optional), then follow the **bare-run dispatch sequence** (fresh Phase 1 every run; pre-existing scratch or budget/time shortfall → **ABORT**, never bounded-continuation, per the FRESH-DATA mandate → Phase 1.5→Phase 2 budget gate) in `references/phase-0-consent.md`. **Non-matching prompts:** load `references/phase-0-consent.md` and run the full AskUserQuestion consent flow.

(All of the above runs INSIDE the execution lifecycle — invariant #15: the worktree gate fires before Phase 0 detection, and the commit→push→PR→deliver lifecycle follows VALIDATE.)

## Highest-Priority Mandates (OVERRIDE every numbered invariant below on any conflict)

- **FRESH-DATA MANDATE (highest priority, non-negotiable).** EVERY run MUST rank on FRESH research gathered THIS run; the prior audit (`src/routing-table-audit.json`) and any prior committed rankings MUST NOT feed ranking/scoring — only SEED research (URLs / citations to re-investigate). If fresh data cannot be obtained and independently re-ranked this run — for ANY reason (budget/time, partial or pre-existing scratch, missing sources, interruption) — the run MUST **ABORT**: no continue, no bounded-continuation, no GAP-stub bypass for ranking; never degrade or resume from stale/prior data. (Reinforces #2: prior rankings diffed/flagged, never inherited.)
- **DELIVERY MANDATE.** Every run ALWAYS OFFERS the full delivery lifecycle, never silently skipped: commit the 3 artifacts → push → open PR → resolve PR merge conflicts → mark PR ready → surface the clickable hyperlink for the user to MERGE the PR. (Extends #15's DELIVER box.)

## Hard Invariants (Always Active)

1. **Fixed taxonomy.** The 14 categories (directly benchmarked parents + 4 composite-inferred) + `fallback_default`@99 are **immutable inputs**, defined in
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
14. **No-effort exclusion (cost_efficiency branch).** Models whose ONLY effort is a no-effort
    no-effort sentinel (`null`/`none`/`n/a` — e.g. `claude-haiku-4-5`) are EXCLUDED from
    six parent categories `agentic_execution`, `architecture`, `security_review`, `debugging`,
    `quality_review`, `knowledge_synthesis`, but REMAIN ranked in the full-universe parents
    `math_proof`, `data_analysis`, `coding`, `mechanical`. Composite categories inherit parent
    eligibility: include a pairing if at least one parent includes it; compute simple mean over
    eligible parent ranks only. This is why no-effort exclusions are inherited automatically.
    `build_routing_table.mjs` enforces this at ranking; `validate_provider.mjs` checks coverage.
    **Distinct from #12** (which bans emitting `none` for EFFORT-CAPABLE models): #14 EXCLUDES
    genuinely no-effort models from 6 parent categories.
    The authoritative effort ladder per model is the dataset's `model_effort_universe`; see
    `audit.metadata.model_effort_universe` as the single source of truth. On the `performance`
    branch, invariant #16's effort floor subsumes this rule (no-effort = below `high`).
15. **Execution lifecycle + worktree gate (ABSOLUTE — precedes every other step).** Every
    run executes inside ONE fixed, never-reordered, never-skipped lifecycle:
    `worktree/branch gate → main skill execution → commit → push → PR → resolve merge
    conflicts → PR ready → deliver PR link + change-summary`. The FIRST action of any run —
    before Phase 0, before any read-for-write, before any dispatch — is the worktree gate:
    `node scripts/check_worktree.mjs` MUST print `WORKTREE-GATE: PASS`. ALL mutating work is
    FORBIDDEN in the primary tree; it happens only inside a compliant LINKED worktree on a
    `<type>/<subject>` branch OUTSIDE the repo. Native `EnterWorktree` is NON-COMPLIANT — use
    the manual `git worktree add`. The final deliverable is the PR hyperlink plus a concise
    summary of what changed in `src/routing-table.json` since its last merged update. Full
    steps: `references/execution-lifecycle.md`; mandate: `docs/spec/dev-loop/worktree-enforcement/`.
16. **Effort floors (owner directives 2026-06-11 + 2026-06-15 — FINAL AND BINDING).**
    Low effort is never ranked in any branch: the builder purges `low` from the global universe,
    validators reject it in committed artifacts, and callers cannot select it as a launch effort.
    Separately, the `performance` branch must NEVER rank any pairing below `high`
    (`null`/`none`/`min`/`light`/`medium`) because performance/deadlock routing must not choose
    weak-effort variants. `cost_efficiency` may still rank valid non-low efforts below `high`.
    `build_routing_table.mjs`, `validate_provider.mjs`, and
    `test/performance-tier-effort.test.mjs` enforce both rules on every build and commit.
17. **Fresh-data (Highest-Priority Mandate — overrides #1–16).** Rank on THIS run's fresh research; prior audit/rankings SEED only. Cannot gather & re-rank fresh data this run → **ABORT** (`blocked`); no bounded-continuation, no GAP-stub bypass for ranking.
18. **Delivery (Highest-Priority Mandate).** Every run ALWAYS OFFERS commit → push → PR → resolve conflicts → PR ready → clickable MERGE hyperlink; never silently skipped.

## Pipeline at a Glance

The Phase 0 → VALIDATE pipeline — wrapped by the SETUP (worktree gate) and DELIVER (commit → push →
PR → deliver link+summary) boxes of invariant #15 — is diagrammed in `references/overview.md`
(§Pipeline at a Glance). Start there, then follow the decision tree per phase.

## Output Contract

The skill run produces **EXACTLY 3 persisted artifacts** — nothing else persists to the repo:
- `src/routing-table.json` — lean canonical routing table (`performance` + `cost_efficiency` →
  14 fixed categories → ordered pairings). Copied to `dist/routing-table.json` by `copy-provider.mjs`.
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
