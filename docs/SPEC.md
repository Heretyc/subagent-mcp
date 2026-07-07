# subagent-mcp -- Technical Specification

<!-- Version is not pinned here; `package.json` "version" is the source of truth. -->

**Author:** Lexi Blackburn | **License:** Apache-2.0 | **Repo:** https://github.com/Heretyc/subagent-mcp

> Rationale for the core design bets lives in [spec/arch-rationale.md](spec/arch-rationale.md).

## Non-Goals

subagent-mcp does NOT and will NOT:

- Call the Anthropic HTTP API directly (no API keys)
- Call the OpenAI HTTP API directly (no `openai` SDK, no API keys)
- Support any provider other than locally authenticated Claude Code and Codex
- Act as a general HTTP proxy or model gateway
- Add direct API support in future versions

## Architecture

```
MCP Host (Claude Code / Codex / Gemini CLI)
         |  JSON-RPC over stdio
         v
  subagent-mcp (node dist/index.js)
         |  ProviderDriver abstraction
         +---> Claude Agent SDK logical session (local claude executable)
         +---> codex app-server JSONL stdio session
```

- **Transport:** stdio (MCP spec 2025-06-18)
- **SDK:** `@modelcontextprotocol/sdk` + `zod`; Claude sessions use `@anthropic-ai/claude-agent-sdk`
- **Platforms:** macOS, Linux, Windows
- **Runtime:** Node.js >= 18 (ESM module)
- **Entry point:** `dist/index.js` (compiled from `src/index.ts`)
- **Server name announced to MCP host:** `subagent-mcp`

All logs go to stderr; stdout carries only JSON-RPC messages.

## Full Parameter Schemas

| Tool | Key params (zod) | Success return shape |
|------|-----------------|----------------------|
| `launch_agent` | `task_category` enum, `prompt` string, optional `provider`/`model`/`effort` overrides, `deadlock?` boolean, `cwd?` string | `{ agent_id, status, provider, model, effort, task_category }`; runs zombie maintenance silently and omits `zombie_report` |
| `poll_agent` | `agent_id` string, `verbose?` boolean (default `false`) | `{ id, provider, model, status, exit_code, stdout_tail, stderr_tail, started_at, last_activity, cwd, alive, idle_seconds, recent_stream, routing_tier }` (+ `hint` when stalled; + `final_output` when `verbose`; + `ruleset_applied`/`ruleset_original_selection` when ruleset altered routing; + `zombie_report` when culling) |
| `kill_agent` | `agent_id` string | `{ agent_id, status, message }` (not-running is not an error) |
| `send_message` | `agent_id` string, `message` string | `{ agent_id, status: "sent", message }` |
| `list_agents` | (none) | `{ agents: [{ id, provider, model, status, started_at, last_activity, cwd_basename, alive, idle_seconds }] }` (+ `zombie_report` when culling; token-efficient core metrics; no `hint`, no `verbose` arg, no tails or stream items -- use `poll_agent`) |

stdout_tail: last 2000 chars. stderr_tail: last 1000 chars. `recent_stream`: last 3 parsed visible provider stream items, each timestamped. `alive`: true while the driver is open (`processing`, `stalled`, or turn-`finished` with `exitCode === null`). `idle_seconds`: `Math.floor((now - lastActivity) / 1000)` since the last visible-stream heartbeat. `poll_agent` and `list_agents` reconcile driver exit synchronously. Errors set `isError: true`; text begins with `"Error: "`.

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
| `fable` | `claude-fable-5` | claude |
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

If none exist, returns the bare name and relies on PATH. The npm prefix is obtained via `execSync("npm prefix -g")` and cached.

### Kill signal

`kill_agent` immediately force-kills any open agent session (`processing`,
`stalled`, or turn-`finished` with an open driver) and reports terminal
`stopped`:
- **Windows:** `taskkill /pid <pid> /t /f`
- **macOS / Linux:** `process.kill(pid, "SIGKILL")`

---

## Concurrency Model

Admission is governed by ONE machine-global, provider-agnostic cap on subagents
alive at once across every session, process, user, and recursive descendant on
the host. There are NO per-provider caps (`MAX_CLAUDE`/`MAX_CODEX`/`countProcessing`
no longer exist). The cap value is `globalConcurrentSubagents` in
`global-concurrency.jsonc` (sole source of truth; default 20, minimum 10,
re-read every launch). The live count is a shared directory of `slot-<uuid>.json`
marker files; `launch_agent` reserves a slot before spawning and is REJECTED
immediately at cap (never queued). On a slot-state I/O error the launch is
REJECTED (fail-closed). A slot is reserved at launch admission and released ONLY
when the agent's driver closes (or via kill / failed-launch cleanup / zombie
culling) -- a `stalled` agent still holds its slot. The authoritative contract
is [spec/global-concurrency/cap-contract.md](spec/global-concurrency/cap-contract.md).

Agents are stored in a module-level `Map<string, AgentState>` keyed by UUID. There is no persistence -- the map is cleared on server restart.

---

## Provider Driver IPC and Output Handling

See [spec/interactive-drivers.md](spec/interactive-drivers.md) for the
normative interactive-only driver model.

### Claude

- Driver: Claude Agent SDK `query()` with an async input stream.
- Launch enqueues the prompt as the first user input; `send_message` enqueues later inputs into the same SDK stream.
- SDK events are captured as JSONL in `agentState.stdout` and parsed with per-agent line buffering. Parsed visible items refresh `lastActivity`; provider-internal thinking blocks do not.
- If the SDK is unavailable or lacks the streaming API, launch fails loudly. There is no raw CLI one-shot fallback.

### Codex

- Driver: `codex app-server --stdio`.
- Launch initializes app-server, starts a configured thread, then starts the first turn.
- `send_message` enqueues the next user turn; queued turns submit through `turn/start` after the active turn completes.
- app-server JSONL notifications are captured in `agentState.stdout`; `turn/completed` marks the current turn `finished` without killing the session.
- If app-server startup or protocol negotiation fails, launch fails loudly. There is no `codex exec` fallback.

### Output Tails

`poll_agent` returns the last 2000 characters of stdout and last 1000 characters of stderr. Full output is stored in memory for the server's lifetime; there is no disk buffering.

---

## Status Lifecycle and Health Monitor

The full status table (`processing`, `stalled`, `finished`, `errored`,
`stopped`, `zombie_killed`), the visible-stream heartbeat, the `alive`/`idle_seconds`/`hint`
fields, the `computeStatusTransition` ordering, the `HEARTBEAT_TIMEOUT_MS = 600000`
(10-minute) boundary, and synchronous exit reconciliation are documented in
[reference/status-lifecycle.md](reference/status-lifecycle.md). `stalled` is a
live, non-failure state; `processing` is the active live state. Tool and hook
maintenance cull stale live and terminal-but-alive agents after the same
6-minute idle window (`ZOMBIE_TERMINAL_IDLE_MS`), anchored on the later of
`exitedAt` and `lastActivity`; `poll_agent` and `send_message` refresh that
clock, and the concurrency slot is already freed at turn-finish. All tool and
hook paths still run culling, but only `poll_agent` and `list_agents` surface
`zombie_report`; culled agents remain `zombie_killed` via `poll_agent`,
`list_agents`, and `wait`.

---

## Error Catalogue

Every error string the server can return:

| Error text | Source |
|-----------|--------|
| `Error: Claude provider only supports haiku, sonnet, opus, opus-4-8, or fable. Got: <model>` | `launch_agent`, provider/model mismatch |
| `Error: Codex provider only supports gpt-5.5. Got: <model>` | `launch_agent`, provider/model mismatch |
| `Global concurrent-subagent limit reached: <current> of <max> live subagents are already running across all sessions on this machine. This global count includes agents started by OTHER active agentic sessions and the ENTIRE recursive descendant tree, not just this session's direct children. launch_agent was REJECTED — this cap never queues or blocks; no slot frees itself by waiting. Free a slot manually first: call list_agents to see live agents, then kill_agent to terminate ones you no longer need, and retry. The limit is "globalConcurrentSubagents" in <configPath> (default 20, minimum 10).` | `launch_agent`, global concurrency cap (`globalCapMessage`) |
| `Error: ultracode effort is only available on Opus 4.8+ (got <provider>/<model>). Use xhigh for other models.` | `resolveEffort`, ultracode on wrong model |
| `Error: max effort is not valid for gpt-5.5 (Codex). Valid: medium, high, xhigh.` | `resolveEffort`, max on codex |
| `Error launching agent: <message>` | `launch_agent`, driver spawn/start failed |
| `Error: Agent <uuid> not found` | `poll_agent`, `kill_agent`, `send_message` |
| `Error: Agent is not live (status: <status>)` | `send_message` when not running |
| `Error killing agent: <message>` | `kill_agent`, `process.kill` threw |
| `Error sending message: <message>` | `send_message`, provider driver rejected enqueue/write |

All error responses set `isError: true` on the MCP content object.

---

## Provider Startup Strings

**Claude (non-ultracode):** Claude Agent SDK `query({ prompt: AsyncIterable, options })`; options include local Claude executable path, `cwd`, model, supported effort, bypass permission mode, default tools, and max turns.

**Claude (ultracode):** Same logical SDK session, with `settings: <tmpdir/subagent-uc-<uuid>.json>` instead of an effort option. Settings file: `{"ultracode":true}`. Deleted on close.

**Codex:** `codex app-server --stdio`, followed by `initialize`, `thread/start`, and `turn/start` JSONL protocol messages.

---

## AgentState Structure

`AgentState` fields: `id` (UUID), `provider`, `model` (alias), `status`, `process` (driver process facade), `driver` (provider driver), `stdout` (full string), `stderr` (full string), `exitCode`, `startedAt` (ms), `lastActivity` (ms, stamped by visible-stream heartbeat), `cwd`, `recentStream` (last 3 parsed stream items), `ucSettingsPath?` (Claude ultracode temp file), `slotPath?`, `exitedAt?`, `waitReported?`.

---

## Governance

The `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` managed blocks (`schema=3`, upserted
by init and vendor registration) make the harness-hook `<subagent-mcp state="...">`
injections the authoritative source of orchestration state. Because the state is
read SOLELY from the injected tag — never inferred from prose — the managed
blocks guard against directive drift and model hallucination: a bare mention of
"subagent-mcp" carries no authority, and the absence of any tag is treated as an
explicit fail-safe. See
[spec/dev-loop/orchestration-directive-architecture.md](spec/dev-loop/orchestration-directive-architecture.md).

## Source References

- MCP protocol spec: https://modelcontextprotocol.io
- `@modelcontextprotocol/sdk`: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Agent SDK: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- Claude Code CLI: https://github.com/anthropic-ai/claude-code
- Codex CLI: https://github.com/openai/codex
