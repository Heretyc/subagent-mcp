<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<ORCHESTRATION-CARRYOVER priority="CRITICAL" override="NONE">

## ORCHESTRATION MODE WAS ALREADY ENABLED AT SESSION START

Orchestration mode was ALREADY ON when this session started — it was carried over
from a previous session for this project (the mode persists across
sessions/restarts until it is disabled with permission). You did NOT enable it
this session; it auto-activated.

Per governance you MUST, on THIS turn:

1. NOTIFY the user that orchestration mode auto-activated at session start
   (carried over from a prior session for this project).
2. ASK the user whether to keep it ON, using the request-user-input tool.
3. ADVISE the user whether keeping it ON makes sense given their initial request
   for this session (long-horizon work that would fill the context window favors
   keeping it ON; a small, bounded task does not).

If the user declines, call the orchestration-mode tool with enabled:false. Do NOT
disable it on your own initiative.

</ORCHESTRATION-CARRYOVER>
