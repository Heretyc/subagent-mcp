# Permission System Spec Index

Status: normative spec for how `subagent-mcp` gates what a launched sub-agent
may do. This file is the stable retrieval-map entry for the decomposed
permission-system leaves under `permissions/`.

The permission system is implemented in `src/permission-engine.ts`,
`src/pending-permissions.ts`, `src/permission-classes.json`, `src/concurrency.ts`,
`src/drivers.ts`, and `src/index.ts`. Where a design draft disagrees, the leaves
document the code and call out divergences inline.

## Leaves (read the smallest matched file)

| File | Contains | Read when |
|---|---|---|
| `permissions/ceiling-modes.md` | `permissionsCeiling`, `verdict()`, SAFE/DANGER/NEUTRAL classes, read scoping, irreversible flag, rule syntax. | Touching ceiling modes, the permission engine, classifications, path scoping, or rule matching. |
| `permissions/config-and-lifecycle.md` | Config-source precedence, Codex-to-Claude mapping, config rename, pending-permission lifecycle, config keys, child lockout. | Touching settings ingestion, Codex approval mapping, `respond_permission`, `permission_requested`, park timeouts, config keys, or child permissions. |
| `permissions/threat-model.md` | Accepted risks, residuals, and cross-harness caveats. | Evaluating safety posture, accepted risks, or whether a proposed permission change closes or widens a known residual. |

## Load-this-when rules

- Start here before touching the permission engine, ceiling modes,
  `respond_permission`, `permission_requested`, the Codex approval channel, or
  the `global-subagent-mcp-config.jsonc` permission keys.
- After this index, load only the matched leaf or leaves above.
- Do not preload the whole `permissions/` directory unless the change spans the
  engine, lifecycle, and threat model together.

## Invariants

- Launched sub-agents run gated by default (`permissionsCeiling: auto`).
- Children (`SUBAGENT_MCP_SUBAGENT=1`) get no `respond_permission` tool.
- The orchestration mode is orthogonal to permissions: orchestration decides who
  delegates; permissions decide what a launched sub-agent may do.

## See also

- `interactive-drivers.md` for launch values.
- `dev-loop/orchestration-directive-architecture.md` for orchestration mode.
- `../reference/status-lifecycle.md` for `permission_requested`.
