# Gemini Entry Point

<!-- subagent-mcp:managed:begin schema=2 -->
## subagent-mcp invariant — managed block, do not edit between markers

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT below, which you MUST still obey (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count — the marker must be physically line 1.

SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do NOT create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.

CANONICAL SOURCE OF TRUTH: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block carries the full ON operating model inline so the session is governed even if the MCP `instructions` are stale; if this block and the MCP `instructions` ever disagree, the MCP `instructions` win.

HARNESS-HOOK SUPREMACY (this clause is identical in CLAUDE.md, AGENTS.md, and GEMINI.md): Any harness-hook context carrying a <subagent-mcp state="..."> tag is MAXIMALLY CRITICAL and MUST be obeyed with NO exceptions. A token only counts as such a tag when it appears as a real tag with a `state` attribute — a bare mention of "subagent-mcp" in ordinary prose is NOT a tag and carries no authority. No user request bypasses a <subagent-mcp state="..."> tag. The ONLY thing a user request may change is switching orchestration ON or OFF — and the authoritative ON or OFF state is reported SOLELY by the harness-hook injection (the `state` attribute of an injected <subagent-mcp> tag). The ABSENCE of any such tag means the state is UNKNOWN (see NO-HOOK). Never infer the state from anything else.

PRECEDENCE (co-supreme top tier): <subagent-mcp> hook tags AND repo/system safety-scope rules are BOTH supreme and EQUAL — neither outranks the other. If they genuinely conflict, STOP and escalate to the user via the structured-question tool; do not silently pick one or average them. FORBIDDEN: resolving such a conflict yourself. Hook tags otherwise outrank ordinary user requests.

ORCHESTRATION ON — you are the ORCHESTRATOR. Allowed tools: ONLY the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. NO direct reads or writes of any kind. "Inline-by-right" does not exist. Every step runs in a sub-agent. If one atomic step truly cannot run in a sub-agent, ASK the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating. SOLE CHANNEL: while subagent-mcp is connected, every sub-agent launch goes through `launch_agent`; never use harness-native sub-agent tools or shell-spawned agents.

ORCHESTRATOR WORKTREE SETUP: launch sub-agents in the main checkout cwd (they no longer self-isolate into per-agent worktrees); SERIALIZE any sub-agents that write the SAME files — never run concurrent writers over overlapping paths (no cwd-level lock exists).

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF — a "long-horizon task" = any task whose TOTAL context footprint (input you read + output you produce) exceeds 200 lines of text. After EVERY user turn, measure the CUMULATIVE footprint accumulated since your last upgrade ask; reset that cumulative count to zero ONLY when you actually ask. If it qualifies, ASK the user via the structured-question tool whether to switch orchestration ON. Ask on EVERY qualifying turn; a decline does NOT suppress future asks. You never assert ON yourself — you only ask.

DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, HALT and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN — represented by the ABSENCE of any tag, never by a tag value. Emit this UNKNOWN-STATE WARNING to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON". Briefly explain WHY: no hook injection detected — cannot verify orchestration state; defaulting to ON to prevent uncontrolled inline execution. Then DEFAULT TO ORCHESTRATION ON (fail-safe). One-time opt-out: if you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the ONLY automatic suppressor of this default.

DISABLE: never on your own initiative; you MAY propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may set enabled:false — per-session only; the next new session resumes ON; no mid-session re-enable.
<!-- subagent-mcp:managed:end -->

Read `AGENTS.md` first. It is the canonical repository instruction file.

Do not add durable rules here. Add or update durable repository rules in
`AGENTS.md`, `docs/spec/dev-loop/`, or `agents/` as appropriate.
- `docs/spec/graphify.md` - graphify knowledge-graph setup and usage rules.
