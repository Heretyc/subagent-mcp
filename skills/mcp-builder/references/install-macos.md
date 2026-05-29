# MCP Server Installation: macOS

**Load when:** macOS-specific MCP setup, brew, nvm, LaunchAgent, Gatekeeper, PATH in shell profile, uv/uvx on macOS.
**Do not load when:** Windows-only install question.

Source: modelcontextprotocol.io/quickstart/server [S5], modelcontextprotocol.io/docs/tools/debugging [S10]

---

## Config File Locations (macOS)

**Claude Desktop:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```
Open from Claude Desktop: Settings -> Developer -> Edit Config.

**Claude Code CLI:** `~/.claude.json` (user/local scope) or `.mcp.json` in project root.

**Codex CLI:** `~/.codex/config.toml`

**Log files:**
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

## Node.js / npm Installation

**Homebrew (recommended):**
```bash
brew install node
# or specific version:
brew install node@20
```

**nvm (Node Version Manager):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
# Add to ~/.zshrc or ~/.bash_profile:
# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm use --lts
```

**Verify:**
```bash
node --version
npm --version
which node    # get path for config
which npx
```

## Python / uv / uvx Installation

**uv (recommended):**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Add to ~/.zshrc: export PATH="$HOME/.local/bin:$PATH"
uvx --version
```

**pyenv + python:**
```bash
brew install pyenv
pyenv install 3.12
pyenv global 3.12
```

## PATH Issues on macOS

Claude Desktop launches with a limited shell environment. Apps launched from GUI don't inherit your shell's PATH.

**Fix 1: Use full absolute paths in config:**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["-y", "my-mcp-package"]
    }
  }
}
```

Find paths:
```bash
which npx    # /opt/homebrew/bin/npx or /usr/local/bin/npx
which uvx    # ~/.local/bin/uvx
which python3
```

**Fix 2: Use env key to set PATH:**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-package"],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
      }
    }
  }
}
```

**Apple Silicon vs Intel:**
- Apple Silicon (M1/M2/M3): Homebrew installs to `/opt/homebrew/bin/`
- Intel: Homebrew installs to `/usr/local/bin/`

## Gatekeeper for Distributed Binaries

If you ship a binary MCP server (not npx/uvx), Gatekeeper may block it on first run.

**For development (unsigned binaries):**
```bash
xattr -d com.apple.quarantine /path/to/my-server
# or:
spctl --add /path/to/my-server
```

**For distribution**: Sign and notarize with Apple Developer ID. Unsigned binaries will be blocked for end users.

**SIP (System Integrity Protection)**: Does not affect MCP servers in user directories. Only affects system directories. No SIP workarounds needed for typical MCP servers.

## Running as LaunchAgent (Persistent HTTP Server)

For remote/HTTP MCP servers that need to always be running:

```xml
<!-- ~/Library/LaunchAgents/com.example.mcp-server.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.mcp-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/username/mcp-server/dist/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mcp-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mcp-server-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>API_KEY</key>
        <string>sk-your-key</string>
    </dict>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.example.mcp-server.plist
launchctl start com.example.mcp-server
```

## DevTools on macOS

Enable Claude Desktop DevTools:
```bash
echo '{"allowDevTools": true}' > ~/Library/Application\ Support/Claude/developer_settings.json
```
Open DevTools: Cmd+Option+I inside Claude Desktop.

## Virtual Environment Path Issues

If using a Python venv and it breaks after Python upgrade:
```bash
# Rebuild venv:
rm -rf venv
python3 -m venv venv --copies    # --copies avoids symlink breakage
source venv/bin/activate
pip install -r requirements.txt
```

Use `uvx` or `uv run` to avoid manual venv management entirely.

## Quick Diagnostic Checklist (macOS)

1. Edit config: `open ~/Library/Application\ Support/Claude/claude_desktop_config.json`
2. Get absolute paths: `which npx`, `which uvx`, `which python3`
3. Validate JSON: `python3 -m json.tool < ~/Library/Application\ Support/Claude/claude_desktop_config.json`
4. Test server directly: run the command from terminal, check for startup errors.
5. Fully quit Claude Desktop (Cmd+Q from dock), reopen.
6. Check logs: `tail -n 50 ~/Library/Logs/Claude/mcp*.log`
7. MCP Inspector: `npx @modelcontextprotocol/inspector /path/to/server`
