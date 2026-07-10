# MCP Server Troubleshooting and Debugging

**Load when:** Any error, debugging, ENOENT, tool not showing up, MCP Inspector usage, log file reading, connection failure, timeout, JSON parse errors.
**Do not load when:** Design questions with no errors present.

Source: modelcontextprotocol.io/docs/tools/debugging [S10], mcp.harishgarg.com/learn/mcp-server-troubleshooting-guide-2025 [S17], fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/ [S15]

---

This page is an index. Detail lives in `troubleshooting/`. Load the sub-page matching the symptom (load all three for a full debugging sweep):

| Sub-page | Covers | retrieval-map section labels |
|----------|--------|------------------------------|
| [`troubleshooting/01-startup-and-connection.md`](troubleshooting/01-startup-and-connection.md) | Debugging workflow; `spawn ENOENT` / command not found; stdout pollution / JSON parse / `Error -32000`; tool not appearing; connection refused / server disconnected. | `connection_failures`, `tool_visibility`, `stdout_pollution` |
| [`troubleshooting/02-params-schema-timeout-platform.md`](troubleshooting/02-params-schema-timeout-platform.md) | `Error -32602` invalid params; schema validation error; timeout (Claude + Codex); Windows path / MSIX issues; Node.js ESM/CJS conflict. | : |
| [`troubleshooting/03-inspector-logs-restart-error-codes.md`](troubleshooting/03-inspector-logs-restart-error-codes.md) | MCP Inspector usage; reading log files (macOS/Windows) + DevTools; after-config-change restart requirements; error-code quick-reference table. | `restart_requirements` |

**Debugging workflow (start here):**

1. Test server binary directly (outside Claude/Codex).
2. Check stdout is clean JSON-RPC only.
3. Run MCP Inspector.
4. Check config file (correct path, valid JSON, absolute paths).
5. Check log files.
6. Add to Claude/Codex and use `/mcp` to check status.

**Top error codes:** `ENOENT` (use absolute path) · `-32000` (fix stdout pollution) · `-32602` (capability/schema) · `-32601` (method not supported) · empty tools list (schema/capability : use MCP Inspector).
