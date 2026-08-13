# Agentic Swarm Workflow Spec

Status: normative spec for the `swarm` MCP tool and the `sub-orchestrator: true` launch_agent flag.
Implementation source of truth for text constants: `src/swarm.ts`.
Sub-orchestrator helpers: `src/sub-orchestrator.ts`.

## What the swarm workflow is

The swarm tool coaches a main orchestrator through a fixed 7-stage workflow for work objectives
projected to span MULTIPLE sessions. The server tracks stage progress in memory for the current
process only; nothing is persisted to disk.

Calling semantics: `swarm(N)` means "stage N is DONE". The tool returns the NEXT stage's coaching
plus the exact next call. Every reply is a plain text result; the swarm tool NEVER sets `isError`.
Out-of-order, repeated, idle, and invalid-stage calls return corrective coaching and leave state
unchanged so a confused caller is steered back onto the sequence.

## In-memory state and no-persistence declaration

State is `{ currentStage: 1..7 | null, pinExpiresAt: number | null }`. `null` = IDLE.
The session is a module-level singleton inside the server process; a server restart resets it to
IDLE by construction. Nothing is written to disk, no state file, no recovery mechanism. The ONLY
recovery path after a process restart (e.g. after the stage-5 handoff spawns a new session) is
the cold `swarm(5)` re-entry call described in section "Re-entry after handoff" below.

## Stage names

| Stage | Name |
|-------|------|
| 1 | planning-team |
| 2 | critic-judgment |
| 3 | write-plan-files |
| 4 | master-goal-prompt |
| 5 | handoff-resume |
| 6 | dispatch |
| 7 | test-complete |

Source: `STAGE_NAMES` array in `src/swarm.ts`.

## Full transition table

| State | Call | Next state | Pin effect | Response |
|-------|------|-----------|-----------|---------|
| IDLE | swarm() / swarm(null) | ACTIVE(1) | pinExpiresAt = now + 3_600_000 | STAGE_COACHING[1] |
| IDLE | swarm(5) | ACTIVE(6) | none (stays null) | SWARM_REENTRY_PREFIX + newline + STAGE_COACHING[6] |
| IDLE | swarm(0) | IDLE | none | notActiveResetText |
| IDLE | swarm(1..4,6,7) | IDLE | none | notActiveText(n) |
| ACTIVE(k) | swarm(null) | ACTIVE(k) | none | alreadyActiveText(k) |
| ACTIVE(k) | swarm(0) | IDLE | pinExpiresAt = null | SWARM_RESET_TEXT |
| ACTIVE(k), k in 1..3 | swarm(k) | ACTIVE(k+1) | pinExpiresAt = now + 3_600_000 (RESTART) | STAGE_COACHING[k+1] |
| ACTIVE(4) | swarm(4) | ACTIVE(5) | pinExpiresAt = null (handoff-next auto-off) | STAGE_COACHING[5] |
| ACTIVE(5) | swarm(5) | ACTIVE(6) | none | STAGE_COACHING[6] |
| ACTIVE(6) | swarm(6) | ACTIVE(7) | none | STAGE_COACHING[7] |
| ACTIVE(7) | swarm(7) | IDLE (terminal reset) | none (already null) | SWARM_COMPLETE_TEXT |
| ACTIVE(k), k>=2 | swarm(k-1) (repeat) | ACTIVE(k) | NONE - never restarts (ruling) | repeatText(k-1, k) |
| ACTIVE(k) | swarm(m), other m in 1..7, m != k | ACTIVE(k) | none | outOfOrderText(m, k) |
| any | non-integer / outside 0..7 | unchanged | none | invalidStageText(got, state) |

Reset semantics: (a) `swarm(0)` abandons and clears state and pin; (b) `swarm(7)` completes and
resets to IDLE so a new swarm can start; (c) process restart implicitly resets.

Cold adoption rules for non-null stage calls when IDLE: only `swarm(5)` is adopted (post-handoff
re-entry). Cold `swarm(1..4)` is rejected with NOT-ACTIVE because it would arm pinned territory
without a real start (gaming vector). Cold `swarm(6..7)` is rejected because the dispatch and
test stages claim to be done without ever running.

## Re-entry after handoff

The stage-5 handoff carries swarm state to a new session via the printed master goal prompt (not a
handoff-write record). The new session's server process starts IDLE. The designated re-entry call
is `swarm(5)`, which transitions directly to ACTIVE(6) and returns STAGE_COACHING[6]. No other
cold-start beyond `swarm(null)` and `swarm(5)` is ever adopted.

Performance pin design (arm/restart/auto-off/call-site/anti-gaming): [swarm-pin.md](swarm-pin.md).

## Sub-orchestrator contract

### What sub-orchestrator: true does

Setting `sub-orchestrator: true` on a `launch_agent` call (main orchestrator only, depth 0) causes
the server to:

1. Insert the `SUB_ORCHESTRATOR_DIRECTIVE` block directly below the parent-process marker line in
   the child's prompt (via `applySubOrchestratorDirective` from `src/sub-orchestrator.ts`).
2. Set env `SUBAGENT_MCP_SUB_ORCHESTRATOR=1` in the child's environment.
3. Serve `SUB_ORCHESTRATOR_INSTRUCTIONS` (from `src/index.ts`) as the child's MCP `instructions`
   when both `SUBAGENT_MCP_SUBAGENT=1` and `SUBAGENT_MCP_SUB_ORCHESTRATOR=1` are set.
4. Register `respond_permission` in the child's server (a sub-orchestrator is the parent of its
   workers and must answer their parked permission requests).

The child is a DELEGATE-ONLY orchestrator for exactly ONE disjoint section of a larger plan.
It operates under the same rules as a main orchestrator with orchestration mode ON. The
parent-process marker does NOT exempt the sub-orchestrator from orchestration; the env marker and
per-turn hook directive jointly enforce it.

### Depth gate

`sub-orchestrator: true` is available ONLY to the main orchestrator (depth 0). Launches from
depth >= 1 are rejected with `SUB_ORCH_DEPTH_ERROR`. Rationale: a sub-orchestrator runs at depth 1;
its workers run at depth 2; the depth cap (`launchDepth >= 2` in `src/index.ts`) prevents workers
from spawning further. If a sub-orchestrator could spawn another sub-orchestrator (depth 1 -> 2),
that second sub-orchestrator's workers would be at depth 3 and could not launch at all.

### Anti-inheritance (env strip proof)

Grandchildren NEVER inherit `SUBAGENT_MCP_SUB_ORCHESTRATOR=1`. The proof chain:

- `buildChildEnv` in `src/index.ts` unconditionally deletes `SUB_ORCHESTRATOR_ENV` from every
  child env UNLESS this specific launch sets the flag.
- Code: `if (overrides[SUB_ORCHESTRATOR_ENV] !== "1") delete env[SUB_ORCHESTRATOR_ENV];`
- A sub-orchestrator's workers are launched with `SUBAGENT_MCP_SUBAGENT=1,
  SUBAGENT_MCP_DEPTH=2`, and NO sub-orchestrator marker.
- Workers cannot spawn (depth cap at >= 2).
- The directive lives only in the flagged child's prompt; it is never inherited.

### Per-turn hook emission

In `runHook` (`src/orchestration/hook-core.ts`), BEFORE the `isSubagent` bail at line 756,
a stateless sub-orchestrator check emits the orchestration tag per turn:

```
if env.SUBAGENT_MCP_SUBAGENT === "1" && env.SUBAGENT_MCP_SUB_ORCHESTRATOR === "1":
  body = readDirective(env, "sub-orchestrator-on.md")
  return composeTag({ state: "on", kind: "sub-orchestrator", phase: "normal", utilization: "unknown" }) + body
```

This is STATELESS: no session pointer is written, no metering state is touched, no latch is set.
A sub-orchestrator sharing the parent's cwd MUST NOT steal the cwd session pointer that
orchestration-mode/handoff tools key on.

### Plan-file intake exception

A sub-orchestrator may directly read the ONE plan file named in its launch prompt. This is the
sole exception to the delegate-only read ladder. Reading the plan file grants no task-side action
authority; all action still runs through sub-agents.

### Worker rules (sub-orchestrator's own sub-agents)

- Workers are NORMAL sub-agents: `sub-orchestrator: true` is NEVER set on them.
- Workers run at `SUBAGENT_MCP_DEPTH=2` and cannot spawn further (depth cap).
- The sub-orchestrator serializes workers that write the same files; never concurrent writers
  over overlapping paths.
- Completion is learned via the `wait` tool on loop; an empty or stalled tail means ALIVE.
- The sub-orchestrator does NOT call swarm and does NOT write handoffs; stage reporting belongs
  to the main orchestrator.
- On completion the sub-orchestrator returns JSON:
  `{ status, summary, source_locators, risks, writes_requested }`.

## Intended usage (swarm dispatch stage)

`sub-orchestrator: true` is scoped to the swarm dispatch stage (stage 6). The main orchestrator
launches exactly ONE sub-orchestrator per plan file path, in parallel, each on a disjoint section.
Setting the flag outside this dispatch pattern is never correct.

## Tool registration

The `swarm` tool is registered ONLY when `SUBAGENT_MCP_SUBAGENT !== "1"`. Children and
sub-orchestrators never see it: they must not call swarm and cannot accidentally do so.

## Related

- `src/swarm.ts`: text constants source of truth (coaching, descriptions, corrective templates).
- `src/sub-orchestrator.ts`: sub-orchestrator helpers (directive, env constant, param/error text).
- `docs/spec/auto-mode/routing-table-contract.md`: branch selection, swarm pin subsection,
  sanctioned-exposures list.
- `docs/spec/auto-mode/tool-description.md`: verbatim launch_agent/swarm tool descriptions.
- `docs/spec/error-catalogue.md`: ERR_SUBORCH_DEPTH row.
- `docs/spec/dev-loop/orchestration-directive-architecture/appendix-a5-directives.md`:
  sub-orchestrator-on.md directive verbatim.
