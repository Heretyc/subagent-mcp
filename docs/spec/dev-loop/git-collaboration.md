# Git Collaboration Policy

Status: normative development policy for this repository.

## Scope

This policy governs commits, branches, worktrees, GitHub Actions, PRs, reviews,
merges, and multi-contributor or multi-agent coordination. Root invariants live
in `AGENTS.md`. Agent execution details live in `agents/GIT_COLLABORATION.md`.

## Directives

1. Inspect `git status --short --branch` before any file edit, branch/worktree
   change, stage, commit, merge, rebase, pull, push, reset, clean, or prune.
2. Never overwrite, discard, stage, commit, reset, clean, rebase, move, or hide
   user/unowned changes without explicit owner authorization for that action.
3. ALL mutating work (file create/edit/delete, stage, commit, branch, merge,
   rebase, reset, clean, dependency/lockfile or generated-output changes) MUST
   occur inside a LINKED git worktree on a short-lived `<type>/<subject>` topic
   branch, never in the primary working tree. Protected/default branches receive
   changes only through PRs.
4. Direct protected/default-branch edits are emergency-only and require explicit
   owner approval plus a written follow-up PR or incident note.
5. Branches must pass `git check-ref-format --branch`.
6. Branch names must use lowercase ASCII with digits, hyphen, underscore, period,
   and single slash separators only. No spaces, emoji, shell metacharacters,
   `..`, `@{`, consecutive slashes, leading/trailing slash, trailing period,
   `.lock`, `refs/`, or object-ID-like 40-hex names.
7. Collaborative branches use `<type>/<short-topic>` or
   `<type>/<actor>/<short-topic>`. Allowed types: `feature`, `fix`, `hotfix`,
   `release`, `docs`, `test`, `refactor`, `chore`, `agent`, `user`,
   `integration`, and `audit`. Claude implementation routines may use Claude's default
   `claude/` prefix only when `claude-routines-cicd.md` allows it.
8. Create one branch per cohesive change set. Split unrelated behavior,
   formatting, dependency, generated-output, and documentation-only changes.
9. Branch from the current default branch unless the work is an approved hotfix,
   release fix, or explicit stacked/dependent branch.
10. Do not reuse merged, closed, abandoned, or stale branches for new work.
11. Do not amend, rebase, squash, drop, or force-push published shared history
    without explicit coordination and approval from active collaborators.
12. Use at most one writable worktree per branch. Do not use `git worktree add
    --force` to duplicate a branch except explicit recovery.
13. Linked worktrees must live outside repository/worktree directories under a
    dedicated sibling worktree root.
14. Before creating, deleting, pruning, merging, rebasing, or force-updating a
    branch, inspect `git worktree list --porcelain -z` when multiple worktrees
    may exist.
15. Remove completed worktrees with `git worktree remove`. Manual directory
    deletion requires immediate stale-metadata audit before pruning.
16. Do not remove an unclean worktree or delete its branch until work is
    committed, intentionally preserved, or confirmed disposable.
17. Commits must be small logical units with the exact staged diff inspected.
18. Commit messages must be concise and specific. Add body text when motivation,
    risk, migration, rollback, or review context is not obvious.
19. Do not commit conflict markers, secrets, accidental debug output, generated
    noise, large/binary artifacts, caches, build products, or unverified work.
20. Files near GitHub's large-file thresholds must use Git LFS, releases,
    external artifact storage, or a documented exception.
21. Do not create empty commits, empty messages, bypass hooks, or use
    `--no-verify` unless an explicit repository workflow requires it and the
    reason is documented.
22. Do not add AI attribution, AI co-author trailers, or tool/vendor co-author
    lines in commits, manifests, docs, or generated metadata.
23. Claude Code Routines are the canonical CI/CD path. GitHub Actions in
    `.github/workflows/` only dispatch or bridge to Claude routine CI/CD unless
    the owner explicitly approves another workflow.
24. `.github/workflows/claude-routine.yml` must run on `pull_request`,
    default-branch `push`, `workflow_dispatch`, and `merge_group`. Additional
    protected-branch push coverage requires explicit owner configuration.
25. Required workflows must use least-privilege permissions, avoid checkout, and
    avoid executing untrusted PR code.
26. Do not use `pull_request_target` to checkout, build, test, lint, or execute
    untrusted PR code.
27. Workflow steps must treat PR titles, bodies, branch names, labels, commit
    messages, and all `github.event` fields as untrusted input.
28. `.github/workflows/**`, `.github/CODEOWNERS`, scripts invoked by CI, and
    secret-handling paths require owner/CODEOWNER review.
29. Required check names must be unique across workflows. Protect them with
    branch rulesets or branch protection only where the GitHub account plan
    actually enforces private-repository protections.
30. Protected branches must require PRs, required checks, resolved
    conversations, at least one independent approval, code-owner review for
    owned paths, blocked force-pushes, and blocked deletion.
31. Busy protected branches must use merge queue, and required CI must include
    `merge_group` before merge queue is required.
32. No PR may merge while draft, failing/missing required checks, conflicted,
    stale, unsafe, superseded, lacking approval, or carrying unresolved changes.
33. No PR may merge unless the latest Claude Routine report for the current head
    SHA has `Status: pass`, or the owner approves an emergency override.
34. Agent-authored PRs must pass the same CI and human review gates as human
    PRs. Agents do not approve or merge their own work.
35. Release branches accept only stabilization, release metadata, backports, and
    approved hotfixes. Feature work targets topic branches from default branch.
36. Hotfixes start from the oldest supported affected release/maintenance branch
    and propagate upward to newer release branches and default branch.
37. Merge freezes must be enforced with branch locks, active rulesets, required
    deployment/review gates, or equivalent maintainer-controlled protections.
38. If GitHub shows a plan-gating warning for private-repository rulesets or
    branch protection, do not represent those rules as enforced. Use manual
    maintainer gates until the repository moves to an enforcing plan.
39. Primary-working-tree mutation is forbidden. Before any mutating or
    repo-affecting action, the pre-action worktree gate
    (`scripts/check_worktree.mjs`) must pass: not the primary tree, branch
    matches `<type>/<subject>` and the allowed type set, worktree lives outside
    the repo dir. Read-only actions (status, log, diff, show, branch --list,
    worktree list, fetch, grep, file inspection) are exempt.
40. Worktree-isolation enforcement is tiered: Tier-1 (authoritative) = GitHub
    branch protection on the default branch (applied to `main`: enforce_admins,
    PR-required, force-push/deletion blocked); Tier-2 (best-effort) = local
    `core.hooksPath=.githooks` pre-commit/pre-push running the gate (bypassable,
    per-clone : every clone must run `node scripts/install_worktree_hooks.mjs`);
    Tier-3 = the agent-run pre-action gate. Full spec + naming + provider notes:
    `docs/spec/dev-loop/worktree-enforcement/`.
41. Before opening any PR, ask the owner using the provider-appropriate
    interactive question tool (AskUserQuestion on Claude, request-user-input on
    Codex) whether they wish to increment the package version number.

## SOP

1. Before work: inspect status, read `AGENTS.md`, identify owned files, and
   record any dirty/unowned changes that affect the task.
2. Branch/worktree: create a policy-named topic branch. ALWAYS create/enter a
   compliant linked sibling worktree (branch `<type>/<subject>`, located outside
   the repo dir) before any mutating action; the primary checkout is read-only.
   Run `node scripts/check_worktree.mjs` to confirm compliance.
3. Edit: keep changes scoped. Preserve user changes. Separate mechanical
   rewrites from behavior changes.
4. Commit: inspect staged diff, run validation : including `node
   scripts/check_mcp_compliance.mjs` (vendor metadata limits; FAIL blocks) and
   the pre-commit contradiction-checker : then commit the smallest coherent unit
   only when requested or workflow-required.
5. PR: open draft PRs for early feedback and ready PRs only after self-review,
   validation, description, risks, and blockers are complete.
6. Review: review purpose, correctness, tests, security, dependencies,
   ownership, docs, generated files, migration impact, and rollback path before
   style nits.
7. Merge: use repository merge policy. Prefer squash for short-lived topic
   branches, merge commits for meaningful integration, and rebase merge only for
   simple isolated PRs where rewritten SHAs are acceptable.
8. Cleanup: after merge/close, delete the head branch when safe, remove local
   worktrees, prune stale refs, and preserve pre-existing unowned work.

## Guidance

- Default branch model: GitHub Flow.
- Default PR size: one self-contained change.
- Use draft PRs for visibility, CI signal, design feedback, and agent progress.
- Keep WIP commits local or on clearly private branches.
- Use issue-linked branches when work starts from a tracked issue.
- Use CODEOWNERS for stable ownership and manual reviewers for cross-cutting
  changes.
- Use Dependabot for GitHub Actions version updates and review those PRs as
  workflow-code changes.
- For private Free organization repositories, keep the Claude dispatch workflow
  but rely on documented manual merge discipline until GitHub enforcement exists.
- Add or update tests with behavior changes unless the PR explains why tests are
  not possible or not useful.
- Prefer reproducible generation over committed generated output.

## Directive/SOP Review Gate

Any new or changed durable prompt, directive, SOP, skill, or normative
instruction/policy content must pass the 8-perspective review in
`docs/spec/prompt-review/eight-perspective-review.md`. Unrelated docs and
agent-state markdown do not activate the gate by file extension alone. All eight
perspectives must pass; if any perspective is concerned or unsure after
revision, stop and ask the owner.
