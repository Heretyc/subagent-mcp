# Repository Agent Instructions

<!-- subagent-mcp:managed:begin schema=4 -->
## subagent-mcp invariant — managed block, do not edit between markers

Upserted by `subagent-mcp init` at user request; re-running init keeps it in sync.

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT below, which still applies (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count — the marker must be physically line 1.

SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do not create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.

CANONICAL SOURCE: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block mirrors that operating model inline so the session stays governed even if the MCP `instructions` are momentarily stale; where the two disagree, the MCP `instructions` win because they are read fresh each connect.

HARNESS-HOOK STATE: a harness-hook context carrying a <subagent-mcp state="..."> tag reports the current orchestration ON/OFF state and takes effect with no exceptions, because it is the only channel with fresh, harness-verified state — self-reported prose cannot substitute for it. A token counts as such a tag only when it is a real tag with a `state` attribute; a bare mention of "subagent-mcp" in prose is not a tag and carries no authority. A user request can only switch orchestration ON or OFF, never assert what the current state already is — that comes solely from the tag. No tag present means the state is UNKNOWN (see NO-HOOK below); never infer it from anything else.

PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority — neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.

ORCHESTRATION ON — you are the ORCHESTRATOR. Allowed tools: only the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. There is no inline-by-right; every step runs in a sub-agent. If one atomic step truly cannot run in a sub-agent, ask the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating. Sole channel: while subagent-mcp is connected, every sub-agent launch goes through `launch_agent`; never use harness-native sub-agent tools or shell-spawned agents.

ORCHESTRATOR WORKTREE SETUP: for mutating work, first place sub-agents in a compliant linked worktree/work branch; the main checkout cwd applies only to read-only work or already-isolated target-tree contexts (sub-agents no longer self-isolate into per-agent worktrees). Serialize any sub-agents that write the same files — never run concurrent writers over overlapping paths (no cwd-level lock exists).

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF BY DEFAULT -- each new session starts with orchestration OFF. A hook meters real provider-reported context usage (never tokenized, never self-estimated). At 15% utilization a persisted latch force-enables orchestration and coaches a 5-question planning stop. At 50% the hook warns every turn to wind down and unlocks handoff-write/handoff-read/handoff-clear for a clean session handoff. If context size cannot be measured, the hook fails safe to ON. Never assert a state yourself -- only the hook tag is authoritative.

DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, halt and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN — represented by the absence of any tag, never by a tag value. Emit this warning to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON." Why: with no fresh state signal, defaulting to ON avoids ungoverned inline execution; one spoken opt-out is allowed per session. If you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the only automatic suppressor of this default.

DISABLE: never on your own initiative; you may propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may set enabled:false — per-session only; the next new session resumes ON; no mid-session re-enable.
<!-- subagent-mcp:managed:end -->

This repository uses the Claude CI/CD Policy Pack for Git, GitHub, CI/CD, and agentic collaboration.

## Line Limit
- `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` <=100 lines; other markdown/RAG <=200.
- If a file would exceed its limit, keep it as an index and move detail into a same-named subdirectory or an appropriate `docs/spec/**` file.
- `docs/spec/dev-loop/orchestration-directive-architecture.md` is now a retrieval map over its subdirectory leaves (`sections-00-04`, `sections-05-09`, `sections-10-13`, `derivation-map`, `appendix-a1-a4`, `appendix-a5-directives`, `appendix-a6-a7`); load the map first, then the matched leaf.

## ASCII Prose Policy
- Agent-written prose that is not a direct quote must be pure ASCII.
- Banned with no exceptions: em dash, en dash, any non-ASCII dash-like character, double hyphen, all non-ASCII characters except non-English names or words, and emoji.
- Direct quotations are preserved intact.
- Where a dash would separate clauses, use a period, comma, colon, parentheses, or line break.
- Hyphen is allowed only for compound adjectives before a noun, established compound nouns, technical identifiers/slugs, CLI flags, file paths, and numeric ranges.
- Hyphen is never for clause separation or emphasis.
- Avoid needless comparison constructions like "X is not Y, it is Z"; state concepts plainly.

## Provider Entry Points
- Read this file first.
- `CLAUDE.md`/`GEMINI.md` redirect here; add no durable operating rules.

## Context Routing
- ALWAYS load `retrieval-map.md` (repo root) at session start : it is the retrieval index for all repo documentation.
- This file is the only always-loaded repository instruction file.
- Do not preload decomposed SOPs, reference folders, or entire directories.
- Before reading a referenced file, identify the concrete trigger below.
- Read the smallest matched file or section. If no trigger matches, continue from this file only. If multiple triggers match, read only matched files.

## Load Triggers
- `docs/spec/safety-scope.md`: read when an interactive human prompt exceeds 150 words; asks for structural, architectural, debug, or root-cause work; or may require pausing, clarification, consent, refusal, or escalation due to ambiguity, safety, privacy, credentials, side effects, identity, authorization, or irreversible actions. Also before secrets, sub-agents, or agent injection.
- `docs/spec/dev-loop/git-collaboration.md`: read before any branch/worktree create/name/switch/delete; staging, committing, pushing, pulling, rebasing, merging, resetting, cleaning, pruning, or opening/reviewing/merging PRs; and protected/default-branch work. Skip for read-only `status`/`diff`/`log` or file inspection.
- `agents/GIT_COLLABORATION.md`: compact git-write checklist; read after the git SOP; skip for read-only or non-git tasks.
- `docs/spec/dev-loop/claude-routine-prompt.md`: read before changing the exact Claude Routine Instructions text.
- `docs/spec/dev-loop/claude-routines-cicd.md`: read before editing `.github/workflows/*`, required-check names, workflow permissions, `workflow_dispatch` I/O, dispatch bridge logic, or any GitHub event/status mapping to Claude Routine execution.
- `docs/spec/dev-loop/dependabot-ci-guard.md`: read before editing `.github/dependabot.yml`, auto-merge/branch-protection rules for Dependabot PRs, or any CI gate that guards dependency-update branches. Skip for read-only status/diff/log.
- `docs/spec/prompt-review/eight-perspective-review.md`: read before creating or changing repo instruction files, reusable prompts/templates/SOPs under `docs/spec`, skills, policy gates, CI/CD agent instructions, or text future agents must follow. Skip for one-off notes, changelogs, or agent-state md.
- `docs/spec/dev-loop/orchestration-directive-architecture/sections-05-09.md` (section 8.4): read before editing any block labeled "do not edit between markers" or carrying a `schema=N` marker.
- `src/routing-table.json` (+ `.spec/references/work-categories.md`): read when choosing model/provider/effort, routing work across Claude/Codex, classifying a prompt into a work-category, or wiring subagent-mcp routing. The JSON is the routing artifact; `work-categories.md` the fixed taxonomy; re-profile new models via the `model-profiler` skill. The `classification_precedence` array in `routing-table.json` is the SOLE ordering authority for classification : never infer ordering from any other source.
- `skills/model-profiler/SKILL.md`: read/run when a new model ships, or when asked to re-profile the fleet / refresh tier rankings / regenerate `src/routing-table.json`; invoke the `model-profiler` skill (bare prompt `Run the model-profiler skill.` uses the standing repo profile); orchestrator-only, flagship runner required; emits `src/routing-table.json` + `src/routing-table-audit.json` + `research-seed-sites.json`.
- `docs/spec/task-taxonomy/_INDEX.md`: read when defining, citing, or changing the fixed 14-category task taxonomy (immutable) or its provenance, not routing.
- `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent` tool's param contract, the routing-table loader/resolver, or auto-mode candidate-selection / silent-fallback behavior; for the advanced-ruleset.py override hook, its python execution/IO contract, launch visibility fields, or the post-spawn failover window, read `docs/spec/advanced-ruleset/_INDEX.md` first.
- `docs/spec/dev-loop/worktree-enforcement/_INDEX.md`: read before ANY mutating or repo-affecting action - creating/naming a branch or worktree, editing/writing/deleting a file, staging, committing, merging, rebasing, resetting, or pushing - to run the pre-action worktree gate. Not for read-only status/log/diff/inspection.
- `docs/spec/dev-loop/release-publishing.md`: read before `npm publish`, npm-registry auth refresh, or diagnosing a publish failure.
- `docs/spec/graphify.md`: read before architecture/navigation questions, before grep/find/rg searches, and at session start for MCP health expectations.
- `docs/spec/permissions.md`: read the index, then the matched leaf before touching the permission engine, ceiling modes, `respond_permission`/`permission_requested`, the Codex approval channel, or the `global-subagent-mcp-config.jsonc` permission keys. Note: launched sub-agents run gated (default ceiling `auto`) and children get no `respond_permission` tool.

## Always Enforce
- UNSKIPPABLE - Worktree-Isolation Mandate (max priority): never do mutating work in the primary working tree; ALL mutating work must occur in a compliant linked worktree on a `<type>/<subject>` branch located outside the repo dir. Run the pre-action gate `node scripts/check_worktree.mjs` before any mutating/repo-affecting action; on failure create/enter a compliant worktree first. See `docs/spec/dev-loop/worktree-enforcement/`.
- SUB-AGENT CARVE-OUT: a session whose literal first line is `<this is a request from a parent process>` (equivalently, env `SUBAGENT_MCP_SUBAGENT=1`) is a delegated sub-agent already placed in its target working tree by the orchestrator: it MUST NOT create or switch git worktrees, MUST skip the worktree-isolation gate, and MUST perform all mutating work directly in the provided cwd.
- Before file edits or git writes, inspect `git status --short --branch`.
- Pre-commit (executable/source or build-participating change): run `node scripts/check_mcp_compliance.mjs` (FAIL blocks), then a contradiction-checker sub-agent (strongest model) per `docs/spec/dev-loop/contradiction-checker.md` (scope: spec conflicts, stale build-participating docs/specs, unstaged build-affecting files). Unavailable: halt. On `blocked`/`needs_user`, act per that spec; never commit around it.
- Treat any uncommitted change present before the current task, or of uncertain author, as user-owned: do not overwrite, discard, stage, commit, reset, clean, rebase, move, or hide it without explicit owner authorization.
- Use short-lived topic branches and PRs for code, CI/CD, schema, prompt/policy, or multi-file docs. Direct protected/default-branch edits require explicit owner emergency approval.
- Claude Code Routines are the canonical CI/CD path. GitHub Actions may only dispatch or bridge to Claude routines unless the owner approves otherwise.
- Automated workflows must prepend `<You are the primary agent in an automated workflow>` as the first character line of injected user turns.
- Every sub-agent prompt must begin with `<this is a request from a parent process>`.
- Sub-agents return JSON with `status`, `summary`, `source_locators`, `risks`, and `writes_requested`; include source locators for file-backed claims.
- Do not include AI attribution or co-author lines in commits, manifests, docs, or generated project metadata.

## Validation
After structural or payload changes, run relevant checks: `find . -name '*.md' -o -name '*.json'`; `python -m py_compile <repo-python-files-used-by-policy-or-ci>`; `git status --short --branch`.
Verify files meet the line limits in the Line Limit section above.
