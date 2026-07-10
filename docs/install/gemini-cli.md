# Install : Gemini CLI

Gemini CLI supports the `subagent-mcp` MCP server, but this repo does not ship a
Gemini per-turn hook. Configure server wiring only. Do the
[build prerequisite](_INDEX.md) first.

Because Gemini injects no `<subagent-mcp state="...">` hook tag, AGENTS.md's
NO-HOOK clause applies: orchestration state is UNKNOWN and defaults to ON.
The expected warning is:

```text
subagent-mcp: no hook injection detected : orchestration state unknown; defaulting to ON
```

This is fail-safe behavior, not a Gemini-specific hook install step. Do not add
a `UserPromptSubmit` hook for Gemini; no such per-turn hook is documented in
this repo.

---

## MCP server : `~/.gemini/settings.json`

Edit `~/.gemini/settings.json` (Windows:
`C:\Users\YourName\.gemini\settings.json`) and merge this `mcpServers` entry
with any existing settings.

**macOS / Linux:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["/abs/path/to/subagent-mcp/dist/index.js"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Dropbox\\subagent-mcp\\dist\\index.js"]
    }
  }
}
```

Restart the Gemini CLI session after editing.

---

## Verification

1. **Build present:** confirm `dist/index.js` exists.
2. **Server loads:** restart Gemini CLI and confirm the `subagent-mcp` MCP tools
   are available.
3. **Expected hookless behavior:** no per-turn directive is injected by Gemini.
   With no hook tag, state is UNKNOWN and defaults to ON under AGENTS.md.

Regression gate: `npm test`.
