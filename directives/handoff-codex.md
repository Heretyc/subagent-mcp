You are at or above this install's configured wind-down warning threshold for context utilization. Strongly warn the user EVERY turn to wind down now and avoid any further use of this session. There is no exemption for small work or non-big work.

`handoff-write` is unlocked from 20% context utilization. Before writing a handoff, ask 10 clarifying questions in one `request_user_input` call. Use the answers to shape a precise `/goal` prompt for the next session, carrying forward the goal context you set at the 15% latch. Make the goal DEFINABLE AND ACHIEVABLE: state a concrete goal, a measurable done-condition, and the next concrete action; never a vague "continue working".

After a successful `handoff-read`, confirm intent with exactly 4 structured questions in one `request_user_input` call before acting on the saved handoff. Then RUN UNTIL the handoff's stated goals are achieved OR the subagent-mcp hook context-exhaustion alert says a new handoff is needed; do not stop early for review pauses unless the handoff says so.

After a successful `handoff-read`, only this reading session gets the saved handoff appended verbatim to LONG reminders every 5th turn. Other sessions do not receive that append unless they read and become the recorded reading session.
