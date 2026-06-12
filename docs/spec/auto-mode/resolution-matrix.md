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

Sole exception to "append to EVERY error": the advanced-ruleset HARD-FAIL
message carries NO hints and is never modified
(`../advanced-ruleset/io-contract.md`). The ruleset VETO error does carry
`<AUTO_HINT>`; its exact text also lives in that leaf.

`SPLIT_HINT` (append to category errors AND to the all-candidates-failed error):

```
If unsure which category fits, do NOT pass one big amorphous task: break the work into smaller atomic steps that each map to a single task_category, and launch one agent per step.
```

## Presence matrix

`P`=provider, `M`=model, `E`=effort present. `launchable valid` means one
of the 14 taxonomy categories other than `fallback_default`. `fallback_default`
is a valid category sentinel, but resolver-backed modes cannot launch it.

| C | P | M | E | Outcome |
|---|---|---|---|---|
| launchable valid | – | – | – | `auto` mode; build candidate list, attempt loop |
| launchable valid | yes | – | – | `provider` mode; candidate list, attempt loop |
| launchable valid | yes | yes | – | `provider_model` mode; candidate list, attempt loop |
| launchable valid | yes | yes | yes | `explicit` mode; single direct attempt, no fallback |
| fallback_default | – | – | – | **ERR_FALLBACK_DEFAULT** |
| fallback_default | yes | – | – | **ERR_FALLBACK_DEFAULT** |
| fallback_default | yes | yes | – | **ERR_FALLBACK_DEFAULT** |
| fallback_default | yes | yes | yes | `explicit` mode; single direct attempt, no fallback |
| launchable valid/fallback_default | – | yes | – | **ERR_MODEL_NEEDS_PROVIDER** |
| launchable valid/fallback_default | – | yes | yes | **ERR_EFFORT_NEEDS_BOTH** (effort rule checked first; see Validation order) |
| launchable valid/fallback_default | – | – | yes | **ERR_EFFORT_NEEDS_BOTH** |
| launchable valid/fallback_default | yes | – | yes | **ERR_EFFORT_NEEDS_BOTH** |
| absent/invalid | * | * | * | **ERR_BAD_CATEGORY** (validate category FIRST, before P/M/E rules) |

All rows above assume `deadlock` absent or `false`. `deadlock=true` combinations
are in the **Deadlock combinations** sub-table below (checked at validation
step 2, before the P/M/E rules).

Validation order in the handler:

1. `task_category` valid? else `ERR_BAD_CATEGORY`.
2. `deadlock === true` AND any of `provider`/`model`/`effort` present →
   `ERR_DEADLOCK_WITH_OVERRIDES`. Runs BEFORE the effort/model rules, so it
   pre-empts `ERR_EFFORT_NEEDS_BOTH`/`ERR_MODEL_NEEDS_PROVIDER` for those combos.
3. If `effort` present and not (`provider` and `model`) → `ERR_EFFORT_NEEDS_BOTH`.
4. If `model` present and not `provider` → `ERR_MODEL_NEEDS_PROVIDER`.
5. (explicit mode only) provider+model must match the existing
   provider↔model rule from `src/index.ts` (claude↔{haiku,sonnet,opus,opus-4-8};
   codex↔gpt-5.5); reuse that existing check and its message verbatim.
6. If `task_category` is `fallback_default` and mode is not `explicit` →
   `ERR_FALLBACK_DEFAULT`.
7. All validation passed. If `deadlock === true`, ARM the deadlock window now
   (counter = 3; `routing-table-contract.md §Branch selection`) — never before
   this point, so a rejected call never arms. Then build the candidate list for
   the selected branch and run the attempt loop (`routing-table-contract.md`).

### Deadlock combinations

`D` = `deadlock=true` (see Validation order step 2; `false`/absent → use the
main matrix). Step 2 precedes the effort/model rules, so ANY override alongside
`deadlock=true` yields `ERR_DEADLOCK_WITH_OVERRIDES` — even a combo that would
otherwise be `ERR_MODEL_NEEDS_PROVIDER` or `ERR_EFFORT_NEEDS_BOTH`.

| C | D | P | M | E | Outcome |
|---|---|---|---|---|---|
| launchable valid | yes | yes | – | – | **ERR_DEADLOCK_WITH_OVERRIDES** |
| launchable valid | yes | – | yes | – | **ERR_DEADLOCK_WITH_OVERRIDES** (pre-empts ERR_MODEL_NEEDS_PROVIDER) |
| launchable valid | yes | – | – | yes | **ERR_DEADLOCK_WITH_OVERRIDES** (pre-empts ERR_EFFORT_NEEDS_BOTH) |
| launchable valid | yes | yes | yes | yes | **ERR_DEADLOCK_WITH_OVERRIDES** |
| launchable valid | yes | – | – | – | `auto`; arm window (counter=3), read `performance`, attempt loop |
| launchable valid | no | – | – | – | `auto`; read `performance` if a window is live, else `cost_efficiency` |

`deadlock=false` is identical to omitting it (last row): it never arms and never
errors with overrides — `false` + full P/M/E is plain `explicit` mode.

## Exact error messages

`ERR_BAD_CATEGORY` (category absent or unknown). Interpolate the offending
value; if absent, render `Got: <none>`:

```
Error: task_category is required and must be one of: math_proof, security_review, debugging, quality_review, architecture, agentic_execution, data_analysis, coding, knowledge_synthesis, mechanical, prompt_engineering, vulnerability_research, molecular_biology, ml_accelerator_design, fallback_default. Got: <value>.
<SPLIT_HINT>
<AUTO_HINT>
```

`ERR_DEADLOCK_WITH_OVERRIDES` (`deadlock=true` passed with any of
provider/model/effort; validation step 2, before the effort/model rules):

```
Error: deadlock cannot be combined with provider, model, or effort. If repeated attempts at this task have failed, switch to pure auto mode — pass only prompt + task_category and let the server select — unless your assignment explicitly demands a specific model. Omit provider/model/effort and retry.
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

`ERR_FALLBACK_DEFAULT` (`fallback_default` in auto/provider/provider_model
mode). The sentinel is a valid category value, but it is not a launchable
routing-table category. Return split guidance instead of model-profiler
population guidance:

```
Error: fallback_default is a split hint sentinel, not a launchable routing-table category.
<SPLIT_HINT>
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
- Do NOT treat a sub-agent's eventual TASK failure as a fallback trigger —
  only launch-time failures fall back (`routing-table-contract.md`).
  Launch-time failure INCLUDES any exit within the post-spawn grace window
  EXCEPT a child already finalized by `turn.completed` (legitimate fast
  completion — `../advanced-ruleset/visibility-and-failover.md`); only deaths
  AFTER that window are task outcomes.
