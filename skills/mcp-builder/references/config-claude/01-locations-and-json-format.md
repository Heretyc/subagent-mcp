# Claude Config: Locations & JSON Format

Part of `config-claude.md`. Source: code.claude.com/docs/en/mcp [S9], modelcontextprotocol.io/docs/tools/debugging [S10], github.com/anthropics/claude-code/issues/26073 [S11]

---

## Config File Locations

### Claude Desktop

| Platform | Standard Path | MSIX/Store Path (Windows only) |
|----------|--------------|-------------------------------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` | N/A |

**Windows MSIX critical bug**: If Claude Desktop was installed via Microsoft Store, WinGet, or MSIX installer, the app reads from the MSIX virtualized path, NOT `%APPDATA%\Claude\`. The "Edit Config" button in the app opens the wrong file. Always edit the MSIX path directly when using Store/WinGet install. See `install-windows.md` for detection steps.

Log files:
- Windows: `%APPDATA%\Claude\logs\mcp*.log`
- macOS: `~/Library/Logs/Claude/mcp*.log`

### Claude Code CLI

Config is split by scope:

| Scope | File | Shared |
|-------|------|--------|
| Local (default) | `~/.claude.json` (under project path) | No |
| Project | `.mcp.json` in project root | Yes (check into git) |
| User | `~/.claude.json` (global section) | No |

On Windows: `~` = `C:\Users\YourName\`.

## Config JSON Format (Claude Desktop + project .mcp.json)

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-package"],
      "env": {
        "API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

**Fields:**

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `command` | Yes | string | Executable. Use absolute path on Windows to avoid ENOENT. |
| `args` | No | string[] | Arguments to command. |
| `env` | No | object | Key-value env vars injected into server process. |
| `type` | No | string | `"stdio"` (default), `"http"`, or `"sse"` (deprecated). |
| `url` | Yes (HTTP) | string | HTTP server URL. |
| `headers` | No | object | Static HTTP headers. |
| `timeout` | No | number | Per-tool timeout in milliseconds. |
| `alwaysLoad` | No | boolean | Load tools into context at startup (bypasses tool search deferral). |
