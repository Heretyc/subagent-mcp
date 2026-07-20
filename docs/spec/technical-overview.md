# Technical Overview

## Provider Support

subagent-mcp supports locally authenticated Claude Code and Codex sessions, plus
direct API providers configured in `<configHome>/providers.jsonc` (JSONC).
API provider entries use `api_style: "claude" | "openai"`, `base_url`, `model`,
`key_env`, and a 14-category `routing` slot map. Credentials are never stored
in `providers.jsonc`: `key_env` names an environment variable, and actual keys
live in the adjacent gitignored `.env`.

API provider routing folds into the same 14-category table by slot insertion.
Slot insertion runs in pure-auto mode ONLY: `provider`/`provider_model`/
`explicit` override launches attempt exactly the user-requested candidate and
never receive inserted `providers.jsonc` API slots. Set
`SUBAGENT_MCP_DISABLE_API_PROVIDERS=1` to disable insertion entirely.
subagent-mcp is not a general HTTP proxy or model gateway.

The API isolation grep gate (`test/no-api-keys.test.mjs`, in the default
`npm test` run) fails the build if `src/**/*.ts` or `dist/index.js` references
literal provider key names, hard-coded provider API hosts, or unapproved raw
HTTP model-inference call sites. HTTP is confined to
`src/providers/provider-client.ts`; the safety test allowlists fetch only in
`src/orchestration/update-check.ts` and `src/providers/provider-client.ts`.

## Architecture

```
MCP Host (Claude Code / Codex / Gemini CLI)
         |  JSON-RPC over stdio
         v
  subagent-mcp (node dist/index.js)
         |  ProviderDriver abstraction
         +---> Claude Agent SDK logical session (local claude executable)
         +---> codex app-server JSONL stdio session
         +---> API provider HTTP client (src/providers/provider-client.ts)
```

- **Transport:** stdio (MCP spec 2025-06-18)
- **SDK:** `@modelcontextprotocol/sdk` + `zod`; Claude sessions use `@anthropic-ai/claude-agent-sdk`
- **Platforms:** macOS, Linux, Windows
- **Runtime:** Node.js >= 20 (ESM module)
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
