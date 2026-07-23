# Worktree & Branch Naming

Read before naming or creating a branch or worktree directory. Reuses the branch types
and ref rules from `docs/spec/dev-loop/git-collaboration.md` (directives 5, 6, 7) : this
is the operational naming contract for the Worktree-Isolation Mandate, not a new policy.

## The formula

```
<type>/<subject>            (2-segment, required minimum)
<type>/<actor>/<subject>    (3-segment, optional)
```

## Allowed types (the approved 13 : do NOT invent new ones)

```
feature  fix  hotfix  release  docs  test  refactor  chore  agent  user  integration  audit  continuous-audit
```

No `feat`, no `wip`, no other ad-hoc types. (Claude implementation routines may use the
`claude/` prefix ONLY where `claude-routines-cicd.md` allows it : not for manual work.)

## Subject (and actor) rules

- Starts with `[a-z0-9]`; remaining chars `[a-z0-9._-]`.
- Lowercase ASCII only. No spaces, uppercase, emoji, or shell metacharacters.
- No leading/trailing/double separators; no trailing `/` or `.`.
- No `..`, no `@{`, no `.lock` suffix, no `refs/`.
- Not a 40-hex object-id-like segment.
- Must pass `git check-ref-format --branch <branch>`.

## The validation regex (literal)

```
^(feature|fix|hotfix|release|docs|test|refactor|chore|agent|user|integration|audit|continuous-audit)\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$
```

The regex is necessary but NOT sufficient: `git check-ref-format --branch` MUST also
pass, and the deeper rejects above (`.lock`, `..`, `@{`, trailing dot/slash, 40-hex)
still apply. `scripts/check_worktree.mjs` enforces both.

## Worktree DIRECTORY naming vs branch name

- The BRANCH keeps its slashes: `chore/worktree-enforcement-sop`.
- The DIRECTORY replaces each `/` with `-`: `chore-worktree-enforcement-sop`.
- The directory MUST live OUTSIDE the repo, under a dedicated sibling worktree root,
  e.g. `<repo>.worktrees/` next to the primary checkout : NEVER inside the repo (not
  `.claude/worktrees/`, not `.git/`, not any path nested under the primary tree).
- (N1) The gate only requires the worktree to be OUTSIDE the primary tree; a compliant
  worktree may live at ANY such path. The `<repo>.worktrees/` sibling root is the
  CONVENTION (keeps related worktrees grouped), not a hard gate condition.

Create command (provider-agnostic):

```sh
git worktree add -b <type>/<subject> ../<repo>.worktrees/<type>-<subject> origin/main
```

## GOOD examples (branch + matching worktree directory)

| Branch | Worktree directory (sibling, outside repo) |
| --- | --- |
| `feature/auto-mode-loader` | `../subagent-mcp.worktrees/feature-auto-mode-loader` |
| `fix/effort-none-routing` | `../subagent-mcp.worktrees/fix-effort-none-routing` |
| `chore/worktree-enforcement-sop` | `../subagent-mcp.worktrees/chore-worktree-enforcement-sop` |
| `docs/agents-load-triggers` | `../subagent-mcp.worktrees/docs-agents-load-triggers` |
| `audit/session-4` | `../subagent-mcp.worktrees/audit-session-4` |
| `agent/codex/seed-site-refresh` | `../subagent-mcp.worktrees/agent-codex-seed-site-refresh` |
| `refactor/router-2.0` | `../subagent-mcp.worktrees/refactor-router-2.0` |

## ANTI-PATTERNS (each rejected : and why)

| Rejected | Why |
| --- | --- |
| working on `main` in the primary checkout | primary tree is read-only; `main` is protected : gate FAIL. |
| `.claude/worktrees/feature-x` inside the repo | worktree must live OUTSIDE the primary repo : outside-repo check FAIL. |
| `wip` | no `<type>/`; not in the allowed type set. |
| `temp` | no `<type>/`; bare disposable name is forbidden. |
| `mybranch` | no `<type>/` segment; fails the formula. |
| `Feature/Login` | uppercase is forbidden (lowercase ASCII only). |
| `fix/my login` | space in subject; fails the regex and `check-ref-format`. |
| `chore/cleanup/` | trailing slash / empty final segment. |
| `feature/` | empty subject after the type. |
| two worktrees on one branch | one writable worktree per branch (git-collaboration 12). |
| `worktree-chore+worktree-enforcement-sop` | Claude EnterWorktree auto-name: `worktree-` prefix + `/`→`+`; wrong type, wrong separators. |
| detached HEAD | no named branch; gate FAIL (cannot validate the formula). |
