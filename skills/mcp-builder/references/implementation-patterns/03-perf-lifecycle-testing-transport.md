# Implementation: Caching, Performance, Lifecycle, Testing, Transport

Part of `implementation-patterns.md`. Source: github.com/modelcontextprotocol/typescript-sdk [S4], github.com/jlowin/fastmcp [S7]

---

## Caching

```typescript
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value as T;
  }
  const value = await fn();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

// Use in tool:
const data = await withCache(`weather:${location}`, 5 * 60 * 1000, () => fetchWeather(location));
```

## Performance: Avoid Blocking

**TypeScript**: Never block event loop. Use worker threads for CPU-intensive work:
```typescript
import { Worker } from 'worker_threads';
// Offload heavy computation to worker thread
```

**Python**: For CPU-bound work in async server, use `asyncio.to_thread()`:
```python
result = await asyncio.to_thread(cpu_intensive_function, args)
```

## Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
```

## Logging Strategy

```typescript
// Structured logging to stderr (stdio transport)
function log(level: 'debug'|'info'|'error', message: string, data?: unknown) {
  console.error(JSON.stringify({ level, message, data, ts: new Date().toISOString() }));
}

// Or send log notification to client:
await server.sendLoggingMessage({ level: "info", data: "Tool executed successfully" });
```

Log: initialization steps, tool invocations (without secrets), errors with stack traces, performance metrics for slow tools.

## Testing

```bash
# Unit test handlers directly (bypass MCP protocol):
# Test the handler function directly, not via MCP transport

# Integration test with MCP Inspector:
npx @modelcontextprotocol/inspector node dist/index.js

# Integration test with Claude Code:
claude mcp add --scope local test-server -- node dist/index.js
/mcp    # check tools visible
```

Write tests that call tool handler functions directly with mock inputs. Verify error cases return `isError: true`. Verify security validation rejects bad inputs.

## Per-Tool Tool Output Limits

If tool returns large content, annotate in tools/list response:
```json
{
  "_meta": {
    "anthropic/maxResultSizeChars": 200000
  }
}
```

Default limit in Claude Code: 25,000 tokens. Increase with `MAX_MCP_OUTPUT_TOKENS` env var.
For tools with inherently large outputs (schemas, file trees), use this annotation.

## SSE / HTTP Transport CORS

For HTTP servers accepting browser clients or cross-origin requests:
```typescript
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Session-Id');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// SSE keep-alive
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
res.on('close', () => clearInterval(keepAlive));
```
