# Install : Claude Code (CLI)

Full support: per-turn `UserPromptSubmit` hook **plus** the MCP server, bundled
in one plugin. Do the [build prerequisite](_INDEX.md) first.

---

## Option A : local-marketplace plugin (hook + server together)

The repo ships a single-plugin marketplace whose manifest points at the
same-repo plugin (`"source": "./"`) and bundles both `.mcp.json` (server) and
`hooks/hooks.json` (hook). Claude Code auto-loads the standard
`hooks/hooks.json`, so `.claude-plugin/plugin.json` must **not** re-declare it
(a `"hooks": "./hooks/hooks.json"` entry now trips a duplicate-hooks-file load
error) and must not re-declare inline hook event tables or `mcpServers`. Only
the plugin loader resolves `${CLAUDE_PLUGIN_ROOT}` and loads both together, so
this is the plugin path.

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

`install` is `<plugin-name>@<marketplace-name>` : both are `subagent-mcp` here.
Optional scope: append `--scope project` (writes `enabledPlugins` to
`.claude/settings.json`) or `--scope user` (default, all projects).

Restart the session, then toggle with the `orchestration-mode` tool
(`enabled: true` / `enabled: false`; omit `enabled` to query).

---

## Option B : manual wiring (no plugin): `claude mcp add` + settings.json hook

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

**3) Static native-agent deny** in the same settings file. This is defense in
depth next to the `PreToolUse` hook, blocking the native `Agent` launcher before
the heartbeat gate runs. Task widget tools and Explore are not in the static
deny list and remain usable.

```json
{
  "permissions": {
    "deny": ["Agent"]
  }
}
```

Keep any existing `permissions.allow` / `ask` / `deny` entries and append only
the missing deny rule. `subagent-mcp setup` and `init --global` do this merge
and back up existing files before editing.

Upgrade silently removes any legacy `Task`, `Explore`, and `Agent(Explore)`
deny entries that a prior install wrote. `doctor` detects stale deny entries
and offers repair. `uninstall` reverts the `Agent` deny entry that smcp owns.

---

## Verification

1. **Manifest (before install):** `claude plugin validate /abs/path/to/subagent-mcp`
   (Windows: pass the `C:\...` path). Expect `✔ Validation passed`.
2. **Build present:** confirm `dist/index.js`,
   `dist/hooks/orchestration-claude.js`, and
   `dist/hooks/orchestration-claude-pretool.js` exist.
3. **Server + tools:** restart the session, then `claude plugin list`
   (`subagent-mcp` enabled), `claude mcp list`, and `/mcp` inside a session :
   `subagent-mcp` connected, with `orchestration-mode`, `launch_agent`,
   `list_agents`, etc. listed.
4. **Hook fires when ON:** toggle `orchestration-mode` ON via the tool, submit
   any prompt, and confirm an orchestrator-only directive is injected ahead of
   the turn (the hook returns `additionalContext`).
5. **Hook downgrades when OFF:** toggle `orchestration-mode` OFF and confirm
   the FULL directive stops; the OFF reminder cadence remains (LONG
   `reminder-off-claude.md` every 5th prompt, state-aware short pointer
   (`short-off.md` while OFF) between).
6. **Native-agent suppression:** `~/.claude/settings.json` has a
   `permissions.deny` entry for `"Agent"`, in addition to the PreToolUse hook.
   Task widget tools and Explore are not in the static deny list.
7. **Manual wiring only:** `claude mcp get subagent-mcp` shows the
   `node dist/index.js` command, and the settings.json hooks fire.

## Reversibility

Before changing existing user config, setup writes timestamped sibling backups
such as `settings.json.bak-setup-*` or `settings.json.bak-native-agent-*`.
Doctor/upgrade snapshots include this file and can be restored with
`subagent-mcp rollback`.

Regression gate: `npm test`.
