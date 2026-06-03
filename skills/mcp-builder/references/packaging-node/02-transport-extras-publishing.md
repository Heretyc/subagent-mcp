# Node Packaging: HTTP Transport, Resources/Prompts, .mcpb, Testing, Versioning

Part of `packaging-node.md`. Source: github.com/modelcontextprotocol/typescript-sdk [S4], modelcontextprotocol.io/quickstart/server [S5]

---

## HTTP Transport (Remote Server)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  const server = new McpServer({ name: "my-server", version: "1.0.0" });
  // register tools...
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000);
```

## Adding Resources

```typescript
server.resource("app-config", "config://app", async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(config) }],
}));
```

## Adding Prompts

```typescript
server.prompt("code-review", "Review code for issues", { code: z.string() }, async ({ code }) => ({
  messages: [{ role: "user", content: { type: "text", text: `Review this code:\n${code}` } }],
}));
```

## Desktop Extensions (.mcpb)

Anthropic's Claude Desktop supports bundled extensions as `.mcpb` files (ZIP archive with `manifest.json`). Use the `mcpb` CLI tool to package. Useful for distributing servers with bundled dependencies to non-technical users. See [S6] for details.

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx -y my-mcp-server
# or for local dev:
npx @modelcontextprotocol/inspector node dist/index.js
```

Inspector opens browser UI to list tools, call them, inspect messages.

## Versioning

Use semver. MCP SDK version ≠ protocol version. SDK handles protocol versioning internally. Publish new SDK minor versions when new server features added.
