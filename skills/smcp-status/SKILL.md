---
name: smcp-status
version: 1.0.0
description: Report live subagent-mcp session state by calling the get_status MCP tool and rendering it in a uniform plain-ASCII layout. Use when the user says "smcp status", "/smcp:status", "routing status", "which providers active", or "agent count". Live data only; reads no state files.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-15
updated: 2026-07-22
---

# subagent-mcp Status

When triggered, call the `get_status` MCP tool and present its live session
state. Use **only** what `get_status` returns. Do not read state files, guess,
or cache: the numbers come from the running MCP server's in-memory state, so a
fresh call each time is the single source of truth. If the `get_status` tool is
not available, say the subagent-mcp MCP server is not connected in this session
and point the user at the `/smcp:doctor` skill.

## Data source

`get_status` returns a JSON object with these fields:

- `providers_loaded` - array of provider names parsed from `providers.jsonc`
  at server start.
- `agent_count` - number of agents launched since this server process started.
- `session_start_time` - ISO timestamp of the MCP server process boot (may be
  null), used to compute uptime.
- `last_routing_decisions` - array of `{ category, provider, timestamp,
  elapsed_ms }`, most recent last, capped at the last 10.
- `swarm` - agentic-swarm session snapshot: `{ active, current_stage,
  stage_name, pin_active, pin_expires_at }`. When `active` is false all other
  swarm fields are null or false.

## Presentation (E1-standardized)

Render uniform, one-item-per-line, plain-ASCII output. No smart quotes, no
emoji, no tables. Use this exact shape:

```
subagent-mcp status
providers_loaded (N): name1, name2, ...
agent_count: K (since session start)
last routing decisions (most recent last):
  1. category=<category> provider=<provider> elapsed_ms=<n>
  2. category=<category> provider=<provider> elapsed_ms=<n>
  3. category=<category> provider=<provider> elapsed_ms=<n>
```

Rules for filling it in:

- `providers_loaded`: print the count then the comma-separated names. If the
  array is empty, print `providers_loaded (0): none loaded`. If you can
  determine reachability (for example from a recent `/smcp:doctor` run in this
  conversation), add a short parenthetical note per provider such as
  `(reachable)` or `(unreachable)`; otherwise omit the note rather than
  guessing - `get_status` alone does not probe reachability.
- `agent_count`: print the integer verbatim. When `session_start_time` is
  present you may add uptime, for example `agent_count: 4 (since session start,
  up 12m)`; if it is null, just print the count.
- last routing decisions: show the **last 3** entries from
  `last_routing_decisions` (the 3 most recent). Number them 1-3 with the oldest
  of the three first and the newest last. If fewer than 3 exist, show what is
  there. If the array is empty, print `last routing decisions: none yet`.

Add a `swarm` line after the routing decisions block:

- When `swarm.active` is true: `swarm: stage <current_stage> of 7 (<stage_name>), pin <active|off>`
- When `swarm.active` is false: `swarm: idle`

`pin` reflects `swarm.pin_active`: print `active` when true, `off` when false.
Do not print `pin_expires_at` unless it adds useful context (for example, if
the user asks how long the pin remains active).

Keep every line plain and aligned by field name so successive status reports
read the same way.
