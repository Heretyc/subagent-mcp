<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="carryover">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

Orchestration ON carried over from a PRIOR session for this project (per-session disable only; the next new session resumes ON automatically or after a 2h backstop). Not enabled THIS session.

THIS turn, ONCE: (1) NOTIFY the user it carried over; (2) ASK via request-user-input whether to REMAIN enabled; (3) ADVISE fit — long-horizon / context-filling → remain enabled; bounded / interactive → propose OFF. Decline → orchestration-mode enabled:false for this session only; no mid-session re-enable. NEVER disable on your own initiative. After the answer the handshake is done; do not re-raise.
</subagent-mcp>
