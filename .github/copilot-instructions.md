# Copilot Repository Instructions

subagent-mcp turns a host CLI into an orchestrator for local sub-agent
sessions. It exposes MCP tools such as `launch_agent`, `poll_agent`, `wait`,
`get_status`, `orchestration-mode`, and handoff tools. Provider credentials and
user config live outside the repo.

## Fallback Rule

Use this file when the host reads instruction files but does not load
subagent-mcp skills, hooks, or slash commands. This applies to instruction-tier
fallback use in Gemini CLI, Cursor, Windsurf, Kiro, Copilot, and similar agents.

## Orchestration

- If a `<subagent-mcp state="...">` hook tag is present, treat it as the
  authoritative orchestration state.
- If no hook tag is present, say: `subagent-mcp: no hook injection detected:
  orchestration state unknown; defaulting to ON.`
- When orchestration is ON, use only `launch_agent` for sub-agent work. Do not
  use native agent/task tools or shell-spawned agents.
- Every sub-agent prompt must begin with `<this is a request from a parent
  process>`.
- Sub-agents return JSON with `status`, `summary`, `source_locators`, `risks`,
  and `writes_requested`.

## Read Ladder

1. Use `poll_agent` tail output first.
2. If the tail is insufficient, launch one summarizer sub-agent and trust its
   summary if it is 100 lines or fewer.
3. For larger handoffs, have sub-agents write scratch files and pass file paths
   between them. The orchestrator does not read large files inline.
4. Use `wait` to learn completion. A quiet or stalled agent is still alive.

## Status And Repair

- `/smcp:help`: load `skills/smcp-help/SKILL.md` for install, config, and
  maintenance guidance.
- `/smcp:status`: load `skills/smcp-status/SKILL.md` and call `get_status`.
- `/smcp:doctor`: load `skills/smcp-doctor/SKILL.md`; run `subagent-mcp doctor`
  read-only first and ask before any repair.
- Config commands: `subagent-mcp config init`, `subagent-mcp config validate`,
  `subagent-mcp doctor`, `subagent-mcp upgrade`, `subagent-mcp rollback`.

## Deeper Docs

- Start with `retrieval-map.md` (repo root) to choose the smallest relevant doc.
- Install and host wiring: `docs/registration.md` and `docs/install/`.
- Tool reference: `docs/tools.md`.
- Orchestration model: `docs/spec/dev-loop/orchestration-directive-architecture.md`.
- Safety and clarification rules: `docs/spec/safety-scope.md`.
- Git and worktree rules: `docs/spec/dev-loop/git-collaboration.md` and
  `agents/GIT_COLLABORATION.md`.
