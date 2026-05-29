# MCP Server Packaging: Python

**Load when:** Building, packaging, or publishing a Python MCP server. FastMCP, mcp library, uvx compatibility, pyproject.toml, entry points.
**Do not load when:** TypeScript-only server, config-only question.

Source: github.com/jlowin/fastmcp [S7], github.com/modelcontextprotocol/python-sdk [S8], modelcontextprotocol.io/quickstart/server [S5]

---

## Framework Choice

| Option | When to use |
|--------|------------|
| **FastMCP** (`fastmcp`) | New servers, simpler API, decorator-based, more features |
| **mcp** (official SDK) | Full protocol control, when FastMCP abstracts too much |

FastMCP is maintained by community (jlowin/fastmcp), widely adopted. Official SDK at `modelcontextprotocol/python-sdk`.

## FastMCP Minimal Server

```python
# server.py
from fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def add_numbers(a: float, b: float) -> float:
    """Adds two numbers. Use when user needs arithmetic."""
    return a + b

@mcp.resource("config://app")
def get_config() -> str:
    """Returns app configuration."""
    return '{"version": "1.0"}'

@mcp.prompt()
def code_review(code: str) -> str:
    """Generate a code review prompt."""
    return f"Review this code for issues:\n{code}"

if __name__ == "__main__":
    mcp.run()
```

Docstring = tool description. Type hints = inputSchema. FastMCP auto-generates schema from signature.

## Official SDK Minimal Server

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

server = Server("my-server")

@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [types.Tool(
        name="add_numbers",
        description="Adds two numbers",
        inputSchema={
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"}
            },
            "required": ["a", "b"]
        }
    )]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "add_numbers":
        result = arguments["a"] + arguments["b"]
        return [types.TextContent(type="text", text=str(result))]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

import asyncio
asyncio.run(main())
```

**Never use `print()` in stdio server.** It corrupts stdout. Use `sys.stderr.write()` for debug.

## pyproject.toml for uvx / pip Install

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-mcp-server"
version = "1.0.0"
description = "MCP server for X"
requires-python = ">=3.10"
dependencies = [
    "fastmcp>=2.0.0",
]

[project.scripts]
my-mcp-server = "my_mcp_server.server:main"

[tool.hatch.build.targets.wheel]
packages = ["src/my_mcp_server"]
```

**`project.scripts` entry** is the `uvx` / `pip install` entry point. Name must match what users call.

```python
# src/my_mcp_server/server.py
def main():
    mcp.run()
```

## uvx Compatibility

`uvx` runs Python tools in isolated environments without pre-installing. Works when:
- Package published to PyPI.
- `project.scripts` entry defined.
- Entry point function calls `mcp.run()` / starts the server.

```bash
# Install and run with uvx:
uvx my-mcp-server

# In config:
"command": "uvx", "args": ["my-mcp-server"]

# With extra packages:
"command": "uvx", "args": ["--with", "extra-dep", "my-mcp-server"]
```

`uv` with `--directory` pins to a local pyproject.toml:
```json
"command": "uv", "args": ["--directory", "/abs/path/to/project", "run", "my-mcp-server"]
```

## Running During Development

```bash
# With uv (recommended):
uv run python server.py

# With pip:
python -m my_mcp_server.server

# With FastMCP dev server (HTTP + browser UI):
fastmcp dev server.py
```

## FastMCP HTTP Transport

```python
mcp = FastMCP("my-server")

# Run as HTTP server:
if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8080)
```

## Secrets / Environment Variables

```python
import os
from fastmcp import FastMCP

mcp = FastMCP("my-server")
API_KEY = os.environ.get("MY_API_KEY")  # injected via config env key

@mcp.tool()
def call_api(query: str) -> str:
    """Calls external API."""
    if not API_KEY:
        raise ValueError("MY_API_KEY not set")
    # use API_KEY
```

In config: `"env": { "MY_API_KEY": "sk-..." }`

## Testing

```bash
# Test with MCP Inspector:
npx @modelcontextprotocol/inspector uvx my-mcp-server

# Or for local dev:
npx @modelcontextprotocol/inspector uv run python server.py
```

## FastMCP OAuth / Auth (Remote)

FastMCP has built-in OAuth 2.1 proxy for remote servers. See [S7] for full auth docs. For local stdio servers, auth is not needed (process isolation is the security boundary).

## Packaging Checklist

- [ ] `pyproject.toml` with `project.scripts` entry
- [ ] Entry point function defined (calls `mcp.run()`)
- [ ] No `print()` statements (use `sys.stderr`)
- [ ] All secrets via `os.environ`, not hardcoded
- [ ] `requires-python = ">=3.10"`
- [ ] Published to PyPI (`python -m build && twine upload dist/*`)
- [ ] Test: `uvx my-mcp-server --help` (or just run and check MCP Inspector)
