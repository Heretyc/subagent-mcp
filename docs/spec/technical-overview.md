# Technical Overview

## Non-Goals

subagent-mcp does NOT and will NOT:

- Call the Anthropic HTTP API directly (no API keys)
- Call the OpenAI HTTP API directly (no `openai` SDK, no API keys)
- Support any provider other than locally authenticated Claude Code and Codex
- Act as a general HTTP proxy or model gateway
- Add direct API support in future versions

The "no API keys / no direct API" non-goals are enforced by a grep-gate test
(`test/no-api-keys.test.mjs`, in the default `npm test` run): it fails the build
if `src/**/*.ts` or `dist/index.js` references `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `api.anthropic.com`, or `api.openai.com`, or introduces a raw
`fetch(...)`/`https.request(...)` model-inference call site (the sole allowed
exception is the npmjs update check in `src/orchestration/update-check.ts`).
subagent-mcp only drives the locally authenticated `claude` and `codex` CLIs; it
never holds provider credentials of its own.

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
[../reference/effort-resolution.md](../reference/effort-resolution.md).
