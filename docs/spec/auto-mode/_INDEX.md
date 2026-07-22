# Auto-Mode Spec Index

Status: normative spec for the `launch_agent` "auto mode" feature. Authored
under the 8-perspective prompt-review gate (see
`../prompt-review/eight-perspective-review.md`). This directory is the canonical
home for the auto-mode design. Implementation lives in `src/**`; this directory
is design + contract only.

## What auto-mode is

`launch_agent` gains a required `task_category` param. When the caller supplies
only `prompt` + `task_category`, the server reads the **cost_efficiency** branch of
the routing table, builds a best-to-worst candidate list for that category, and
launches the first candidate that spawns successfully : silently falling back
down the list on any launch-time failure. `provider`/`model`/`effort` become
optional overrides that are usually unnecessary.

Branch selection : the `cost_efficiency` default, the `performance` branch armed
by the optional `deadlock` flag, and the window decrement/re-arm rules : is
specified in `routing-table-contract.md`.

This is a server-side capability change. It reuses the existing
`buildCommand` + `resolveExe` + `spawn` path unchanged; it adds a resolver in
front of that path.

## Leaves (read the smallest matched file)

| File | Contains | Read when |
|---|---|---|
| `param-contract.md` | New `launch_agent` param schema; required/optional rules; selection modes; `sub-orchestrator?` row. | Changing the tool's input schema or param semantics. |
| `resolution-matrix.md` | Full presence-to-behavior matrix; validation-order note including `ERR_SUBORCH_DEPTH` at step 6b. | Implementing/validating param validation and candidate-list construction. |
| `resolution-errors.md` | Exact auto-mode error text, shared hint blocks, anti-examples, and `ERR_SUBORCH_DEPTH` verbatim text. | Implementing/validating hard-error response text. |
| `routing-table-contract.md` | Loader contract: path, branch selection (`cost_efficiency` default + `performance` deadlock window + swarm pin subsection), pairing schema ref, model->provider map, effort normalization, ordering, attempt + silent fallback, empty-table behavior; amended sanctioned-exposures list. | Implementing the loader/resolver against the table. |
| `tool-description.md` | Verbatim rewritten tool description + 15 caveman `task_category` glosses; sub-orchestrator sentence + param gloss; swarm tool description + stage param gloss; byte accounting. | Rewriting the MCP tool metadata strings. |
| `build-and-test.md` | B2 file partition (non-overlapping ownership) + the fixture-based test plan. | Splitting build work or writing tests. |

Related leaf set: `../advanced-ruleset/` specifies the user-editable
`advanced-ruleset.py` override hook, which runs between candidate-list
construction and the attempt loop and deliberately AMENDS clauses of this set
: the launch-payload no-routing-fields rule (`param-contract.md`), the
every-error-hints convention and the task-failure anti-example
(`resolution-matrix.md`), and the sanctioned-exposure list plus the
launch-time-only clause (`routing-table-contract.md`). Read
`../advanced-ruleset/_INDEX.md` before relying on those clauses.

## Invariants carried from `AGENTS.md`

- Fail loud: every rejected input returns a clear MCP error, never a silent
  default or a crash. Silent fallback applies ONLY to launch-time candidate
  failures (see `routing-table-contract.md section Attempt loop`).
- The 14 categories (directly benchmarked parents + 4 composite-inferred) +
  `fallback_default` are the fixed taxonomy
  (`docs/spec/task-taxonomy/_INDEX.md`); auto-mode consumes them, never
  re-derives, renames, or reorders them.
- No AI attribution in commits/docs/metadata.
- Topic branch + PR for the implementation; pre-commit contradiction-checker
  sub-agent before any source commit.

## Authoritative pairing shape note

The runtime pairing shape is defined by `skills/model-profiler/references/provider-json-emission.md` and enforced by `scripts/validate_provider.mjs`: `performance.<category>` is a **direct array** of pairing objects (no `.pairings` wrapper). The `.spec/references/assets/routing-table.json` file is the spine/category-key mirror used for structural validation only : it is NOT the runtime pairing shape and must not be treated as the authoritative source for array vs. object layout.

The committed `src/routing-table.json` is the launchable-only runtime table.
`src/routing-table-audit.json` may retain benchmarked non-launchable ids for
provenance, but `scripts/validate_provider.mjs` and
`scripts/validate_routing_audit.mjs` project comparisons through
`scripts/lib/launchable-models.mjs`.

## AGENTS.md load-trigger note (for B2 : do NOT edit AGENTS.md from this task)

B2 should add a load trigger to `AGENTS.md` "Load Triggers":

> `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent`
> tool's param contract, the routing-table loader/resolver, or auto-mode
> candidate-selection / silent-fallback behavior.

Keep `AGENTS.md` <=100 lines when adding it; `src/routing-table.json` is the
routing artifact; the fixed taxonomy lives in `.spec/references/work-categories.md`.
That trigger line has since been EXTENDED in place (net 0 lines) to also route
advanced-ruleset work to `docs/spec/advanced-ruleset/_INDEX.md`; the exact
current text is quoted in `../advanced-ruleset/_INDEX.md`.
