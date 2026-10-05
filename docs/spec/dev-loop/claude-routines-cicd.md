# Claude Routines CI/CD

Status: normative CI/CD mapping for this repository.

## Canonical Path

Claude Code Routines are the canonical CI/CD path for this repository. GitHub
Actions exists only as the GitHub-standard dispatch bridge and signal that a
routine was started. The workflow file is
`.github/workflows/claude-routine.yml`.

Routines are research-preview infrastructure. If Anthropic changes routine API,
trigger behavior, limits, or completion reporting, stop and update this SOP
before changing workflow behavior.

## Prompt And Setup

Paste the exact contents of `docs/spec/dev-loop/claude-routine-prompt.md` into
the Claude routine Instructions field. That file contains no setup commentary,
citations, or wrapper text.

## Required Setup

1. Create a Claude Code routine at `claude.ai/code/routines`.
2. Select this repository and a scoped Claude Code cloud environment.
3. Configure the routine Instructions field from
   `docs/spec/dev-loop/claude-routine-prompt.md`.
4. Add an API trigger to the routine.
5. Store the API trigger URL in GitHub Actions secret
   `CLAUDE_ROUTINE_FIRE_URL`.
6. Store the API trigger bearer token in GitHub Actions secret
   `CLAUDE_ROUTINE_FIRE_TOKEN`.
7. Install the Claude GitHub App for GitHub-event routines when direct webhook
   triggers are used.
8. Keep routine repository branch pushes disabled for CI/CD routines. If a
   future implementation routine must push code, use Claude's default
   `claude/`-prefixed branch restriction as a documented tool exception, or get
   owner approval before enabling broader branch pushes.

## Workflow Contract

`.github/workflows/claude-routine.yml` must:

- trigger on `pull_request`, `workflow_dispatch`, `merge_group`, and push events
  with the dispatch job limited to the repository default branch unless owner
  policy adds more protected branches
- use least-privilege `GITHUB_TOKEN` permissions
- avoid checkout and avoid executing untrusted PR code
- send only bounded event metadata to the routine API
- prepend `<You are the primary agent in an automated workflow>` to the routine
  API text body
- send workflow SHA, target SHA, PR head/base SHA, and merge-group metadata
- state in its routine contract text that PR issue linkage is enforced and that
  project board findings are advisory only, without loading the project-board
  skill, contacting the project board, or running a board sweep
- fail if the routine cannot be dispatched
- require version sync by running `npm run check:versions` or `npm run build`
  before reporting pass
- report the returned Claude Code session URL in the workflow summary
- not claim that routine completion succeeded merely because dispatch succeeded
- mark all GitHub event fields as untrusted metadata for the routine

## Routine Report Format

The routine must post or preserve this exact report shape:

```markdown
## Claude Routine CI/CD

Status: pass|fail|blocked
Session: <Claude session URL>
Trigger: <event/ref/sha>
Target SHA: <sha checked out for validation>

### Checks
- Line limits: pass|fail|blocked
- Version sync: pass|fail|blocked
- JSON syntax: pass|fail|blocked
- Python syntax: pass|fail|blocked
- Branch and PR policy: pass|fail|blocked
- Issue linkage: pass|fail|blocked|not-applicable
- GitHub governance: pass|fail|blocked
- Claude CI/CD mapping: pass|fail|blocked
- Security: pass|fail|blocked
- Attribution: pass|fail|blocked
- Artifact hygiene: pass|fail|blocked
- 8-perspective directive/SOP gate: pass|fail|blocked|not-applicable

### Findings
- <file or PR field>: <problem and required fix>

### Advisory (non-blocking)
- <board or other advisory observation>: <note; never affects Status or merge>

### Validation Notes
- <commands, limitations, skipped checks, or routine API limitations>
```

## Issue Linkage And Advisory Board Findings

- Every PR must have a filed issue linked in its body before merge. The routine
  reports this as the `Issue linkage` check, and that check can fail or block.
- The check is evaluated against the pull requests the run identifies: the PR of
  a `pull_request` event, or the pull requests GitHub reports as associated with
  the target SHA of a `merge_group`, push, or `workflow_dispatch` run. Those
  associated PRs, including already-merged ones, are evaluated exactly like
  `merge_group` PRs. `not-applicable` applies only when the association query on
  the target SHA completed successfully and returned no pull request; such runs
  report `not-applicable` rather than fail, and must not assume a PR body. A
  `pull_request` event must always identify an actual PR or report `blocked`, and
  is never `not-applicable`. If the pull-request association lookup for a
  `merge_group`, push, or `workflow_dispatch` run fails or is unavailable, PR
  metadata cannot be established and the check reports `blocked`, never
  `not-applicable`. An identified PR whose body or issue metadata is
  inaccessible also reports `blocked`. Each `blocked` here is a non-board
  access limitation.
- Issue linkage is required independently of project board membership,
  issue-to-board mappings, board fields, board sweeps, and board review queues.
- Board evaluation is advisory whenever it happens at all. Normal CI must not
  load the project-board skill, contact the project board, or run a board sweep
  just to check a PR. No new board checker is added and no new mandatory
  evaluation is introduced.
- Board-only findings, absent issue-to-board mappings, incomplete board fields,
  stale board sweeps, board review queues, unavailable project permissions, and
  board API failures must never cause a CI failure, a fail or blocked routine
  status, or a merge rejection.
- Advisory items belong in the report's `Advisory (non-blocking)` section and
  must stay distinguishable from `Findings`, which carries failing or blocking
  non-board problems only.
- Every unrelated check stays fail-closed. Do not add blanket
  `continue-on-error` and do not make the Claude routine nonblocking.

## Enforcement

- Branch protection or rulesets should require `claude-routine-dispatch` only on
  GitHub plans where private-repository protections are actually enforced.
- On private repositories where GitHub shows a plan-gating warning, do not treat
  rulesets or branch protection as enforceable. Maintainers must manually block
  merges unless this SOP's routine-report gate passes.
- The required check proves that GitHub successfully fired the routine. It does
  not prove that the routine completed successfully.
- No PR may merge unless the latest Claude Routine report for the current head
  SHA has `Status: pass`, or the owner explicitly approves an emergency override
  that names the risk and accepted bypass.
- Human review must inspect the routine session URL or PR comment before merge
  until Anthropic exposes a blocking completion status for routines.
- If the routine API, token, quota, or webhook delivery fails, the PR does not
  merge.
- If direct GitHub-event routines are enabled in Claude, keep the workflow
  bridge anyway so GitHub has a required status check.
- Fork and Dependabot `pull_request` runs do not receive normal repository
  secrets. They fail closed unless a maintainer moves the change to a trusted
  branch, performs a trusted `workflow_dispatch`, or uses an owner-approved
  metadata-only GitHub App/routine trigger.

## Security

- Routine API tokens are per-routine bearer tokens and must stay in GitHub
  Actions secrets.
- Do not use an Anthropic API key for routine firing.
- Do not put secrets in workflow YAML, prompts, PR bodies, comments, or docs.
- Limit routine environment variables, network access, connectors, and branch
  permissions to what the routine needs.
- Remember that routines run autonomously without approval prompts during a run.
