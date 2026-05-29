# MCP Server Troubleshooting and Debugging

**Load when:** Any error, debugging, ENOENT, tool not showing up, MCP Inspector usage, log file reading, connection failure, timeout, JSON parse errors.
**Do not load when:** Design questions with no errors present.

Source: modelcontextprotocol.io/docs/tools/debugging [S10], mcp.harishgarg.com/learn/mcp-server-troubleshooting-guide-2025 [S17], fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/ [S15]

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

---

## MCP Inspector Usage

```bash
# Install and run (no global install needed):
npx @modelcontextprotocol/inspector <command> [args...]

# Examples:
npx @modelcontextprotocol/inspector npx -y my-mcp-package
npx @modelcontextprotocol/inspector node dist/index.js
npx @modelcontextprotocol/inspector uvx my-mcp-server
npx @modelcontextprotocol/inspector python server.py

# HTTP server:
npx @modelcontextprotocol/inspector --transport http https://mcp.example.com/mcp
```

Inspector opens browser UI. Can:
- View server capabilities
- List tools, resources, prompts
- Call tools with custom arguments
- See raw JSON-RPC message exchange
- Identify schema errors

---

## Reading Log Files

**Claude Desktop (macOS):**
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

**Claude Desktop (Windows):**
```powershell
Get-Content "$env:APPDATA\Claude\logs\mcp*.log" -Tail 50 -Wait
```

Log captures: connection events, config errors, runtime errors, message exchange (in debug mode).

**Claude Desktop DevTools** (enable with `developer_settings.json` + `allowDevTools: true`):
Open with Cmd+Option+I (mac) or Ctrl+Alt+I (win). Network panel shows MCP message payloads.

---

## After Any Config Change

**Claude Desktop**: Must fully quit (system tray / Cmd+Q), not just close window. Reopen.
**Claude Code CLI**: Start new session or restart. Run `claude mcp list` to verify.
**Codex CLI**: Restart Codex session.

---

## Quick Reference: Error Codes

| Code | Meaning | Common Fix |
|------|---------|-----------|
| ENOENT | Command/file not found | Use absolute path |
| -32000 | Server error (often JSON parse) | Fix stdout pollution |
| -32602 | Invalid params | Check capability negotiation, fix schema |
| -32601 | Method not found | Server doesn't support that primitive |
| Connection closed | Server crashed | Check stderr/logs for crash reason |
| Empty tools list | Schema/capability issue | Use MCP Inspector |
