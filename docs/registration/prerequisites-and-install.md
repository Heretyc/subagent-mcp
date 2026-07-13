<!-- Part of registration (split). Retrieval map: ../registration.md -->

# Prerequisites & Install

**Load when:** installing subagent-mcp from a package registry, wiring both CLIs
in one shot with `setup`, tuning global machine-local settings, upserting managed
blocks into provider global user-config, or installing from source.
**Do not load when:** you only need the per-host MCP-server config snippet (see
`claude-code.md`, `codex.md`, `gemini.md`) or the orchestration hook wiring (see
[docs/install/_INDEX.md](../install/_INDEX.md)).

## Prerequisites

- **Node.js >= 18**
- **`claude` CLI** (Claude Code) installed globally and authenticated (`claude login`)
- **`codex` CLI** (OpenAI Codex CLI) installed globally and authenticated (`codex auth`)
- Both CLIs must be installed and on `PATH` (macOS/Linux: standard npm global bin or Homebrew; Windows: resolved via npm global prefix automatically)

## Install

**npmjs install (default; auto-wires Claude and Codex):**

```bash
npm install -g @heretyc/subagent-mcp
subagent-mcp setup
```

Use GitHub Packages only when an internal workflow requires that registry:

```bash
# One-time: configure registry + auth (classic PAT with read:packages)
echo "@heretyc:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc

npm install -g @heretyc/subagent-mcp
subagent-mcp setup
```

`setup` writes the MCP server entry and `UserPromptSubmit` hook for each
detected vendor. Re-run after upgrading. Pass `--dry-run` to preview.

Consumer repos can also run `subagent-mcp init --root /path/to/project` to
upsert managed invariant blocks; use `--dry-run` or `--remove`.

## Global settings

The installed `dist/global-subagent-mcp-config.jsonc` file holds machine-local
settings (the legacy `dist/global-concurrency.jsonc` is still read as a
back-compat fallback):

- `globalConcurrentSubagents`: live subagent cap; default `20`, minimum `10`.
- `checkForUpdates`: silent npmjs update check; default `true`.

When `checkForUpdates` is true, the MCP server starts a non-blocking npmjs
metadata check after launch. If a newer `@heretyc/subagent-mcp` exists, the CLI
hook appends an informational prompt to run `subagent-mcp update`, then
`subagent-mcp setup`, at most once per session and no more than every 12 hours.
Registry-sourced names, versions, and URLs are never interpolated into injected
text. If a hook host omits `session_id`, the notice falls back to
timestamp-only throttling.

Set `"checkForUpdates": false` to skip the registry fetch and suppress the hook
notice. `SUBAGENT_UPDATE_CHECK=0` or `SUBAGENT_UPDATE_CHECK=false`
(case-insensitive) disables the same behavior for that process.

## `init --global` (provider global user-config)

`subagent-mcp init --global` upserts the managed init/directive block into each
provider's **official global user-config file** instead of a project tree:

| Provider | Global file |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |

These are the homedir dotdir paths on macOS, Windows, and Linux; scope is
exactly those three files. The command honors `--dry-run`, `--remove`, and
`--force`, and is **mutually exclusive** with `--root`, `--files`, `--copilot`,
and `--cursor`.

```bash
subagent-mcp init --global            # upsert into the three global files
subagent-mcp init --global --dry-run  # preview
subagent-mcp init --global --remove   # remove the managed block
```

## Developer install from source

See [CONTRIBUTING.md](../../CONTRIBUTING.md) section Local Setup for clone, install,
build, and run steps. Once built, wire the from-source binary into your vendor
config using the per-platform steps (`claude-code.md`, `codex.md`, `gemini.md`).
