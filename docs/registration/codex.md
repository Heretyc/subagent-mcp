<!-- Part of registration (split). Retrieval map: ../registration.md -->

# Codex CLI — MCP server registration

**Load when:** registering the bare `subagent-mcp` server in Codex's
`config.toml`, or locating repo-level Codex config docs.
**Do not load when:** installing the Codex orchestration hook (see
`orchestration-plugin.md`) or wiring Claude/Gemini (see `claude-code.md`,
`gemini.md`).

Replace the path with the absolute path where you cloned the repo.

**macOS / Linux** — edit `~/.codex/config.toml` (create if it doesn't exist):

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/abs/path/to/subagent-mcp/dist/index.js"]
```

**Windows** — edit `C:\Users\YourName\.codex\config.toml`:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

Forward or double-backslash paths both work in TOML. Verify with `/mcp` inside a Codex session.

## Project-local Codex config

Repo-level `.codex/config.toml` (trust requirement, `enabled` toggle,
`disabled_tools` deny-list): see [docs/install/codex-cli.md](../install/codex-cli.md).
