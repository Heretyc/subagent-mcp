# Registering the MCP Server

Per-platform registration for `subagent-mcp` across Claude Code, Codex, and
Gemini CLIs. Replace the path in each example with the absolute path where you
cloned the repo.

This page is the MCP-only registration reference. To install the
**orchestration-mode hook together with the server** on each host (the
preferred plugin path, manual fallbacks, and per-host verification), see
[docs/install/_INDEX.md](install/_INDEX.md).

See [README.md](../README.md) for the project overview and
[docs/SPEC.md](SPEC.md) for the full technical specification.

---

## Prerequisites

- **Node.js >= 18**
- **`claude` CLI** (Claude Code) installed globally and authenticated (`claude login`)
- **`codex` CLI** (OpenAI Codex CLI) installed globally and authenticated (`codex auth`)
- Both CLIs must be installed and on `PATH` (macOS/Linux: standard npm global bin or Homebrew; Windows: resolved via npm global prefix automatically)

---

## Install

**Recommended — GitHub Packages install (auto-wires Claude and Codex):**

```bash
# One-time: configure registry + auth (classic PAT with read:packages)
echo "@heretyc:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc

npm install -g @heretyc/subagent-mcp
subagent-mcp setup
```

`setup` writes the MCP server entry and `UserPromptSubmit` hook for each
detected vendor. Re-run after upgrading. Pass `--dry-run` to preview.

**Developer install from source:**

```bash
git clone https://github.com/Heretyc/subagent-mcp
cd subagent-mcp
npm install
npm run build
```

Server entry point after build: `dist/index.js`. Wire manually per the sections below.

---

## Claude Code CLI

**macOS / Linux** — run once from any directory:

```bash
claude mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

**Windows:**

```bash
claude mcp add subagent-mcp -- node "C:\Users\YourName\Dropbox\subagent-mcp\dist\index.js"
```

To make it available across all projects (user scope), add `--scope user`. Or add it to a project's `.mcp.json` for team sharing:

**macOS / Linux `.mcp.json`:**

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

**Windows `.mcp.json`:**

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

The Claude Desktop config lives at:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Verify with `claude mcp list` or `/mcp` inside a Claude Code session.

---

## Codex CLI

**macOS / Linux** — edit `~/.codex/config.toml` (create if it doesn't exist):

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/abs/path/to/subagent-mcp/dist/index.js"]
```

**Windows** — edit `C:\Users\YourName\.codex\config.toml`:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

Forward or double-backslash paths both work in TOML. Verify with `/mcp` inside a Codex session.

---

## Gemini CLI

**macOS / Linux** — edit `~/.gemini/settings.json` (merge into existing file):

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

**Windows** — edit `C:\Users\YourName\.gemini\settings.json`:

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

## Orchestration mode (plugin: hook + server)

`orchestration-mode` is a toggle. When ON, every top-level user turn gets an
orchestrator-only directive injected ahead of the prompt, re-pinning "delegate,
do not execute directly" so it survives long sessions. The MCP tool flips the
toggle; a bundled `UserPromptSubmit` hook does the per-turn injection. Both ship
in the same plugin, so install the plugin (not just the bare server) to get the
full feature. Run `npm run build` first — the hook runs from `dist/`.

### Claude Code CLI (plugin)

The plugin manifest is `.claude-plugin/plugin.json` (just
`name`/`version`/`description`); Claude **auto-discovers** the bundled hook
(`hooks/hooks.json`) and the server (`.mcp.json`) at the plugin root, so the
manifest must **not** re-declare `hooks`/`mcpServers` (doing so fails the load
with a duplicate-hooks error). Install it as a local marketplace plugin so
Claude resolves `${CLAUDE_PLUGIN_ROOT}`:

```bash
claude plugin marketplace add /abs/path/to/subagent-mcp
claude plugin install subagent-mcp@subagent-mcp
```

On Windows, pass the absolute repo path (for example
`C:\Users\YourName\Dropbox\subagent-mcp`) to `marketplace add`. Restart the
session, then toggle with the `orchestration-mode` tool (`enabled: true` /
`enabled: false`; omit `enabled` to query).

### Codex CLI (hook + server)

Codex has no plugin manifest in this repo, so install the hook by hand: copy
`codex/hooks.json` to `~/.codex/hooks.json` and replace the placeholder path
with an **absolute** path to the built `dist/hooks/orchestration-codex.js`
(`${PLUGIN_ROOT}` only expands inside a real plugin and would otherwise no-op).
The server comes from the `config.toml` entry shown above. Full step-by-step in
[docs/install/codex-cli.md](install/codex-cli.md).

### Desktop hosts toggle but do not inject

Claude Desktop and Codex Desktop have **no `UserPromptSubmit` hook host**, so
the `orchestration-mode` tool still flips the marker but **nothing is injected
per turn**. This is documented degradation, not a bug — use a CLI host for the
full per-turn behavior.
