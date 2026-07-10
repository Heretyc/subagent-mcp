<!-- Part of registration (split). Retrieval map: ../registration.md -->

# Gemini CLI — MCP server registration

**Load when:** registering the bare `subagent-mcp` server in Gemini's
`settings.json`.
**Do not load when:** wiring Claude/Codex (see `claude-code.md`, `codex.md`).
Gemini fires no `UserPromptSubmit` hook, so there is no orchestration-hook
install step for it — orchestration falls back to fail-safe ON.

Replace the path with the absolute path where you cloned the repo.

**macOS / Linux** — edit `~/.gemini/settings.json` (merge into existing file):

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

**Windows** — edit `C:\Users\YourName\.gemini\settings.json`:

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Dropbox\\subagent-mcp\\dist\\index.js"]
    }
  }
}
```

Restart the Gemini CLI session after editing.
