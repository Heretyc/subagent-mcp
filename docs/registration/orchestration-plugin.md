<!-- Part of registration (split). Retrieval map: ../registration.md -->

# Orchestration mode (plugin: hook + server)

**Load when:** installing the per-turn orchestration hook alongside the server,
diagnosing why injection does not fire, or explaining desktop-host degradation.
**Do not load when:** you only need the bare MCP-server config (see
`claude-code.md`, `codex.md`, `gemini.md`).

`orchestration-mode` is a toggle. When ON, every top-level user turn gets an
orchestrator-only directive injected ahead of the prompt, re-pinning "delegate,
do not execute directly" so it survives long sessions. The MCP tool flips the
toggle; a bundled `UserPromptSubmit` hook does the per-turn injection. Both ship
in the same plugin, so install the plugin (not just the bare server) to get the
full feature. Run `npm run build` first — the hook runs from `dist/`.

## Claude Code CLI (plugin)

The plugin manifest is `.claude-plugin/plugin.json` (just
`name`/`version`/`description`); Claude **auto-discovers** the bundled hook
(`hooks/hooks.json`) and the server (`.mcp.json`) at the plugin root, so the
manifest must **not** re-declare `hooks`/`mcpServers` (doing so fails the load
with a duplicate-hooks error). Install it as a local marketplace plugin so
Claude resolves `${CLAUDE_PLUGIN_ROOT}`:

```bash
claude plugin marketplace add /abs/path/to/subagent-mcp
claude plugin install subagent-mcp@subagent-mcp
```

On Windows, pass the absolute repo path (for example
`C:\Users\YourName\Dropbox\subagent-mcp`) to `marketplace add`. Restart the
session, then toggle with the `orchestration-mode` tool (`enabled: true` /
`enabled: false`; omit `enabled` to query).

## Codex CLI (hook + server)

Codex has no plugin manifest in this repo, so install the hook by hand: copy
`codex/hooks.json` to `~/.codex/hooks.json` and replace the placeholder path
with an **absolute** path to the built `dist/hooks/orchestration-codex.js`
(`${PLUGIN_ROOT}` only expands inside a real plugin and would otherwise no-op).
The server comes from the `config.toml` entry shown in `codex.md`. Full
step-by-step in [docs/install/codex-cli.md](../install/codex-cli.md).

## Desktop hosts toggle but do not inject

Claude Desktop and Codex Desktop have **no `UserPromptSubmit` hook host**, so
the `orchestration-mode` tool still flips the marker but **nothing is injected
per turn**. This is documented degradation, not a bug — use a CLI host for the
full per-turn behavior.
