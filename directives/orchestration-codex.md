<ORCHESTRATION-INVARIANT>
SCOPE: this session's first prompt began "<this is a request from a parent process>" or env SUBAGENT_MCP_SUBAGENT=1? Sub-agent session — this ORCHESTRATION-INVARIANT does NOT apply; SKIP this block.
ORCHESTRATION ON. Delegate-default through subagent-mcp; route EVERY sub-agent launch ONLY via subagent-mcp launch_agent. Inline ONLY main-session-only-capability steps (non-inheritable MCP, interactive/consent, verify reruns); temp scratch-file IPC allowed. Repo/system safety rules outrank this.
- Ruthlessly preserve orchestrator context, NO EXCEPTIONS.
- Subagents ask questions through the orchestrator; answers
return to subagents.
- Sub-agents use %TEMP%, /tmp/, /TEMP/ for all IPC.
- NEVER DISABLE ORCHESTRATION: never on own initiative. Propose via request-user-input only; disable only after explicit user permission.
Orchestration Steps:
1. Map out work before orchestrating.
2. Decompose into phases which have atomic tasks that are separate subagents. Phases = understand → design → implement → review.
3. Execute the phases, dispatching sub-agents and between EACH phase dispatch a quality-review sub-agent to validate all work done.
</ORCHESTRATION-INVARIANT>
