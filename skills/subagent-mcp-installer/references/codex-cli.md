# Vendor : Codex CLI

Full support: MCP server in `~/.codex/config.toml` **plus** a per-turn hook
(`SessionStart` + `UserPromptSubmit`) in `~/.codex/hooks.json`. All paths
absolute and pointing at the permanent install root (`<npm root -g>/@heretyc/subagent-mcp`).
Compliance basis: `compliance.md` → "Codex CLI".

Prereq: the decoupled global install exists. `INSTALL = <npm root -g>/@heretyc/subagent-mcp`.
The CLI and the Codex IDE/Desktop extension share `config.toml`, so the server
registration serves both; the hook is CLI-only.

## 1) MCP server : `~/.codex/config.toml`

`codex mcp add subagent-mcp -- node "<INSTALL>/dist/index.js"`, or hand-edit
(back the file up first):

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["<INSTALL>/dist/index.js"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Use forward slashes (or doubled backslashes) in TOML paths on Windows. Optional
per-tool gating: `[mcp_servers.subagent-mcp.tools.<tool>] approval_mode = "approve"`.

## 2) Per-turn hook : `~/.codex/hooks.json`

Create/merge (back up first). `SessionStart` covers turn 0; `UserPromptSubmit`
covers turns 1+. `commandWindows` is the documented Windows override; `timeout`
is seconds (NOT `timeoutSec`).

Codex command hooks take a single command **string** : there is no `args` array
(unlike Claude's exec form in `claude-code.md`), so the absolute path is embedded
**and quoted** inside `command`, with `commandWindows` carrying the Windows path.
This is the Codex-native form, not a bespoke shim.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ {
        "type": "command",
        "command": "node \"<INSTALL>/dist/hooks/orchestration-codex.js\"",
        "commandWindows": "node \"<INSTALL>/dist/hooks/orchestration-codex.js\"",
        "timeout": 10
      } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ {
        "type": "command",
        "command": "node \"<INSTALL>/dist/hooks/orchestration-codex.js\"",
        "commandWindows": "node \"<INSTALL>/dist/hooks/orchestration-codex.js\"",
        "timeout": 10
      } ] }
    ]
  }
}
```

On a single OS you may keep only `command` with that OS's absolute path. Do NOT
add a matcher to `UserPromptSubmit` : it does not accept one. Prefer
`~/.codex/hooks.json` over a repo `.codex/hooks.json` (user-level fires
regardless of project trust). Add `[features] hooks = true` only if a
profile/admin disabled hooks.

## 3) Trust the hook

Command hooks must be **trusted** before they run. Start `codex`, run `/hooks`,
and trust the new hook. Trust is keyed to the hook's hash : **editing or
repointing `hooks.json` invalidates the stored `trusted_hash`** (in
`config.toml`), so re-trust after any change.

## Verification

1. `codex mcp list` (or `/mcp`) → `subagent-mcp` + tools (`orchestration-mode`,
   `launch_agent`, ...).
2. `directives/orchestration-codex.md`, `short-on.md`, `short-off.md`,
   `carryover-codex.md`, `reminder-on.md`, `reminder-off-codex.md` exist at
   `<INSTALL>/directives`.
3. `/hooks` shows the hook **trusted**.
4. Toggle `orchestration-mode` ON → start a fresh session (`SessionStart` fires
   turn 0) → directive injects on cadence. If silent: confirm the path is
   absolute (not `${PLUGIN_ROOT}`) and `~/.codex/hooks.json` is in use & trusted.
5. Toggle OFF → the FULL directive stops; the OFF reminder cadence (LONG
   `reminder-off-codex.md` every 5th prompt, state-aware short pointer
   (`short-off.md` while OFF) between) remains.
6. If the hook acts on a 600 s timeout instead of ~10 s, you left `timeoutSec`
   instead of `timeout`.
