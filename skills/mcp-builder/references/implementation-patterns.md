# Implementation Patterns, Security, and Optimization

**Load when:** Writing tool handlers, async patterns, security hardening, rate limiting, caching, streaming, testing, performance optimization, secrets management.
**Do not load when:** Config-only questions, protocol-level questions.

Source: github.com/modelcontextprotocol/typescript-sdk [S4], github.com/jlowin/fastmcp [S7], cerbos.dev/blog/how-to-secure-your-fast-mcp-server [S16]

---

## Tool Handler Pattern (TypeScript)

```typescript
server.tool(
  "search_files",
  "Search files by content pattern. Returns matching file paths and line numbers.",
  {
    pattern: z.string().min(1).max(500),
    directory: z.string().optional().default("/tmp"),
    max_results: z.number().int().min(1).max(100).default(20),
  },
  async ({ pattern, directory, max_results }) => {
    // 1. Validate beyond schema if needed
    if (directory.includes("..")) {
      return { content: [{ type: "text", text: "Path traversal not allowed" }], isError: true };
    }

    try {
      // 2. Execute
      const results = await searchFiles(pattern, directory, max_results);

      // 3. Return structured response
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      // 4. Tool execution errors -> isError: true, NOT protocol error
      return {
        content: [{ type: "text", text: `Search failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);
```

## Tool Handler Pattern (Python / FastMCP)

```python
@mcp.tool()
async def search_files(pattern: str, directory: str = "/tmp", max_results: int = 20) -> str:
    """Search files by content pattern. Returns matching paths and line numbers."""
    # Validate
    if ".." in directory:
        raise ValueError("Path traversal not allowed")
    if not pattern or len(pattern) > 500:
        raise ValueError("Pattern must be 1-500 chars")

    try:
        results = await do_search(pattern, directory, max_results)
        return json.dumps(results, indent=2)
    except Exception as e:
        # FastMCP wraps exceptions as isError: true automatically
        raise RuntimeError(f"Search failed: {e}")
```

## Async Patterns

**TypeScript**: Tool handlers are always `async`. SDK handles concurrency. Use `await` for all I/O.

**Python FastMCP**: Both sync and async functions work. Use `async def` for I/O-bound tools, `def` for CPU-bound.

```python
@mcp.tool()
async def fetch_url(url: str) -> str:
    """Fetch URL content."""
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=30)
        return response.text
```

Never use `time.sleep()` in async handlers - use `asyncio.sleep()`. Never use blocking I/O (requests library) in async handlers.

## Progress Notifications (Long-Running Tools)

```typescript
server.tool("long_task", "Runs a long task", { steps: z.number() }, async ({ steps }, { sendNotification }) => {
  for (let i = 0; i < steps; i++) {
    await sendNotification({
      method: "notifications/progress",
      params: { progressToken: "task-1", progress: i, total: steps },
    });
    await doStep(i);
  }
  return { content: [{ type: "text", text: "Done" }] };
});
```

Python FastMCP: use `ctx.report_progress(current, total)`.

## Security: Input Validation

Always validate beyond JSON Schema:

```typescript
// Path traversal prevention
if (!path.startsWith('/allowed/base/')) {
  throw new Error('Access denied');
}
const resolved = path.resolve(userInput);
if (!resolved.startsWith(allowedBase)) {
  throw new Error('Path traversal denied');
}

// Command injection prevention (NEVER use shell: true or template strings)
// WRONG:
exec(`grep ${userPattern} ${userFile}`);
// RIGHT:
execFile('grep', [userPattern, userFile]);  // no shell interpolation
```

```python
import subprocess
# WRONG:
subprocess.run(f"grep {pattern} {file}", shell=True)
# RIGHT:
subprocess.run(["grep", pattern, file], capture_output=True)
```

## Security: Secrets Management

```typescript
// Get from environment, fail loudly if missing
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY environment variable required');

// Never log secrets
console.error('Calling API');  // OK
console.error(`Calling API with key ${apiKey}`);  // NEVER
```

Inject secrets via config `env` key - never hardcode, never in `args` (visible in process list).

## Security: SSRF Prevention

```typescript
import { URL } from 'url';

function validateUrl(urlStr: string): void {
  const url = new URL(urlStr);  // throws on invalid URL
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(',') ?? [];
  
  // Block private/internal addresses
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) {
    throw new Error('Internal URLs not allowed');
  }
  
  // Check allowlist if configured
  if (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname)) {
    throw new Error('Host not in allowlist');
  }
}
```

## Rate Limiting

Per-tool rate limiting with token bucket:

```typescript
const toolCallCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(toolName: string, maxPerMinute: number): void {
  const now = Date.now();
  const key = toolName;
  const entry = toolCallCounts.get(key);
  
  if (!entry || now > entry.resetAt) {
    toolCallCounts.set(key, { count: 1, resetAt: now + 60000 });
    return;
  }
  
  if (entry.count >= maxPerMinute) {
    throw new Error(`Rate limit: ${maxPerMinute} calls/minute for ${toolName}`);
  }
  entry.count++;
}
```

FastMCP has middleware support for rate limiting. For distributed systems, use Redis-backed rate limiting.

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
