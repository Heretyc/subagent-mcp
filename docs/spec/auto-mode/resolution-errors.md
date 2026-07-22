# Auto-Mode Resolution Errors

Normative. Exact error text for the auto-mode validation matrix in
[resolution-matrix.md](resolution-matrix.md).

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
Error: deadlock cannot be combined with provider, model, or effort. From the 3rd attempt for the same atomic task, deadlock outranks capability overrides: drop provider/model/effort and retry.
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
  1. <model>@<effort> (<provider>) [<failure_type>]: <reason>
  2. ...
<SPLIT_HINT>
<AUTO_HINT>
```

Each numbered line carries the `failure_type` label in brackets :
`[transient_provider]` (usage caps, quota 429, HTTP-status 5xx, network
timeouts, ETIMEDOUT/ECONNRESET) or `[permanent]` (everything else, including
bare three-digit numbers without HTTP-status context) : from
`classifyFailureReason(reason, stderr)`. Exhaustion is `ERR_ALL_FAILED`
regardless of classification; it carries no `failover_occurred` field (it is an
error, not a success).

Override selector modes use `ERR_ALL_FAILED` if every requested and fallback
candidate fails. The requested route appears first in the numbered list; any
valid auto candidates are appended after de-duping.

## ERR_SUBORCH_DEPTH (`sub-orchestrator: true` at depth >= 1; validation step 6b)

This error sets `isError: true`. Verbatim text from `SUB_ORCH_DEPTH_ERROR(depth)` in
`src/sub-orchestrator.ts`:

```
Error: sub-orchestrator: true is only available to the main orchestrator (depth 0). Current SUBAGENT_MCP_DEPTH=<depth>: a sub-orchestrator launched from this depth could not delegate, because the 2-level spawn cap leaves its workers unable to run. Relaunch this agent as a normal sub-agent (omit sub-orchestrator).
```

Interpolate the actual `currentLaunchDepth()` value for `<depth>`. This error carries no
`AUTO_HINT` (it is a structural depth violation, not a mode/category error).

## Anti-examples (what must NOT happen)

- Do NOT silently substitute `effort:"high"` when `effort` is omitted : that is
  the old behavior; auto-mode resolves effort from the pairing.
- Do NOT crash or return an empty/`undefined` payload when the table is missing
  : return `ERR_TABLE_MISSING`.
- Do NOT retry the same `{provider,model,effort}` triple in one launch call.
- Do NOT treat a sub-agent's eventual TASK failure as a fallback trigger :
  only launch-time failures fall back (`routing-table-contract.md`).
  Launch-time failure INCLUDES any exit within the post-spawn grace window
  EXCEPT a driver already finalized by its provider turn-completion marker (legitimate fast
  completion : `../advanced-ruleset/visibility-and-failover.md`); only deaths
  AFTER that window are task outcomes.

