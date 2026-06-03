# Troubleshooting: Params, Schema, Timeout, Platform Issues

Part of `troubleshooting.md`. Source: modelcontextprotocol.io/docs/tools/debugging [S10], mcp.harishgarg.com/learn/mcp-server-troubleshooting-guide-2025 [S17]

---

## Failure Mode: Error -32602 Invalid Params

**Symptoms:** Tool calls fail with -32602.

**Common causes:**
1. Client calling `sampling/createMessage` but client didn't declare `sampling` capability.
2. Invalid arguments passed to tool (wrong types, missing required fields).
3. Server returned wrong response shape for a request type.

**Fix:** Check the `initialize` exchange in MCP Inspector. Verify both sides declared expected capabilities.

---

## Failure Mode: Schema Validation Error

**Symptoms:** Tools listed but tool calls rejected. Schema error in logs.

**Check inputSchema:**
- Root must be `"type": "object"` - missing this is a common mistake.
- Properties must have `"type"` field.
- `"required"` must be an array of strings, not a boolean.
- No circular references.

**Valid schema:**
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query" }
  },
  "required": ["query"]
}
```

**Invalid (missing type at root):**
```json
{
  "properties": {
    "query": { "type": "string" }
  }
}
```

---

## Failure Mode: Timeout

**Claude Desktop / Code**: Default tool call timeout varies. Configure per-server: `"timeout": 300000` (5 minutes).

**Codex**: Default `tool_timeout_sec = 60`. Configure: `tool_timeout_sec = 300`.

**Server-side**: Return quickly for long operations. Use progress notifications to signal activity. If tool truly needs >5 minutes, implement async pattern: return job ID immediately, poll for result separately.

---

## Failure Mode: Windows Path / MSIX Issues

See `install-windows.md` for the MSIX path trap.

Short version:
- MSIX install reads config from `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`
- Standard install reads from `%APPDATA%\Claude\`
- "Edit Config" button may open wrong file on MSIX install

---

## Failure Mode: Node.js ESM / CJS Conflict

**Symptoms:** `require is not defined in ES module scope` or `Cannot find module`.

**Fix:**
- `"type": "module"` in package.json = ESM mode. All `import` statements must have `.js` extension.
- `"type": "commonjs"` (default) = CJS mode. Use `require()`.
- Mix-up: ESM package imported via `require()` → error.

**Safe approach:** Pick one. ESM is preferred for new packages. Set `"type": "module"` and use `import`.
