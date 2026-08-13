<!-- Part of README.md (split). See ../README.md for overview and install. -->

## How To Operate It

### Orchestration Mode

- **ON**: your assistant acts as a pure manager. It delegates every step to
  sub-agents. Best for big, long-running jobs.
- **OFF**: your assistant works normally, with no delegation rules.

Flip it with the `orchestration-mode` tool. Desktop apps can toggle the mode but
do not receive per-turn hook reminders.

### Tools

The server exposes `launch_agent`, `poll_agent`, `kill_agent`, `send_message`,
`list_agents`, `wait`, `respond_permission`, `orchestration-mode`,
`model-selection-mode`, `configure`, and `swarm`; `get_status` returns
`providers_loaded`, `agent_count`, `session_start_time`,
`last_routing_decisions`, and `swarm` (active stage and routing state). See
[docs/tools.md](../docs/tools.md) for the full parameter and return reference.

`configure` lists, reads, or updates config by canonical key (`action=list`,
`get`, or `set`). Secret-matching values and all env values are always redacted
in responses. Machine-global settings (`global.*`) are read-only through MCP; a
set attempt returns a coaching message pointing to the resolved file path instead
of writing. Settings that affect process environment state (`.env` entries,
provider `key_env` changes) return `restart_required: true`. Use `/smcp:config`
to invoke this tool interactively.

You do not have to choose a model. Give `launch_agent` a prompt and a task
category such as `coding`, `debugging`, or `security_review`; the server picks
the provider, model, and effort.

### Agentic Swarms

`swarm()` starts a staged 7-step workflow for objectives projected to span
multiple sessions. The server returns per-stage coaching and tracks the current
stage in memory for the life of the process. Call `swarm(N)` to report stage N
done and receive the next stage's coaching; call `swarm(0)` to abandon.

Stage 6 dispatches one sub-orchestrator per plan section. Pass
`sub-orchestrator: true` on a `launch_agent` call (main orchestrator only,
depth 0) to launch a child as a delegate-only orchestrator; the server injects
the directive and the child's own workers run as normal sub-agents without
inheriting the flag.

Stage-report spamming cannot extend active routing state: only a genuine
forward advance to a new stage changes state, and all routing state clears
when handoff becomes the next step.

### Concurrency

There is one machine-wide limit on concurrent sub-agents. The default is 20.
When the limit is reached, `launch_agent` is rejected immediately and does not
queue. Change the value in `global-subagent-mcp-config.jsonc` in the install
folder. The file is re-read on every launch.

The config file was renamed from `global-concurrency.jsonc` in 2.12.5. The old
name is still read, with a one-time deprecation notice, when the new file is
absent.

The same settings file includes `checkForUpdates` (default `true`). Disable it
with `checkForUpdates: false` or `SUBAGENT_UPDATE_CHECK=0`.
