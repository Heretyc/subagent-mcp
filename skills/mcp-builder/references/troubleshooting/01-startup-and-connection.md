# Troubleshooting: Startup & Connection Failures

Part of `troubleshooting.md`. Source: modelcontextprotocol.io/docs/tools/debugging [S10], mcp.harishgarg.com/learn/mcp-server-troubleshooting-guide-2025 [S17], fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/ [S15]

Covers retrieval-map sections: `connection_failures`, `tool_visibility`, `stdout_pollution`.

---

## Debugging Workflow

1. Test server binary directly (outside Claude/Codex)
2. Check stdout is clean JSON-RPC only
3. Run MCP Inspector
4. Check config file (correct path, valid JSON, absolute paths)
5. Check log files
6. Add to Claude/Codex and use `/mcp` to check status

---

## Failure Mode: spawn ENOENT / Command Not Found

**Symptoms:** Server fails to start. Log shows `spawn ENOENT` or `ENOENT: no such file or directory`. Tools never appear.

**Causes (ranked by frequency):**
1. Command not in PATH that Claude/Codex sees at launch
2. Wrong executable name (e.g., `npx` vs `npx.cmd` on Windows)
3. Package not installed globally
4. Python venv not activated / wrong python path

**Fixes:**

Unix/macOS:
```bash
which npx   # get absolute path
which uvx
```
Use that path in config:
```json
{ "command": "/opt/homebrew/bin/npx", "args": ["-y", "my-package"] }
```

Windows:
```powershell
(Get-Command npx).Source   # e.g. C:\Program Files\nodejs\npx.cmd
```
Use `cmd /c` wrapper:
```json
{ "command": "cmd", "args": ["/c", "npx", "-y", "my-package"] }
```

Python/uvx missing:
```bash
# Install uv:
curl -LsSf https://astral.sh/uv/install.sh | sh  # macOS
irm https://astral.sh/uv/install.ps1 | iex        # Windows
# Use full path in config
```

---

## Failure Mode: stdout Pollution / JSON Parse Error / Error -32000

**Symptoms:** Server starts but tools don't work. Log shows JSON parse error. `Error -32000` ("Server error"). Garbled output.

**Cause:** Something wrote non-JSON to stdout in the MCP server process.

**Critical rule**: In stdio transport, stdout is exclusively for JSON-RPC messages.

| Language | BAD (corrupts stdio) | GOOD (safe) |
|----------|---------------------|-------------|
| Node.js | `console.log(...)` | `console.error(...)` |
| Python | `print(...)` | `sys.stderr.write(...)` or `import logging` to stderr |
| Any | Writing to stdout at startup | Only after JSON-RPC init completes |

**Diagnose:**
```bash
# Run server and capture stdout:
node dist/index.js 2>/dev/null | head -20
# Should see JSON-RPC messages only (starting with {"jsonrpc")
# Any non-JSON line = the bug
```

**Python diagnosis:**
```bash
python server.py 2>/dev/null | head -20
```

---

## Failure Mode: Tool Not Appearing in Claude / Codex

**Symptoms:** Server connects (no error in log), but zero tools visible.

**Checklist:**
1. Does `tools/list` return tools? Test with MCP Inspector.
2. Is `tools` declared in server capabilities? SDK usually handles this automatically.
3. Tool name conflict with another server? (Codex: check `disabled_tools`).
4. Schema invalid? Missing `"type": "object"` in inputSchema.
5. Tool name has invalid characters? Use alphanumeric + underscore only.
6. Server crashed silently after init? Check log file.
7. In Claude Code: did you run `claude mcp list` to confirm server added?

---

## Failure Mode: Connection Refused / Server Disconnected

**Symptoms:** Log shows connection refused, server disconnected, or connection closed unexpectedly.

**For stdio servers:**
- Server process exited (crash on startup)
- Check: `node dist/index.js` in terminal - does it stay running?
- Common crash causes: missing env var (`process.env.KEY` is undefined), import error, syntax error

**For HTTP servers:**
- Server not running / wrong port
- Firewall blocking port
- HTTPS required but server running HTTP
- CORS issue (for browser-based clients)

**Reconnection**: Claude Code auto-reconnects HTTP/SSE servers (5 attempts, exponential backoff). Stdio servers are NOT auto-reconnected.
