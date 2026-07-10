# Agent Git Collaboration Checklist

Use this checklist for repository work. The normative policy is
`docs/spec/dev-loop/git-collaboration.md`; `AGENTS.md` holds root invariants.

## Before Work

1. Run `git status --short --branch`.
2. Identify unowned dirty files. Do not overwrite, stage, commit, reset, clean,
   rebase, move, or hide them without explicit owner authorization.
3. Follow `docs/spec/safety-scope.md` for interactive cascades, automated
   declarations, credential handling, and sub-agent prompts.
4. Read the task scope and name the owned files or directories.
5. Use a topic branch for non-trivial work unless the owner explicitly directed
   a different workflow that still respects protected/default-branch rules.

## Branches

- Branch names must pass `git check-ref-format --branch`.
- Use `<type>/<short-topic>` or `<type>/<actor>/<short-topic>`.
- Allowed types: `feature`, `fix`, `hotfix`, `release`, `docs`, `test`,
  `refactor`, `chore`, `agent`, `user`, `integration`, `audit`.
- Use lowercase ASCII, digits, hyphen, underscore, period, and single slash
  separators only.
- Do not reuse merged, closed, abandoned, or stale branches.
- Do not force-push or rewrite shared history without explicit coordination.

## Worktrees

- Use at most one writable worktree per branch.
- Put linked worktrees under a sibling worktree root, never inside another
  repository or worktree.
- Before branch/worktree cleanup or force-updates, inspect
  `git worktree list --porcelain -z`.
- Use `git worktree remove` for cleanup and do not remove unclean worktrees
  unless work is committed, preserved, or confirmed disposable.

## Commits

- Inspect the exact staged diff before committing.
- Commit the smallest coherent logical unit.
- Do not commit unrelated changes, conflict markers, secrets, debug output,
  generated noise, caches, large artifacts, or unverified work.
- Add tests or validation for behavior changes, or record why not.
- Do not add AI attribution or co-author lines.
- Do not use `--no-verify` or empty commits unless policy explicitly requires it.

## Pull Requests

- Use draft PRs for early visibility or CI signal.
- Mark ready only after self-review, validation, completed description, and
  blocker disclosure.
- PR descriptions must include summary, scope, validation, risk, rollback, and
  reviewer notes.
- Do not merge draft, failing, conflicted, stale, superseded, unsafe, or
  under-reviewed PRs.

## GitHub Actions

- Claude Code Routines are the canonical CI/CD path.
- The required workflow bridge lives in `.github/workflows/claude-routine.yml`.
- Required jobs use least-privilege permissions and routine API secrets only.
- The workflow dispatch check proves routine dispatch, not routine completion.
- Human review must inspect the Claude session URL or PR report before merge.
- Do not use `pull_request_target` to execute untrusted PR code.
- Treat all event fields as untrusted input.
- Workflow and CI-invoked script changes require owner/CODEOWNER review.

## Handoff

Report branch, worktree path, HEAD SHA, changed files, validation run, unowned
dirty files observed, and any blocked policy question.
