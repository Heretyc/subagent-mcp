# MCP Server Packaging: Python

**Load when:** Building, packaging, or publishing a Python MCP server. FastMCP, mcp library, uvx compatibility, pyproject.toml, entry points.
**Do not load when:** TypeScript-only server, config-only question.

Source: github.com/jlowin/fastmcp [S7], github.com/modelcontextprotocol/python-sdk [S8], modelcontextprotocol.io/quickstart/server [S5]

---

This page is an index. Detail lives in `packaging-python/`. Load the sub-page(s) for your task (load both for a full build-and-publish pass):

| Sub-page | Covers |
|----------|--------|
| [`packaging-python/01-server-code.md`](packaging-python/01-server-code.md) | Framework choice (FastMCP vs official `mcp` SDK); FastMCP minimal server (tool/resource/prompt decorators); official SDK minimal server (`list_tools`/`call_tool`, `stdio_server`); the no-`print()` stdout rule. |
| [`packaging-python/02-packaging-uvx-and-ops.md`](packaging-python/02-packaging-uvx-and-ops.md) | `pyproject.toml` with `project.scripts` entry point; uvx compatibility and `uv --directory`; running during development; FastMCP HTTP transport; secrets via `os.environ`; testing with MCP Inspector; FastMCP OAuth; packaging checklist. |

**Quick facts (no sub-page load needed):**

- FastMCP derives the tool description from the docstring and the inputSchema from type hints.
- Never use `print()` in a stdio server — it corrupts stdout. Use `sys.stderr.write()`.
- The `project.scripts` entry name must match what users invoke via `uvx`/`pip`; the entry function calls `mcp.run()`.
