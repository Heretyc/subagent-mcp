# Python Packaging: Server Code (FastMCP & Official SDK)

Part of `packaging-python.md`. Source: github.com/jlowin/fastmcp [S7], github.com/modelcontextprotocol/python-sdk [S8], modelcontextprotocol.io/quickstart/server [S5]

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
