# Dependabot CI Guard Procedure

Status: normative procedure for required CI guards on Dependabot dependency
update PRs.

## Monitored Ecosystems

`.github/dependabot.yml` runs two weekly update jobs: `github-actions` (rooted at
`/`) and `npm` (rooted at `/`, monitoring the package manifest). Both open PRs on
`dependabot/*` branches, so both are subject to the guards below. Adding a further
ecosystem does not change the guard procedure : any Dependabot-actor PR inherits it.

## When This Applies

A Dependabot PR, where actor is `dependabot[bot]` and the head branch matches
`dependabot/*`, shows a red required check for `validate-branch` from
`.github/workflows/worktree-guard.yml` or `claude-routine-dispatch` from
`.github/workflows/claude-routine.yml`.

## Root Cause

Both failures are Dependabot-context artifacts, not defects in the dependency
bump.

`validate-branch` fails because the worktree branch formula only allows branch
types `feature fix hotfix release docs test refactor chore agent user
integration audit`. Dependabot branches use
`dependabot/<ecosystem>/<dep>-<ver>`, which is not an allowed type, so the guard
exits with `head branch '...' violates the worktree branch formula`.

`claude-routine-dispatch` fails because Dependabot PRs run with restricted
secret scope. `CLAUDE_ROUTINE_FIRE_URL` and `CLAUDE_ROUTINE_FIRE_TOKEN` are
empty, so the dispatch guard exits 1 with
`Missing CLAUDE_ROUTINE_FIRE_URL or CLAUDE_ROUTINE_FIRE_TOKEN secret`.

## Canonical Fix

Add a job-level condition to each affected job:

```yaml
if: github.actor != 'dependabot[bot]'
```

If the job already has an `if:`, combine the Dependabot guard without
clobbering the existing expression:

```yaml
if: ${{ github.actor != 'dependabot[bot]' && ( <existing-expression> ) }}
```

Parenthesize the existing expression to preserve operator precedence because
`&&` binds tighter than `||`.

Current `validate-branch` example:

```yaml
jobs:
  validate-branch:
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
```

Current `claude-routine-dispatch` example:

```yaml
jobs:
  claude-routine-dispatch:
    name: claude-routine-dispatch
    if: ${{ github.actor != 'dependabot[bot]' && (github.event_name != 'push' || github.ref_name == github.event.repository.default_branch) }}
    runs-on: ubuntu-latest
```

## Required Check Semantics

Use a job-level `if:` for required checks. The workflow run still fires, and the
skipped job reports conclusion `skipped`. The Checks API maps that to
`neutral`, which branch protection counts as success, so the required check goes
green.

Do not use a trigger-level skip, such as a path filter, for a required check.
The workflow would never report the check, leaving it pending and blocking the
PR.

## Open PR Propagation

`pull_request` workflows execute from the PR merge commit. An already-open
Dependabot PR only picks up this guard change after the fix lands on `main` and
the PR is updated.

Procedure:

1. Merge the guard fix to `main`.
2. Comment `@dependabot rebase` on the Dependabot PR, or close and reopen it.
3. Confirm the required checks re-run and report green.

## Adding A New Dependabot-Sensitive Guard

Any future required job that cannot run meaningfully under Dependabot's
restricted context must carry the same job-level guard:

```yaml
if: github.actor != 'dependabot[bot]'
```

## Related Docs

- `AGENTS.md`
- `claude-routines-cicd.md`
