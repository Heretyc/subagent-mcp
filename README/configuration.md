# README Configuration

This page holds the detailed configuration reference for
[README.md](../README.md), which stays as the concise top-level entry point.

## Where The Config Lives

The global config ships as `src/global-subagent-mcp-config.jsonc` and installs
to `dist/global-subagent-mcp-config.jsonc`, beside the compiled server. It is
the sole source of truth for machine-wide defaults and is re-read on every
`launch_agent`, so edits take effect with no restart. The legacy filename
`dist/global-concurrency.jsonc` is still read when the new file is absent.

Per-user permission rules layer on top of the global ceiling from
`~/.subagent-mcp/settings.json` then `~/.subagent-mcp/settings.local.json`, then
per-repo `<cwd>/.claude/settings.json` and `.claude/settings.local.json`. Only
`permissions.{allow, deny, ask, additionalDirectories}` are read from those
files. Deny and ask rules are unioned, so they only tighten. Full precedence:
[docs/spec/permissions.md](../docs/spec/permissions.md).

## Global Config Keys

| Key | Values | Default |
|---|---|---|
| `globalConcurrentSubagents` | integer 10 or greater; 1 to 9 forced up to 10; missing, 0, or negative resets to default | `20` |
| `checkForUpdates` | `true` or `false` | `true` |
| `permissionsCeiling` | `auto`, `manual`, or `yolo` | `auto` |
| `escalation` | `irreversible-only` or `off`; applies in `auto` mode only | `irreversible-only` |
| `strictReadParity` | `warn` or `off`; logging only | `warn` |
| `sandboxNetwork` | `true` or `false`; Codex workspace-write network | `false` |

## Permission And Selection Modes

- **Permission ceiling** (`permissionsCeiling`, global config): `auto`,
  `manual`, or `yolo`. See
  [Permissions](../README.md#permissions).
- **Escalation** (`escalation`, global config): in `auto` mode,
  `irreversible-only` routes irreversible NEUTRAL residue to a human; `off`
  leaves it to orchestrator judgment.
- **Model selection** (`model-selection-mode` tool, per project): `smart`
  rejects provider, model, and effort selectors and picks the best model
  automatically. `user-approved-overrides` allows manual selectors for a
  30-minute window, then reverts to `smart`.
- **Orchestration** (`orchestration-mode` tool): `ON` or `OFF`. See
  [How to operate it](../README.md#how-to-operate-it).
