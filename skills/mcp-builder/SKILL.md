---
name: mcp-builder
description: Build, package, install, configure, debug, and optimize Model Context Protocol (MCP) servers for Claude (Desktop, Code CLI) and Codex CLI on Windows and macOS. Use when building MCP tools, creating AI tool integrations, give Claude access to database or API or filesystem, connect AI agent to external tools or services, packaging stdio or HTTP servers, configuring mcpServers JSON or TOML, troubleshooting spawn ENOENT or connection errors, designing tool/resource/prompt schemas, implementing JSON-RPC handlers, publishing npm or Python MCP packages, setting up uvx or npx installable servers, debugging tool not appearing in Claude or Codex, writing secure MCP server code, server architecture review, MCP protocol compliance, FastMCP, @modelcontextprotocol/sdk, mcp Python library, MCP Inspector usage, Claude Desktop config, Claude Code CLI mcp add command, Codex config.toml, MCP server security, rate limiting MCP tools, MCP over SSE or HTTP transport, stdio transport pitfalls, environment variable injection for MCP, cross-platform MCP deployment, MCP server instructions field, tool search optimization, alwaysLoad, server descriptions for AI discovery, mcpb Desktop Extensions.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: May 2025
---

# MCP Builder

Build and ship MCP servers for Claude and Codex. Load `references/retrieval-map.md` first to find the right leaf doc for any task.

## Quick Decision Tree

Some "Load" targets below are thin indexes with a same-named sub-directory (`config-claude.md`, `implementation-patterns.md`, `install-windows.md`, `packaging-node.md`, `packaging-python.md`, `tool-resource-prompt-schemas.md`, `troubleshooting.md`). For these, follow the index's table of contents into `references/<topic>/` for full detail : don't stop at the index. See `references/retrieval-map.md` for specifics.

| Task | Load |
|------|------|
| Understand MCP protocol / primitives | `protocol-spec.md` |
| Tool / resource / prompt schemas | `tool-resource-prompt-schemas.md` |
| TypeScript/Node server + npm package | `packaging-node.md` |
| Python server + pip/uvx package | `packaging-python.md` |
| Claude Desktop or Claude Code config | `config-claude.md` |
| Codex CLI config | `config-codex.md` |
| Windows install / path / registry | `install-windows.md` |
| macOS install / Gatekeeper / LaunchAgent | `install-macos.md` |
| Implementation patterns / security | `implementation-patterns.md` |
| Debug / errors / ENOENT / tool missing | `troubleshooting.md` |
| Source citations | `source-ledger.md` |

## Core Rules (Always Active)

1. **stdio: never write to stdout** except JSON-RPC. All logs go to stderr.
2. **Absolute paths** in all config files. Never relative.
3. **Windows MSIX bug**: Claude Desktop MSIX reads from `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\` not `%APPDATA%\Claude\`. Edit the correct file.
4. **Protocol version**: Current spec is `2025-06-18`. Server must echo client's version on init.
5. **inputSchema** must be JSON Schema with `type: "object"`. Missing `required` array = all fields optional.
6. **Secrets**: use `env` key in config, never hardcode. Never log secrets.

## Minimal Server Skeleton (TypeScript)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

server.tool("my_tool", "What it does", { param: z.string() }, async ({ param }) => ({
  content: [{ type: "text", text: `Result: ${param}` }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Minimal Server Skeleton (Python / FastMCP)

```python
from fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """What it does."""
    return f"Result: {param}"

if __name__ == "__main__":
    mcp.run()
```

## Config Snippets

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` on Win / `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-package"],
      "env": { "API_KEY": "sk-..." }
    }
  }
}
```

**Claude Code CLI**:
```bash
claude mcp add --transport stdio my-server -- npx -y my-mcp-package
claude mcp add --transport http my-remote -- https://api.example.com/mcp
```

**Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers.my-server]
command = "npx"
args = ["-y", "my-mcp-package"]
```

## Workflow: New Server

1. Choose language (TS for npm ecosystem, Python for data/ML tools).
2. Initialize project (`npm init` / `uv init`).
3. Install SDK (`npm i @modelcontextprotocol/sdk` / `uv add fastmcp`).
4. Implement tools/resources/prompts. Validate with MCP Inspector.
5. Add `bin` entry (TS) or entry point (Python).
6. Test: `npx @modelcontextprotocol/inspector npx -y my-package`.
7. Configure in Claude / Codex config. Restart client.
8. Check logs if tools missing.

## Server Instructions Field (Tool Search Optimization)

Claude Code defers MCP tool loading by default (tool search). Server instructions help Claude find your tools:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-package"],
      "serverInstructions": "Use these tools for database operations: querying, schema inspection, and record management."
    }
  }
}
```

Truncated at 2KB. Put most important info first. In code: set via SDK's server description field during initialization.

## Debugging Checklist

- [ ] Server process actually starts? Run command directly in terminal.
- [ ] stdout clean? Run with `2>/dev/null` and check stdout is valid JSON only.
- [ ] Config file at correct path for platform (MSIX trap on Windows)?
- [ ] Absolute paths in config?
- [ ] `env` key set for required environment variables?
- [ ] Client fully restarted (close window not enough for Claude Desktop)?
- [ ] MCP Inspector shows tools correctly?
- [ ] Log files checked? (`%APPDATA%\Claude\logs\mcp*.log` / `~/Library/Logs/Claude/`)
