# MCP Server Packaging: TypeScript / Node.js

**Load when:** Building, packaging, or publishing a TypeScript or JavaScript MCP server. npm package structure, npx installability, ESM/CJS issues, bin entries.
**Do not load when:** Python-only server, config-only question.

Source: github.com/modelcontextprotocol/typescript-sdk [S4], modelcontextprotocol.io/quickstart/server [S5]

---

This page is an index. Detail lives in `packaging-node/`. Load the sub-page(s) for your task (load both for a full build-and-publish pass):

| Sub-page | Covers |
|----------|--------|
| [`packaging-node/01-server-and-package-setup.md`](packaging-node/01-server-and-package-setup.md) | SDK install; minimal server (official SDK + fastmcp TS); `package.json` structure and critical fields; `tsconfig.json` (ESM); shebang; making npx-installable; ESM vs CJS issue table and import style. |
| [`packaging-node/02-transport-extras-publishing.md`](packaging-node/02-transport-extras-publishing.md) | HTTP/streamable transport (express); adding resources and prompts; Desktop Extensions (`.mcpb`); testing with MCP Inspector; versioning (semver, SDK vs protocol version). |

**Quick facts (no sub-page load needed):**

- Never use `console.log` in a stdio server : it pollutes stdout. Use `console.error`.
- `"type": "module"` in package.json enables ESM; the `bin` entry is what `npx my-mcp-server` runs.
- Under `"module": "Node16"`, ESM imports need the `.js` extension (e.g. `.../server/mcp.js`).
