# Python Packaging: pyproject.toml, uvx, Dev, HTTP, Secrets, Testing

Part of `packaging-python.md`. Source: github.com/jlowin/fastmcp [S7], github.com/modelcontextprotocol/python-sdk [S8], modelcontextprotocol.io/quickstart/server [S5]

---

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
