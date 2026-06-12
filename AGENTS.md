# Repository Agent Instructions

This repository uses the Claude CI/CD Policy Pack for Git, GitHub, CI/CD, and
agentic collaboration.

## Line Limit

- `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` <=100 lines; other markdown/RAG <=200.
- If a file would exceed its limit, keep it as an index and move detail into a
  same-named subdirectory or an appropriate `docs/spec/**` file.

## Provider Entry Points

- Read this file first.
- `CLAUDE.md`/`GEMINI.md` redirect here; add no durable operating rules.

## Context Routing

- This file is the only always-loaded repository instruction file.
- Do not preload decomposed SOPs, reference folders, or entire directories.
- Before reading a referenced file, identify the concrete trigger below.
- Read the smallest matched file or section. If no trigger matches, continue
  from this file only. If multiple triggers match, read only matched files.

## Load Triggers

- `docs/spec/safety-scope.md`: read when an interactive human prompt exceeds
  150 words; asks for structural, architectural, debug, or root-cause work; or
  may require pausing, clarification, consent, refusal, or escalation due to
  ambiguity, safety, privacy, credentials, side effects, identity, authorization,
  or irreversible actions. Also before secrets, sub-agents, or agent injection.
- `docs/spec/dev-loop/git-collaboration.md`: read before any branch/worktree
  create/name/switch/delete; staging, committing, pushing, pulling, rebasing,
  merging, resetting, cleaning, pruning, or opening/reviewing/merging PRs; and
  protected/default-branch work. Skip for read-only `status`/`diff`/`log` or
  file inspection.
- `agents/GIT_COLLABORATION.md`: compact git-write checklist; read after the git SOP; skip for read-only or non-git tasks.
- `docs/spec/dev-loop/claude-routine-prompt.md`: read before changing the exact Claude Routine Instructions text.
- `docs/spec/dev-loop/claude-routines-cicd.md`: read before editing
  `.github/workflows/*`, required-check names, workflow permissions,
  `workflow_dispatch` I/O, dispatch bridge logic, or any GitHub event/status
  mapping to Claude Routine execution.
- `docs/spec/prompt-review/eight-perspective-review.md`: read before creating
  or changing repo instruction files, reusable prompts/templates/SOPs under
  `docs/spec`, skills, policy gates, CI/CD agent instructions, or text future
  agents must follow. Skip for one-off notes, changelogs, or agent-state md.
- `src/routing-table.json` (+ `.spec/references/work-categories.md`): read when
  choosing model/provider/effort, routing work across Claude/Codex, classifying
  a prompt into a work-category, or wiring subagent-mcp routing. The JSON is the
  routing artifact; `work-categories.md` the fixed taxonomy; re-profile new
  models via the `model-profiler` skill.
- `docs/spec/task-taxonomy/_INDEX.md`: read when defining, citing, or changing
  the fixed 14-category task taxonomy (immutable) or its provenance, not routing.
- `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent` tool's param contract, the routing-table loader/resolver, or auto-mode candidate-selection / silent-fallback behavior; for the advanced-ruleset.py override hook, its python execution/IO contract, launch visibility fields, or the post-spawn failover window, read `docs/spec/advanced-ruleset/_INDEX.md` first.
- `docs/spec/dev-loop/worktree-enforcement/_INDEX.md`: read before ANY mutating or repo-affecting action — creating/naming a branch or worktree, editing/writing/deleting a file, staging, committing, merging, rebasing, resetting, or pushing — to run the pre-action worktree gate. Not for read-only status/log/diff/inspection.
- `docs/spec/dev-loop/release-publishing.md`: read before `npm publish`, npm-registry auth refresh, or diagnosing a publish failure.

## Always Enforce

- UNSKIPPABLE — Worktree-Isolation Mandate (max priority): never do mutating
  work in the primary working tree; ALL mutating work must occur in a compliant
  linked worktree on a `<type>/<subject>` branch located outside the repo dir.
  Run the pre-action gate `node scripts/check_worktree.mjs` before any
  mutating/repo-affecting action; on failure create/enter a compliant worktree
  first. See `docs/spec/dev-loop/worktree-enforcement/`.
- Before file edits or git writes, inspect `git status --short --branch`.
- Pre-commit (executable/source or build-participating change): run
  `node scripts/check_mcp_compliance.mjs` (FAIL blocks), then a contradiction-checker
  sub-agent (strongest model) per `docs/spec/dev-loop/contradiction-checker.md`
  (scope: spec conflicts, stale build-participating docs/specs, unstaged build-affecting files).
  Unavailable: halt. On `blocked`/`needs_user`, act per that spec; never commit around it.
- Treat any uncommitted change present before the current task, or of uncertain
  author, as user-owned: do not overwrite, discard, stage, commit, reset, clean,
  rebase, move, or hide it without explicit owner authorization.
- Use short-lived topic branches and PRs for code, CI/CD, schema, prompt/policy,
  or multi-file docs. Direct protected/default-branch edits require explicit
  owner emergency approval.
- Claude Code Routines are the canonical CI/CD path. GitHub Actions may only
  dispatch or bridge to Claude routines unless the owner approves otherwise.
- Automated workflows must prepend `<You are the primary agent in an automated
  workflow>` as the first character line of injected user turns.
- Every sub-agent prompt must begin with `<this is a request from a parent
  process>`.
- Sub-agents return JSON with `status`, `summary`, `source_locators`, `risks`,
  and `writes_requested`; include source locators for file-backed claims.
- Do not include AI attribution or co-author lines in commits, manifests, docs,
  or generated project metadata.

## Validation

After structural or payload changes, run relevant checks:

```bash
find . -name '*.md' -o -name '*.json'
python -m py_compile <repo-python-files-used-by-policy-or-ci>
git status --short --branch
```

Verify files meet the line limits in the Line Limit section above.
