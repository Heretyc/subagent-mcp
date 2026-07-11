# Enforcement : Gate, Hooks, CI, Loophole Closures

Read before any mutating action. The pre-action gate is MANDATORY and provider-equal.

## Pre-action GATE algorithm (step by step)

Run `node scripts/check_worktree.mjs` (or apply this logic) BEFORE any mutating action.

1. `git rev-parse --is-inside-work-tree` must be `true`. Else FAIL: not in a git work
   tree.
2. `gitDir = git rev-parse --absolute-git-dir`; `commonDir = realpath(git rev-parse
   --git-common-dir)`. If `realpath(gitDir) === commonDir` → FAIL: primary working tree :
   all mutating work must be in a linked worktree. Record `primaryTop = realpath(parent
   of commonDir)`.
3. `branch = git rev-parse --abbrev-ref HEAD`. If `HEAD` (detached) → FAIL. The protected
   set is the repo's resolved default branch (`git symbolic-ref --short
   refs/remotes/origin/HEAD`, minus the `origin/` prefix) UNIONed with the literal
   fallback `{main, master}`; if `origin/HEAD` is unset, use the fallback. If branch is in
   that set → FAIL (so a type-named default like `release/x` is still blocked).
4. Validate the branch with `git check-ref-format --branch <branch>` AND the formula
   regex (see `naming.md`). Reject `.lock`, `..`, `@{`, trailing `/`/`.`, and 40-hex
   topics. FAIL with the regex on mismatch.
5. Outside-repo check: `thisTop = realpath(git rev-parse --show-toplevel)`. If `thisTop`
   equals or is nested under `primaryTop` → FAIL: worktree must live OUTSIDE the primary
   repo directory (sibling root), not e.g. `.claude/worktrees/`.
6. Else PASS.

On FAIL: STOP. Create/enter a compliant worktree first; take no other repo-affecting
action.

## Immutable / read-only allowlist (EXEMPT from the gate, allowed anywhere)

These never mutate working tree, index, refs, stash, or remote, so they run in the
primary tree too : do NOT gate them:

- Reading files; `cat`/`less`/editor open without save; grep / glob / ls / find.
- `git status`, `git log`, `git diff`, `git show`, `git branch --list`,
  `git worktree list`, `git remote -v`, `git config --get`.
- `git fetch` WITHOUT merge/pull; read-only `git ls-files`, `git rev-parse`, `git blame`.
- Any read-only query or analysis.

Anything that writes : file create/edit/delete, `git add|commit|branch|merge|rebase|
reset|clean|stash|push`, dependency/lockfile edits, code-gen that writes : is GATED.

## Check-script contract (`scripts/check_worktree.mjs`)

- Zero-dependency ESM; `execFileSync('git', [...])`; realpath comparisons via
  `node:fs`/`node:path`.
- Standalone-runnable and hook-runnable.
- Prints `WORKTREE-GATE: PASS` (exit 0) OR `WORKTREE-GATE: FAIL` + numbered reasons +
  the exact remediation command (exit 1).
- Third path : delegated sub-agents (`SUBAGENT_MCP_SUBAGENT=1`): short-circuits BEFORE
  any isolation check, prints `check_worktree: delegated sub-agent
  (SUBAGENT_MCP_SUBAGENT=1) : worktree isolation skipped; operating in provided cwd.`
  (exit 0), and does NOT emit `WORKTREE-GATE: PASS`.

## Git hooks

`.githooks/pre-commit` and `.githooks/pre-push` (POSIX sh, Git-for-Windows compatible)
resolve the repo via `git rev-parse --show-toplevel`, run
`node "$TOP/scripts/check_worktree.mjs"`, and exit non-zero (blocking) on FAIL. Install
once per clone:

```sh
node scripts/install_worktree_hooks.mjs   # git config core.hooksPath .githooks
```

`core.hooksPath` is repo-local (per-clone) and shared across all worktrees of that clone.

(N4) `pre-push` validates the LOCAL worktree's compliance (gate logic) before a push
leaves the machine; it is Tier-2 (bypassable, absent until installed). The ref-level
block that actually refuses a direct push to the default branch is Tier-1 (server-side
branch protection), not this hook. `pre-push` EXEMPTS deletion-only pushes (every ref
update has an all-zero local SHA) so merged/stale remote branches can be cleaned up from
any checkout, but any push carrying a real ref update still runs the gate, and deleting a
protected/default branch remains blocked by Tier-1 branch protection
(`allow_deletions=false`).

## Three-tier enforcement model (honest about what actually blocks)

Enforcement is TIERED. Only Tier 1 is authoritative; Tiers 2-3 are best-effort.

- TIER 1 : AUTHORITATIVE (server-side). A GitHub branch-protection ruleset on the
  DEFAULT branch. It IS applied to this repo's `main` with: `enforce_admins=true`,
  required pull request (0 approvals), `allow_force_pushes=false`,
  `allow_deletions=false`, `required_conversation_resolution=true`,
  `required_status_checks=null`. This blocks ALL direct pushes, force-pushes, and
  deletions to `main` : for EVERYONE, admins included; every change lands via PR. This,
  not local hooks, is the real guarantee. Reproduce/re-apply idempotently with
  `node scripts/apply_branch_protection.mjs` (ruleset in
  `.github/main-branch-protection.json`; the script carries the rationale
  comments because the JSON ruleset remains machine data).
- TIER 2 : LOCAL best-effort. `core.hooksPath=.githooks` `pre-commit`/`pre-push` run
  `scripts/check_worktree.mjs`. Bypassable via `--no-verify` or
  `-c core.hooksPath=`, and ABSENT on a fresh clone until
  `node scripts/install_worktree_hooks.mjs` runs. Therefore advisory, NOT
  authoritative. Every clone MUST run the installer (clone bootstrap).
- TIER 3 : AGENT self-enforcement. The `AGENTS.md` mandate plus the pre-action gate
  that compliant agents run themselves; optionally a Claude `PreToolUse` hook for
  edit-time blocking (see `claude.md`). Depends on agent compliance; not a mechanical
  guarantee.

`.github/workflows/worktree-guard.yml` (owner-approved exception to directive 23;
`contents: read` only; NO checkout; NO PR-code execution) is a PR-time branch-NAME
check only : a fast signal, NOT the Tier-1 block. It validates the PR head against the
formula and asserts the base is the repo's default branch, treating all `github.event`
fields as untrusted.

## LOOPHOLE CLOSURES (bypass attempt → which TIER catches it)

- `--no-verify` / disabling local hooks → Tier 2 is skipped, but Tier 1 still requires a
  PR and blocks every direct push to `main`; the skip never reaches the protected base.
- Force-push / branch deletion on `main` → Tier 1 (`allow_force_pushes=false`,
  `allow_deletions=false`, `enforce_admins=true`) refuses it server-side for everyone.
- Editing in the PRIMARY tree, then committing from a worktree → primary-tree edits are
  not in the worktree's index; the commit captures nothing (Tier 3 reality), surfacing
  the violation instead of laundering it.
- GUI / other git clients (skip `.git/hooks`) → Tier 2 `core.hooksPath` points all
  clients at `.githooks`; regardless, Tier 1 gates the push at the merge boundary.
- In-repo `.claude/worktrees/` → gate step 5 (Tier 2/3) FAILs any worktree nested under
  the primary tree.
- Detached HEAD / orphan branch → gate step 3 (Tier 2/3) FAILs (no compliant branch).
- Renaming the branch after the fact → the gate re-runs on every mutating action
  (Tier 3); the workflow re-validates head.ref on each PR sync (advisory).
- Sandbox bypass flags (Codex `--dangerously-bypass-approvals-and-sandbox`/`--yolo`,
  agent auto-approve) → forbidden for escaping the gate; Tier 1 is independent of any
  client sandbox and still blocks the merge boundary.
