# Install — Claude Desktop (MCP-only)

Claude Desktop has **no `UserPromptSubmit` hook host**, so it gets the **MCP
server only**. The `orchestration-mode` tool still flips the marker, but
**nothing is injected per turn** — this is documented degradation, not a bug.
For per-turn injection, use the [Claude Code CLI](claude-code-cli.md) host.

Do the [build prerequisite](_INDEX.md) first.

---

## Configure the server

Edit `claude_desktop_config.json` (create it if missing) and add the server:

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

On macOS / Linux use a forward-slash absolute path, e.g.
`"/abs/path/to/subagent-mcp/dist/index.js"`. Use an **absolute** path to `node`
or ensure `node` is on the GUI app's `PATH` (absolute path avoids Windows
`ENOENT`).

### Config file locations

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows (standard):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (MSIX / Store / WinGet install):**
  `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

> On Windows MSIX/Store installs the in-app **Edit Config** button opens the
> *wrong* file. Edit the `Packages\...\LocalCache` path directly.

After editing, **fully quit and reopen** Claude Desktop (closing the window is
not enough — the server only reloads on a full restart).

---

## Verification

1. **Build present:** confirm `dist/index.js` exists.
2. **Tools appear:** after a full restart, confirm the `subagent-mcp` tools
   (`orchestration-mode`, `launch_agent`, `list_agents`, etc.) are listed.
3. **Expected degradation:** toggle `orchestration-mode` ON and confirm that
   **no** per-turn directive is injected (there is no `UserPromptSubmit` hook
   host on Desktop). The marker flips; injection does not occur. This is the
   intended behavior.
