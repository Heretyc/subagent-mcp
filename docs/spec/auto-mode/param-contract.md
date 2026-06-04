# Auto-Mode Param Contract

Normative. Defines the new `launch_agent` input schema and param semantics.
Error message text and the full presence matrix live in `resolution-matrix.md`.

## Input schema (zod)

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_category` | enum of the 11 keys (below) | **YES — always** | Maps directly to routing-table category keys. Required in BOTH auto and explicit modes. |
| `prompt` | string, min 1 | YES (unchanged) | The sub-agent task. |
| `provider` | enum `["claude","codex"]` | optional | Override. Omit to auto-select. |
| `model` | enum `["haiku","sonnet","opus","opus-4-8","gpt-5.5"]` | optional | Override. Omit to auto-select. |
| `effort` | enum `["low","medium","high","xhigh","max","ultracode"]` | optional | Override. **Remove the current `.default("high")`.** Omit to auto-select. |
| `cwd` | string | optional (unchanged) | Working directory for the spawned CLI. |

The 11 `task_category` enum values (the fixed 10 + fallback):

```
math_proof, security_review, debugging, quality_review, architecture,
agentic_execution, data_analysis, coding, knowledge_synthesis, mechanical,
fallback_default
```

These are the EXACT keys in `.spec/references/assets/routing-table.json`
(`categories` / `performance` keys, plus the top-level `fallback_default`).
Auto-mode never invents, renames, or reorders them — the taxonomy is fixed
(`docs/spec/task-taxonomy/_INDEX.md`).

> Implementation note: keep `task_category` as a `z.enum(...)` so the SDK
> surfaces the 11 valid values to callers, but ALSO hard-validate inside the
> handler so the error text in `resolution-matrix.md` (which lists the valid
> categories and the auto-mode hints) is what the caller sees, not only the raw
> zod enum error.

## Selection modes

The combination of supplied override params determines the `selection_mode`
returned in the success payload and the candidate-list rule applied:

| Supplied overrides | `selection_mode` | Candidate rule (see `routing-table-contract.md`) |
|---|---|---|
| none | `auto` | every pairing in `performance.<task_category>`, rank ascending |
| `provider` only | `provider` | pairings whose model maps to that provider, rank ascending |
| `provider` + `model` | `provider_model` | pairings matching that model, rank ascending |
| `provider` + `model` + `effort` | `explicit` | exactly that one pairing; single attempt, no fallback; attempt directly even if absent from table |

`effort` alone, or `model` without `provider`, are NOT valid modes — they are
hard errors (`resolution-matrix.md`). Net rule:

- if `effort` given → require `provider` AND `model`.
- if `model` given → require `provider`.

## Success payload (returned after first successful spawn)

JSON (string in the MCP text content), superset of the current payload:

```json
{
  "agent_id": "<uuid>",
  "status": "running",
  "provider": "claude",
  "model": "opus-4-8",
  "effort": "high",
  "task_category": "architecture",
  "selection_mode": "auto",
  "candidates_skipped": 2
}
```

- `provider`/`model`/`effort` are the ACTUALLY launched values (resolved from
  the winning pairing, after effort normalization — `routing-table-contract.md`).
- `effort` is the normalized launch-enum value actually passed to
  `buildCommand` (e.g. `"high"`, or the clamped value); for `haiku` it is the
  value `buildCommand` ignored — report the pairing's normalized effort.
- `candidates_skipped` = count of earlier candidates that failed to launch
  before this one succeeded (0 in `explicit` mode).

## Out of scope (future)

- The `cost_efficiency` branch is NOT consumed by this feature. The resolver
  reads only the `performance` branch. Record `cost_efficiency` as a future
  extension (e.g. a future `optimize_for: "cost"` param); do not wire it now.
