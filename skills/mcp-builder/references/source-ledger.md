# Source Ledger

Citations for claims in this skill. Files in `references/` are navigation targets, not provenance. Sources here are original.

---

## Source Index

**[S1]** Model Context Protocol. (2025). *Architecture overview.* modelcontextprotocol.io. https://modelcontextprotocol.io/docs/concepts/architecture
- Supports: host/client/server architecture, stdio vs HTTP transports, two-layer model, primitives overview.

**[S2]** Model Context Protocol. (2025, November 25). *MCP Specification 2025-11-25.* modelcontextprotocol.io. https://modelcontextprotocol.io/specification/2025-11-25
- Supports: protocol version numbers, OAuth 2.1 + PKCE S256 requirement, async tasks spec, capability negotiation rules.

**[S3]** Model Context Protocol. (2025). *Tools concept documentation.* modelcontextprotocol.io. https://modelcontextprotocol.io/docs/concepts/tools
- Supports: tool definition schema fields (name, title, description, inputSchema, outputSchema, annotations), content types (text, image, audio, resource_link, embedded resource), isError field, error codes, security requirements for tool authors.

**[S4]** Model Context Protocol. (2025). *TypeScript SDK.* GitHub. https://github.com/modelcontextprotocol/typescript-sdk
- Supports: McpServer class API, StdioServerTransport, StreamableHTTPServerTransport, server.tool() / server.resource() / server.prompt() registration patterns.

**[S5]** Model Context Protocol. (2025). *Build an MCP server (quickstart).* modelcontextprotocol.io. https://modelcontextprotocol.io/quickstart/server
- Supports: minimal server code (TypeScript and Python), pyproject.toml structure, connecting to Claude Desktop.

**[S6]** Anthropic. (2025). *One-click MCP server installation for Claude Desktop (Desktop Extensions).* anthropic.com. https://www.anthropic.com/engineering/desktop-extensions
- Supports: .mcpb file format, manifest.json structure, mcpb pack command.

**[S7]** Lowin, J. (2025). *FastMCP: The fast, Pythonic way to build MCP servers.* GitHub. https://github.com/jlowin/fastmcp
- Supports: FastMCP decorator API (@mcp.tool, @mcp.resource, @mcp.prompt), FastMCP OAuth proxy, mcp.run() patterns, HTTP transport in FastMCP, middleware/rate limiting.

**[S8]** Model Context Protocol. (2025). *Python SDK.* GitHub. https://github.com/modelcontextprotocol/python-sdk
- Supports: Official Python SDK Server class, stdio_server context manager, list_tools / call_tool decorators.

**[S9]** Anthropic. (2025). *Connect Claude Code to tools via MCP.* code.claude.com. https://code.claude.com/docs/en/mcp
- Supports: claude mcp add command syntax and all flags, scope system (local/project/user), .mcp.json format, ~/.claude.json format, MCP_TIMEOUT / MAX_MCP_OUTPUT_TOKENS env vars, tool search / ENABLE_TOOL_SEARCH, alwaysLoad field, timeout field, headersHelper, environment variable expansion syntax, OAuth for remote servers.

**[S10]** Model Context Protocol. (2025). *Debugging MCP integrations.* modelcontextprotocol.io. https://modelcontextprotocol.io/docs/tools/debugging
- Supports: stdio stdout rule (never log to stdout), log file locations (macOS ~/Library/Logs/Claude, Windows %APPDATA%\Claude\logs), MCP Inspector usage, developer_settings.json for DevTools, working directory note (use absolute paths), environment variable inheritance limitations.

**[S11]** Anthropic. (2026). *Bug: Windows MSIX "Edit Config" opens wrong claude_desktop_config.json.* GitHub Issues. https://github.com/anthropics/claude-code/issues/26073
- Supports: MSIX virtualized path (`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`), silent MCP server failure due to wrong config file on MSIX install.

**[S12]** OpenAI. (2025). *Model Context Protocol - Codex.* developers.openai.com. https://developers.openai.com/codex/mcp
- Supports: Codex CLI config.toml format, all TOML fields (command, args, env, env_vars, cwd, url, bearer_token_env_var, http_headers, env_http_headers, startup_timeout_sec, tool_timeout_sec, enabled, required, enabled_tools, disabled_tools, default_tools_approval_mode), codex mcp add command.

**[S13]** OpenAI. (2025). *Configuration Reference - Codex.* developers.openai.com. https://developers.openai.com/codex/config-reference
- Supports: ~/.codex/config.toml location, project-scoped .codex/config.toml for trusted projects.

**[S14]** Exchangepedia. (2026, April). *Where Does Claude Desktop Store Its Config on Windows? PowerShell Module.* exchangepedia.com. https://exchangepedia.com/2026/04/claudetools-claude-desktop-powershell-module.html
- Supports: Windows APPDATA vs MSIX path distinction, PowerShell detection commands.

**[S15]** Setiawan, F. (2025, April 22). *Fixing "spawn npx ENOENT" in Windows 11 When Adding MCP Server with Node/NPX.* fransiscuss.com. https://fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/
- Supports: cmd /c workaround for spawn ENOENT on Windows, absolute path fix for npx.

**[S16]** Cerbos. (2025). *How to Secure Your FastMCP Server With Permission Management.* cerbos.dev. https://www.cerbos.dev/blog/how-to-secure-your-fast-mcp-server-with-permission-management
- Supports: Tool-level access control, rate limiting with token bucket algorithm, Redis for distributed rate limiting, naive implementation exposing all tools to all users as security risk.

**[S17]** Garg, H. (2025). *Fix MCP Errors Fast: Error -32000, Connection Closed, Timeout Solutions.* mcp.harishgarg.com. https://mcp.harishgarg.com/learn/mcp-server-troubleshooting-guide-2025
- Supports: Error -32000 caused by stdout pollution, common error taxonomy, connection closed symptoms.

---

## Claim Provenance Notes

- MSIX virtualized path claim (install-windows.md): From [S11] (GitHub issue with direct path). Verified via [S14].
- "2025-06-18" as current protocol version: From [S1] (docs use this in initialize examples). [S2] documents 2025-11-25 spec update.
- `console.log` corrupts stdio: From [S10] (official debugging docs, explicit warning).
- FastMCP auto-generates schema from type hints: From [S7] (FastMCP README behavior description).
- Codex `env_vars` field name: From [S12] (official Codex MCP docs - field name differs from Claude's `env`).
- Claude Code tool search 2KB truncation limit: From [S9] (Claude Code MCP docs).
- `MAX_MCP_OUTPUT_TOKENS` default 25,000: From [S9].
- Windows long path 260 char limit: Microsoft Windows documentation (general knowledge, not web-sourced in this research).

## Uncertain / Inferred Claims

The following are based on general knowledge or inference; original sources not directly verified during research:
- LaunchAgent plist structure (install-macos.md): Standard macOS pattern, not MCP-specific source.
- Redis rate limiting pattern (implementation-patterns.md): General distributed systems pattern, cited [S16] for context.
- `execFile` vs `exec` for command injection prevention: General Node.js security best practice, not MCP-specific.

If source for any specific claim is needed, surface to user and ask.
