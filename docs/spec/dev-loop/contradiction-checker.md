# Contradiction-Checker Sub-Agent

Status: normative. Activated by the `AGENTS.md` Always Enforce bullet before any
commit that changes executable/source code or build-participating files. This
file is the full contract; the `AGENTS.md` bullet is the trigger.

## Purpose

A separate sub-agent checks a pending commit's change set against the
repository's specs, docs, and build inputs BEFORE the commit is created. It
exists to catch (1) changes that contradict normative documents and (2)
incomplete commits that would leave the build or its documented inputs
inconsistent. The dispatching agent must not self-review in place of this
checker.

## Dispatch Contract

- Dispatch a SEPARATE sub-agent (never inline) using the strongest selectable
  model/reasoning available to the host.
- The sub-agent prompt MUST begin with `<this is a request from a parent
  process>` (root invariant in `AGENTS.md`).
- The checker's FIRST step re-runs `node scripts/check_mcp_compliance.mjs`
  (vendor metadata caps); a FAIL there is itself a blocking contradiction.
- Give the checker: the worktree path, branch, base ref, a description of the
  change set, and the staged/unstaged file lists.
- If no checker can be dispatched, halt and tell the owner. Do not commit.

## What Counts As A Contradiction

The checker reports a contradiction in ANY of these classes:

1. **Spec-vs-change conflict.** The change does Y where a normative spec/doc
   (e.g. `AGENTS.md`, `docs/spec/**`, skill references, wiring-shape docs)
   says X. Cite both sides with file:line locators.
2. **Stale build-participating docs/specs.** Docs or specs that PARTICIPATE in
   the build, package, or test output — anything consumed by the `build`,
   `test`, `prepare`, or pack steps in `package.json` (e.g. `directives/**`
   shipped in the tarball, generator inputs read by `scripts/*.mjs`, files
   listed in `package.json` `files[]`) — that the change set renders
   inaccurate or inconsistent but does not update. A code change that alters
   behavior documented in a shipped or build-consumed doc, without updating
   that doc in the same change set, is a contradiction.
3. **Unstaged build-affecting work.** Any file that participates in the build,
   package, or test pipeline that is MODIFIED but not staged, or UNTRACKED but
   referenced by the staged change (imported, required, listed in
   `package.json` `files[]`/scripts, or named in a workflow), at commit time.
   A commit that would ship half of a build-affecting change set is a
   contradiction even when nothing textually conflicts.
   - User-owned dirty files (pre-existing changes the current task does not
     own) are NOT contradictions of this class; list them under `risks` so the
     orchestrator can confirm ownership, and never stage them.

## Return Shape

Return STRICT JSON only — no prose outside it:

```json
{
  "status": "pass|blocked|needs_user",
  "summary": "...",
  "source_locators": ["file:line", "..."],
  "risks": ["..."],
  "writes_requested": []
}
```

- `pass`: no contradictions in any class. `risks` may still carry soft notes.
- `blocked`: at least one contradiction found. The summary names each
  contradiction, its class (1-3), and the exact files/lines involved.
- `needs_user`: the checker cannot decide without owner input (e.g. uncertain
  file ownership, ambiguous spec authority).
- Include `source_locators` for every file-backed claim.
- `writes_requested` is normally empty; the checker is read-only.

## Orchestrator Obligations On The Result

- `pass`: proceed to commit.
- `blocked` (class 1 or 2): fix the conflicting/stale files in the same change
  set, then RE-RUN the checker. Do not commit around a contradiction.
- `blocked` (class 3): stage the missing owned build-affecting files if they
  belong to the same cohesive change, or split them into their own branch per
  `git-collaboration.md` directive 8; then re-run the checker.
- `needs_user`: do no writes; resolve via `docs/spec/safety-scope.md`; do not
  self-trigger a clarification cascade.
- Never downgrade a `blocked` to a risk note, and never edit the checker's
  verdict into the commit/PR description as a pass.

## What This Checker Is Not

- Not a style or quality reviewer (use the review SOPs for that).
- Not the 8-perspective gate for durable instructions (that is
  `docs/spec/prompt-review/eight-perspective-review.md`; both can apply to the
  same commit).
- Not a substitute for CI: it runs pre-commit, against intent, not runtime.
