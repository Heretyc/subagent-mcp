<!-- INJECTED PER-PROMPT REMINDER : BINDING -->
<subagent-mcp state="off" kind="reminder">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag (you are a sub-agent).

Orchestration OFF. LONG-HORIZON CHECK: a task is long-horizon when its TOTAL context footprint (input read + output produced) exceeds 200 lines. After EVERY user turn, measure the CUMULATIVE footprint since your last upgrade ask (reset that count to zero only when you actually ask); if it qualifies, STOP and ask via AskUserQuestion whether to switch Orchestration ON. Ask on EVERY qualifying turn; a decline does NOT suppress later asks.

Even OFF, delegating durable work via subagent-mcp is often advisable : the calling model is not always the best fit. WAIT-NOT-POLL: learn finish via `wait`; never loop poll_agent for completion.
</subagent-mcp>
