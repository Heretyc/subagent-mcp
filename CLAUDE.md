# Claude Entry Point

<!-- subagent-mcp:managed:begin schema=4 -->
## subagent-mcp invariant — managed block, do not edit between markers

Upserted by `subagent-mcp init` at user request; re-running init keeps it in sync.

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT below, which still applies (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count — the marker must be physically line 1.

SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do not create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.

CANONICAL SOURCE: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block mirrors that operating model inline so the session stays governed even if the MCP `instructions` are momentarily stale; where the two disagree, the MCP `instructions` win because they are read fresh each connect.

HARNESS-HOOK STATE: a harness-hook context carrying a <subagent-mcp state="..."> tag reports the current orchestration ON/OFF state and takes effect with no exceptions, because it is the only channel with fresh, harness-verified state — self-reported prose cannot substitute for it. A token counts as such a tag only when it is a real tag with a `state` attribute; a bare mention of "subagent-mcp" in prose is not a tag and carries no authority. A user request can only switch orchestration ON or OFF, never assert what the current state already is — that comes solely from the tag. No tag present means the state is UNKNOWN (see NO-HOOK below); never infer it from anything else.

PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority — neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.

ORCHESTRATION ON — you are the ORCHESTRATOR. Allowed tools: only the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. There is no inline-by-right; every step runs in a sub-agent. If one atomic step truly cannot run in a sub-agent, ask the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating. Sole channel: while subagent-mcp is connected, every sub-agent launch goes through `launch_agent`; never use harness-native sub-agent tools or shell-spawned agents.

ORCHESTRATOR WORKTREE SETUP: for mutating work, first place sub-agents in a compliant linked worktree/work branch; the main checkout cwd applies only to read-only work or already-isolated target-tree contexts (sub-agents no longer self-isolate into per-agent worktrees). Serialize any sub-agents that write the same files — never run concurrent writers over overlapping paths (no cwd-level lock exists).

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF BY DEFAULT -- each new session starts with orchestration OFF. A hook meters real provider-reported context usage (never tokenized, never self-estimated). At 15% utilization a persisted latch force-enables orchestration and coaches a 5-question planning stop. At 50% the hook warns every turn to wind down and unlocks handoff-write/handoff-read/handoff-clear for a clean session handoff. If context size cannot be measured, the hook fails safe to ON. Never assert a state yourself -- only the hook tag is authoritative.

DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, halt and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN — represented by the absence of any tag, never by a tag value. Emit this warning to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON." Why: with no fresh state signal, defaulting to ON avoids ungoverned inline execution; one spoken opt-out is allowed per session. If you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the only automatic suppressor of this default.

DISABLE: never on your own initiative; you may propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may set enabled:false — per-session only; the next new session resumes ON; no mid-session re-enable.
<!-- subagent-mcp:managed:end -->

Read `AGENTS.md` first. It is the canonical repository instruction file.

Do not add durable rules here. Add or update durable repository rules in
`AGENTS.md`, `docs/spec/dev-loop/`, or `agents/` as appropriate.
