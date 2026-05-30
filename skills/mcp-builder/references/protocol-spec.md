# MCP Protocol Specification

**Load when:** Understanding MCP fundamentals, architecture, transports, lifecycle, capability negotiation, message format.
**Do not load when:** Task is purely about config files, packaging, or platform-specific install.

Source: modelcontextprotocol.io/docs/concepts/architecture [S1], spec.modelcontextprotocol.io [S2]

---

## Architecture

Three participants:
- **MCP Host**: AI application (Claude Desktop, Claude Code, Codex CLI, VS Code). Manages one or more clients.
- **MCP Client**: Component inside host. One per server. Maintains dedicated connection.
- **MCP Server**: Program exposing tools/resources/prompts. Runs locally (stdio) or remotely (HTTP).

Two layers:
- **Data layer**: JSON-RPC 2.0 message semantics, primitives, lifecycle.
- **Transport layer**: Communication channel (stdio or HTTP).

## Transports

| Feature | stdio | Streamable HTTP |
|---------|-------|----------------|
| Use case | Local process, same machine | Remote server, multi-client |
| Mechanism | stdin/stdout streams | HTTP POST + optional SSE |
| Auth | None (process isolation) | Bearer token, API key, OAuth 2.1 |
| Performance | Best (no network overhead) | Network latency |
| Log output | stderr (captured by host) | Server-side log aggregation |
| Stdout rule | ONLY JSON-RPC messages | N/A |

**Critical stdio rule**: Never write anything to stdout except JSON-RPC messages. `console.log` in Node / `print()` in Python = fatal corruption. Use `console.error` / `sys.stderr.write`.

SSE transport is **deprecated** as of 2025-11-25. Use Streamable HTTP for new remote servers.

## Protocol Version

Current: `2025-06-18` (also `2025-11-25` in latest spec). Server must echo client's `protocolVersion` on init or negotiate compatible version.

## Message Format (JSON-RPC 2.0)

All messages UTF-8 encoded.

**Request:**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

**Response:**
```json
{ "jsonrpc": "2.0", "id": 1, "result": { ... } }
```

**Error response:**
```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32602, "message": "Invalid params" } }
```

**Notification** (no id, no response expected):
```json
{ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }
```

## Standard Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params (also: capability not declared, sampling to client that didn't declare it) |
| -32603 | Internal error |

Tool execution errors use `isError: true` in the tool result, NOT protocol errors.

## Lifecycle

1. **Initialize**: Client sends `initialize` with `protocolVersion` and `capabilities`.
2. **Server responds**: echoes version, declares its `capabilities`, `serverInfo`.
3. **Client notifies**: sends `notifications/initialized` (no response).
4. **Operation**: request/response/notification exchange.
5. **Shutdown**: transport-level close.

**Initialize request params:**
```json
{
  "protocolVersion": "2025-06-18",
  "capabilities": { "elicitation": {} },
  "clientInfo": { "name": "claude-code", "version": "1.0.0" }
}
```

**Initialize response result:**
```json
{
  "protocolVersion": "2025-06-18",
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": {},
    "prompts": {}
  },
  "serverInfo": { "name": "my-server", "version": "1.0.0" }
}
```

## Server Capabilities

Declare only what you implement. Undeclared = must not use.

| Capability key | Description |
|---------------|-------------|
| `tools` | Server has tools. `listChanged: true` enables list_changed notifications. |
| `resources` | Server has resources. `subscribe: true` enables subscriptions. |
| `prompts` | Server has prompt templates. |
| `logging` | Server will send log notifications. |

## Client Capabilities (for server authors)

| Capability key | Meaning |
|---------------|---------|
| `sampling` | Client can handle `sampling/createMessage` requests from server. |
| `elicitation` | Client can handle `elicitation/create` requests. |
| `roots` | Client exposes filesystem roots. |

If client doesn't declare `sampling` but server calls `sampling/createMessage` → -32602 error.

## Primitives Summary

**Server-side** (server exposes to clients):
- **Tools**: executable functions. LLM invokes via `tools/call`.
- **Resources**: read-only data. Client fetches via `resources/read`.
- **Prompts**: reusable templates. Client retrieves via `prompts/get`.

**Client-side** (server requests from client):
- **Sampling**: server asks client LLM for completion (`sampling/createMessage`).
- **Elicitation**: server asks user for input (`elicitation/create`).

## Method Reference

| Method | Direction | Description |
|--------|-----------|-------------|
| `tools/list` | C→S | List available tools |
| `tools/call` | C→S | Execute a tool |
| `resources/list` | C→S | List available resources |
| `resources/read` | C→S | Read resource content |
| `resources/subscribe` | C→S | Subscribe to resource updates |
| `prompts/list` | C→S | List prompt templates |
| `prompts/get` | C→S | Get a specific prompt |
| `sampling/createMessage` | S→C | Server requests LLM completion |
| `elicitation/create` | S→C | Server requests user input |
| `logging/setLevel` | C→S | Client adjusts log level |
| `notifications/initialized` | C→S | Client signals ready |
| `notifications/tools/list_changed` | S→C | Tool list updated |
| `notifications/resources/list_changed` | S→C | Resource list updated |
| `notifications/message` | S→C | Log message |
