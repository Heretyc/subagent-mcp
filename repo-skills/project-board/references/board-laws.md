# Project Board Laws

This file is the canonical home of the project board laws.

## Scope

These laws are binding, with no exceptions, on work performed under an
explicitly requested project-board engagement. They do not apply to ordinary
contributions and never add prerequisites to one. An ordinary contribution
needs a filed and linked issue plus the repository's normal code review,
required checks, and security gates: no board access, project attachment, board
fields, board sweep, board HR-queue drain, or board-specific approval.

https://github.com/users/Heretyc/projects/4 is the Source of Truth for the
PLANNING and STATUS of Board Work. It is subordinate to the alignment chain in
Law 2: where Board and Premise conflict, the Premise wins and the Board is
corrected.

## Definitions

"Board Work" = any mutation of git-tracked content - commits, branches, PRs -
    carried out as part of a requested board engagement. Wiki edits, releases,
    tags, and comments are not Board Work. Board mutations are not Board Work
    and never require issues.
"Human Review" (HR) = engagement of the human via the structured question tool,
    presented as if the human has no knowledge of the project or repo. Two modes:
  - Decision HR: 2+ options, each with pros and cons.
  - Action HR: 1 required action, why it is needed, and the consequence of inaction.
    Within board scope HR is NEVER skippable for any authority or reason. One HR
    session MAY bundle every trigger pending at that moment.
"Premise" = The answer to "what is this + why care?":  who it's for + problem + what
    it does + why not alternatives. Canonical copy: first paragraph of README.md,
    MAXIMUM 1000 characters.
"Short Premise" = Verbatim-identical version of Premise (minus the "why not
    alternatives" aspect) MAXIMUM 350 characters and found in BOTH the Repo and Project
    Short Descriptions.
"Interactive Session" = A harness that has a working structured question tool.
    Lacking this, the session is considered non-interactive.
"Board Operator" = the named owner of the catch-all `*` rule in the effective
    `.github/CODEOWNERS`, read at run time from the repository default branch
    (or from the base branch of the PR when the engagement is scoped to one),
    or an agent that owner has explicitly delegated for the current engagement.
    Resolve this every time; never rely on a login recorded in this file or
    remembered from an earlier session. Verify the acting identity with `gh api
    user` and compare that login to the resolved CODEOWNERS entry; never read
    credential stores, auth-store files, or token material to establish
    identity. Board sweeps, board reviews, true-ups (Law 13), and the HR queue
    (Law 14) affect no specific paths, so they require catch-all ownership or
    its explicit delegation; a path-scoped CODEOWNER qualifies only for board
    operations confined to the paths they own. A requester whose catch-all
    CODEOWNERS entry or delegation from that owner is not verified may not run
    board sweeps, board reviews, true-ups, or HR-queue drains. Board review
    eligibility does not govern ordinary PR review, which follows the
    repository's normal review rules. If the CODEOWNERS resolution, the acting
    identity, or a claimed delegation is missing, ambiguous, or unverifiable,
    ask a structured question and pause only the board operations that depend on
    it; unrelated work and ordinary contributions proceed.

## Directives

1. Short Premise must faithfully condense the canonical Premise. Any edit to the
    Premise updates both Short Premise copies in the same session. If the copies mismatch,
    truncate, or drift from the canonical: the README is canonical and
    the mismatch is an HR trigger.
2. Code MUST align with repo Spec docs. Spec MUST align with the Premise at all
    times. The Premise is always the tie-breaker. If in doubt, HR. If the
    Repo lacks the canonical Premise in README.md, or either Short Description
    lacks the Short Premise: recon the project specs/code and present a proposed
    Premise and Short Premise via Decision HR; that same HR authorizes the board
    issue for the restoration edit (which is Board Work).
3. All Board Work maps to a board issue. All issues map to Milestones. No unmapped
    Board Work.
4. Every issue/epic carries ALL required fields at ALL times: Label(s),
    Priority, Size, Estimate, Iteration, Milestone, Assignee, Relationships,
    branch/PR link, and updated Status. Satisfiability rules: issues are created
    fully populated in a single operation, with Iteration taken from the
    authorizing HR (Law 9, bundled per the HR definition); the branch/PR link is
    mandatory from the moment the branch or PR exists and MUST be back-filled in
    the same working session ("none yet" before that; "n/a" for board-only
    issues); Assignee follows Law 11 (an idle issue may be unassigned or
    assigned to anyone; an actively-worked issue MUST be assigned to the worker).
    Field completeness is a board-side requirement and never gates an ordinary
    contribution or a merge.
5. Within board scope, every PR maps to a fully populated issue. Repository-wide,
    every PR requires a filed and linked issue; board population is not a
    precondition for opening or merging it.
6. Live updates are mandatory during Board Work: update the mapped item BEFORE,
    DURING, and AFTER the work. Agents update existing items in real time without
    seeking permission. While an HR is pending on an item, only Status changes and
    comments recording the block are permitted on it.
7. Every agent performing Board Work MUST fully understand the Board plan and the
    Premise BEFORE acting. The read-only sweep in Law 13 both requires and
    satisfies this understanding for a Board Operator; a non-Board-Operator
    satisfies it with a read-only review of the Board and Premise, no sweep.
8. Any conflict between tasked board work and the Board: STOP and deconflict via HR
    BEFORE any board edit. Conflicts between Board and Premise resolve per Law 2.
9. Net-new Board Work not on the board: HR BEFORE adding it. That HR also supplies
    the new issue's Iteration and other judgment fields (Law 4).
10. Board ops use ONLY the `gh` CLI, including `gh api` where subcommands lack
    field coverage (Relationships). If `gh` is not authenticated or lacks
    the project scope: Action HR asking the human to run `gh auth refresh -s
    project` (interactive; agents cannot complete it).
11. Before starting Board Work on an unassigned issue, assign it to the logged-in
    `gh` user. If an issue you are tasked to work is assigned to someone else: Action
    HR to reassign. If the human declines, stand down from that item: you are
    forbidden from performing Board Work on any issue not assigned to the logged-in
    `gh` user. Idle issues may remain unassigned or assigned to others.
12. Never store local paths or machine-specific information anywhere on the Board.
13. A Board Operator sweeps the Board before starting and after finishing Board
    Work: find the most recently COMPLETED "Project Board true-up #". If it
    completed more than 5 business days ago, or none exists: dispatch 2+ review
    subagents over all incomplete board items for non-compliance with these Laws
    (if the harness cannot spawn subagents, perform the work directly). HR is
    mandated on all non-compliant items found (bundle-able). Once the true-up is
    complete: mark it complete and create the next true-up issue with an
    incremented #, NO assignee, description = a VERBATIM copy of these Laws from
    their canonical home (this file, `repo-skills/project-board/references/board-laws.md`).
14. HR may be DEFERRED only in headless runs where no human is reachable
    (determined if no structured question tool exists in your harness), and
    deferral is never resolution. Queue the item as a comment on the dedicated
    HR-queue board item, set the affected issue's Status to "Awaiting Review"
    (rename "In Review" to "Awaiting Review" if it exists. If you cannot rename,
    use "In Review" status), and proceed only with Board Work unaffected by the
    pending question; doubt about whether Board Work is affected resolves to
    AFFECTED. Any Interactive Session engaged in board operations MUST drain the
    queue (bundled HR) BEFORE starting any new Board Work; draining is a Board
    Operator operation, so a non-Board-Operator session facing a non-empty queue
    reports it and starts no new Board Work instead of draining it. If any
    queued item is older than 5 business days, all
    Board Work halts until the queue drains - ordinary contributions are
    unaffected. Every true-up (Law 13) reports the queue's contents. Queued items
    are never deemed approved, expired, or abandoned.

## Advisory posture

Board evaluation is advisory when performed. Board-only findings, absent
issue-to-board mappings, incomplete board fields, stale board sweeps, board
review queues, unavailable project permissions, and board API failures must
never cause a CI failure, a blocked routine status, or a merge rejection. Keep
advisory findings distinguishable from failing non-board findings. Missing PR
issue linkage is a separate contribution requirement and remains enforceable.
