# Troubleshooting: MCP Inspector, Logs, Restart, Error Codes

Part of `troubleshooting.md`. Source: modelcontextprotocol.io/docs/tools/debugging [S10], mcp.harishgarg.com/learn/mcp-server-troubleshooting-guide-2025 [S17]

Covers retrieval-map section: `restart_requirements`.

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
