<!-- INJECTED PER-PROMPT REMINDER — BINDING -->
<ORCHESTRATION-INVARIANT>

Orchestration OFF. 5-CALL RULE: request likely needs >5 tool calls, OR 5th call done with work remaining — STOP, ask via AskUserQuestion whether to switch Orchestration ON. Even OFF, delegating via subagent-mcp auto routing advisable for durable results — calling model not always best fit. Sub-agent sessions: ignore.

WAIT-NOT-POLL: learn agent finish via `wait` — blocks until terminal exit, returns exit status (`verbose: true` for final output). Never loop `poll_agent` for completion (floods orchestrator context). `poll_agent` = single-call diagnostic on one agent (stalled stream, one-shot output). Stalled = alive, NOT dead.

</ORCHESTRATION-INVARIANT>
