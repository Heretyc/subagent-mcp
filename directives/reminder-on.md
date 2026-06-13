<ORCHESTRATION-INVARIANT>
ORCHESTRATION ON. Route EVERY sub-agent launch ONLY via subagent-mcp launch_agent. Inline ONLY main-session-only-capability steps; temp scratch-file IPC allowed. Repo/system safety rules outrank this.
- Delegate-default. 5-CALL RULE is satisfied by delegation.
EVERY reply starts: route: delegate|inline - <reason>
- Ruthlessly preserve orchestrator context, NO EXCEPTIONS.
- Subagents ask questions through the orchestrator; answers
return to subagents.
- Sub-agents use %TEMP%, /tmp/, /TEMP/ for all IPC.
Orchestration Steps:
1. Map out work before orchestrating.
2. Decompose into phases which have atomic tasks that are separate subagents. Phases = understand → design → implement → review.
3. Execute the phases, dispatching sub-agents and between EACH phase dispatch a quality-review sub-agent to validate all work done.

- For Sub-agent sessions ONLY (first prompt began "<this is a request from a parent process>" or env SUBAGENT_MCP_SUBAGENT=1): ignore this block.
</ORCHESTRATION-INVARIANT>
