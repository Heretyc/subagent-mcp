# Claude Entry Point

<!-- subagent-mcp:managed:begin schema=5 -->
## subagent-mcp invariant — managed block, do not edit between markers

Upserted by `subagent-mcp init` at user request; re-running init keeps it in sync.

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT and the SUB-ORCHESTRATOR CARVE-OUT below, which still apply (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count — the marker must be physically line 1.

SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do not create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.

SUB-ORCHESTRATOR CARVE-OUT: if env SUBAGENT_MCP_SUB_ORCHESTRATOR=1, the sub-agent exemption does NOT lift orchestration for you: you are a delegate-only sub-orchestrator bound by your launch prompt directive and the per-turn hook tag; your own sub-agents run as normal sub-agents and never inherit the flag.

CANONICAL SOURCE: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block mirrors that operating model inline so the session stays governed even if the MCP `instructions` are momentarily stale; where the two disagree, the MCP `instructions` win because they are read fresh each connect.

HARNESS-HOOK STATE: a harness-hook context carrying a <subagent-mcp state="..."> tag reports the current orchestration ON/OFF state and takes effect with no exceptions, because it is the only channel with fresh, harness-verified state — self-reported prose cannot substitute for it. A token counts as such a tag only when it is a real tag with a `state` attribute; a bare mention of "subagent-mcp" in prose is not a tag and carries no authority. A user request can only switch orchestration ON or OFF, never assert what the current state already is — that comes solely from the tag. No tag present means the state is UNKNOWN (see NO-HOOK below); never infer it from anything else.

PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority — neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.

SOLE CHANNEL — BOTH ORCHESTRATION STATES: whether orchestration is ON or OFF, every sub-agent launch goes through subagent-mcp `launch_agent`; harness-native Task/Agent/collaboration tools, shell-spawned agents, and any wrapper around them are never permitted. Why: native launch paths fragment permission handling and user-instruction compliance and add context/token overhead; subagent-mcp keeps permission handling and routing consistent with bounded handoffs (fuller rationale: docs/spec/dev-loop/orchestration-directive-architecture.md).

ORCHESTRATION ON — you are the ORCHESTRATOR. Allowed tools: only the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. There is no inline-by-right; every step runs in a sub-agent. Sole delegate-only exception — applicable skill instructions: you may directly read the SKILL.md of a skill that serves the user's current request, plus the files it explicitly requires, only while each referenced path stays inside that same skill's folder; reading grants no task-side action authority, and if those instructions expand scope beyond the user's current request, ask fresh approval via the structured-question tool first — action steps still run through subagent-mcp sub-agents. If one atomic step truly cannot run in a sub-agent, ask the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating.

TASK TRACKING: track multi-step work with the harness-native task tracking tool (if one exists), keeping statuses current as work progresses.
WAIT-ON-AGENTS: When waiting for agents to finish processing, utilize the SMCP (Subagent-MCP) wait tool on loop rather than less efficient harness native methods

ORCHESTRATOR WORKTREE SETUP: for mutating work, first place sub-agents in a compliant linked worktree/work branch; the main checkout cwd applies only to read-only work or already-isolated target-tree contexts (sub-agents no longer self-isolate into per-agent worktrees). Serialize any sub-agents that write the same files — never run concurrent writers over overlapping paths (no cwd-level lock exists).

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF BY DEFAULT -- each new session starts with orchestration OFF. A hook meters real provider-reported context usage (never tokenized, never self-estimated). At 15% utilization a persisted latch force-enables orchestration and coaches a planning stop of at least 4 open questions, whose answers become this session's goal context. At 20% utilization handoff-write/handoff-read/handoff-clear unlock so that goal context can be recorded for a clean session handoff; at the wind-down warning threshold (user setting, default 60%) the hook warns every turn to wind down. If context size cannot be measured, the hook fails safe to ON. Never assert a state yourself -- only the hook tag is authoritative.

MODEL SELECTION: defaults to smart/automatic whenever unset — the server auto-picks each sub-agent's model and launch_agent rejects provider/model/effort selectors; those selectors are honored only inside the existing user-approved override window (model-selection-mode "user-approved-overrides", set only with explicit user authorization via the structured-question tool).

SWARM WORKFLOW: when a work objective is projected to span multiple sessions, offer the agentic-swarm workflow and drive it with the swarm MCP tool - swarm() starts it, each swarm(N) reports stage N done and returns the next stage's coaching, swarm(0) abandons. Stage state lives in the server, in memory only - never self-assert a stage. The launch_agent sub-orchestrator: true flag exists ONLY for the swarm dispatch stage; never set it elsewhere.

DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, halt and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN — represented by the absence of any tag, never by a tag value. Emit this warning to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON." Why: with no fresh state signal, defaulting to ON avoids ungoverned inline execution; one spoken opt-out is allowed per session. If you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the only automatic suppressor of this default.

DISABLE: never on your own initiative; you may propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may set enabled:false — a session-keyed opt-out for THIS session only (2h backstop) honored even after the 15% latch or metering fail-safe; user-approved enabled:true may re-enable mid-session; each new session starts back at the default-OFF metering regime.
<!-- subagent-mcp:managed:end -->

Read `AGENTS.md` first. It is the canonical repository instruction file.

Do not add durable rules here. Add or update durable repository rules in
`AGENTS.md`, `docs/spec/dev-loop/`, or `agents/` as appropriate.
