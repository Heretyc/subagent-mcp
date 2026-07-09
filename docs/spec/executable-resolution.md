# Executable Resolution (Cross-Platform)

The public function `resolveExeFor(provider, platform, deps)` in `src/platform.ts` is a pure, dependency-injected function that determines the real path to the `claude` or `codex` binary. `deps` provides `existsSync` and `npmPrefix()` so the function is fully unit-testable with mocked filesystem and npm prefix.

## win32

PowerShell `.ps1` / `.cmd` shims in the npm global bin directory cannot be directly spawned by `child_process.spawn`. The server locates the real `.exe` under the npm global prefix:

- **claude:** `<npmPrefix>\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
- **codex:** `<npmPrefix>\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`

If the expected path does not exist (e.g. installed differently), falls back to the bare name `"claude"` / `"codex"` and relies on PATH.

## darwin / linux

On POSIX systems, the npm global bin directory contains a real symlink (not a shim) that re-execs the correct vendor binary, so the bare name on PATH works correctly in normal login shells. For non-login shell environments (common with MCP host launchers where PATH may be minimal), the server probes candidate absolute paths in order and returns the first that exists:

1. `<npmPrefix>/bin/<name>` -- npm global bin (most reliable if npm is configured correctly)
2. `/opt/homebrew/bin/<name>` -- Homebrew install (macOS)
3. `/usr/local/bin/<name>` -- traditional unix location

If none exist, returns the bare name and relies on PATH. The npm prefix is obtained via `execSync("npm prefix -g")` and cached.

## Kill signal

`kill_agent` immediately force-kills any open agent session (`processing`,
`stalled`, or turn-`finished` with an open driver) and reports terminal
`stopped`:
- **Windows:** `taskkill /pid <pid> /t /f`
- **macOS / Linux:** `process.kill(pid, "SIGKILL")`
