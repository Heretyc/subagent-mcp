# subagent-mcp v2.2.0 -- Technical Specification

**Author:** Lexi Blackburn | **License:** Apache-2.0 | **Repo:** https://github.com/Heretyc/subagent-mcp

---

## Non-Goals

subagent-mcp does NOT and will NOT:

- Call the Anthropic HTTP API directly (no `anthropic` SDK, no API keys)
- Call the OpenAI HTTP API directly (no `openai` SDK, no API keys)
- Support any provider other than the locally installed `claude` and `codex` CLIs
- Act as a general HTTP proxy or model gateway
- Add direct API support in future versions -- all model access is permanently via the local CLIs

---

## Architecture

```
MCP Host (Claude Code / Codex / Gemini CLI)
         |  JSON-RPC over stdio
         v
  subagent-mcp (node dist/index.js)
         |  Node.js child_process.spawn
         +---> claude CLI process (stdin/stdout/stderr pipes)
         +---> codex CLI process (stdout/stderr pipes, stdin ignored)
```

- **Transport:** stdio (MCP spec 2025-06-18)
- **SDK:** `@modelcontextprotocol/sdk` + `zod` for parameter validation
- **Platforms:** macOS, Linux, Windows
- **Runtime:** Node.js >= 18 (ESM module)
- **Entry point:** `dist/index.js` (compiled from `src/index.ts`)
- **Server name announced to MCP host:** `subagent-mcp`

All logs go to stderr. stdout carries only JSON-RPC messages.

---

## Full Parameter Schemas

| Tool | Key params (zod) | Success return shape |
|------|-----------------|----------------------|
| `launch_agent` | `provider` enum, `model` enum, `effort` enum (default `"high"`), `prompt` string, `cwd?` string | `{ agent_id, status, provider, model }` |
| `poll_agent` | `agent_id` string, `verbose?` boolean (default `false`) | `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd, alive, idle_seconds }` (+ `hint` when status is `processing`; + `final_output` string when `verbose` is `true`) |
| `kill_agent` | `agent_id` string | `{ agent_id, status, message }` (not-running is not an error) |
| `send_message` | `agent_id` string, `message` string | `{ agent_id, status: "sent", message }` |
| `list_agents` | (none) | `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd, alive, idle_seconds }] }` (each + `hint` when status is `processing`) |

stdout_tail: last 2000 chars. stderr_tail: last 1000 chars. `alive`: boolean, true while running/processing (exitCode === null). `idle_seconds`: `Math.floor((now - lastActivity) / 1000)`. `poll_agent` and `list_agents` reconcile process exit synchronously before building their return value, so an already-exited process is reported `completed`/`failed` immediately rather than after the next health-monitor tick. Errors set `isError: true`; text begins with `"Error: "`.

---

## Effort Resolution and Ultracode Mechanism

The `resolveEffort` decision logic (pseudocode + full decision table) and the
ultracode `--settings` activation/cleanup mechanism are documented in
[reference/effort-resolution.md](reference/effort-resolution.md).

---

## Model ID Mapping

| Alias | Mapped CLI model ID | Provider |
|-------|-------------------|----------|
| `haiku` | `haiku` (passed as-is) | claude |
| `sonnet` | `sonnet` (passed as-is) | claude |
| `opus` | `claude-opus-4-8` | claude |
| `opus-4-8` | `claude-opus-4-8` | claude |
| `gpt-5.5` | `gpt-5.5` (passed as-is) | codex |

---

## Executable Resolution (Cross-Platform)

The public function `resolveExeFor(provider, platform, deps)` in `src/platform.ts` is a pure, dependency-injected function that determines the real path to the `claude` or `codex` binary. `deps` provides `existsSync` and `npmPrefix()` so the function is fully unit-testable with mocked filesystem and npm prefix.

### win32

PowerShell `.ps1` / `.cmd` shims in the npm global bin directory cannot be directly spawned by `child_process.spawn`. The server locates the real `.exe` under the npm global prefix:

- **claude:** `<npmPrefix>\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
- **codex:** `<npmPrefix>\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`

If the expected path does not exist (e.g. installed differently), falls back to the bare name `"claude"` / `"codex"` and relies on PATH.

### darwin / linux

On POSIX systems, the npm global bin directory contains a real symlink (not a shim) that re-execs the correct vendor binary, so the bare name on PATH works correctly in normal login shells. For non-login shell environments (common with MCP host launchers where PATH may be minimal), the server probes candidate absolute paths in order and returns the first that exists:

1. `<npmPrefix>/bin/<name>` — npm global bin (most reliable if npm is configured correctly)
2. `/opt/homebrew/bin/<name>` — Homebrew install (macOS)
3. `/usr/local/bin/<name>` — traditional unix location

If none of the above exist, returns the bare name and relies on PATH as the final arbiter.

The npm prefix is obtained via `execSync("npm prefix -g")` and cached after the first call.

### Kill signal

On agent termination, SIGTERM is sent first. If the process is still alive after 5 seconds:
- **Windows:** `taskkill /pid <pid> /t /f`
- **macOS / Linux:** `process.kill(pid, "SIGKILL")`

---

## Concurrency Model

```typescript
const MAX_CLAUDE = 5;
const MAX_CODEX  = 5;
```

`countRunning(provider)` counts agents in `status === "running"` for that provider. If the count meets or exceeds the cap, `launch_agent` returns an error without spawning. Completed, failed, killed, and processing agents do not count toward the cap. The cap exists to limit API rate-limit pressure, and only actively-producing (`running`) agents add that load; a `processing` agent is quiet by definition (no output for >= 60s) so it costs no rate-limit budget and intentionally does not reserve a slot. More than 5 live processes per provider can therefore coexist when some are `processing`.

Agents are stored in a module-level `Map<string, AgentState>` keyed by UUID. There is no persistence -- the map is cleared on server restart.

---

## IPC and Output Handling

### Claude

- stdin: `"pipe"` -- prompt written then closed immediately after spawn
- stdout: `"pipe"` -- buffered into `agentState.stdout`; `lastActivity` updated on each chunk
- stderr: `"pipe"` -- buffered into `agentState.stderr`; `lastActivity` updated on each chunk
- Exit: `close` event sets `exitCode` and `status` (`completed` for code 0, `failed` otherwise)

### Codex

- stdin: `"ignore"` -- prompt passed as CLI argument, not stdin
- stdout: `"pipe"` -- JSONL stream; each chunk scanned for `"type":"turn.completed"`
- stderr: `"pipe"` -- captured same as Claude
- `turn.completed` detection: when a stdout chunk contains the string `"type":"turn.completed"`, the server sets `status = "completed"`, `exitCode = 0`, and kills the process cleanly. The `close` event then fires but the status is already terminal and is not overwritten.

### Output Tails

`poll_agent` returns the last 2000 characters of stdout and last 1000 characters of stderr. Full output is stored in memory for the server's lifetime; there is no disk buffering.

---

## Status Lifecycle and Health Monitor

The full status table (`running`, `processing`, `completed`, `failed`,
`killed`), the `alive`/`idle_seconds`/`hint` fields, the
`computeStatusTransition` ordering, the `STALL_THRESHOLD = 60000` boundary, and
synchronous exit reconciliation are documented in
[reference/status-lifecycle.md](reference/status-lifecycle.md). `processing`
(renamed from `stalled`) is a live, non-failure state.

---

## Error Catalogue

Every error string the server can return:

| Error text | Source |
|-----------|--------|
| `Error: Claude provider only supports haiku, sonnet, opus, or opus-4-8. Got: <model>` | `launch_agent`, provider/model mismatch |
| `Error: Codex provider only supports gpt-5.5. Got: <model>` | `launch_agent`, provider/model mismatch |
| `Error: Maximum <n> concurrent <provider> agents already running. Current: <n>` | `launch_agent`, concurrency cap |
| `Error: ultracode effort is only available on Opus 4.8+ (got <provider>/<model>). Use xhigh for other models.` | `resolveEffort`, ultracode on wrong model |
| `Error: max effort is not valid for gpt-5.5 (Codex). Valid: low, medium, high, xhigh.` | `resolveEffort`, max on codex |
| `Error launching agent: <message>` | `launch_agent`, `spawn` threw |
| `Error: Agent <uuid> not found` | `poll_agent`, `kill_agent`, `send_message` |
| `Error: Agent is not running (status: <status>)` | `send_message` when not running |
| `Error: Agent stdin is not available` | `send_message` when stdin is null |
| `Error killing agent: <message>` | `kill_agent`, `process.kill` threw |
| `Error sending message: <message>` | `send_message`, `stdin.write` threw |

All error responses set `isError: true` on the MCP content object.

---

## Full CLI Invocation Strings

**Claude (non-ultracode):** `claude -p --model <id> [--effort <e>] --permission-mode bypassPermissions --tools default --max-turns 50 --output-format json` | stdio `["pipe","pipe","pipe"]`, prompt via stdin.

**Claude (ultracode):** Same as above but `--settings <tmpdir/subagent-uc-<uuid>.json>` replaces `--effort`. Settings file: `{"ultracode":true}`. Deleted on close.

**Codex:** `codex exec -C <cwd> -m gpt-5.5 -c 'model_reasoning_effort="<e>"' --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json "<prompt>"` | stdio `["ignore","pipe","pipe"]`.

---

## AgentState Structure

`AgentState` fields: `id` (UUID), `provider`, `model` (alias), `status`, `process` (ChildProcess), `stdout` (full string), `stderr` (full string), `exitCode`, `startedAt` (ms), `lastActivity` (ms), `cwd`, `ucSettingsPath?` (temp file path, Claude ultracode only).

---

## Source References

- MCP protocol spec: https://modelcontextprotocol.io
- `@modelcontextprotocol/sdk`: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Code CLI: https://github.com/anthropic-ai/claude-code
- Codex CLI: https://github.com/openai/codex
