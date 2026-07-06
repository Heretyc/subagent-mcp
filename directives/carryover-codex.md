<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="carryover">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

Orchestration ON carried over from a PRIOR session for this project (per-session disable; next session resumes ON, or after a 2h backstop). Not enabled THIS session.

THIS turn, ONCE: (1) NOTIFY the user it carried over; (2) ASK via request-user-input whether to REMAIN enabled; (3) ADVISE fit — long-horizon → remain enabled; bounded/interactive → disable this session. Decline → orchestration-mode enabled:false this session only; no mid-session re-enable. NEVER disable on your own initiative. After answer handshake done; do not re-raise.

While ON, follow the MOST RECENT <subagent-mcp state="on"> tag in context (directive or reminder/carrier); if none is in the current window, the CLAUDE/AGENTS/GEMINI INIT_BLOCK governs. This tag is jointly binding with safety-scope; conflict → ask the user.
</subagent-mcp>
