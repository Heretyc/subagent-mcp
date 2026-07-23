---
name: smcp-config
version: 1.0.0
description: Read and change subagent-mcp settings through the configure MCP tool. Use when the user says "smcp config", "/smcp:config", "change smcp setting", or "set api key".
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-22
updated: 2026-07-22
---

# subagent-mcp Config

Use the `configure` MCP tool: `action=list` enumerates every key with metadata,
`action=get` reads one, `action=set` writes a settable key. Read
`references/settings.md` for paths, redaction, and write rules; never guess
key names or defaults.

- `global.*`, `update.autoUpdate`, and `mode.*` are read-only here: `set`
  returns a coached no-op naming the file or tool to use instead.
- Running `configure` IS permitted for the orchestrator session even when
  orchestration mode is ON; call it directly, do not delegate.
- Never echo a secret; report only the redacted tool output.
