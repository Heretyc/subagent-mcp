# Implementation: Security (Validation, Secrets, SSRF, Rate Limiting)

Part of `implementation-patterns.md`. Source: github.com/modelcontextprotocol/typescript-sdk [S4], github.com/jlowin/fastmcp [S7], cerbos.dev/blog/how-to-secure-your-fast-mcp-server [S16]

---

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
