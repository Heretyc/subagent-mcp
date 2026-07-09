# Error Catalogue

Every error string the server can return:

| Error text | Source |
|-----------|--------|
| `Error: Claude provider only supports haiku, sonnet, opus, opus-4-8, or fable. Got: <model>` | `launch_agent`, provider/model mismatch |
| `Error: Codex provider only supports gpt-5.5. Got: <model>` | `launch_agent`, provider/model mismatch |
| `Global concurrent-subagent limit reached: <current> of <max> live subagents are already running across all sessions on this machine. This global count includes agents started by OTHER active agentic sessions and the ENTIRE recursive descendant tree, not just this session's direct children. launch_agent was REJECTED â€” this cap never queues or blocks; no slot frees itself by waiting. Free a slot manually first: call list_agents to see live agents, then kill_agent to terminate ones you no longer need, and retry. The limit is "globalConcurrentSubagents" in <configPath> (default 20, minimum 10).` | `launch_agent`, global concurrency cap (`globalCapMessage`) |
| `Error: ultracode effort is only available on Opus 4.8+ (got <provider>/<model>). Use xhigh for other models.` | `resolveEffort`, ultracode on wrong model |
| `Error: max effort is not valid for gpt-5.5 (Codex). Valid: medium, high, xhigh.` | `resolveEffort`, max on codex |
| `Error launching agent: <message>` | `launch_agent`, driver spawn/start failed |
| `Error: Agent <uuid> not found` | `poll_agent`, `kill_agent`, `send_message` |
| `Error: Agent is not live (status: <status>)` | `send_message` when not running |
| `Error killing agent: <message>` | `kill_agent`, `process.kill` threw |
| `Error sending message: <message>` | `send_message`, provider driver rejected enqueue/write |

All error responses set `isError: true` on the MCP content object.
