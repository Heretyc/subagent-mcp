# Contributing

This repository is operated by specification-first changes and Claude Routine
CI/CD.

## Workflow

1. Inspect `git status --short --branch` before work.
2. Read `AGENTS.md`, `docs/spec/dev-loop/git-collaboration.md`, and
   `agents/GIT_COLLABORATION.md`.
3. Work on a short-lived policy-named topic branch, not directly on protected
   or default branches.
4. Keep changes scoped to the active task and preserve user/unowned work.
5. Commit only inspected staged diffs as small logical units.
6. Open PRs for non-trivial changes; ready PRs need summary, validation, risk,
   rollback, and reviewer notes.
7. Validate docs, JSON, local scripts, Claude routine CI/CD mapping, GitHub
   workflow bridge, and generated artifacts before commit.
8. Do not add AI attribution or co-author lines.

## GitHub Gates

- Claude Code Routines are the canonical CI/CD path.
- `.github/workflows/claude-routine.yml` is the required GitHub-standard
  dispatch bridge to Claude routine CI/CD.
- Require `claude-routine-dispatch` in branch protection or rulesets only when
  the GitHub account plan enforces private-repository protections. On private
  Free organization repos, treat the check as a mandatory manual merge gate.
- PRs must pass required checks, independent review, CODEOWNER review when
  applicable, and resolved conversations before merge.
- Agent-authored PRs use the same CI, review, and merge gates as human PRs.
- Workflow changes are executable code and require owner/CODEOWNER review.
