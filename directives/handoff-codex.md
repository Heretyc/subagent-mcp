The runtime prefixes this directive with the current handoff lifecycle state. Act on the prefixed state:

**`write_required`** - Prepare and record a fresh handoff, then keep working in this same session. Do NOT start a new session. First ask 10 clarifying questions in one `request_user_input` call. Use the answers to shape a precise `/goal` prompt for the next session, carrying forward the goal context you set at the 15% latch. Make the goal DEFINABLE AND ACHIEVABLE: state a concrete goal, a measurable done-condition, and the next concrete action; never a vague "continue working". Then call `handoff-write` and continue the task.

**`session_handoff_required`** - Call `handoff-read` before any ordinary task work. After a successful `handoff-read`, confirm intent with exactly 4 structured questions in one `request_user_input` call before acting on the saved handoff. Then resume and RUN UNTIL the handoff's stated goals are achieved OR the subagent-mcp hook context-exhaustion alert says a new handoff is needed; do not stop early for review pauses unless the handoff says so.

`handoff-write` remains voluntarily available from 20% context utilization for goal capture outside these mandatory transitions.

After a successful `handoff-read`, only this reading session gets the saved handoff appended verbatim to LONG reminders every 5th turn. Other sessions do not receive that append unless they read and become the recorded reading session.
