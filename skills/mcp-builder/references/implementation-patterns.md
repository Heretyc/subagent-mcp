# Implementation Patterns, Security, and Optimization

**Load when:** Writing tool handlers, async patterns, security hardening, rate limiting, caching, streaming, testing, performance optimization, secrets management.
**Do not load when:** Config-only questions, protocol-level questions.

Source: github.com/modelcontextprotocol/typescript-sdk [S4], github.com/jlowin/fastmcp [S7], cerbos.dev/blog/how-to-secure-your-fast-mcp-server [S16]

---

This page is an index. Detail lives in `implementation-patterns/`. Load the sub-page(s) for your task:

| Sub-page | Covers |
|----------|--------|
| [`implementation-patterns/01-handlers-async-progress.md`](implementation-patterns/01-handlers-async-progress.md) | Tool handler patterns (TypeScript + Python/FastMCP), the validate/execute/return/isError structure, sync vs async handler guidance, blocking-I/O pitfalls, progress notifications for long-running tools. |
| [`implementation-patterns/02-security.md`](implementation-patterns/02-security.md) | Input validation beyond JSON Schema, path-traversal and command-injection prevention, secrets management (env key, never log/hardcode), SSRF prevention, per-tool rate limiting (token bucket + Redis note). |
| [`implementation-patterns/03-perf-lifecycle-testing-transport.md`](implementation-patterns/03-perf-lifecycle-testing-transport.md) | Caching with TTL, avoiding event-loop blocking (worker threads / `asyncio.to_thread`), graceful shutdown, structured stderr logging, testing strategy, per-tool output limits (`anthropic/maxResultSizeChars`, `MAX_MCP_OUTPUT_TOKENS`), SSE/HTTP CORS + keep-alive. |

**Core invariants (apply to all of the above):**

- In stdio transport, never write non-JSON-RPC to stdout. Log to stderr (`console.error` / `sys.stderr`).
- Tool execution errors return `isError: true`, not a protocol error.
- Validate every input beyond the schema; reject path traversal and never build shell strings from user input.
- Inject secrets via the config `env` key; never hardcode, never put in `args`, never log them.
