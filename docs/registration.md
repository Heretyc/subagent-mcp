# Registering the MCP Server

Per-platform registration for `subagent-mcp` across Claude Code, Codex, and
Gemini CLIs. Replace the path in each example with the absolute path where you
cloned the repo.

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

```bash
git clone https://github.com/Heretyc/subagent-mcp
cd subagent-mcp
npm install
npm run build
```

The server entry point after build: `dist/index.js`.

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
