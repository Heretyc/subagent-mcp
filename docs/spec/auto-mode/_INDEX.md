# Auto-Mode Spec Index

Status: normative spec for the `launch_agent` "auto mode" feature. Authored
under the 8-perspective prompt-review gate (see
`../prompt-review/eight-perspective-review.md`). This directory is the canonical
home for the auto-mode design. Implementation lives in `src/**`; this directory
is design + contract only.

## What auto-mode is

`launch_agent` gains a required `task_category` param. When the caller supplies
only `prompt` + `task_category`, the server reads the **performance** branch of
the routing table, builds a best→worst candidate list for that category, and
launches the first candidate that spawns successfully — silently falling back
down the list on any launch-time failure. `provider`/`model`/`effort` become
optional overrides that are usually unnecessary.

This is a server-side capability change. It reuses the existing
`buildCommand` + `resolveExe` + `spawn` path unchanged; it adds a resolver in
front of that path.

## Leaves (read the smallest matched file)

| File | Contains | Read when |
|---|---|---|
| `param-contract.md` | New `launch_agent` param schema; required/optional rules; selection modes. | Changing the tool's input schema or param semantics. |
| `resolution-matrix.md` | Full presence→behavior matrix; every hard-error case with EXACT message text. | Implementing/validating param validation and candidate-list construction. |
| `routing-table-contract.md` | Loader contract: path, branch, pairing schema ref, model→provider map, effort normalization, ordering, attempt + silent fallback, empty-table behavior. | Implementing the loader/resolver against the table. |
| `tool-description.md` | Verbatim rewritten tool description + the 11 caveman `task_category` metadata glosses. | Rewriting the MCP tool metadata strings. |
| `build-and-test.md` | B2 file partition (non-overlapping ownership) + the fixture-based test plan. | Splitting build work or writing tests. |

## Invariants carried from `AGENTS.md`

- Fail loud: every rejected input returns a clear MCP error, never a silent
  default or a crash. Silent fallback applies ONLY to launch-time candidate
  failures (see `routing-table-contract.md §Attempt loop`).
- The 10 categories + `fallback_default` are the fixed taxonomy
  (`docs/spec/task-taxonomy/_INDEX.md`); auto-mode consumes them, never
  re-derives, renames, or reorders them.
- No AI attribution in commits/docs/metadata.
- Topic branch + PR for the implementation; pre-commit contradiction-checker
  sub-agent before any source commit.

## Authoritative pairing shape note

The runtime pairing shape is defined by `skills/model-profiler/references/provider-json-emission.md` and enforced by `scripts/validate_provider.mjs`: `performance.<category>` is a **direct array** of pairing objects (no `.pairings` wrapper). The `.spec/references/assets/routing-table.json` file is the spine/category-key mirror used for structural validation only — it is NOT the runtime pairing shape and must not be treated as the authoritative source for array vs. object layout.

## AGENTS.md load-trigger note (for B2 — do NOT edit AGENTS.md from this task)

B2 should add a load trigger to `AGENTS.md` "Load Triggers":

> `docs/spec/auto-mode/_INDEX.md`: read before changing the `launch_agent`
> tool's param contract, the routing-table loader/resolver, or auto-mode
> candidate-selection / silent-fallback behavior.

Keep `AGENTS.md` <=100 lines when adding it; `src/routing-table.json` is the
routing artifact; the fixed taxonomy lives in `.spec/references/work-categories.md`.
