# Compliance — official sources & the rules they impose

The single source of truth for "is this install standards-compliant?". Every
wiring decision in the other reference docs traces back to a line here. When a
vendor changes its spec, update THIS file first, then the vendor guide.

## Authoritative sources

- **Claude Code — MCP:** https://code.claude.com/docs/en/mcp
- **Claude Code — Hooks:** https://code.claude.com/docs/en/hooks
- **Codex — MCP:** https://developers.openai.com/codex/mcp
- **Codex — Config Reference:** https://developers.openai.com/codex/config-reference
- **Codex — Hooks:** https://developers.openai.com/codex/hooks

## Claude Code — MCP server registration

- **Scopes** (Claude Code — MCP): `local` and `user` both persist to
  `~/.claude.json`; `project` persists to a checked-in `.mcp.json`. **User
  scope** = available across all the operator's projects, private to them —
  the correct scope for a machine-wide addon.
- **Register** via the official CLI: `claude mcp add --scope user <name> -- <cmd> <args...>`.
  Everything after `--` is the server command, passed through untouched.
- **stdio entry shape:** `command` + `args` (absolute paths). For a Node server:
  `command: "node"`, `args: ["<abs>/dist/index.js"]`.
- **Project `.mcp.json` approval:** project-scoped servers require approval
  before use; reset with `claude mcp reset-project-choices`. The stored decision
  lives in `~/.claude.json` per project as `enabledMcpjsonServers` /
  `disabledMcpjsonServers`. To suppress a repo's own `.mcp.json` server on a dev
  machine (so the user-scope install wins, no scope conflict), add the server
  name to that project's `disabledMcpjsonServers`.

## Claude Code — hooks

- **Schema** (Claude Code — Hooks): a `UserPromptSubmit` command hook is
  `{ "type": "command", "command": "...", "args": [...]? , "timeout": <s>? }`,
  nested under a matcher group: `"UserPromptSubmit": [ { "hooks": [ <hook> ] } ]`.
- **Location:** `~/.claude/settings.json` = all projects (machine-wide).
  `.claude/settings.json` / `.claude/settings.local.json` = single project.
- **Windows form (REQUIRED for robustness):** prefer **exec form** for a Node
  script — `command: "node"`, `args: ["<abs>/...js"]`. Shell form
  (`command: "node \"...\""`, no `args`) is valid but the docs reserve it for
  `.cmd`/`.bat` shims; a `.js` run by `node` is a real executable invocation, so
  exec form is the documented-preferred pattern.
- **Timeout:** `UserPromptSubmit` defaults to **30 s** (it blocks the model);
  set `timeout` explicitly only if the hook needs longer.

## Codex CLI — MCP server

- **Schema** (Codex — Config Reference): a server is a
  `[mcp_servers.<name>]` table in `~/.codex/config.toml`. `command` (required)
  + `args` (array). Env via `env_vars` (forwarded names) or `[mcp_servers.<name>.env]`.
  Optional `enabled`, `startup_timeout_sec` (default 10), `tool_timeout_sec`
  (default 60), `required`.
- **Register** via `codex mcp add <name> -- <cmd> <args...>` or by hand-editing
  the TOML. The CLI and the Codex IDE/Desktop extension SHARE this file.

## Codex CLI — hooks

- **Schema** (Codex — Hooks): `hooks.json` (next to a config layer) is a `hooks`
  object keyed by lifecycle event. `SessionStart` fires once at session start;
  `UserPromptSubmit` fires per prompt before reasoning. Each event holds matcher
  groups whose `hooks` arrays carry command hooks (`type`, `command`, …).
- **`commandWindows`** is the documented Windows-only command override (TOML
  alias `command_windows`). Use it to keep one cross-platform `hooks.json`.
- **`timeout`** (seconds) — NOT `timeoutSec`.
- **Trust:** command hooks must be trusted (`/hooks`) before they run; trust is
  keyed to the hook's hash, so editing a hook requires re-trust. Hooks are
  enabled by default on recent Codex; `[features] hooks = true` only if disabled.
- **Prefer `~/.codex/hooks.json`** over a repo `.codex/hooks.json`: the user-level
  file fires regardless of project trust.

## Cross-vendor invariants

- Absolute paths everywhere; never a placeholder (`${CLAUDE_PLUGIN_ROOT}`,
  `${PLUGIN_ROOT}`) outside the plugin loader that defines it — it reaches a
  hand-install as a literal and silently no-ops.
- The install root must be **permanent** (see `locations.md`).
- `directives/` ships beside `dist/` so the hooks' `../../directives` fallback
  resolves with zero env wiring.
