---
name: project-board
description: Operate the subagent-mcp GitHub project board (https://github.com/users/Heretyc/projects/4) via the gh CLI. Use ONLY for explicit project-board requests - "board status", "board sweep", "board true-up", "project board plan", "update the board", "board fields", "board HR queue", "add this to the project". Do not use for ordinary code contributions, which need only a filed and linked issue.
---

# Project Board

Repository-local skill. It serves this repository only: it is not part of
product skill registration, global installation, or npm distribution.

## When this skill applies

Activate on an explicit project-board request: board planning, board status,
board maintenance, board management, board sweeps or true-ups, board field
population, or attaching an issue to the board.

Do **not** activate for an ordinary contribution. An ordinary contribution
requires a filed and linked issue plus the repository's normal code review,
required checks, and security gates - no board access, project attachment,
board fields, board sweep, board HR-queue drain, or board-specific approval.

Being invoked for board **status** is a read: report current board state. A
read-only status is open to anyone and never requires a board sweep, a true-up,
or an HR-queue drain, so never run a maintainer-gated operation to answer one.
It is also not authority to perform board writes; board writes follow the
authority rules below.

## Authority check before a maintainer operation

Run this before any board sweep, board review, true-up, or HR-queue drain:

1. Resolve the named owner of the catch-all `*` rule in `.github/CODEOWNERS`,
   read at run time from the repository default branch, or from the PR base
   branch when the engagement is scoped to one PR. Do not use a login
   remembered from this skill or an earlier session.
2. Identify the acting account with `gh api user`. Never read credential
   stores, auth-store files, or token material to establish identity.
3. Proceed only when that login matches the resolved catch-all owner, or that
   owner has explicitly and verifiably delegated this engagement. A path-scoped
   CODEOWNER qualifies only for board operations confined to their owned paths.
4. Otherwise decline the operation, name which verification failed, and offer a
   read-only board status instead. Do not perform the sweep, review, true-up, or
   drain.
5. If the CODEOWNERS resolution, the acting identity, or a claimed delegation is
   unclear, ask a structured question and pause only the board operations that
   depend on it. Unrelated work and ordinary contributions continue.

## Procedures

The full board procedures - definitions, the 14 board laws, and the authority
and HR rules that govern them - live in
[references/board-laws.md](references/board-laws.md). That file is the
canonical home of the board laws. Read it before any board operation beyond a
plain read of current board state.

## Fixed constraints

- Board resource: https://github.com/users/Heretyc/projects/4
- Board operations use **only** the `gh` CLI, including `gh api` where
  subcommands lack field coverage. If `gh` is unauthenticated or lacks the
  `project` scope, raise an Action HR asking the human to run
  `gh auth refresh -s project`.
- Board sweeps, board reviews, true-ups, and the HR queue are maintainer
  operations: only an applicable CODEOWNER, or an agent explicitly delegated by
  one, may run them. Board review eligibility does not govern ordinary PR
  review.
- Never store local paths or machine-specific information on the board.
- Board-only findings are advisory. Absent issue-to-board mappings, incomplete
  board fields, stale sweeps, board review queues, unavailable project
  permissions, and board API failures never fail CI, block routine status, or
  reject a merge. Missing PR issue linkage is a separate contribution
  requirement and remains enforceable.
- If the applicable maintainer identity is missing, ambiguous, or unverifiable,
  ask a structured question and pause only the board operations that depend on
  it.
