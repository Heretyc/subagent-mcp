# dispatch-mechanics.md — Proven Sub-Agent Dispatch (Claude + Codex)

**Load when:** writing/launching any sub-agent prompt. This is the concrete how-to that makes the
sub-agent fan-out actually work (single-family or mixed-provider — provider mix is optional).

---

## Canonical dispatch — `mcp__subagent-mcp__launch_agent` (both providers)

**Launch ALL sub-agents — Claude and Codex — via `mcp__subagent-mcp__launch_agent`.** This is the
hub-and-spoke primary path: the orchestrator is the hub, every sub-agent is a spoke, and all
coordination flows back through the orchestrator (never spoke-to-spoke). Parameters:

| Param | Values | Notes |
|-------|--------|-------|
| `provider` | `claude` \| `codex` | Which family/CLI backs the agent (provider mix optional — one or more families) |
| `model` | the concrete member id within the chosen family | **Operator-selected at dispatch**, dogfooding the run's `routing-table.json`; the skill prescribes a role, never a named member |
| `effort` | the member's reasoning-effort tier (family ladder, weakest→strongest) | Standard for research/extraction; elevated/maximal for flagship synthesis; operator-selected |
| `prompt` | string | Begins with `<this is a request from a parent process>` |
| `cwd` | path | Working dir for the agent (the repo or a scratch workdir) |

When binding effort, use a concrete selectable tier for any model that supports effort settings.
`none`/no-effort sentinels are only for members with no selectable effort setting.

Pick the **member by the work**, dogfooding the KB's own routing — the skill prescribes the *role*,
the operator binds the concrete member+effort from `routing-table.json`:

| Role (route to) | Use for |
|---|---|
| a low-cost mechanical-execution member | Mechanical read/write — leaf edits, file moves, boilerplate, list/reformat |
| a mid-tier research/build member | Research / review / build / repair — Phase 1 research, critics, repair passes |
| a flagship-synthesis member (elevated effort) | Synthesis / merge / critique / architecture / tie-break — Phase 2, the merge, hard reviews |
| a deterministic-extraction member | Deterministic extraction / structured pulls / closed-loop validator work |

Every prompt starts with `<this is a request from a parent process>` and demands the JSON return
contract (`status, summary, source_locators, risks, writes_requested`).

- **Give Codex agents ample time.** Codex runs are slow; allow generous wall-clock and leave **≥5
  minutes between check-ins** (poll via `mcp__subagent-mcp__poll_agent`, or block on
  `mcp__subagent-mcp__wait`). Do not busy-poll.
- **Verify the output FILE on disk** — the scratch/output file under `%TEMP%\model-profiler\<run-id>\`
  is the source of truth, not the agent's returned stream.

## Single-family (e.g. Claude-only) dispatch — a first-class supported path

Provider mix is **optional** (Hard Invariant #5). Multi-family and single-family are both
fully-supported, first-class paths. When running single-family, dispatch ALL research/judging via that
family's web-research subagents (e.g. Claude via the native Agent tool, or
`mcp__subagent-mcp__launch_agent` with `provider: claude`):

- It does **NOT** block emission and does **NOT** halt the run. It is not a degrade — no risk logging
  required.
- Critics remain FRESH within-family agents distinct from producers — never the producing agent itself
  (self-review ban / Anti-Pattern D; Hard Invariant #4). When ≥2 families are reachable, cross-family
  critics are available; the only invariant is fresh-critic separation, which holds in every case.

## Fallback — if `subagent-mcp` is unavailable

Only if `mcp__subagent-mcp__launch_agent` cannot be used (server absent/unavailable). Otherwise the
canonical path above is mandatory.

**Claude fallback — native Agent tool.** Launch via the native Agent tool with the same model
choices and the same `<this is a request from a parent process>` + JSON-return contract as above.

**Codex fallback — CLI via STDIN (critical):** **PIPE THE PROMPT VIA STDIN. Never pass the prompt as
a positional argument.** Embedded quotes in a positional arg break PowerShell native-command arg
tokenization and the call fails with "unexpected argument". Proven pattern (PowerShell, run in
background for long jobs):

```powershell
$p = @'
<this is a request from a parent process>
<full prompt here — literal $ and backticks are safe inside single-quoted here-string>
'@
$p | codex exec -C <workdir> -m <member-id> -c 'model_reasoning_effort="<effort>"' `
  --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check *> <logfile>
```

- Bind `<member-id>` + `<effort>` from `routing-table.json` at dispatch (operator-selected). Use a
  standard effort tier for research/extraction; an elevated tier for flagship synthesis. Never bind
  `none` for a model that has selectable effort settings.
- Closing `'@` of the here-string MUST be at column 0 (no leading whitespace).
- Run long Codex jobs in the **background**; allow generous time (≥5 min between check-ins).
- **Verify the output FILE on disk** — introspection into the external process is limited, so the
  scratch/output file is the source of truth, not the process stream.

## Finite wait, fallback, and GAP-stub policy

**Maximum wait.** After launching an agent, poll (`mcp__subagent-mcp__poll_agent`) at most
**5 times** (≥5 min between polls, ≤25 min wall-clock). If no terminal status after 5 polls,
treat the agent as **STALLED**.

**Fallback dispatch.** On STALLED or terminal `blocked`/error:
1. Relaunch via an **alternate provider/model** from `routing-table.json`.
   - Bare standing-profile runs: prefer Claude-backed research fallback when Codex is
     usage-limited or unavailable, even if this makes the fallback single-family. Single-family is a
     fully-supported path (invariant #5); no risk logging required for the provider mix itself.
2. Poll the fallback up to **5 times** (≥5 min each).
3. If fallback also stalls or errors: write a **GAP stub** at the expected output path and
   continue. Do not halt the run for a single domain's GAP.

**GAP stub** — minimal markdown at the agent's expected output path:

```markdown
# [GAP] Phase-1 Agent N — <domain>
Agent N did not complete. Reason: STALLED | FAILED | PROVIDER_LIMITED.
Fallback: <provider/model> — also failed or unavailable.
All pairings in domain "<domain>" are [DATA_MISSING] for this run.
Phase 2 judges must treat this domain as [GAP] and flag it in risks.
Remediation: [future run may re-profile this domain with expanded budget]
```

Budget exhaustion is **NOT** a legitimate stub reason. Per the FRESH-DATA mandate (SKILL.md
Highest-Priority Mandates) there is no bounded-continuation: if the session budget cannot cover fresh
research, **ABORT** the run as `blocked` (`fresh-data-unsatisfiable: budget`) rather than GAP-stubbing
to bypass it. GAP stubs remain valid ONLY for a genuinely STALLED/FAILED/PROVIDER_LIMITED single
benchmark agent (provider resilience), never to substitute stale/prior data or to dodge budget.

Do **not** hang indefinitely. A run with provider-resilience GAP stubs continues; a stalled run blocks;
a budget/fresh-data shortfall ABORTS.

## Dogfood the route when picking tiers

Select the sub-agent tier by the KB's routing rules, not by habit — by **role**; the operator binds
the concrete member+effort from `routing-table.json`:

| Work in this pipeline | Route to (role) |
|-----------------------|-----------------|
| Deterministic / extraction / JSON-schema / validator work | a deterministic-extraction member (`agentic_execution`/closed-loop) |
| Review / research / build / repair | a mid-tier research/build member |
| Mechanical read / write | a low-cost mechanical-execution member |
| Synthesis / merge / critique / architecture / tie-break | a flagship-synthesis member (elevated effort) |

## Handoff discipline

Sub-agents write full content to `%TEMP%\model-profiler\<run-id>\` scratch files (ephemeral — consumed
by the builder, never persisted to the repo); only compact JSON status returns to the orchestrator. The
orchestrator reads scratch files on demand. This keeps orchestrator context lean across the whole
multi-phase run.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
