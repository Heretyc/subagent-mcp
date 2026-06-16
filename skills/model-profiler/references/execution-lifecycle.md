# execution-lifecycle.md — STRICT Run Lifecycle (worktree-first → deliver)

**Load when:** starting ANY model-profiler run, BEFORE Phase 0. This is the unskippable
wrapper around the pipeline. The phase order here is FIXED — never reordered, never
skipped. The middle (Phase 0 → VALIDATE) is the main pipeline (`SKILL.md`); this leaf
governs the worktree gate that PRECEDES it and the git lifecycle that FOLLOWS it.

---

## Phase order (absolute — every run, no exceptions)

```
0. worktree/branch gate   ← ABSOLUTE FIRST STEP (before Phase 0 consent)
1. main skill execution   ← Phase 0 → 1 → 1.5 → 2 → EMIT → 3-PASS → VALIDATE
2. commit
3. push
4. open PR
5. resolve merge conflicts
6. PR ready
7. deliver: PR hyperlink + change-summary + clickable MERGE link
```

The full lifecycle (steps 2–7) is ALWAYS OFFERED at the end of every run and is **never silently
skipped** (DELIVERY MANDATE — SKILL.md Highest-Priority Mandates / invariant #18).

## 0. Worktree/branch gate (FIRST — before anything mutating)

ALL mutating work in this skill is FORBIDDEN in the primary checkout. Before Phase 0
consent, before any read-for-write, before any dispatch:

1. **Decide the branch:** `<type>/<subject>` from the allowed type set (use `chore/` or
   `feature/` for a routine refresh, e.g. `chore/routing-refresh-<date>`). Formula + regex:
   `docs/spec/dev-loop/worktree-enforcement/naming.md`.
2. **Create/enter a compliant LINKED worktree OUTSIDE the repo:**
   ```sh
   git worktree add -b <type>/<subject> ../subagent-mcp.worktrees/<type>-<subject> origin/main
   ```
   Native Claude `EnterWorktree` is NON-COMPLIANT (wrong branch name, inside-repo path) —
   use the manual command above. See `worktree-enforcement/claude.md`.
3. **Run the gate from inside that worktree and REQUIRE pass:**
   ```sh
   node scripts/check_worktree.mjs   # must print WORKTREE-GATE: PASS
   ```
   On FAIL: STOP. Take no repo-affecting action until a compliant worktree exists.

The gate re-runs before every mutating action (Tier-3 self-enforcement); the authoritative
boundary is the Tier-1 server-side protection on the default branch.

## 1. Main skill execution

Run the pipeline per `SKILL.md` (Phase 0 consent → … → VALIDATE). Emit the EXACTLY-3
artifacts; stay within the DATA-ONLY boundary (invariant #13). Do not commit until ALL
validators are green (`validate_provider` + audit-mirror + `validate_seed_sites` +
`validate_routing_audit`).

## 2. Commit

Stage ONLY the 3 artifacts plus any in-allowlist script/skill changes the run made:
```sh
git add src/routing-table.json src/routing-table-audit.json research-seed-sites.json
git commit -m "<concise descriptive message>"
```
NO AI attribution / co-author lines in the commit or any generated metadata (validation.md
§2). Dispatch the pre-commit contradiction-checker sub-agent first if source/executable
changed; if it reports `blocked`/`needs_user`, do not commit.

## 3. Push

```sh
git push -u origin <type>/<subject>
```
Never push to the default/protected branch directly.

## 4. Open PR

```sh
gh pr create --base main --head <type>/<subject> --title "<title>" --body "<summary>"
```
Topic-branch → default-branch only.

## 5. Resolve merge conflicts

Merge (or rebase) the default branch into the topic branch and resolve until mergeable:
```sh
git fetch origin ; git merge origin/main
```
A conflicted routing artifact is resolved by RE-RUNNING the deterministic builder on the
merged dataset, NEVER by hand-editing JSON. Re-run builder + validators after any conflict
resolution that touched an artifact (regen-green must hold).

## 6. PR ready

The PR is READY only when: validators green, spec checklist clear (validation.md §2), the
six scenario routes pass (validation.md §3), conflicts resolved, CI passing.

## 7. Deliver: PR hyperlink + change-summary + MERGE link (DELIVERY MANDATE)

The full delivery lifecycle is ALWAYS OFFERED and NEVER silently skipped (DELIVERY MANDATE).
Return to the owner ALL of:
- the **PR URL** (`gh pr view --json url -q .url`),
- a **concise summary of what changed in `src/routing-table.json` since its LAST MERGED
  update** — diff the prior merged routing table (the #21 drift baseline:
  `git show origin/main:src/routing-table.json`) against the new one and surface:
  per-category route/rank shifts, added/removed model+effort pairings, and any
  completeness-state change. The audit metadata
  (`run_manifest.drift_vs_prior_audit` + the change note) holds the full provenance; the
  delivered summary is the human-readable digest of it, and
- the **clickable MERGE hyperlink** for the owner to merge the PR (the PR web URL —
  `gh pr view --json url -q .url` — which opens the mergeable PR; surface it LAST so the owner
  can complete the merge). Merge conflicts (step 5) must be resolved and the PR marked ready
  (step 6) before this link is surfaced.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
