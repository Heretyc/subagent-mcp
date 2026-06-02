# Implementation: Tool Handlers, Async, Progress

Part of `implementation-patterns.md`. Source: github.com/modelcontextprotocol/typescript-sdk [S4], github.com/jlowin/fastmcp [S7]

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
