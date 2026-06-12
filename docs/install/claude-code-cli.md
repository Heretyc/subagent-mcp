# Install — Claude Code (CLI)

Full support: per-turn `UserPromptSubmit` hook **plus** the MCP server, bundled
in one plugin. Do the [build prerequisite](_INDEX.md) first.

---

## Option A — local-marketplace plugin (hook + server together)

The repo ships a single-plugin marketplace whose plugin source is the repo root
itself, bundling both `.mcp.json` (server) and `hooks/hooks.json` (hook). The
plugin loader **auto-discovers** the root-level `.mcp.json` and `hooks/hooks.json`,
so `.claude-plugin/plugin.json` carries only `name`/`version`/`description` and
must **not** re-declare `mcpServers` or `hooks` — re-declaring them collides with
auto-discovery and the plugin fails to load with a duplicate-hooks error
(`Hook load failed: Duplicate hooks file detected`). Only the plugin loader
resolves `${CLAUDE_PLUGIN_ROOT}` and loads both together, so this is the
plugin path.

**macOS / Linux:**

```bash
claude plugin marketplace add /abs/path/to/subagent-mcp
claude plugin install subagent-mcp@subagent-mcp
```

**Windows:**

```bash
claude plugin marketplace add "C:\Users\YourName\Dropbox\subagent-mcp"
claude plugin install subagent-mcp@subagent-mcp
```

`install` is `<plugin-name>@<marketplace-name>` — both are `subagent-mcp` here.
Optional scope: append `--scope project` (writes `enabledPlugins` to
`.claude/settings.json`) or `--scope user` (default, all projects).

Restart the session, then toggle with the `orchestration-mode` tool
(`enabled: true` / `enabled: false`; omit `enabled` to query).

---

## Option B — manual wiring (no plugin): `claude mcp add` + settings.json hook

Use this when wiring the server and hook separately.
`${CLAUDE_PLUGIN_ROOT}` is **not** available outside a plugin, so use an
absolute path (the compiled hook falls back to its own `../../directives` for
directive assets, so no extra env wiring is needed).

**1) Register the MCP server** (project scope shown; `--scope user` for all
projects):

```bash
# macOS / Linux
claude mcp add --scope project subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
# Windows
claude mcp add --scope project subagent-mcp -- node "C:\Users\YourName\Dropbox\subagent-mcp\dist\index.js"
```

**2) Register the hooks** by hand in `~/.claude/settings.json` (all
projects) or `.claude/settings.json` (this project). Windows user path:
`C:\Users\YourName\.claude\settings.json`.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/abs/path/to/subagent-mcp/dist/hooks/orchestration-claude.js"]
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/abs/path/to/subagent-mcp/dist/hooks/orchestration-claude-pretool.js"],
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

On Windows use a doubled-backslash or forward-slash absolute path in `args`.

---

## Verification

1. **Manifest (before install):** `claude plugin validate /abs/path/to/subagent-mcp`
   (Windows: pass the `C:\...` path). Expect `✔ Validation passed`.
2. **Build present:** confirm `dist/index.js`,
   `dist/hooks/orchestration-claude.js`, and
   `dist/hooks/orchestration-claude-pretool.js` exist.
3. **Server + tools:** restart the session, then `claude plugin list`
   (`subagent-mcp` enabled), `claude mcp list`, and `/mcp` inside a session —
   `subagent-mcp` connected, with `orchestration-mode`, `launch_agent`,
   `list_agents`, etc. listed.
4. **Hook fires when ON:** toggle `orchestration-mode` ON via the tool, submit
   any prompt, and confirm an orchestrator-only directive is injected ahead of
   the turn (the hook returns `additionalContext`).
5. **Hook downgrades when OFF:** toggle `orchestration-mode` OFF and confirm
   the FULL directive stops; the OFF reminder cadence remains (LONG
   `reminder-off-claude.md` every 5th prompt, one-line rule carrier between).
6. **Manual wiring only:** `claude mcp get subagent-mcp` shows the
   `node dist/index.js` command, and the settings.json hooks fire.

Regression gate: `npm test`.
