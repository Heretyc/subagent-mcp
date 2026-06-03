# Claude Config: Transport Types & Windows Path Fixes

Part of `config-claude.md`. Source: code.claude.com/docs/en/mcp [S9], github.com/anthropics/claude-code/issues/26073 [S11]

---

## Transport Type Examples

**stdio (local process):**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\Lexi\\projects"],
      "env": {}
    }
  }
}
```

**HTTP (remote):**
```json
{
  "mcpServers": {
    "my-remote": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer sk-..." }
    }
  }
}
```

**`streamable-http`** is an alias for `"type": "http"` in Claude Code CLI (matches MCP spec name).

## Windows Command Path Fixes

Claude Desktop may not inherit full PATH. Use absolute paths:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": ["-y", "my-mcp-package"]
    }
  }
}
```

Or use `cmd /c` wrapper:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "my-mcp-package"]
    }
  }
}
```

For Python/uvx on Windows:
```json
{
  "command": "C:\\Users\\YourName\\.local\\bin\\uvx.exe",
  "args": ["my-mcp-package"]
}
```
