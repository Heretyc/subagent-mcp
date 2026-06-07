<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<ORCHESTRATION-CARRYOVER priority="CRITICAL" override="NONE">

ORCHESTRATION MODE auto-activated at session start (carried over from prior session for this project; mode persists until disabled with permission). You did NOT enable it.

THIS turn you MUST:
1. NOTIFY user it auto-activated at session start.
2. ASK whether to keep it ON, via request-user-input.
3. ADVISE whether keeping it ON fits user's request this session (long-horizon context-filling work → keep ON; small bounded task → not).

User declines → call orchestration-mode with enabled:false. NEVER disable on own initiative.

</ORCHESTRATION-CARRYOVER>
