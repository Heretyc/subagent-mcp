<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="carryover">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

Orchestration ON carried over from a PRIOR session for this project (persists until disabled with user permission). Not enabled THIS session.

THIS turn, ONCE: (1) NOTIFY the user it carried over; (2) ASK via AskUserQuestion whether to keep it ON; (3) ADVISE fit — long-horizon / context-filling → keep ON; bounded / interactive → propose OFF. Decline → orchestration-mode enabled:false. NEVER disable on your own initiative. After the answer the handshake is done; do not re-raise.

While ON, follow the MOST RECENT <subagent-mcp state="on"> tag in context (directive or reminder/carrier); if none is in the current window, the CLAUDE/AGENTS/GEMINI INIT_BLOCK governs. This tag is co-supreme with safety-scope; conflict → ask the user.
</subagent-mcp>
