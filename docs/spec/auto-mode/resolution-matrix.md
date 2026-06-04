# Auto-Mode Resolution Matrix and Error Catalogue

Normative. The complete param-presence → behavior table and EXACT error text.
All errors are returned as `{ content: [{type:"text", text:<msg>}], isError: true }`
(the existing error shape in `src/index.ts`). Fail loud: never default, never
crash.

## Shared hint blocks (reused verbatim in every error)

`AUTO_HINT` (append to EVERY error below):

```
Tip: omit provider/model/effort entirely and the server auto-selects the best provider/model/effort for this task_category, with automatic silent fallback.
```

`SPLIT_HINT` (append to category errors AND to the all-candidates-failed error):

```
If unsure which category fits, do NOT pass one big amorphous task: break the work into smaller atomic steps that each map to a single task_category, and launch one agent per step.
```

## Presence matrix

`P`=provider, `M`=model, `E`=effort present. `C`=task_category valid.

| C | P | M | E | Outcome |
|---|---|---|---|---|
| valid | – | – | – | `auto` mode; build candidate list, attempt loop |
| valid | yes | – | – | `provider` mode; candidate list, attempt loop |
| valid | yes | yes | – | `provider_model` mode; candidate list, attempt loop |
| valid | yes | yes | yes | `explicit` mode; single direct attempt, no fallback |
| valid | – | yes | – | **ERR_MODEL_NEEDS_PROVIDER** |
| valid | – | yes | yes | **ERR_EFFORT_NEEDS_BOTH** (effort rule checked first; see Validation order) |
| valid | – | – | yes | **ERR_EFFORT_NEEDS_BOTH** |
| valid | yes | – | yes | **ERR_EFFORT_NEEDS_BOTH** |
| absent/invalid | * | * | * | **ERR_BAD_CATEGORY** (validate category FIRST, before P/M/E rules) |

Validation order in the handler:

1. `task_category` valid? else `ERR_BAD_CATEGORY`.
2. If `effort` present and not (`provider` and `model`) → `ERR_EFFORT_NEEDS_BOTH`.
3. If `model` present and not `provider` → `ERR_MODEL_NEEDS_PROVIDER`.
4. (explicit mode only) provider+model must match the existing
   provider↔model rule from `src/index.ts` (claude↔{haiku,sonnet,opus,opus-4-8};
   codex↔gpt-5.5); reuse that existing check and its message verbatim.
5. Build candidate list per mode; run attempt loop (`routing-table-contract.md`).

## Exact error messages

`ERR_BAD_CATEGORY` (category absent or unknown). Interpolate the offending
value; if absent, render `Got: <none>`:

```
Error: task_category is required and must be one of: math_proof, security_review, debugging, quality_review, architecture, agentic_execution, data_analysis, coding, knowledge_synthesis, mechanical, fallback_default. Got: <value>.
<SPLIT_HINT>
<AUTO_HINT>
```

`ERR_MODEL_NEEDS_PROVIDER`:

```
Error: provider is required when model is given. You passed model=<model> without provider. Either also pass provider, or omit both.
<AUTO_HINT>
```

`ERR_EFFORT_NEEDS_BOTH`:

```
Error: effort requires both provider and model. You passed effort=<effort> without a complete provider+model. Either pass provider+model+effort for a fully explicit launch, or omit all three.
<AUTO_HINT>
```

`ERR_TABLE_MISSING` (auto/provider/provider_model mode, table file absent or
unreadable):

```
Error: routing table not populated for <task_category> (routing-table file missing or unreadable). Either run the model-profiler to populate it, or pass provider+model+effort explicitly for a fully-specified launch.
<AUTO_HINT>
```

`ERR_NO_CANDIDATES` (table loaded but the category has zero pairings, OR a
provider/model constraint matched nothing):

```
Error: routing table not populated for <task_category> (no <scope> pairings available). Either run the model-profiler to populate it, or pass provider+model+effort explicitly.
<AUTO_HINT>
```

`<scope>` = `""` (empty category), `"matching provider <provider>"`, or
`"matching model <model>"`.

`ERR_ALL_FAILED` (every candidate's launch attempt failed). List each skipped
candidate and its failure reason:

```
Error: all <N> candidate launches failed for task_category <task_category>:
  1. <model>@<effort> (<provider>): <reason>
  2. ...
<SPLIT_HINT>
<AUTO_HINT>
```

`ERR_EXPLICIT_FAILED` (explicit mode, the single attempt failed). No fallback:

```
Error: explicit launch <model>@<effort> (<provider>) failed: <reason>.
<AUTO_HINT>
```

## Anti-examples (what must NOT happen)

- Do NOT silently substitute `effort:"high"` when `effort` is omitted — that is
  the old behavior; auto-mode resolves effort from the pairing.
- Do NOT crash or return an empty/`undefined` payload when the table is missing
  — return `ERR_TABLE_MISSING`.
- Do NOT fall back past a fully-explicit (`explicit` mode) attempt — one try
  only, then `ERR_EXPLICIT_FAILED`.
- Do NOT treat a sub-agent's eventual TASK failure as a fallback trigger — only
  launch-time failures fall back (`routing-table-contract.md`).
