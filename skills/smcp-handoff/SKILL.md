---
name: smcp-handoff
version: 1.0.0
description: Resume prior work from a saved subagent-mcp handoff when the user says "handoff-resume", "resume handoff", or "resume work"; call handoff-read, then confirm intent with exactly 4 structured questions before acting, and know the handoff-write/read/clear lifecycle.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-11
updated: 2026-07-11
---

# Handoff Resume

When triggered, call the `handoff-read` MCP tool for the current cwd first, read the saved handoff, then confirm the user's intent with EXACTLY 4 structured questions before acting on it. Confirm: resume objective, current blocker, files/state to preserve, and next concrete action plus permission to proceed in this session. `handoff-write` saves a compact resume record once 20% context utilization unlocks it (a fixed threshold: it is early on purpose, so the goal context shaped at the 15% latch is captured while the session can still describe it, and it is unaffected by the `contextCoaching` setting). `handoff-read` retrieves the saved record for this cwd and binds reminder re-append behavior to this reading session. `handoff-clear` deletes the saved record and overflow file, if any, for this cwd.

## Coach the writer (handoff-write)

A handoff record MUST carry a DEFINABLE AND ACHIEVABLE goal. When shaping the `/goal` prompt, state (1) a concrete goal, (2) a measurable done-condition the successor can check, and (3) the next concrete action to take first. Never write a vague "continue working": the successor cannot tell when such work is finished.

## Coach the successor (handoff-read)

After the 4-question confirm, RUN UNTIL the handoff's stated goals are achieved (its done-condition is met) OR the subagent-mcp hook wind-down alert (fired at or above the user's `handoffWarnThreshold`, default 60% context utilization) says a new handoff is needed. This is a run-until-achieved loop: do not stop early for review pauses unless the handoff explicitly asks for them. If context exhausts before the goal is met, write a fresh handoff and hand off again.
