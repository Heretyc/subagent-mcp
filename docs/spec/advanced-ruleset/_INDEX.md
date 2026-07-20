# Advanced-Ruleset Spec Index

Status: normative spec for the `advanced-ruleset.py` routing override hook.
Authored under the 8-perspective prompt-review gate (see
`../prompt-review/eight-perspective-review.md`). This directory is the
canonical home for the ruleset design. Implementation lives in `src/**`; this
directory is design + contract only. It deliberately AMENDS specific clauses of
`../auto-mode/`; every amendment is marked in the owning leaf and cross-linked
from `visibility-and-failover.md` and `io-contract.md`.

## What the advanced ruleset is

`advanced-ruleset.py` is a USER-EDITABLE Python script with FINAL authority
over model routing for `launch_agent`. It lives in the same directory as
`routing-table.json` (`dist/advanced-ruleset.py`; globally
`$(npm root -g)/@heretyc/subagent-mcp/dist/advanced-ruleset.py` : note the
SCOPED package name). It is the USER'S EXPLICIT OVERRIDE layer and ALWAYS RUNS
LAST: after the server builds the complete candidate list, including
`providers.jsonc` API slot candidates inserted by `slotInsert`, in EVERY
selection mode, including a fully explicit `provider+model+effort` request.
The script may reorder, filter, or replace that list, and the returned list is
consumed verbatim by the attempt loop. The shipped scaffold is a passthrough
with `LOAD_RULES = False`, so the feature is inert until a user opts in.

LOUD WARNING : a machine with NO Python interpreter cannot run the mandatory
environment check, and ANY ruleset failure (missing interpreter included)
hard-fails `launch_agent` with the exact message in `io-contract.md`. On such a
machine EVERY `launch_agent` call fails until Python is installed or
`SUBAGENT_RULESET_PYTHON` points at a working interpreter. This is the owner's
stated contract, not a bug. The failure never latches, so the first launch
after the fix succeeds without a server restart.

## Leaves (read the smallest matched file)

| File | Contains | Read when |
|---|---|---|
| `execution-contract.md` | Interpreter detection + `SUBAGENT_RULESET_PYTHON`; env-check vs `route` mode; per-process latch table (FAILURE NEVER LATCHES); hardcoded 120000 ms timeout; hook position; runtime recreate; actor table. | Changing when, how, or whether the script runs. |
| `io-contract.md` | Exact stdin/stdout schemas; env-check `{"ready","load-rules"}` shape; strict output validation; empty-array veto + exact text; THE verbatim hard-fail string + hint exception; anti-examples. | Changing payloads, validation, or error text. |
| `scaffold-and-deployment.md` | Canonical scaffold source; generated embed + build order; hard-fail dist copy; installer backup/restore bracket; verify lists; never-overwrite-user-edits rule. | Touching the scaffold, build pipeline, or installer. |
| `visibility-and-failover.md` | `ruleset_applied` / `ruleset_original_selection` fields; amendments to auto-mode exposure clauses; post-spawn grace-window failover contract. | Changing launch/poll payload fields or failover behavior. |
| `build-and-test.md` | Implementer file partition; test plan with rationale; verification gate. | Splitting build work or writing tests. |

## Invariants carried from `AGENTS.md`

- Fail loud: a ruleset malfunction is NEVER swallowed : `launch_agent` returns
  the exact hard-fail message (`io-contract.md`), never a silent fallback to
  the unmodified candidate list.
- User-owned files are sacred: a package update must never overwrite a
  user-edited `advanced-ruleset.py` (`scaffold-and-deployment.md`).
- No AI attribution in commits, docs, or metadata.
- Topic branch + PR; pre-commit `node scripts/check_mcp_compliance.mjs` plus a
  contradiction-checker sub-agent before any source commit.

## AGENTS.md load trigger (applied in place)

`AGENTS.md` stays exactly 100 lines: the existing auto-mode trigger line
(AGENTS.md line 56) was EXTENDED in place (net 0 lines) instead of adding a
new bullet. Exact current text of that line:

> - `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent` tool's param contract, the routing-table loader/resolver, or auto-mode candidate-selection / silent-fallback behavior; for the advanced-ruleset.py override hook, its python execution/IO contract, launch visibility fields, or the post-spawn failover window, read `docs/spec/advanced-ruleset/_INDEX.md` first.
