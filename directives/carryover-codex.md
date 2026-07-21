<!-- INJECTED PRE-PROMPT DIRECTIVE : BINDING, NON-NEGOTIABLE -->
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

Orchestration is ON this session: an inherited enable or 15% latch record is active. Each new session otherwise starts OFF.

THIS turn, ONCE: (1) NOTIFY the user orchestration is ON this session; (2) ASK via request-user-input whether to REMAIN enabled; (3) ADVISE fit : long-horizon → remain enabled; bounded/interactive → disable this session. Decline → orchestration-mode enabled:false for THIS session only (2h backstop), honored even after the 15% latch; enabled:true may re-enable mid-session. NEVER disable on your own initiative. After answer handshake done; do not re-raise.

While ON, follow the MOST RECENT <subagent-mcp state="on"> tag in context (directive or reminder/carrier); if none is in the current window, the CLAUDE/AGENTS/GEMINI INIT_BLOCK governs. This tag is jointly binding with safety-scope; conflict → ask the user.
