# subagent-mcp v2.0.0 -- Technical Specification

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
- **Runtime:** Node.js >= 18 (ESM module)
- **Entry point:** `dist/index.js` (compiled from `src/index.ts`)
- **Server name announced to MCP host:** `subagent-mcp`

All logs go to stderr. stdout carries only JSON-RPC messages.

---

## Full Parameter Schemas

| Tool | Key params (zod) | Success return shape |
|------|-----------------|----------------------|
| `launch_agent` | `provider` enum, `model` enum, `effort` enum (default `"high"`), `prompt` string, `cwd?` string | `{ agent_id, status, provider, model }` |
| `poll_agent` | `agent_id` string | `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd }` |
| `kill_agent` | `agent_id` string | `{ agent_id, status, message }` (not-running is not an error) |
| `send_message` | `agent_id` string, `message` string | `{ agent_id, status: "sent", message }` |
| `list_agents` | (none) | `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd }] }` |

stdout_tail: last 2000 chars. stderr_tail: last 1000 chars. Errors set `isError: true`; text begins with `"Error: "`.

---

## Effort-Resolution Decision Logic

```
function resolveEffort(provider, model, effort):

  if effort == "ultracode":
    if NOT (provider == "claude" AND model IN ["opus", "opus-4-8"]):
      THROW: "ultracode effort is only available on Opus 4.8+ (got <provider>/<model>). Use xhigh for other models."
    RETURN { kind: "settings" }   # --> write temp JSON file, pass --settings

  if provider == "claude" AND model == "haiku":
    RETURN { kind: "none" }       # --> no --effort flag at all

  if provider == "claude" AND model IN ["sonnet", "opus", "opus-4-8"]:
    if effort IN ["low", "medium", "high", "xhigh", "max"]:
      RETURN { kind: "flag", value: effort }

  if provider == "codex":
    if effort == "max":
      THROW: "max effort is not valid for gpt-5.5 (Codex). Valid: low, medium, high, xhigh."
    if effort IN ["low", "medium", "high", "xhigh"]:
      RETURN { kind: "flag", value: effort }

  # Fallback (should not reach in practice given zod validation)
  RETURN { kind: "flag", value: "high" }
```

Decision table:

| provider | model | effort | Result |
|----------|-------|--------|--------|
| claude | haiku | any | `{ kind: "none" }` -- no `--effort` passed |
| claude | sonnet | low/medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | opus / opus-4-8 | low/medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | opus / opus-4-8 | ultracode | `{ kind: "settings" }` -- temp file path |
| claude | any | ultracode (non-4.8) | THROW error |
| codex | gpt-5.5 | low/medium/high/xhigh | `{ kind: "flag", value: effort }` |
| codex | gpt-5.5 | max | THROW error |
| codex | gpt-5.5 | ultracode | THROW error (Opus-4.8+ only) |

---

## Ultracode `--settings` Mechanism

### What ultracode is

Ultracode is a Claude Code interactive mode that sets reasoning effort to `xhigh` AND grants standing `dynamic-workflow` permission. It is not an `--effort` flag value.

### Why `--effort ultracode` does not work

The Claude CLI validates the `--effort` argument against a known enum. `ultracode` is not in that enum. The CLI exits with an error when passed `--effort ultracode`. This was verified against `claude-opus-4-8`.

### How the server activates it headlessly

1. Write `{"ultracode":true}` to a temp file: `<os.tmpdir()>/subagent-uc-<uuid>.json`
2. Pass `--settings <path>` to the `claude` CLI instead of `--effort`
3. The Claude CLI reads the settings file and activates ultracode mode
4. On agent exit (any path: `close` event, `kill_agent`, spawn error), delete the temp file

This behavior is verified working on `claude-opus-4-8`. `--effort xhigh` alone does NOT activate ultracode.

### Cleanup

The temp settings file path is stored in `AgentState.ucSettingsPath`. It is deleted in:
- The `close` event handler (normal exit and `kill_agent` path)
- The `kill_agent` tool's `close` listener
- The spawn error handler in `launch_agent`

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

## Windows Executable Resolution

On Windows, npm global packages may not be on `PATH` in the environment that spawns the server. The server resolves the real executables at runtime:

```typescript
function resolveExe(provider: "claude" | "codex"): string {
  if (!isWindows) return provider;  // "claude" or "codex" -- on PATH

  const prefix = execSync("npm prefix -g").trim();

  if (provider === "claude") {
    const exe = join(prefix, "node_modules", "@anthropic-ai", "claude-code",
                     "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  } else {
    const exe = join(prefix, "node_modules", "@openai", "codex",
                     "node_modules", "@openai", "codex-win32-x64",
                     "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    if (existsSync(exe)) return exe;
  }

  return provider;  // fall back to PATH name
}
```

The npm prefix is cached after the first call. On non-Windows, the CLI name is used directly (assumed on PATH).

---

## Concurrency Model

```typescript
const MAX_CLAUDE = 5;
const MAX_CODEX  = 5;
```

`countRunning(provider)` counts agents in `status === "running"` for that provider. If the count meets or exceeds the cap, `launch_agent` returns an error without spawning. Completed, failed, killed, and stalled agents do not count toward the cap.

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

## Health Monitor

`setInterval` every 10,000 ms. For each agent: if `running` and `now - lastActivity > 60s` -> `stalled`. If `stalled` and activity resumed -> `running`. If process exited -> `completed` (code 0) or `failed`. Stalled agents are not auto-killed; use `kill_agent`.

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
