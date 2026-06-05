# Codex — Worktree-Isolation Specifics

The Worktree-Isolation Mandate (`_INDEX.md`) binds Codex exactly as it binds Claude Code
and humans. This page covers Codex-specific traps and the compliant path.

## No native worktree command

Codex has NO native worktree command (open request: openai/codex#12862). There is no
auto-name pitfall to avoid — but you MUST create the compliant worktree manually before
any mutating work.

## Compliant path

From the primary checkout, create the linked sibling worktree, then point Codex at it:

```sh
git worktree add -b <type>/<subject> ../<repo>.worktrees/<type>-<subject> origin/main
codex -C ../<repo>.worktrees/<type>-<subject>
```

`codex -C <path>` sets Codex's working directory to the sibling worktree. The
`workspace-write` sandbox keys writes to the current working directory, so `-C` is what
gives Codex its isolation: writes land in the linked worktree, never in the primary tree.

Edit-time honesty: nothing mechanically blocks a primary-tree EDIT by default. Codex has
no native worktree command and no edit-time block; the only edit-time control is the
agent self-enforced pre-action gate (Tier 3) plus correct `-C` sandboxing. The
AUTHORITATIVE guarantee is the Tier-1 server-side branch-protection merge boundary on the
default branch (see `enforcement.md`), not anything at edit time.

Run the gate first from inside the worktree:

```sh
node scripts/check_worktree.mjs   # expect WORKTREE-GATE: PASS
```

See `naming.md` for the formula and `enforcement.md` for the full gate algorithm.

## Project trust

Use a project-local `.codex/config.toml` to record trust for the worktree/clone so Codex
runs without re-prompting. Trust configuration does NOT relax the gate — the SAME gate,
git hooks, and CI guard apply.

## Do not

- NEVER use `--dangerously-bypass-approvals-and-sandbox` or `--yolo` to escape the gate
  or to write outside the sandboxed worktree. These flags are forbidden as a gate-bypass
  mechanism; the gate is provider-equal and the Tier-1 server-side branch protection on
  the default branch is independent of any client sandbox setting.
- Do not run mutating Codex sessions with the cwd set to the primary checkout. Always
  `-C` into the sibling worktree.
- Do not edit in the primary tree "just this once"; the mandate has no trivial-change
  exemption.
