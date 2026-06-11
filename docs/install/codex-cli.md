# Install — Codex CLI

Full support: per-turn hook (`SessionStart` + `UserPromptSubmit`) **plus** the
MCP server. Two parts, two files of record. Do the
[build prerequisite](_INDEX.md) first.

The CLI and the Codex IDE/Desktop extension **share** `~/.codex/config.toml`, so
registering the MCP server once serves both. The per-turn hook is **CLI-only**.

---

## 1) MCP server — `~/.codex/config.toml`

Either run `codex mcp add` (writes the user config) or edit the TOML by hand.

**macOS / Linux:**

```bash
codex mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

**Windows** (`C:\Users\YourName\.codex\config.toml`):

```bash
codex mcp add subagent-mcp -- node "C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"
```

Equivalent hand-edited TOML:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/abs/path/to/subagent-mcp/dist/index.js"]
startup_timeout_sec = 10
tool_timeout_sec = 60

# Windows: use forward slashes (or doubled backslashes) in TOML
# args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

Hooks are **enabled by default** in Codex 0.131+. Add the block below **only**
if a profile/admin disabled them:

```toml
[features]
hooks = true
```

---

## 2) Per-turn hook — `~/.codex/hooks.json` (CLI only)

Create `~/.codex/hooks.json` (Windows: `C:\Users\YourName\.codex\hooks.json`).
Use the repo's `codex/hooks.json` as a **template to copy** — it is not usable
in place. `SessionStart` covers turn 0; `UserPromptSubmit` covers turns 1+.

Two install-critical rules:

- **Use an ABSOLUTE path**, not `${PLUGIN_ROOT}`. That placeholder only expands
  for a real Codex plugin manifest; this repo ships none, so a hand-installed
  hook receives the literal string and silently no-ops. (The compiled hook
  self-resolves its `directives/` assets via `../../directives`, so an
  absolute-path install needs zero env wiring.)
- The timeout field is **`timeout`** (seconds, default 600), **not**
  `timeoutSec`.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/abs/path/to/subagent-mcp/dist/hooks/orchestration-codex.js\"",
            "commandWindows": "node \"C:/Users/YourName/Dropbox/subagent-mcp/dist/hooks/orchestration-codex.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/abs/path/to/subagent-mcp/dist/hooks/orchestration-codex.js\"",
            "commandWindows": "node \"C:/Users/YourName/Dropbox/subagent-mcp/dist/hooks/orchestration-codex.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`commandWindows` is optional but makes the file cross-platform; on a single OS
you may keep just `command` with that OS's absolute path. Do **not** add a
matcher to `UserPromptSubmit` — it does not accept one.

> **Why user config, not repo `.codex/hooks.json`:** repo-local hooks load only
> when the project `.codex/` layer is **trusted**. `~/.codex/hooks.json` fires
> regardless of project trust, so prefer it.

---

## Project-local Codex config

A repo-level `.codex/config.toml` is honored only when the project is trusted
in the user config (`~/.codex/config.toml`):

```toml
[projects.'<abs repo path>']
trust_level = "trusted"
```

Project-local values override the user config for the keys they set. For a
server defined in the user config, project config can toggle it:

```toml
[mcp_servers.subagent-mcp]
enabled = true  # or false
```

Granular alternative — keep the server enabled but hide specific tools:

```toml
[mcp_servers.subagent-mcp]
disabled_tools = ["launch_agent", "poll_agent", "kill_agent", "send_message", "list_agents", "wait"]
```

---

## Verification

1. **Build present:** confirm `dist/index.js` and
   `dist/hooks/orchestration-codex.js` exist (Node >= 18).
2. **Directive assets resolve:** confirm `directives/orchestration-codex.md`,
   `off-turn-reminder.md`, and `carryover-codex.md` exist at `directives/`.
3. **Server + tools:** `codex mcp list` (or `/mcp` in a session) shows
   `subagent-mcp` and its tools (`orchestration-mode`, `launch_agent`, etc.).
4. **Trust the hook:** start `codex`, run `/hooks`, and **trust** the new
   command hook. Untrusted command hooks do not execute (trust is keyed to the
   hook's hash; editing it requires re-trust).
5. **Hook fires when ON:** toggle `orchestration-mode` ON, start a fresh
   session (`SessionStart` fires turn 0), submit a couple of prompts, and
   confirm the orchestrator-only directive injects on cadence. If nothing
   injects, re-check that the path is absolute (not `${PLUGIN_ROOT}`) and that
   `~/.codex/hooks.json` (not an untrusted repo file) is in use.
6. **Hook silent when OFF:** toggle `orchestration-mode` OFF and confirm
   injection stops.
7. **Field-name sanity:** if the hook behaves on a 600s timeout instead of
   ~10s, you likely left `timeoutSec` instead of `timeout`.

Regression gate: `npm test`.
