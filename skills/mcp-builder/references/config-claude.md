# Claude Desktop & Claude Code CLI Configuration

**Load when:** Configuring MCP servers for Claude Desktop or Claude Code CLI. Config file locations, mcpServers JSON format, env key, scope options, claude mcp add command, .mcp.json, ~/.claude.json.
**Do not load when:** Codex CLI config (see config-codex.md).

Source: code.claude.com/docs/en/mcp [S9], modelcontextprotocol.io/docs/tools/debugging [S10], github.com/anthropics/claude-code/issues/26073 [S11]

---

This page is an index. Detail lives in `config-claude/`. Load the sub-page for your task (or load all three for a full configuration pass):

| Sub-page | Covers |
|----------|--------|
| [`config-claude/01-locations-and-json-format.md`](config-claude/01-locations-and-json-format.md) | Config file locations (Claude Desktop standard + Windows MSIX path; Claude Code CLI scope files), log file locations, mcpServers JSON format, full field table (`command`, `args`, `env`, `type`, `url`, `headers`, `timeout`, `alwaysLoad`). |
| [`config-claude/02-transport-and-windows-paths.md`](config-claude/02-transport-and-windows-paths.md) | Transport type examples (stdio, HTTP, streamable-http alias); Windows command path fixes (absolute path, `cmd /c` wrapper, Python/uvx). |
| [`config-claude/03-cli-env-scope-and-oauth.md`](config-claude/03-cli-env-scope-and-oauth.md) | `claude mcp add` command + all flags and option ordering; env var expansion in .mcp.json; scope hierarchy/precedence; MCP timeout settings (`MCP_TIMEOUT`, `timeout`, `MAX_MCP_OUTPUT_TOKENS`); after-config-change restart; OAuth for remote servers. |

**Quick facts (no sub-page load needed):**

- Windows MSIX install reads config from `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`, NOT `%APPDATA%\Claude\`. The in-app "Edit Config" button opens the wrong file on MSIX. See `install-windows.md`.
- Use absolute paths in `command` on Windows to avoid `spawn ENOENT`.
- After any config change, fully quit and reopen Claude Desktop (closing the window is not enough); restart the Claude Code CLI session.
- Max tool output default 25,000 tokens; override with `MAX_MCP_OUTPUT_TOKENS`.
