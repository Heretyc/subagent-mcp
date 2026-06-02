# Node Packaging: Server Code & Package Setup

Part of `packaging-node.md`. Source: github.com/modelcontextprotocol/typescript-sdk [S4], modelcontextprotocol.io/quickstart/server [S5]

---

## SDK Install

```bash
npm install @modelcontextprotocol/sdk
# or
npm install fastmcp  # TypeScript framework, simpler API
```

## Minimal Server (Official SDK)

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

server.tool(
  "add_numbers",
  "Adds two numbers together",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Never use `console.log` in stdio server.** It pollutes stdout. Use `console.error` for debug output.

## Minimal Server (fastmcp TypeScript)

```typescript
import { FastMCP } from "fastmcp";
import { z } from "zod";

const server = new FastMCP({ name: "my-server", version: "1.0.0" });

server.addTool({
  name: "add_numbers",
  description: "Adds two numbers",
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => String(a + b),
});

server.start({ transportType: "stdio" });
```

## package.json Structure

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for X",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "my-mcp-server": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  },
  "files": ["dist/**", "README.md"],
  "engines": { "node": ">=18" }
}
```

**Critical fields:**
- `"type": "module"` enables ESM. If omitted, defaults to CJS.
- `bin` entry = what `npx my-mcp-server` runs.
- `files` = what gets published to npm (keep small).

## tsconfig.json (ESM)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## Shebang for Executable

First line of `src/index.ts` (or add via build step):
```typescript
#!/usr/bin/env node
```

Without shebang, `npx` still works. With shebang, file is directly executable on Unix.

## Making npx Installable

1. Publish to npm: `npm publish --access public`
2. Users run: `npx -y my-mcp-server`
3. In config: `"command": "npx", "args": ["-y", "my-mcp-server"]`

The `-y` flag auto-confirms npx install. Without it, npx may prompt the user.

## ESM vs CJS Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `require is not defined` | CJS file trying to import ESM package | Add `"type":"module"` or rename to `.cjs` |
| `Cannot find module` | ESM import missing `.js` extension | Add `.js` to all imports in source (TS compiles to JS) |
| `__dirname is not defined` | ESM doesn't have `__dirname` | Use `new URL('.', import.meta.url).pathname` |
| Dual package | Publishing both CJS and ESM | Use `exports` field with conditional exports |

**ESM import style in TypeScript (required for `"module": "Node16"`):**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";  // .js extension!
```
