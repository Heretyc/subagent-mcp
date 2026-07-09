# Global Concurrent-Subagent Cap Contract -- RETRIEVAL MAP

Normative content lives in the leaf files under `cap-contract/`. This file is
a retrieval map only so file-level links to the cap contract stay valid while
the contract remains under repository markdown line limits.

## One-screen summary

The machine-global live-subagent cap is the sole admission control for
subagents alive at once across all sessions, processes, users, and recursive
descendants on one host. `launch_agent` rejects immediately at cap and never
queues. Per-user slot marker files (one namespace subdir per OS user) provide the
live count for that user, zombie culling removes stale markers opportunistically
(killing only verified provider children), and the cap config is re-read on every
launch.

## Leaf directory

| Leaf | Covers | Load when |
|---|---|---|
| `cap-contract/state-and-lifecycle.md` | Scope, shared state, slot directory, and slot lifecycle. | Touching reservation, counting, paths, release sites, or lifecycle semantics. |
| `cap-contract/zombie-culling.md` | Zombie culling thresholds, process-tree cleanup, reports, and crash/no-reaper behavior. | Touching stale slot cleanup, hook/tool culling, or `zombie_killed` reporting. |
| `cap-contract/config-and-build.md` | Config source/path/validation, shipped JSONC template, retention, and build copy/scaffold behavior. | Touching `global-subagent-mcp-config.jsonc`, config parsing, update checks, retention, scaffold, or copy-provider behavior. |
| `cap-contract/enforcement-fail-open-tests.md` | Launch enforcement point, reject response requirements, fail-open behavior, and test coverage. | Touching cap enforcement, reject messaging, filesystem-error behavior, or cap-related tests. |

## Related specs

- `docs/spec/global-concurrency/_INDEX.md` routes global cap topics.
- `docs/spec/auto-mode/_INDEX.md` covers the `launch_agent` candidate-selection
  flow that the cap check precedes.
