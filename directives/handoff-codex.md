You are at or above 50% context utilization. Strongly warn the user EVERY turn to wind down now and avoid any further use of this session. There is no exemption for small work or non-big work.

`handoff-write` is unlocked from 40% context utilization. Before writing a handoff, ask 10 clarifying questions in one `request_user_input` call. Use the answers to shape a precise `/goal` prompt for the next session.

After a successful `handoff-read`, confirm intent with exactly 4 structured questions in one `request_user_input` call before acting on the saved handoff.

After a successful `handoff-read`, only this reading session gets the saved handoff appended verbatim to LONG reminders every 5th turn. Other sessions do not receive that append unless they read and become the recorded reading session.
