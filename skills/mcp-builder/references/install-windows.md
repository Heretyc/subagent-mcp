# MCP Server Installation: Windows

**Load when:** Any Windows-specific MCP setup, APPDATA paths, MSIX trap, PowerShell, PATH issues, winget, spawn ENOENT on Windows.
**Do not load when:** macOS-only install.

Source: exchangepedia.com/2026/04/claudetools-claude-desktop-powershell-module.html [S14], github.com/anthropics/claude-code/issues/26073 [S11], fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/ [S15]

---

This page is an index. Detail lives in `install-windows/`. Load the sub-page(s) for your task:

| Sub-page | Covers |
|----------|--------|
| [`install-windows/01-msix-trap-and-runtimes.md`](install-windows/01-msix-trap-and-runtimes.md) | The Windows MSIX config-path trap (standard vs virtualized path, detection, PowerShell finder); installing Node.js/npm (winget, choco, nvm-windows) and Python/uv/uvx; getting full executable paths for config. |
| [`install-windows/02-path-escaping-cli-wsl-diagnostics.md`](install-windows/02-path-escaping-cli-wsl-diagnostics.md) | PATH/ENOENT fixes (absolute path, `cmd /c`, node.exe + module path, system PATH); JSON path escaping and spaces; PowerShell execution policy; Claude Code CLI on Windows; WSL process-boundary caveat; long-path 260-char limit; reading log files; DevTools; the Windows diagnostic checklist. |

**Quick facts (no sub-page load needed):**

- MSIX/Store/WinGet install reads config from `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`. Standard `.exe` install uses `%APPDATA%\Claude\claude_desktop_config.json`. The in-app "Edit Config" button can open the wrong file on MSIX.
- `spawn ENOENT` on Windows = command not on the PATH Claude Desktop sees. Fix with an absolute `command` path or a `cmd /c` wrapper.
- Windows paths in JSON need `\\` or `/`. Restart (fully quit) Claude Desktop after edits.
