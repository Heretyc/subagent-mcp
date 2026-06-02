# Retrieval Map

First file to load. Maps every trigger type to the smallest useful file set.

## Index Files Have Sub-Pages

Seven referenced files are now thin **indexes** plus a same-named sub-directory of detail pages: `config-claude.md`, `implementation-patterns.md`, `install-windows.md`, `packaging-node.md`, `packaging-python.md`, `tool-resource-prompt-schemas.md`, `troubleshooting.md`. When a "Load" target below is one of these, do not stop at the index: follow its table of contents and load the relevant sub-page(s) under `references/<topic>/` for the actual detail.

## Direct Topic Index

| Term | Load |
|------|------|
| Model Context Protocol, MCP | `protocol-spec.md` |
| JSON-RPC 2.0, message format | `protocol-spec.md` |
| tools/list, tools/call | `tool-resource-prompt-schemas.md` |
| resources/list, resources/read | `tool-resource-prompt-schemas.md` |
| prompts/list, prompts/get | `tool-resource-prompt-schemas.md` |
| inputSchema, outputSchema | `tool-resource-prompt-schemas.md` |
| stdio transport | `protocol-spec.md` + `troubleshooting.md` |
| SSE transport, streamable HTTP | `protocol-spec.md` + `implementation-patterns.md` |
| FastMCP | `packaging-python.md` + `implementation-patterns.md` |
| @modelcontextprotocol/sdk | `packaging-node.md` + `implementation-patterns.md` |
| mcp Python library | `packaging-python.md` |
| MCP Inspector | `troubleshooting.md` |
| capability negotiation, initialize | `protocol-spec.md` |

## Alias / Synonym Index

| Alias | Canonical | Load |
|-------|-----------|------|
| tool server, AI tool integration | MCP server | `protocol-spec.md` |
| context server, plugin server | MCP server | `protocol-spec.md` |
| mcpServers, mcp_servers | config key | `config-claude.md` or `config-codex.md` |
| claude_desktop_config.json | Claude Desktop config | `config-claude.md` |
| .mcp.json | Claude Code project config | `config-claude.md` |
| ~/.claude.json | Claude Code user config | `config-claude.md` |
| config.toml | Codex CLI config | `config-codex.md` |
| npx server, uvx server | distribution method | `packaging-node.md` or `packaging-python.md` |
| MCP extension, .mcpb | Desktop Extensions format | `packaging-node.md` |

## Trigger Phrase Index

| Trigger Phrase | Load |
|---------------|------|
| "build MCP server", "create MCP server" | `SKILL.md` + relevant packaging doc |
| "MCP tool not showing up", "tool not appearing" | `troubleshooting.md` |
| "spawn ENOENT", "command not found" | `troubleshooting.md` + platform install doc |
| "stdout pollution", "JSON parse error" | `troubleshooting.md` |
| "configure Claude Desktop MCP" | `config-claude.md` + platform install doc |
| "add MCP to Codex", "codex mcp add" | `config-codex.md` |
| "claude mcp add", "mcp add command" | `config-claude.md` |
| "MCP server on Windows" | `install-windows.md` + `config-claude.md` |
| "MCP server on macOS", "MCP server on Mac" | `install-macos.md` + `config-claude.md` |
| "publish npm MCP", "npm package MCP" | `packaging-node.md` |
| "Python MCP server", "pip install MCP" | `packaging-python.md` |
| "uvx MCP", "uv run MCP" | `packaging-python.md` |
| "MCP security", "secure MCP tool" | `implementation-patterns.md` |
| "MCP rate limit", "tool injection prevention" | `implementation-patterns.md` |
| "MCP Inspector", "debug MCP" | `troubleshooting.md` |
| "MCP log", "Claude Desktop log" | `troubleshooting.md` |
| "MSIX Claude Desktop" | `install-windows.md` |
| "MCP timeout", "tool timeout" | `troubleshooting.md` + `config-claude.md` |
| "MCP resource", "MCP prompt template" | `tool-resource-prompt-schemas.md` |
| "FastMCP tutorial", "FastMCP example" | `packaging-python.md` + `implementation-patterns.md` |

## Task-to-Document Map

| Task | Primary | Secondary |
|------|---------|-----------|
| Understand MCP architecture | `protocol-spec.md` | - |
| Design tool schema | `tool-resource-prompt-schemas.md` | `implementation-patterns.md` |
| Build TypeScript server | `packaging-node.md` | `implementation-patterns.md` |
| Build Python server | `packaging-python.md` | `implementation-patterns.md` |
| Publish npm package | `packaging-node.md` | - |
| Publish PyPI / uvx package | `packaging-python.md` | - |
| Configure Claude Desktop | `config-claude.md` | platform install doc |
| Configure Claude Code CLI | `config-claude.md` | - |
| Configure Codex CLI | `config-codex.md` | - |
| Install on Windows | `install-windows.md` | `config-claude.md` |
| Install on macOS | `install-macos.md` | `config-claude.md` |
| Secure a server | `implementation-patterns.md` | - |
| Debug connection failure | `troubleshooting.md` | platform install doc |
| Debug tool not visible | `troubleshooting.md` | `tool-resource-prompt-schemas.md` |
| Test with MCP Inspector | `troubleshooting.md` | - |
| Implement streaming / progress | `implementation-patterns.md` | `protocol-spec.md` |

## Symptom / Error to Document Map

| Symptom / Error | Load |
|----------------|------|
| `spawn ENOENT` | `troubleshooting.md` -> `troubleshooting/01-startup-and-connection.md` (connection_failures) |
| `spawn npx ENOENT` on Windows | `install-windows.md` + `troubleshooting.md` |
| `spawn uv ENOENT` | `install-macos.md` or `install-windows.md` + `troubleshooting.md` |
| Tool list empty / zero tools | `troubleshooting.md` -> `troubleshooting/01-startup-and-connection.md` (tool_visibility) |
| `Error -32000` | `troubleshooting.md` |
| `Error -32602 Invalid params` | `tool-resource-prompt-schemas.md` + `troubleshooting.md` |
| JSON parse error / garbled output | `troubleshooting.md` -> `troubleshooting/01-startup-and-connection.md` (stdout_pollution) |
| Server disconnected / connection closed | `troubleshooting.md` |
| MCP config not found | `install-windows.md` or `install-macos.md` |
| MSIX path wrong | `install-windows.md` |
| Claude Desktop shows server error | `troubleshooting.md` + `config-claude.md` |
| Codex server not connecting | `config-codex.md` + `troubleshooting.md` |
| Tools not appearing after config change | `troubleshooting.md` -> `troubleshooting/03-inspector-logs-restart-error-codes.md` (restart_requirements) |
| Memory leak in server | `implementation-patterns.md` |
| Tool output too large | `config-claude.md` (MAX_MCP_OUTPUT_TOKENS) |

## Entity / Product / Vendor / Project Map

| Entity | Load |
|--------|------|
| Anthropic / Claude | `config-claude.md` |
| Claude Desktop | `config-claude.md` + platform install doc |
| Claude Code CLI | `config-claude.md` |
| OpenAI / Codex CLI | `config-codex.md` |
| FastMCP (Python, jlowin/fastmcp) | `packaging-python.md` + `implementation-patterns.md` |
| fastmcp (TypeScript, punkpeye) | `packaging-node.md` + `implementation-patterns.md` |
| @modelcontextprotocol/sdk | `packaging-node.md` |
| mcp Python SDK | `packaging-python.md` |
| MCP Inspector | `troubleshooting.md` |
| uv / uvx | `packaging-python.md` + `install-macos.md` or `install-windows.md` |
| npx | `packaging-node.md` |

## Failure Mode Map

| Failure | Load |
|---------|------|
| Server not starting | `troubleshooting.md` |
| stdout pollution | `troubleshooting.md` + `implementation-patterns.md` |
| Path not found on Windows | `install-windows.md` + `troubleshooting.md` |
| MSIX virtualization trap | `install-windows.md` |
| Schema validation failure | `tool-resource-prompt-schemas.md` |
| Timeout on tool call | `troubleshooting.md` + `config-claude.md` |
| Secrets exposed in logs | `implementation-patterns.md` |
| Node ESM/CJS conflict | `packaging-node.md` + `troubleshooting.md` |
| Python venv path broken | `packaging-python.md` + `troubleshooting.md` |

## "Load This When..." Rules

- Load `protocol-spec.md` when: questions about MCP fundamentals, capability negotiation, message format, transport comparison, lifecycle.
- Load `tool-resource-prompt-schemas.md` when: designing schemas, inputSchema format questions, tool response content types, resource URI patterns, prompt template design.
- Load `packaging-node.md` when: building or publishing TypeScript/JavaScript MCP servers, npm package structure, npx installability, bin entries, ESM vs CJS.
- Load `packaging-python.md` when: building or publishing Python MCP servers, FastMCP, uvx compatibility, pyproject.toml, entry points, pip install.
- Load `config-claude.md` when: configuring MCP in Claude Desktop or Claude Code CLI, .mcp.json, ~/.claude.json, mcpServers JSON format, env key, scope options, claude mcp add command.
- Load `config-codex.md` when: configuring MCP in Codex CLI, ~/.codex/config.toml, TOML format, codex mcp add.
- Load `install-windows.md` when: any Windows-specific install question, APPDATA paths, MSIX, PowerShell, PATH on Windows, winget/choco, cmd /c workaround.
- Load `install-macos.md` when: macOS-specific install, brew, nvm, LaunchAgent, Gatekeeper, PATH in shell profile.
- Load `implementation-patterns.md` when: writing handler code, async patterns, security, rate limiting, caching, streaming/progress, secrets, testing, performance.
- Load `troubleshooting.md` when: any error, debugging, ENOENT, tool not showing, MCP Inspector, log files, connection failure, timeout.
- Load `source-ledger.md` when: user asks for citations or provenance of claims.

## When to Stop and Ask

Stop and ask for more context when:
- User wants to connect to a non-standard MCP host not covered (Cursor, VS Code, Zed, etc.).
- User's config file is in a custom / enterprise-managed location.
- User wants SSE + authentication on a custom server infrastructure.
- Error message or log output not matching any known failure mode.
