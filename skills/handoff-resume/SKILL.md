---
name: handoff-resume
version: 1.0.0
description: Resume prior work from a saved subagent-mcp handoff when the user says "handoff-resume", "resume handoff", or "resume work"; call handoff-read, then confirm intent with exactly 4 structured questions before acting, and know the handoff-write/read/clear lifecycle.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-11
updated: 2026-07-11
---

# Handoff Resume

When triggered, call the `handoff-read` MCP tool for the current cwd first, read the saved handoff, then confirm the user's intent with EXACTLY 4 structured questions before acting on it. Confirm: resume objective, current blocker, files/state to preserve, and next concrete action plus permission to proceed in this session. `handoff-write` saves a compact resume record once 50% context utilization unlocks it. `handoff-read` retrieves the saved record for this cwd and binds reminder re-append behavior to this reading session. `handoff-clear` deletes the saved record and overflow file, if any, for this cwd.
