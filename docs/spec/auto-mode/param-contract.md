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
| `deadlock` | boolean | optional | Auto-mode-only escalation flag; omit normally. Agent-visible gloss is the verbatim MANDATE in `tool-description.md`: set `true` only on the 3rd+ launch attempt for the SAME atomic task. CANNOT be combined with `provider`/`model`/`effort` (→ `ERR_DEADLOCK_WITH_OVERRIDES`, `resolution-matrix.md`). `false` == omitting. Window mechanics: `routing-table-contract.md §Branch selection`. |
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

The combination of supplied override params determines the resolution mode
(internal — no longer surfaced in the payload) and the candidate-list rule
applied:

| Supplied overrides | mode (internal) | Candidate rule (see `routing-table-contract.md`) |
|---|---|---|
| none | `auto` | every pairing in the selected branch's `<task_category>`, rank ascending |
| `provider` only | `provider` | pairings whose model maps to that provider, rank ascending |
| `provider` + `model` | `provider_model` | pairings matching that model, rank ascending |
| `provider` + `model` + `effort` | `explicit` | exactly that one pairing; single attempt, no fallback; attempt directly even if absent from table |

`effort` alone, or `model` without `provider`, are NOT valid modes — they are
hard errors (`resolution-matrix.md`). Net rule:

- if `effort` given → require `provider` AND `model`.
- if `model` given → require `provider`.

`deadlock` does not create a mode: it is valid ONLY in `auto` mode (no overrides)
and, while a window is armed, selects the `performance` branch for `auto`
launches (`routing-table-contract.md §Branch selection`). Combined with any
override → `ERR_DEADLOCK_WITH_OVERRIDES`.

## Success payload (returned after first successful spawn)

JSON (string in the MCP text content):

```json
{
  "agent_id": "<uuid>",
  "status": "processing",
  "provider": "claude",
  "model": "opus-4-8",
  "effort": "high",
  "task_category": "architecture"
}
```

- `provider`/`model`/`effort` are the ACTUALLY launched values (resolved from
  the winning pairing, after effort normalization — `routing-table-contract.md`).
- `effort` is the normalized launch-enum value actually passed to
  `buildCommand` (e.g. `"high"`, or the clamped value); for `haiku` it is the
  value `buildCommand` ignored — report the pairing's normalized effort.
- `selection_mode` and `candidates_skipped` are NOT returned (removed): the
  launch payload carries no routing-internal fields — with ONE deliberate
  exception: when the advanced ruleset ALTERED the routing decision, the
  conditional `ruleset_applied` + `ruleset_original_selection` pair is added
  (`../advanced-ruleset/visibility-and-failover.md`). Which branch/tier was
  used is still surfaced only via `poll_agent`'s `routing_tier` (`docs/tools.md`).

## Branch and deadlock

`auto` launches read the `cost_efficiency` branch by default; the optional
`deadlock` flag arms a per-process window that diverts pure-`auto` launches to
the `performance` branch for the next 3 successes. Full mechanics (arming,
decrement, re-arm, shared-process scope, no cross-branch fallback) live in
`routing-table-contract.md §Branch selection`.
