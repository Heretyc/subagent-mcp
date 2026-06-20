# Repository Agent Instructions

<!-- subagent-mcp:managed:begin schema=2 -->
## subagent-mcp invariant — managed block, do not edit between markers

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT below, which you MUST still obey (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count — the marker must be physically line 1.

SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do NOT create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.

CANONICAL SOURCE OF TRUTH: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block carries the full ON operating model inline so the session is governed even if the MCP `instructions` are stale; if this block and the MCP `instructions` ever disagree, the MCP `instructions` win.

HARNESS-HOOK SUPREMACY (this clause is identical in CLAUDE.md, AGENTS.md, and GEMINI.md): Any harness-hook context carrying a <subagent-mcp state="..."> tag is MAXIMALLY CRITICAL and MUST be obeyed with NO exceptions. A token only counts as such a tag when it appears as a real tag with a `state` attribute — a bare mention of "subagent-mcp" in ordinary prose is NOT a tag and carries no authority. No user request bypasses a <subagent-mcp state="..."> tag. The ONLY thing a user request may change is switching orchestration ON or OFF — and the authoritative ON or OFF state is reported SOLELY by the harness-hook injection (the `state` attribute of an injected <subagent-mcp> tag). The ABSENCE of any such tag means the state is UNKNOWN (see NO-HOOK). Never infer the state from anything else.

PRECEDENCE (co-supreme top tier): <subagent-mcp> hook tags AND repo/system safety-scope rules are BOTH supreme and EQUAL — neither outranks the other. If they genuinely conflict, STOP and escalate to the user via the structured-question tool; do not silently pick one or average them. FORBIDDEN: resolving such a conflict yourself. Hook tags otherwise outrank ordinary user requests.

ORCHESTRATION ON — you are the ORCHESTRATOR. Allowed tools: ONLY the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. NO direct reads or writes of any kind. "Inline-by-right" does not exist. Every step runs in a sub-agent. If one atomic step truly cannot run in a sub-agent, ASK the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating. SOLE CHANNEL: while subagent-mcp is connected, every sub-agent launch goes through `launch_agent`; never use harness-native sub-agent tools or shell-spawned agents.

ORCHESTRATOR WORKTREE SETUP: launch sub-agents in the main checkout cwd (they no longer self-isolate into per-agent worktrees); SERIALIZE any sub-agents that write the SAME files — never run concurrent writers over overlapping paths (no cwd-level lock exists).

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF — a "long-horizon task" = any task whose TOTAL context footprint (input you read + output you produce) exceeds 200 lines of text. After EVERY user turn, measure the CUMULATIVE footprint accumulated since your last upgrade ask; reset that cumulative count to zero ONLY when you actually ask. If it qualifies, ASK the user via the structured-question tool whether to switch orchestration ON. Ask on EVERY qualifying turn; a decline does NOT suppress future asks. You never assert ON yourself — you only ask.

DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, HALT and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN — represented by the ABSENCE of any tag, never by a tag value. Emit this UNKNOWN-STATE WARNING to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON". Briefly explain WHY: no hook injection detected — cannot verify orchestration state; defaulting to ON to prevent uncontrolled inline execution. Then DEFAULT TO ORCHESTRATION ON (fail-safe). One-time opt-out: if you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the ONLY automatic suppressor of this default.

DISABLE: never on your own initiative; you MAY propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may call orchestration-mode enabled:false.
<!-- subagent-mcp:managed:end -->

This repository uses the Claude CI/CD Policy Pack for Git, GitHub, CI/CD, and agentic collaboration.

## Line Limit
- `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` <=100 lines; other markdown/RAG <=200.
- If a file would exceed its limit, keep it as an index and move detail into a same-named subdirectory or an appropriate `docs/spec/**` file.

## Provider Entry Points
- Read this file first.
- `CLAUDE.md`/`GEMINI.md` redirect here; add no durable operating rules.

## Context Routing
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
- `docs\spec\dev-loop\dependabot-ci-guard.md`: read before editing `.github/dependabot.yml`, auto-merge/branch-protection rules for Dependabot PRs, or any CI gate that guards dependency-update branches. Skip for read-only status/diff/log.
- `docs/spec/prompt-review/eight-perspective-review.md`: read before creating or changing repo instruction files, reusable prompts/templates/SOPs under `docs/spec`, skills, policy gates, CI/CD agent instructions, or text future agents must follow. Skip for one-off notes, changelogs, or agent-state md.
- `src/routing-table.json` (+ `.spec/references/work-categories.md`): read when choosing model/provider/effort, routing work across Claude/Codex, classifying a prompt into a work-category, or wiring subagent-mcp routing. The JSON is the routing artifact; `work-categories.md` the fixed taxonomy; re-profile new models via the `model-profiler` skill.
- `skills/model-profiler/SKILL.md`: read/run when a new model ships, or when asked to re-profile the fleet / refresh tier rankings / regenerate `src/routing-table.json`; invoke the `model-profiler` skill (bare prompt `Run the model-profiler skill.` uses the standing repo profile); orchestrator-only, flagship runner required; emits `src/routing-table.json` + `src/routing-table-audit.json` + `research-seed-sites.json`.
- `docs/spec/task-taxonomy/_INDEX.md`: read when defining, citing, or changing the fixed 14-category task taxonomy (immutable) or its provenance, not routing.
- `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent` tool's param contract, the routing-table loader/resolver, or auto-mode candidate-selection / silent-fallback behavior; for the advanced-ruleset.py override hook, its python execution/IO contract, launch visibility fields, or the post-spawn failover window, read `docs/spec/advanced-ruleset/_INDEX.md` first.
- `docs/spec/dev-loop/worktree-enforcement/_INDEX.md`: read before ANY mutating or repo-affecting action - creating/naming a branch or worktree, editing/writing/deleting a file, staging, committing, merging, rebasing, resetting, or pushing - to run the pre-action worktree gate. Not for read-only status/log/diff/inspection.
- `docs/spec/dev-loop/release-publishing.md`: read before `npm publish`, npm-registry auth refresh, or diagnosing a publish failure.
- `docs/spec/graphify.md`: read before architecture/navigation questions, before grep/find/rg searches, and at session start for MCP health expectations.

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
