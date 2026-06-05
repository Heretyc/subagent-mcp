# Claude Code — Worktree-Isolation Specifics

The Worktree-Isolation Mandate (`_INDEX.md`) binds Claude Code exactly as it binds Codex
and humans. This page covers Claude-specific traps and the compliant path.

## Native EnterWorktree is NON-COMPLIANT

Claude Code's built-in `EnterWorktree` tool does NOT produce a compliant worktree:

- It AUTO-NAMES the branch `worktree-<name>` and replaces `/` with `+` — e.g. a request
  for `chore/worktree-enforcement-sop` becomes the branch
  `worktree-chore+worktree-enforcement-sop`. That has the wrong type prefix
  (`worktree-`), uses `+` instead of `/`, and FAILS the formula regex.
- It places the worktree under `.claude/worktrees/` INSIDE the repo, which FAILS the
  outside-repo check.

Therefore: do NOT use `EnterWorktree` for compliant mutating work.

## Compliant path (provider-agnostic)

From the primary checkout, create a linked sibling worktree manually:

```sh
git worktree add -b <type>/<subject> ../<repo>.worktrees/<type>-<subject> origin/main
```

Then perform ALL mutating work from inside that sibling path. Run the gate first:

```sh
node scripts/check_worktree.mjs   # expect WORKTREE-GATE: PASS
```

See `naming.md` for the formula and `enforcement.md` for the full gate algorithm.

## Edit-time honesty: nothing blocks a primary-tree EDIT by default

By default NO tool mechanically blocks a primary-tree file EDIT. Claude Code's
`Edit`/`Write`/`Bash` will happily write into the primary checkout unless you add the
OPTIONAL `PreToolUse` hook below. Edit-time control here is best-effort (the optional
hook) plus the agent self-enforced pre-action gate (Tier 3). The AUTHORITATIVE guarantee
is the Tier-1 server-side branch-protection merge boundary on `main` (see
`enforcement.md`) — not anything at edit time.

## OPTIONAL PreToolUse hook (best-effort, edit-time)

This is OPTIONAL and best-effort, NOT the authoritative block. Paste into
`.claude/settings.json` (project or user) under `hooks`. It runs the gate before
mutating tools and denies the call on non-zero exit; read-only tools stay ungated.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/check_worktree.mjs"
          }
        ]
      }
    ]
  }
}
```

A non-zero exit from the command blocks the tool call (the gate prints
`WORKTREE-GATE: FAIL` + reasons). Keep the matcher scoped to mutating tools; never gate
read-only inspection (Read, Grep, Glob, `git status|log|diff`) per the `enforcement.md`
allowlist. This hook is a client-side convenience layered on top of Tier-1.

## Do not

- Do not use `EnterWorktree` and then rename the branch to dodge the gate — the gate
  re-runs on every mutating action.
- Do not edit in the primary tree "just this once"; the mandate has no trivial-change
  exemption.
