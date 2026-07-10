<!-- Part of registration (split). Retrieval map: ../registration.md -->

# Claude Code CLI — MCP server registration

**Load when:** registering the bare `subagent-mcp` server with Claude Code (CLI
or Desktop), choosing user vs project scope, or locating the Claude Desktop
config file.
**Do not load when:** installing the orchestration hook/plugin (see
`orchestration-plugin.md`) or wiring Codex/Gemini (see `codex.md`, `gemini.md`).

Replace the path in each example with the absolute path where you cloned the repo.

**macOS / Linux** — run once from any directory:

```bash
claude mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

**Windows:**

```bash
claude mcp add subagent-mcp -- node "C:\Users\YourName\Dropbox\subagent-mcp\dist\index.js"
```

To make it available across all projects (user scope), add `--scope user`. Or add it to a project's `.mcp.json` for team sharing:

**macOS / Linux `.mcp.json`:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["/abs/path/to/subagent-mcp/dist/index.js"]
    }
  }
}
```

**Windows `.mcp.json`:** same shape with a double-backslash path, e.g.
`"args": ["C:\\Users\\YourName\\Dropbox\\subagent-mcp\\dist\\index.js"]`.

The Claude Desktop config lives at:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Verify with `claude mcp list` or `/mcp` inside a Claude Code session.
