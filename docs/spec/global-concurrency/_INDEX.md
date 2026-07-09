# Global-Concurrency Spec Index

Status: normative spec for the machine-global cap on **live** subagents
enforced by `launch_agent`. This directory is the canonical home for the cap
design. Implementation lives in `src/**` (chiefly `src/concurrency.ts`); this
directory is design + contract only. The cap is independent of model routing
and of orchestration mode — it governs only how many subagents may be alive at
once across the whole machine.

## What the global concurrency cap is

A single machine-wide limit on the number of subagents that may be **alive at
the same time** across EVERY session, process, and user on the host. The whole
recursive descendant tree counts toward ONE number: every descendant runs its
own MCP server and its own `launch_agent`, so the tree-wide total is emergent
from shared state, not computed by any PID-tree walk or liveness probe. When
the limit is reached, `launch_agent` is REJECTED — the cap never queues or
blocks. The limit value lives in a user-editable `global-subagent-mcp-config.jsonc`
config that is re-read live on every call and preserved across package updates
by the same bracket that protects `advanced-ruleset.py`.
See `docs/spec/permissions.md` §4 for the 2.12.5 rename; `global-concurrency.jsonc` is a deprecated fallback.

`launch_agent` silently runs zombie reaping before cap rejection but does not
return `zombie_report`; culled `zombie_killed` status remains observable through
`poll_agent`, `list_agents`, and `wait`.

## Leaves (read the smallest matched file)

| File | Contains | Read when |
|---|---|---|
| `cap-contract.md` | Retrieval map for the authoritative cap contract leaves below. | Start here for cap mechanism, config, path, enforcement, or tests. |
| `cap-contract/state-and-lifecycle.md` | Scope, shared-state marker-dir mechanism, never-over-admit proof, machine-global path per OS, slot lifecycle, and release sites. | Touching reservation, counting, paths, release sites, or lifecycle semantics. |
| `cap-contract/zombie-culling.md` | Zombie culling thresholds, process-tree cleanup, JSONL reports, and crash/no-reaper semantics. | Touching stale slot cleanup, hook/tool culling, or `zombie_killed` reporting. |
| `cap-contract/config-and-build.md` | `global-subagent-mcp-config.jsonc` config, verbatim template, parse/validate/clamp table, retention, scaffold, and copy-provider behavior. | Touching config parsing, update checks, retention, scaffold, or packaging copy behavior. |
| `cap-contract/enforcement-fail-open-tests.md` | Enforcement point, reject response requirements, fail-open policy, and tests. | Touching cap enforcement, reject messaging, filesystem-error behavior, or cap-related tests. |

## Related specs

- `../advanced-ruleset/scaffold-and-deployment.md` — the cap config reuses this
  leaf's preserve-on-update 3-site bracket and gen-scaffold / copy-provider
  build chain verbatim; read it before touching retention or packaging.
- `../auto-mode/_INDEX.md` — the `launch_agent` candidate-selection and attempt
  loop the cap check sits in front of (the check runs after routing + the
  advanced-ruleset hook, before the first spawn attempt).
