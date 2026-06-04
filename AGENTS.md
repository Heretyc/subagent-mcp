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

- `docs/spec/safety-scope.md`: read when an interactive human prompt is over
  150 words; asks for structural, architectural, debug, troubleshooting, or
  root-cause work; or may require pausing, clarification, consent, refusal, or
  escalation due to ambiguity, under-specification, safety, privacy,
  credentials, external side effects, identity, authorization, or irreversible
  actions. Also read before handling secrets, spawning sub-agents, or editing
  automated/scheduled agent [agentic mention removed].
- `docs/spec/dev-loop/git-collaboration.md`: read before creating, naming,
  switching, or deleting branches/worktrees; before staging, committing,
  pushing, pulling, rebasing, merging, resetting, cleaning, pruning, opening,
  reviewing, or merging PRs; and before protected/default-branch work. Do not
  read it for read-only `status`, `diff`, `log`, or file inspection.
- `agents/GIT_COLLABORATION.md`: after the git SOP, read when modifying repo
  files or performing git write actions and a compact checklist is useful. Do
  not read for read-only review, explanation, or non-git tasks.
- `docs/spec/dev-loop/claude-routine-prompt.md`: read before creating or
  changing the exact Claude Routine Instructions text.
- `docs/spec/dev-loop/claude-routines-cicd.md`: read before editing
  `.github/workflows/*`, required-check names, workflow permissions,
  `workflow_dispatch` inputs/outputs, routine dispatch bridge logic, or any
  GitHub event/status mapping to Claude Routine execution.
- `docs/spec/prompt-review/eight-perspective-review.md`: read before creating
  or changing repository instruction files, reusable prompts/templates, SOPs
  under `docs/spec`, skills, policy gates, CI/CD agent instructions, or text
  future agents/maintainers must follow. Do not read for one-off task notes,
  changelogs, or agent-state markdown unless they contain reusable rules.
- `.spec/references/retrieval-map.md`: read when choosing which model/provider/
  effort for a task, routing or distributing work across Claude/Codex,
  classifying a prompt into a work-category, or wiring the subagent-mcp routing
  feature. Entry point for the cross-provider model-routing KB; re-profile new
  models with the `model-profiler` skill.
- `docs/spec/task-taxonomy/_INDEX.md`: read when defining, citing, or changing
  the fixed 10-category task taxonomy (immutable; never re-derived by a
  profiler run) or how/why it was determined — spec and provenance, not
  operational routing; see `.spec/references/retrieval-map.md` for that.
- `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent` tool's param contract, the routing-table loader/resolver, or auto-mode candidate-selection / silent-fallback behavior.

## Always Enforce

- Before file edits or git writes, inspect `git status --short --branch`.
- Before any repository commit that changes executable/source code, dispatch a separate contradiction-checker
  sub-agent using the strongest explicitly selectable model and reasoning
  settings available to check against relevant specs/docs. If unavailable, halt and tell the owner. If it reports
  `blocked` or `needs_user`, perform no writes; surface the blocker and resolve
  it through the applicable `docs/spec/safety-scope.md` flow. Do not
  self-trigger a clarification cascade.
- Treat any uncommitted change present before the current task, or whose author
  is uncertain, as user-owned. Do not overwrite, discard, stage, commit, reset,
  clean, rebase, move, or hide it without explicit owner authorization.
- Use short-lived topic branches and PRs for code, CI/CD, schema,
  prompt/policy, or multi-file documentation changes. Direct protected/default
  branch edits require explicit owner emergency approval.
- Claude Code Routines are the canonical CI/CD path. GitHub Actions may only
  dispatch or bridge to Claude routines unless the owner approves otherwise.
- Automated workflows must prepend `<You are the primary agent in an automated
  workflow>` as the first character line of injected user turns.
- Every sub-agent prompt must begin with
  `<this is a request from a parent process>`.
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
