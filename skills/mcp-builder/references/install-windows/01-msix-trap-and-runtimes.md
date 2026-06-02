# Windows Install: MSIX Path Trap & Runtime Installation

Part of `install-windows.md`. Source: exchangepedia.com/2026/04/claudetools-claude-desktop-powershell-module.html [S14], github.com/anthropics/claude-code/issues/26073 [S11], fransiscuss.com/2025/04/22/fix-spawn-npx-enoent-windows11-mcp-server/ [S15]

---

## Critical: Windows MSIX Path Trap

Claude Desktop on Windows has TWO possible config locations. Using the wrong one = silently failing MCP servers.

**Detect which installer was used:**
- Store / WinGet / MSIX install: config is at MSIX path (virtualized)
- Standard `.exe` installer: config is at standard APPDATA path

**Standard install path:**
```
C:\Users\YourName\AppData\Roaming\Claude\claude_desktop_config.json
```

**MSIX / Store / WinGet install path:**
```
C:\Users\YourName\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

**Detection:** Open Claude Desktop -> Settings -> "Edit Config". If it opens the APPDATA path but servers still fail, you have the MSIX install. Check the MSIX path directly.

**PowerShell to find the right config:**
```powershell
# Check standard path
Test-Path "$env:APPDATA\Claude\claude_desktop_config.json"

# Check MSIX path
$msixPath = Get-ChildItem "$env:LOCALAPPDATA\Packages" | Where-Object { $_.Name -like "Claude_*" }
if ($msixPath) {
    $configPath = "$($msixPath.FullName)\LocalCache\Roaming\Claude\claude_desktop_config.json"
    Write-Output "MSIX config: $configPath"
    Test-Path $configPath
}
```

## Node.js / npm Installation

**Recommended: winget**
```powershell
winget install OpenJS.NodeJS
# or LTS:
winget install OpenJS.NodeJS.LTS
```

**Chocolatey:**
```powershell
choco install nodejs
```

**nvm-windows** (version manager, if you need multiple Node versions):
```powershell
# Install from: https://github.com/coreybutler/nvm-windows/releases
nvm install lts
nvm use lts
```

**Verify:**
```powershell
node --version
npm --version
where node    # get full path for config
where npx
```

## Python / uv / uvx Installation

**uv (recommended package manager):**
```powershell
# PowerShell install:
irm https://astral.sh/uv/install.ps1 | iex
# Then verify:
uv --version
uvx --version
```

**Python direct:**
```powershell
winget install Python.Python.3.12
# or from python.org installer
```

**Get full paths for config:**
```powershell
(Get-Command uvx).Source    # e.g. C:\Users\Name\.local\bin\uvx.exe
(Get-Command python).Source # e.g. C:\Python312\python.exe
```
