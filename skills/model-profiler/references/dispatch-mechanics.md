# dispatch-mechanics.md — Proven Sub-Agent Dispatch (Claude + Codex)

**Load when:** writing/launching any sub-agent prompt. This is the concrete how-to that makes the
mixed-provider fan-out actually work.

---

## Canonical dispatch — `mcp__subagent-mcp__launch_agent` (both providers)

**Launch ALL sub-agents — Claude and Codex — via `mcp__subagent-mcp__launch_agent`.** This is the
hub-and-spoke primary path: the orchestrator is the hub, every sub-agent is a spoke, and all
coordination flows back through the orchestrator (never spoke-to-spoke). Parameters:

| Param | Values | Notes |
|-------|--------|-------|
| `provider` | `claude` \| `codex` | Which family/CLI backs the agent (≥2 families across the run) |
| `model` | the concrete member id within the chosen family | **Operator-selected at dispatch**, dogfooding the run's `routing-table.json`; the skill prescribes a role, never a named member |
| `effort` | the member's reasoning-effort tier (family ladder, weakest→strongest) | Standard for research/extraction; elevated/maximal for flagship synthesis; operator-selected |
| `prompt` | string | Begins with `<this is a request from a parent process>` |
| `cwd` | path | Working dir for the agent (the repo or a scratch workdir) |

Pick the **member by the work**, dogfooding the KB's own routing — the skill prescribes the *role*,
the operator binds the concrete member+effort from `routing-table.json`:

| Role (route to) | Use for |
|---|---|
| a low-cost mechanical-execution member | Mechanical read/write — leaf edits, file moves, boilerplate, list/reformat |
| a mid-tier research/build member | Research / review / build / repair — Phase 1 research, critics, repair passes |
| a flagship-synthesis member (elevated effort) | Synthesis / merge / critique / architecture / tie-break — Phase 2, the merge, hard reviews |
| a deterministic-extraction member (cross-family) | Deterministic extraction / structured pulls / closed-loop validator work |

Every prompt starts with `<this is a request from a parent process>` and demands the JSON return
contract (`status, summary, source_locators, risks, writes_requested`).

- **Give Codex agents ample time.** Codex runs are slow; allow generous wall-clock and leave **≥5
  minutes between check-ins** (poll via `mcp__subagent-mcp__poll_agent`, or block on
  `mcp__subagent-mcp__wait`). Do not busy-poll.
- **Verify the output FILE on disk** — the scratch/output file under `%TEMP%` (and the durable copy
  in `giga-research/`) is the source of truth, not the agent's returned stream.

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
  standard effort tier for research/extraction; an elevated tier for flagship synthesis.
- Closing `'@` of the here-string MUST be at column 0 (no leading whitespace).
- Run long Codex jobs in the **background**; allow generous time (≥5 min between check-ins).
- **Verify the output FILE on disk** — introspection into the external process is limited, so the
  scratch/output file is the source of truth, not the process stream.

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

Sub-agents write full content to `%TEMP%` scratch files (and to `giga-research/` where it is durable
provenance); only compact JSON status returns to the orchestrator. The orchestrator reads scratch
files on demand. This keeps orchestrator context lean across the whole multi-phase run.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
