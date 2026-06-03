# Windows Install: PATH, Escaping, CLI, WSL, Diagnostics

Part of `install-windows.md`. Source: exchangepedia.com/2026/04/claudetools-claude-desktop-powershell-module.html [S14], fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/ [S15]

---

## PATH Issues on Windows

Claude Desktop launches with a limited PATH inherited from the system, not your user PATH. This causes ENOENT when commands like `npx` or `uvx` are not in system PATH.

**Fix 1: Use absolute paths in config (recommended):**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": ["-y", "my-mcp-package"]
    }
  }
}
```

**Fix 2: cmd /c wrapper (makes npm global bin available):**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "my-mcp-package"]
    }
  }
}
```

**Fix 3: node.exe + module path directly:**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\YourName\\AppData\\Roaming\\npm\\node_modules\\my-mcp-package\\dist\\index.js"]
    }
  }
}
```

**Fix 4: Add to system PATH** (not user PATH):
- Win+S -> "Environment Variables" -> System Variables -> PATH -> Add Node/npm/uv directories.
- Requires Claude Desktop restart.

## JSON Config Path Escaping

Windows paths in JSON must use double backslashes OR forward slashes:

```json
"command": "C:\\Users\\Lexi\\AppData\\Roaming\\npm\\my-server.cmd"
// OR
"command": "C:/Users/Lexi/AppData/Roaming/npm/my-server.cmd"
```

Forward slashes work in most Windows contexts. Double backslash is more conventional.

**Spaces in paths**: wrap in quotes in `args`, not in `command`:
```json
{
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["C:\\My Projects\\server\\dist\\index.js"]
}
```

## PowerShell Execution Policy

Some MCP server scripts fail with PowerShell restriction errors:
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Or use CMD instead of PowerShell when executing scripts.

## Claude Code CLI on Windows

Claude Code CLI (`claude`) works on Windows natively and in WSL.

```powershell
# Native Windows:
claude mcp add my-server -- npx -y my-mcp-package

# If PATH issue, use full path:
claude mcp add my-server -- "C:\Program Files\nodejs\npx.cmd" -y my-mcp-package
```

Config stored in: `C:\Users\YourName\.claude.json`

## WSL Considerations

MCP servers in WSL are separate from Windows-native servers. Claude Desktop on Windows CANNOT talk to a stdio MCP server running inside WSL (different process boundary). Use HTTP/SSE transport to bridge WSL servers to Windows Claude Desktop.

Claude Code CLI can run inside WSL and talk to WSL-native stdio servers normally.

## Long Path Issues

Windows has 260-char path limit by default. Long `node_modules` paths can fail.

Enable long paths:
```powershell
# Run as Administrator:
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1
```

Or enable via Group Policy: Computer Config -> Admin Templates -> System -> Filesystem -> Enable Win32 long paths.

## Log Files (Windows)

```powershell
# View Claude Desktop MCP logs:
Get-Content "$env:APPDATA\Claude\logs\mcp*.log" -Tail 50

# Or for MSIX install:
$pkg = Get-ChildItem "$env:LOCALAPPDATA\Packages" | Where-Object { $_.Name -like "Claude_*" }
Get-Content "$($pkg.FullName)\LocalCache\Roaming\Claude\logs\mcp*.log" -Tail 50
```

## Claude Desktop DevTools (Windows)

Enable DevTools for client-side debugging:
```powershell
'{"allowDevTools": true}' | Set-Content "$env:APPDATA\Claude\developer_settings.json" -Encoding utf8
```
Open DevTools: Ctrl+Alt+I inside Claude Desktop.

## Quick Diagnostic Checklist (Windows)

1. Which installer? Detect MSIX vs standard (see above).
2. Edit the correct config file.
3. Run `where node`, `where npx`, `where uvx` in PowerShell - note full paths.
4. Use those full paths in config.
5. Validate JSON: paste config into jsonlint.com.
6. Fully quit Claude Desktop (system tray -> Quit), reopen.
7. Check log file for errors.
8. Test server process directly: `& "C:\...\node.exe" "C:\...\index.js"` - should start without crash.
