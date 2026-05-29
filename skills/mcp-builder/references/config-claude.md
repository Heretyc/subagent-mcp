# Claude Desktop & Claude Code CLI Configuration

**Load when:** Configuring MCP servers for Claude Desktop or Claude Code CLI. Config file locations, mcpServers JSON format, env key, scope options, claude mcp add command, .mcp.json, ~/.claude.json.
**Do not load when:** Codex CLI config (see config-codex.md).

Source: code.claude.com/docs/en/mcp [S9], modelcontextprotocol.io/docs/tools/debugging [S10], github.com/anthropics/claude-code/issues/26073 [S11]

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

## Claude Code CLI: claude mcp add

```bash
# Add stdio server (default scope: local)
claude mcp add my-server -- npx -y my-mcp-package

# Add with env vars
claude mcp add --env API_KEY=sk-... my-server -- npx -y my-mcp-package

# Add HTTP server
claude mcp add --transport http my-remote https://mcp.example.com/mcp

# Add with auth header
claude mcp add --transport http my-remote https://mcp.example.com/mcp \
  --header "Authorization: Bearer token"

# Project scope (creates .mcp.json, shareable with team)
claude mcp add --scope project my-server -- npx -y my-mcp-package

# User scope (available across all projects)
claude mcp add --scope user my-server -- npx -y my-mcp-package

# Import from Claude Desktop (macOS and WSL only)
claude mcp add-from-claude-desktop

# Add via JSON
claude mcp add-json my-server '{"type":"stdio","command":"npx","args":["-y","pkg"]}'

# List, inspect, remove
claude mcp list
claude mcp get my-server
claude mcp remove my-server

# Check status inside Claude Code session
/mcp
```

**Option ordering**: All flags BEFORE server name. `--` separates server name from command.
Correct: `claude mcp add --env KEY=val my-server -- python server.py`
Wrong: `claude mcp add my-server --env KEY=val -- python server.py`

## Environment Variable Expansion in .mcp.json

```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

`${VAR}` = required. `${VAR:-default}` = with fallback. Expansion in: `command`, `args`, `env`, `url`, `headers`.

## Scope Hierarchy (Claude Code)

Precedence (highest wins): Local > Project > User > Plugin > claude.ai connectors.
Matched by name. Entire entry from highest scope used (no field merging).

## MCP Timeout Settings

- Default startup timeout: 5 seconds (configurable with `MCP_TIMEOUT` env var, e.g. `MCP_TIMEOUT=10000 claude`).
- Per-server tool timeout: `"timeout": 600000` in server entry (milliseconds).
- Max tool output: 25,000 tokens default. Override with `MAX_MCP_OUTPUT_TOKENS=50000`.

## After Config Changes

**Claude Desktop**: Must fully quit and reopen. Closing the window is NOT enough.
**Claude Code CLI**: Restart the CLI session. `claude mcp list` to verify.

## OAuth for Remote Servers

Claude Code supports OAuth 2.0 for HTTP servers. Run `/mcp` inside Claude Code to trigger browser auth flow. Tokens stored in system keychain.

```bash
claude mcp add --transport http \
  --client-id your-client-id --client-secret --callback-port 8080 \
  my-server https://mcp.example.com/mcp
```
