# Codex CLI MCP Configuration

**Load when:** Configuring MCP servers for OpenAI Codex CLI. config.toml format, codex mcp add, startup/tool timeouts, bearer token auth.
**Do not load when:** Claude Desktop or Claude Code (see config-claude.md).

Source: developers.openai.com/codex/mcp [S12], developers.openai.com/codex/config-reference [S13]

---

## Config File Location

| Scope | Path |
|-------|------|
| User (global) | `~/.codex/config.toml` |
| Project (scoped) | `.codex/config.toml` in project root (trusted projects only) |

On Windows: `~` = `C:\Users\YourName\`. So: `C:\Users\YourName\.codex\config.toml`.
On macOS: `~/.codex/config.toml`.

Format: **TOML** (not JSON like Claude). Section headers use `[mcp_servers.<name>]`.

## stdio Server Config (TOML)

```toml
[mcp_servers.my-server]
command = "npx"
args = ["-y", "my-mcp-package"]
env_vars = ["API_KEY"]          # environment variables to FORWARD from host

[mcp_servers.my-server.env]
MY_ENV_VAR = "static-value"     # static environment variables
```

**Fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `command` | Yes | Startup command |
| `args` | No | Array of arguments |
| `env_vars` | No | List of env var names to forward from host environment |
| `env` | No | Table of static env var key=value pairs |
| `cwd` | No | Working directory for server process |
| `startup_timeout_sec` | No | Default: 10 seconds |
| `tool_timeout_sec` | No | Default: 60 seconds |
| `enabled` | No | Toggle server on/off (`true` by default) |
| `required` | No | If `true`, Codex fails to start if this server can't init |
| `enabled_tools` | No | List of tool names to expose (whitelist) |
| `disabled_tools` | No | List of tool names to hide (blacklist) |
| `default_tools_approval_mode` | No | `"auto"`, `"prompt"`, or `"approve"` |

## HTTP Server Config (TOML)

```toml
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"     # env var holding bearer token
http_headers = { "X-Region" = "us-east-1" }    # static headers
env_http_headers = { "X-Token" = "MY_TOKEN" }  # headers pulled from env vars
```

## CLI Commands

```bash
# Add server via CLI
codex mcp add my-server -- npx -y my-mcp-package

# View active servers in TUI
/mcp    # (inside Codex session)
```

Direct TOML editing is also valid and often clearer.

## Tool Approval Modes

| Mode | Behavior |
|------|---------|
| `auto` | Tools execute without prompting |
| `prompt` | User prompted before each tool call |
| `approve` | User must explicitly approve tool category |

## Filtering Tools

```toml
[mcp_servers.my-server]
command = "npx"
args = ["-y", "my-mcp-package"]
enabled_tools = ["get_weather", "search_code"]  # only expose these tools
# OR
disabled_tools = ["delete_file"]                # hide specific dangerous tools
```

## Environment Variable Forwarding

`env_vars` = list of var names to pass through from Codex's environment. User must have these set in their shell.

```toml
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env_vars = ["GITHUB_PERSONAL_ACCESS_TOKEN"]
```

## Timeouts

```toml
[mcp_servers.slow-server]
command = "python"
args = ["slow_server.py"]
startup_timeout_sec = 30   # give it more time to start
tool_timeout_sec = 300     # 5 minutes for tool calls
```

## Windows Path Notes

On Windows, use forward slashes or double backslashes in TOML:

```toml
[mcp_servers.local]
command = "C:/Program Files/nodejs/npx.cmd"
args = ["-y", "my-mcp-package"]
# OR
command = "C:\\Program Files\\nodejs\\npx.cmd"
```

Or use `cmd` wrapper:
```toml
[mcp_servers.local]
command = "cmd"
args = ["/c", "npx", "-y", "my-mcp-package"]
```

## Comparison: Codex vs Claude Config

| Feature | Codex (TOML) | Claude (JSON) |
|---------|-------------|--------------|
| Format | TOML | JSON |
| Stdio server | `command`, `args`, `env`, `env_vars` | `command`, `args`, `env` |
| HTTP server | `url`, `bearer_token_env_var`, `http_headers` | `type: "http"`, `url`, `headers` |
| Tool timeout | `tool_timeout_sec` | `"timeout"` (ms) |
| Startup timeout | `startup_timeout_sec` | `MCP_TIMEOUT` env var |
| Tool filtering | `enabled_tools`, `disabled_tools` | Not directly supported |
| Env forwarding | `env_vars` (forward from host) | `env` (inject static values) |
| Approval mode | `default_tools_approval_mode` | Managed by Claude UI |
