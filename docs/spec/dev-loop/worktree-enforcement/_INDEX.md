# Worktree-Isolation Mandate : Index

Status: MANDATORY, max-priority, unskippable except for delegated sub-agents
(`SUBAGENT_MCP_SUBAGENT=1`, see item 5). Provider-equal (Claude Code, Codex,
humans). Integrates with `docs/spec/dev-loop/git-collaboration.md` (reuses its branch
types and ref rules : this folder does not fork a parallel policy).

## The Mandate (in brief)

1. NO mutating work may occur in the PRIMARY working tree (the main repo checkout) :
   ever, even locally or trivially. All mutating work (file create/edit/delete; `git
   add|commit|branch|merge|rebase|reset|clean`; dependency/lockfile changes; code-gen
   that writes) MUST happen inside a LINKED git worktree that lives OUTSIDE the repo
   directory under a dedicated sibling worktree root.
2. The worktree's branch MUST follow `<type>/<subject>` (optionally
   `<type>/<actor>/<subject>`) using only the allowed type set. See `naming.md`.
3. A PRE-ACTION ENFORCEMENT GATE runs BEFORE any mutating action: verify you are in a
   compliant linked worktree (not the primary tree; branch matches the formula; worktree
   is outside the repo). If the gate fails → STOP and create/enter a compliant worktree
   first; take no other repo-affecting action. See `enforcement.md`.
4. IMMUTABLE / read-only actions are EXEMPT and allowed anywhere: reading files;
   `git status|log|diff|show|branch --list|worktree list`; grep/glob/ls; fetch without
   merge; read-only queries : anything that does not mutate working tree, index, refs,
   stash, or remote.
5. Enforcement is mandatory and provider-equal : unskippable for orchestrators and
   normal sessions. The sole exemption is delegated sub-agents
   (`SUBAGENT_MCP_SUBAGENT=1`), which `scripts/check_worktree.mjs` short-circuits per the
   documented carve-out, since the orchestrator already placed them in their target tree.

## Why

Parallel agents and humans sharing one checkout corrupt each other's index, branch, and
stash state. Isolating every mutating actor in its own outside-the-repo linked worktree
makes branch-per-task the only writable path, keeps the primary tree pristine for review
and read-only inspection, and lets the same gate bind Claude, Codex, and humans equally.

## The one-command gate

```sh
node scripts/check_worktree.mjs
```

Prints `WORKTREE-GATE: PASS` (exit 0) or `WORKTREE-GATE: FAIL` + numbered reasons +
the exact remediation command (exit 1). Hooks and CI call the same script/logic.

## Load-trigger map to the leaves

- `naming.md`: read before naming/creating a branch or worktree directory : the exact
  formula, allowed types, subject rules, validation regex, folder-vs-branch naming, and
  good/anti-pattern examples.
- `enforcement.md`: read before any mutating action : the gate algorithm, the read-only
  allowlist, the check-script contract, the THREE-TIER enforcement model (Tier-1
  authoritative server-side branch protection; Tier-2 local hooks; Tier-3 agent
  self-enforcement), the PR-time branch-name workflow, and explicit loophole closures.
- `claude.md`: read when working as/with Claude Code : why native EnterWorktree is
  non-compliant and the compliant manual command + PreToolUse hook.
- `codex.md`: read when working as/with Codex : the manual worktree + `codex -C`
  isolation flow and sandbox caveats.

## Install (once per clone)

```sh
node scripts/install_worktree_hooks.mjs   # sets core.hooksPath = .githooks
```

core.hooksPath is repo-local (per-clone) config shared across all worktrees of a clone;
every fresh clone must run it once.
