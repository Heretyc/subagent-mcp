# Claude Config: CLI add, Env Expansion, Scope, Timeouts, OAuth

Part of `config-claude.md`. Source: code.claude.com/docs/en/mcp [S9]

---

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
