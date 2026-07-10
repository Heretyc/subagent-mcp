# Vendor : Claude Code (CLI)

Full support: user-scope MCP server **plus** machine-wide `UserPromptSubmit`
and `PreToolUse` hooks. All paths absolute and pointing at the permanent root
(`<npm root -g>/@heretyc/subagent-mcp`). Compliance basis: `compliance.md` → "Claude Code".

Prereq: the decoupled global install exists (`packaging.md` / `deploy.mjs`).
Resolve the install root once: `INSTALL = <npm root -g>/@heretyc/subagent-mcp`.

## 1) MCP server : user scope (official CLI)

```
claude mcp add --scope user subagent-mcp -- node "<INSTALL>/dist/index.js"
```

- User scope → persisted to `~/.claude.json`, available in every project.
- Verify: `claude mcp list` shows `subagent-mcp ... ✓ Connected` and
  `claude mcp get subagent-mcp` shows the `node <INSTALL>/dist/index.js` command.

## 2) Per-turn hook : `~/.claude/settings.json` (exec form)

Add (do not duplicate an existing entry; back the file up first):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["<INSTALL>/dist/hooks/orchestration-claude.js"]
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
            "args": ["<INSTALL>/dist/hooks/orchestration-claude-pretool.js"],
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Exec form (`command: "node"` + `args`) is the docs-preferred Windows pattern for
a Node script. Use a forward-slash or doubled-backslash absolute path in `args`.

## 3) Choose one Claude Code install path per workspace

The repo's local-marketplace plugin is a co-equal supported Claude Code install
path. It bundles the same server + hook from `${CLAUDE_PLUGIN_ROOT}` (the
checkout). Running both paths in one workspace duplicates the server and causes
a **double** hook injection (plugin hook + settings.json hook both fire). On a
machine using this standalone install:

- Ensure `subagent-mcp@subagent-mcp` is NOT in `~/.claude/settings.json`
  `enabledPlugins`, and the repo is NOT in `extraKnownMarketplaces` /
  `~/.claude/plugins/known_marketplaces.json`.
- If you develop in the repo, suppress its project `.mcp.json` server so it does
  not conflict with the user-scope one: add `"subagent-mcp"` to that project's
  `disabledMcpjsonServers` in `~/.claude.json` (or reject it at the approval
  prompt / `claude mcp reset-project-choices`).

## Verification

1. `claude mcp list` → `subagent-mcp` Connected (points at `<INSTALL>`).
2. Restart the session; `/mcp` lists `orchestration-mode`, `launch_agent`,
   `list_agents`, etc.
3. Toggle `orchestration-mode` ON → submit a prompt → an orchestrator-only
   directive is injected ahead of the turn (hook returns `additionalContext`).
4. Toggle OFF → the FULL directive stops; the OFF reminder cadence (LONG
   `reminder-off-claude.md` every 5th prompt, state-aware short pointer
   (`short-off.md` while OFF) between) remains.
5. Native `Task`/`Agent` tools are redirected while the server heartbeat is fresh.
6. No double injection (confirms the plugin is not also wired).

## Desktop note

Claude Desktop hosts the MCP server (MCP-only) but has no `UserPromptSubmit`
host, so the toggle flips the marker but nothing injects per turn. Register the
server in the Desktop config; skip the hook. Documented degradation, not a bug.
