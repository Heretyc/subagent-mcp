# Error Catalogue

Every error string the server can return:

| Error text | Source |
|-----------|--------|
| `Error: Claude provider only supports haiku, sonnet, sonnet-5-5, sonnet-5, sonnet-4-6, sonnet-4-5, opus, opus-4-8, opus-5-5, opus-5, opus-4-7, opus-4-6, opus-4-5, fable, fable-5-1. Got: <model>` | `launch_agent` (`validatePresence`), provider/model mismatch |
| `Error: Codex provider only supports gpt-5.5, gpt-5.6, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-6-astra, gpt-6-sol, gpt-6-luna. Got: <model>` | `launch_agent` (`validatePresence`), provider/model mismatch |
| `Error: provider override must be claude or codex. Got: <provider>. The api provider is internal auto-slot routing only and cannot be selected explicitly.` | `launch_agent` (`validatePresence`), non-launchable provider override |
| `Global concurrent-subagent limit reached: <current> of <max> live subagents are already running across all sessions on this machine. This global count includes agents started by OTHER active agentic sessions and the ENTIRE recursive descendant tree, not just this session's direct children. launch_agent was REJECTED : this cap never queues or blocks; no slot frees itself by waiting. Free a slot manually first: call list_agents to see live agents, then kill_agent to terminate ones you no longer need, and retry. The limit is "globalConcurrentSubagents" in <configPath> (default 20, minimum 10).` | `launch_agent`, global concurrency cap (`globalCapMessage`) |
| `Error: ultracode effort is only available on Opus 4.8 (got <provider>/<model>). Use xhigh for other models.` | `resolveEffort`, ultracode on any model other than pinned `opus-4-8` (generic `opus` is GA Opus 5.5, not ultracode-capable) |
| `Error: ultracode effort is only available on Opus 4.8 (provider claude, model opus-4-8). Got: <provider>/<model>. Use xhigh for other models.` | `launch_agent` (`validatePresence`), explicit ultracode on wrong model |
| `Error: max effort is not valid for <model> (Codex). Valid: medium, high, xhigh.` | `resolveEffort`, `max` on gpt-5.5 (max is valid on CODEX_MAX_MODELS: the gpt-6 family gpt-6-astra/gpt-6-sol/gpt-6-luna, the gpt-5.6 trio gpt-5.6-sol/gpt-5.6-terra/gpt-5.6-luna, and the generic gpt-5.6 alias) |
| `Error: max effort is not valid for <model> (Codex). Valid Codex efforts: medium, high, xhigh.` | `launch_agent` (`validatePresence`), explicit `max` on gpt-5.5 |
| `Error: <effort> effort is not supported by claude/<model>. Supported: <supported>. No silent downgrade.` | `resolveEffort`, effort tier outside the claude per-model ladder (`CLAUDE_EFFORT_LADDERS`) - e.g. `sonnet-4-6`/`opus-4-6` @ `xhigh`, `opus-4-5` @ `xhigh`/`max`; `<supported>` is that model's legal tiers (plus `ultracode` on `opus-4-8`) |
| `Error: <effort> effort is not supported by claude/<model>. Supported: <supported>. No silent downgrade.` | `launch_agent` (`validatePresence`), explicit effort tier outside the claude per-model ladder (`CLAUDE_EFFORT_LADDERS`) |
| `low effort is not supported. Valid efforts: medium, high, xhigh, max, ultracode.` | `resolveEffort`, banned `low` tier (also rejected by the zod enum at the tool boundary) |
| `Error launching agent: <message>` | `launch_agent`, driver spawn/start failed |
| `Error: Agent <uuid> not found` | `poll_agent`, `kill_agent`, `send_message` |
| `Error: Agent is not live (status: <status>)` | `send_message` when not running |
| `Error killing agent: <message>` | `kill_agent`, `process.kill` threw |
| `Error sending message: <message>` | `send_message`, provider driver rejected enqueue/write |
| `Error: sub-orchestrator: true is only available to the main orchestrator (depth 0). Current SUBAGENT_MCP_DEPTH=<depth>: a sub-orchestrator launched from this depth could not delegate, because the 2-level spawn cap leaves its workers unable to run. Relaunch this agent as a normal sub-agent (omit sub-orchestrator).` | `launch_agent`, `sub-orchestrator: true` at depth >= 1 (`ERR_SUBORCH_DEPTH`) |

All error responses set `isError: true` on the MCP content object.

> Note : the `Error text` column shows each message core, not always the full
> emitted string. Per the append-hints convention
> (`auto-mode/resolution-matrix.md`), `validatePresence` appends a newline plus
> the `<AUTO_HINT>` block to its `provider override must be ...`, `ultracode
> effort is only available ... (provider claude, model opus-4-8) ...`, `max
> effort is not valid for <model> (Codex) ...`, and `<effort> effort is not
> supported by claude/<model> ...` strings, so what the caller sees is longer
> than the row above. The two `... provider only supports ...` strings
> are emitted bare (no appended hint), exactly as shown.

## Swarm non-error response surface

The `swarm` tool NEVER sets `isError`. Out-of-order calls, repeat calls, already-active calls,
idle calls, invalid-stage calls, and corrective coaching replies are all plain text results.
This is deliberate: a confused caller receives corrective coaching and can self-correct rather
than receiving a protocol failure it cannot act on. Full text templates:
`docs/spec/auto-mode/tool-description.md` and `src/swarm.ts`.
