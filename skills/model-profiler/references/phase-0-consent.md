# phase-0-consent.md : HARD GATE: Owner Consent

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

Default path: use **AskUserQuestion** (a single batched prompt) to confirm the six parameters below.
Do not proceed on assumed defaults.

Exception: if the exact standing repository profile below matches, Phase 0 is satisfied by this
owner-authored directive. Do not ask the owner and do not return `needs_user` for these six
parameters. Persist either the owner's answers or the standing profile to
`%TEMP%\model-profiler\<run-id>\phase-0-consent.md` for this run (this also becomes the provenance
that Phase 1 agents read). All other hard halt conditions remain active.

## Standing repository profile for a bare run

Apply this profile only when **all** conditions are true:

- Current working directory is the `subagent-mcp` repository root.
- The user instruction is exactly `Run the model-profiler skill.` after trimming whitespace.
- The instruction adds no credentials, deletes, branch/git writes, outbound messages, deployments,
  private-data export, taxonomy change, or files outside the profiler write allowlist below.

When matched, use these Phase 0 answers:

| # | Standing answer |
|---|-----------------|
| 1 | **Profiling scope:** current-generation fleet for every repository-supported provider family reachable through Subagent-MCP; recency window is public releases since the prior `research-seed-sites.json` `metadata.last_run_at`, plus current-generation models already retained in `src/routing-table.json`. Phase 1 discovers concrete model ids and effort ladders. |
| 2 | **Mode:** Fast. |
| 3 | **Runtime / budget:** Fast-mode run capped at 90 wall-clock minutes and the current session's configured provider budget; stop as `blocked` on quota or timeout rather than guessing or retrying indefinitely. A reachable-but-single provider family is NOT a `blocked` condition : single-family is a fully-supported path (invariant #5). |
| 4 | **Provider mix (optional):** use whichever Subagent-MCP provider families and effort tiers are reachable. Single-family and multi-family are both fully-supported, first-class paths; provider mix is never required. When only one family is reachable (e.g. Claude-only), dispatch single-family : not a degrade, not a halt. |
| 5 | **Model universe scope:** current generation. |
| 6 | **Emission authorization:** yes, for the profiler write allowlist only. |

Profiler write allowlist (EXACTLY these : the 3 persisted artifacts plus build-wiring):
`src/routing-table.json`, `src/routing-table-audit.json`, `research-seed-sites.json`, `package.json`,
`scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, `scripts/build_routing_table.mjs`,
`scripts/update_seed_sites.mjs`, `scripts/validate_seed_sites.mjs`, and `%TEMP%\model-profiler\**`
(ephemeral research scratch : written, consumed, never persisted to the repo). The spine asset
(`.spec/references/assets/routing-table.json`) and `.spec/references/work-categories.md` are READ-only
inputs, NOT writable. Build-wiring files are idempotent: update them only if the schema or builder
contract changed.

This profile authorizes file edits only; it does **not** authorize staging, commits, pushes, PRs,
branch/worktree changes, deletes, credential access, outbound third-party messages, deployments,
taxonomy-spine changes, or writes outside the allowlist. Inspect `git status --short --branch`
before writes.

## Standing dirty-tree policy

For the exact bare standing run, a dirty tree does not block by itself. Classify dirty and
untracked paths from `git status --porcelain` before Phase 1:

- **Generated outputs that may be overwritten after backup:** the 3 persisted artifacts only :
  `src/routing-table.json`, `src/routing-table-audit.json`, and `research-seed-sites.json`.
- **Adjacent implementation files that may be dirty but are read-only for this run:**
  `skills/model-profiler/**`, `package.json`, `scripts/copy-provider.mjs`,
  `scripts/validate_provider.mjs`, `scripts/build_routing_table.mjs`, `src/routing.ts`, and
  `test/**`. If the run would write one of these dirty paths, halt as `blocked` unless the owner
  separately authorized that schema/build/test change in this session.
- **Any other dirty path:** halt as `blocked` before dispatch; it is unrelated user-owned work.

Before overwriting a generated output with an uncommitted diff, copy its current contents to
`%TEMP%\model-profiler-backups\<run-id>\...` using the same relative path, then record the backup
path in `%TEMP%\model-profiler\<run-id>\phase-0-consent.md` or the run note. Do not use `git stash`,
`reset`, `checkout`, or cleanup commands to manage dirty files. Attempts to overwrite a path outside
the generated-output set above must halt, even if the path is on the broader allowlist.

## No Bounded-Continuation : Fresh-data or ABORT (FRESH-DATA MANDATE)

There is **NO bounded-continuation mode**. Per the FRESH-DATA mandate (SKILL.md Highest-Priority
Mandates : outranks every numbered invariant), every run MUST rank on FRESH research gathered THIS
run. When Phase 1 fan-out would exceed the standing-profile budget cap (90 wall-clock minutes +
session token budget), or any pre-existing/partial scratch is found in the run dir:

1. **Do NOT reuse prior or partial data to keep going, and do NOT GAP-stub to bypass budget.**
2. **ABORT the run** as `blocked` with reason
   `fresh-data-unsatisfiable: <budget|partial-scratch|missing-sources|interruption>`. Surface it;
   do not silently degrade.
3. Prior audit / `research-seed-sites.json` may still SEED a *future* fresh run (source URLs /
   citations to re-investigate) : they NEVER feed ranking/scoring.

A run that cannot obtain and independently re-rank fresh data this run is ABORTED : never degraded,
never resumed from stale/prior data. This abort does not weaken any other barrier (credential,
taxonomy, git-write, out-of-allowlist); it makes the token-budget shortfall a hard ABORT rather than
a partial-continuation.

## Bare-run dispatch sequence (exact bare prompt : fresh-data gates)

The SKILL.md entry point points here. After persisting the standing-profile consent record, follow
this sequence (all within the worktree lifecycle of invariant #15 / `references/execution-lifecycle.md`).
The FRESH-DATA mandate governs every step: rank only on THIS run's fresh research; never reuse
stale/prior/partial data; on any fresh-data shortfall, ABORT.

1. **MANDATORY FIRST CHECK : before Phase 1 dispatch:** does `%TEMP%\model-profiler\<run-id>\`
   already contain pre-existing `phase-1-agent-*.md` files?
   - **YES** → these are stale/pre-existing scratch. Do **NOT** reuse them to skip Phase 1. Either
     run a genuinely fresh Phase 1 (the pre-existing scratch is disregarded for ranking), or, if a
     fresh Phase 1 cannot run this run, **ABORT** as `blocked` (`fresh-data-unsatisfiable`). There is
     no skip-Phase-1 continuation.
   - **NO** → proceed to the standing dirty-tree policy above + fresh Phase 1 dispatch as normal.
2. **Budget shortfall = ABORT (never bypass):** if Phase 1 fresh fan-out cannot complete within the
   session budget, **ABORT** as `blocked` (`fresh-data-unsatisfiable: budget`). Do NOT enter
   bounded-continuation, do NOT reuse partial data, do NOT GAP-stub to bypass budget for ranking.
3. **Phase 1.5→Phase 2 budget gate (fresh-data only):** after Phase 1.5 completes (both
   `phase-1.5-pivotal-questions.md` and `phase-1.5-adjudications.md` exist) on COMPLETE THIS-run
   fresh Phase-1 data, if the Phase 2 LLM synthesis would exceed remaining session budget, you MAY
   defer ONLY the synthesis and deterministically re-rank from THIS run's fresh Phase-1 data:
   - Run `node scripts/build_routing_table.mjs ; if ($LASTEXITCODE -eq 0) { node scripts/validate_provider.mjs }`
   - Emit/regenerate `src/routing-table.json` + `src/routing-table-audit.json` from the fresh data
   - Record in the run note: Phase 2 synthesis deferred (budget constraint); routing table re-ranked
     from THIS run's fresh Phase 1 data via the deterministic builder (no stale/prior data used)
   - Return completion with the Phase 2 synthesis debt labeled deferred/non-blocking
   - If the THIS-run fresh Phase-1 data is itself incomplete, **ABORT** per step 2 rather than
     degrading from stale or partial data.

## The six parameters to confirm

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | **Profiling scope:** which in-scope provider families + which recency window (e.g. last 6 months)? Or a specific model the owner already has in mind? | Bounds discovery. Phase 1 enumerates the concrete model list within this scope; the skill preselects nothing. |
| 2 | **Fast or Full** mode? | Scales fan-out (agent counts) and number of adversarial passes |
| 3 | **Runtime / budget** ceiling? (wall-clock + token/cost budget) | Long background jobs run detached; budget bounds fan-out |
| 4 | **Provider mix** available? (which provider families + effort tiers are reachable now) | Provider mix is OPTIONAL : single-family and multi-family are both fully-supported paths (invariant #5); when only one family is reachable, dispatch single-family : not a degrade, not a halt |
| 5 | **Model universe scope:** "current generation" (recommended) or a strict recency window? | **Tradeoff to surface impartially:** a strict recency window can exclude an older small/low-cost tier that currently anchors a low-complexity category's primary route : leaving that route without a replacement. State this consequence; recommend "current generation"; confirm the owner's choice before proceeding. Name no specific model. |
| 6 | **Authorize the 3-artifact emission + build-wiring?** The run will write `src/routing-table.json` + `src/routing-table-audit.json` + `research-seed-sites.json`, and touch `package.json`, `scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, `scripts/build_routing_table.mjs`, `scripts/update_seed_sites.mjs`, `scripts/validate_seed_sites.mjs`. | These are code/config changes; the owner must scope them in. |

> The taxonomy is **fixed** : there is no "authorize taxonomy change" question. The 14 categories +
> `fallback_default`@99 are immutable inputs (`.spec/references/work-categories.md`); this run only
> refreshes the per-category rankings against them.

## Decision after answers

- **All six answered or standing profile matched + required provider families available + emission
  authorized** -> proceed to Phase 1.
- **Only one provider family reachable** -> NOT a halt and NOT a degrade; dispatch single-family
  (e.g. Claude-only web-research) as a fully-supported, first-class path (invariant #5,
  `dispatch-mechanics.md`). Proceed; do not `blocked`. No risk logging required for the provider mix.
  Critics stay FRESH within-family agents distinct from producers.
- **Owner declines emission scope** -> stop; the run produces no artifacts. (There is no RAG-only
  fallback : the 3 artifacts are the only output.) Surface what will be skipped.
- **Owner declines / defers** -> stop. No dispatch, no writes.
- **Scope unclear** (e.g., "profile the new one" with no family/window) -> ask a narrowing
  follow-up; do not guess the scope and do not preselect a model. The exact bare instruction above
  is not unclear; it uses the standing repository profile.

## Persisted record (example shape)

```md
# Phase 0 : Consent (run YYYY-MM-DD)
- Profiling scope: <provider families>; window <e.g. last 6 months>
- Mode: Fast | Full
- Runtime/budget: <wall-clock>, <token/cost ceiling>
- Provider mix: <families + effort tiers reachable now>
- Model universe scope: current-generation | strict-recency-window
- 3-artifact emission + build-wiring authorized: yes | no
- Consent: granted by <owner> at <time>
- Standing profile: none | bare-reprofile-default
- Notes/constraints: <...>
```

This record is an input to every Phase 1 agent (it tells them the discovery scope and the
corroboration posture to assume for a brand-new release).

---

*Author: Lexi Blackburn : https://github.com/Heretyc/ : May 2026*
