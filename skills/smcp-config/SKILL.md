---
name: smcp-config
version: 1.0.0
description: Read and change subagent-mcp settings through the configure MCP tool by canonical key. Use when the user says "smcp config", "configure smcp", "change smcp setting", "/smcp:config", "set api key", or "change concurrency". Covers user settings, provider fields, routing slots, .env secrets, and read-only global, update, and mode keys.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-22
updated: 2026-07-22
---

# subagent-mcp Config

Use the `configure` MCP tool to list, read, and set subagent-mcp settings by
canonical key: `action=list` enumerates settings, `action=get` reads one key,
`action=set` writes a settable key. Secrets are always redacted; writes are
validated, backed up, and atomic, and responses report `restart_required`.

Read `skills/smcp-config/references/settings.md` for the full catalog: every
key, type, default, valid values, scope, resolved path, restart flag, and an
example call. Never guess key names or defaults.

## Rules

- `global.*`, `update.autoUpdate`, and `mode.*` are read-only here. `set`
  returns a coached no-op naming the file a human must edit, or the
  `orchestration-mode` / `model-selection-mode` tool to use instead.
- Running `configure` IS permitted for the orchestrator session even when
  orchestration mode is ON: the MCP tool is an allowed channel. Call it
  directly; do not delegate the edit to a subagent.
- Never echo a secret value; report only the redacted tool output.
