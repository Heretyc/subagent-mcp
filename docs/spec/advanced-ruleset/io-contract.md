# Advanced-Ruleset IO Contract

Normative. Defines the exact JSON shapes on stdin/stdout, the strict output
validation rules, the empty-array veto, and THE verbatim hard-fail string.
When the script runs is `execution-contract.md`; payload visibility fields are
`visibility-and-failover.md`.

## Env-check mode output (no-arg invocation)

The script prints ONE JSON object to stdout:

```json
{ "ready": true, "load-rules": false }
```

- Both keys REQUIRED, both booleans. The second key is `"load-rules"` with a
  HYPHEN : not `load_rules`, not `loadRules`.
- Extra keys are ignored. Missing/non-boolean keys, or `"ready": false`, are
  failures (-> hard fail, non-latching; `execution-contract.md`).

## Routing mode stdin (server -> script)

One JSON object, written to stdin then EOF. Example (valid JSON):

```json
{
  "candidates": [
    { "provider": "claude", "model": "opus-4-8", "effort": "ultracode", "rank": 1 },
    { "provider": "codex",  "model": "gpt-5.5",  "effort": "xhigh",     "rank": 2 },
    { "provider": "api",    "model": "team-fast", "effort": "medium",   "rank": 3 },
    { "provider": "claude", "model": "haiku",    "effort": "none",      "rank": 4 }
  ],
  "context": {
    "task_category": "coding",
    "cwd": "C:\\work\\repo",
    "selection_mode": "auto",
    "provider": null,
    "model": null,
    "effort": null
  }
}
```

| Field | Contract |
|---|---|
| `candidates[]` | The already-filtered LAUNCHABLE list (best-to-worst), after applicable cost-efficiency auto `providers.jsonc` API slot insertion. Performance and override modes receive no API slots. Short model ids for CLI providers, configured model strings for provider `"api"`; normalized efforts; haiku rows carry effort `"none"`. |
| `candidates[].rank` | Dense positional 1..N over THIS list (raw table ranks gap after launchability filtering; explicit mode has no table rank). |
| `context.task_category` | The validated category string. |
| `context.cwd` | The launch working directory (`params.cwd \|\| process.cwd()`). |
| `context.selection_mode` | `"auto"` \| `"provider"` \| `"provider_model"` \| `"explicit"`. |
| `context.provider/model/effort` | The caller's own overrides, or `null`. Keys ALWAYS present (deterministic shape). |

The context deliberately EXCLUDES deadlock status, branch, tier, and window
counters : the script must never learn them. OS environment variables are
visible natively (`os.environ`); use them for machine-local policy inputs.

The candidate list is complete when the ruleset receives it: applicable API
slots already have provider value `"api"`, and no candidates are inserted after
the ruleset.

## Routing mode stdout (script -> server)

A BARE JSON array : the modified candidate list (reorder / filter / replace
allowed). Template:

```json
[
  { "provider": "claude", "model": "sonnet",  "effort": "high"  },
  { "provider": "api",    "model": "team-fast", "effort": "medium" },
  { "provider": "codex",  "model": "gpt-5.5", "effort": "xhigh" }
]
```

## Strict output validation (server side)

Validation is against STATIC launch enums, NOT raw routing-table rows: the
returned list is consumed verbatim by the attempt loop, so every entry must be
launchable. Table ids like `gpt-5.5-pro` or `claude-fable-5` are NOT valid
output; use short launch id `fable` for `claude-fable-5`.

| Rule | Detail |
|---|---|
| Top level | Bare JSON array. An object wrapper (e.g. `{"candidates": [...]}`) is INVALID. `[]` is VALID : see Veto below. |
| Element | Object with string `provider`, `model`, `effort`. All other keys : including `rank` : are IGNORED on output. |
| `provider` | `claude`, `codex`, or `api`. |
| `model` | `haiku`, `sonnet`, `opus`, `opus-4-8`, `fable` (claude); `gpt-5.5`, `gpt-5.6` (codex); or an `api` model present in the input candidates. CLI provider/model pairs must be legal. |
| `effort` | Per-model table below; the validator does its OWN membership checks. |
| Duplicates | Allowed for CLI candidates. API candidates cannot exceed their input multiplicity because each requires attached dispatch metadata. |
| Anything else | Ruleset failure -> hard fail. |

Per-model effort legality:

| model | legal `effort` values |
|---|---|
| `haiku` | exactly `"none"` |
| `sonnet` | `medium`, `high`, `xhigh`, `max` |
| `fable` | `medium`, `high`, `xhigh`, `max` |
| `opus`, `opus-4-8` | `medium`, `high`, `xhigh`, `max`, `ultracode` |
| `gpt-5.5` | `medium`, `high`, `xhigh` (NO `max`, NO `ultracode`) |
| `gpt-5.6` | `medium`, `high`, `xhigh` (NO `max`, NO `ultracode`) |
| `api` provider candidates | configured slot effort (currently `medium`) |

HAZARD : the validator must not delegate effort checks to the launch path:
`resolveEffort` has a lenient fallback that silently coerces
unrecognized effort strings to `high`. Without own membership checks, junk
like `"banana"` would launch instead of failing. The strict table above is the
contract; `buildCommand`/`resolveEffort` remain defense-in-depth only.

## Empty array = VETO (valid, not a malfunction)

Filtering to zero candidates is the limit case of the explicitly allowed
filter operation : a legitimate policy ("never launch codex in this repo")
must be expressible without masquerading as a system malfunction. An empty
array therefore returns a clean `isError` result with EXACTLY this text (the
`<AUTO_HINT>` block from `../auto-mode/resolution-matrix.md` appended on the
next line):

```
Error: advanced ruleset returned zero candidates for task_category <task_category>; launch vetoed by ruleset.
<AUTO_HINT>
```

The veto is NOT the hard-fail message, NOT a silent no-op, and NOT a latch; it
never touches the deadlock window. Tests assert this text verbatim.

## THE hard-fail message (verbatim, immutable)

Any ruleset failure : non-zero exit, non-serializable or invalid JSON output,
any invalid element, timeout, missing interpreter, `ready: false`, scaffold
recreate write failure : makes `launch_agent` fail with EXACTLY:

```
subagent ruleset erroring. Please ask the system administrator to debug before continuing. It is highly discouraged to continue use of this chat session as the system is now operating outside safe parameters.
```

- No `Error: ` prefix. No trailing-punctuation changes. Never reworded.
- It carries NO `<AUTO_HINT>` and NO `<SPLIT_HINT>` : a deliberate, documented
  EXCEPTION to the append-hints-to-every-error convention in
  `../auto-mode/resolution-matrix.md` (amended there). The owner demands the
  exact string and nothing else.
- Defined once in source (`RULESET_HARD_FAIL_MSG`, src/ruleset.ts) and
  asserted verbatim in tests (full string equality, house convention).
- Failure diagnostics (stderr tail, exit code) go to server-side
  `console.error` ONLY; the MCP caller never sees them.
- The failure does NOT latch: the next `launch_agent` retries
  (`execution-contract.md`).

## Anti-examples (all -> hard fail unless noted)

- Script prints `ok` or a Python traceback to stdout -> unparseable -> hard fail.
  Diagnostics belong on stderr.
- Output is `{"candidates": [...]}` -> not a bare array -> hard fail.
- Output names `gpt-5.5-pro` or `claude-fable-5` -> not a launchable model id ->
  hard fail (table ids are not launch ids; use `fable`).
- `{"provider":"codex","model":"gpt-5.5","effort":"max"}` -> illegal effort for
  codex -> hard fail. Same for sonnet + `ultracode`.
- `{"provider":"claude","model":"sonnet","effort":"banana"}` -> hard fail (the
  effort.ts fallback leniency would have coerced it; the validator must not).
- A rule that calls a slow network API -> exceeds 120000 ms -> killed -> hard
  fail. Keep rules lean; they run inside EVERY launch.
- `[]` -> NOT a hard fail: deliberate veto, exact veto text above.
