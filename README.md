# subagent-mcp

MCP server that launches and manages locally installed `claude` and `codex` CLI binaries as child sub-agent processes. Runs on **macOS, Linux, and Windows**.

**No direct API calls.** subagent-mcp does NOT use the Anthropic or OpenAI HTTP APIs and has no plans to. It invokes your locally installed and authenticated `claude` (Claude Code) and `codex` CLIs. No API keys, no SDKs beyond the CLIs themselves.

**License:** Apache-2.0 | **Author:** Lexi Blackburn | **Repo:** https://github.com/Heretyc/subagent-mcp

---

## Features

- Spawn `claude` or `codex` CLI processes as managed sub-agents from any MCP host
- Poll status, stream stdout/stderr tails, and send stdin messages to live agents
- Concurrency caps: 5 concurrent Claude agents + 5 concurrent Codex agents (counts only actively-`running` agents, to limit API rate-limit pressure; quiet `processing` agents don't reserve a slot)
- Liveness tracking: agents with no output for 60 seconds enter `processing` state (still alive, just quiet -- thinking or awaiting a temp-file handoff), and recover to `running` if output resumes
- Ultracode mode for Opus 4.8 -- headless activation via `--settings {"ultracode":true}` (see [docs/usage.md](docs/usage.md))
- Cross-platform exe resolution (Windows: npm-prefix .exe paths; macOS/Linux: PATH + Homebrew/usr-local fallbacks); SIGTERM/taskkill kill flow
- stdio MCP transport; built with `@modelcontextprotocol/sdk` + `zod`

---

## Quick Start

**Prerequisites:** Node.js >= 18, plus the `claude` and `codex` CLIs installed globally, authenticated, and on `PATH`. See [docs/registration.md](docs/registration.md) for full per-platform setup.

```bash
git clone https://github.com/Heretyc/subagent-mcp
cd subagent-mcp
npm install
npm run build
```

The server entry point after build is `dist/index.js`. Register it with Claude Code (macOS / Linux example):

```bash
claude mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

On Windows, quote the absolute path to `dist\index.js`. For Codex, Gemini, `.mcp.json`, Claude Desktop config paths, and Windows specifics, see [docs/registration.md](docs/registration.md).

---

## Tools

Six tools are exposed over the stdio MCP transport:

| Tool | Purpose |
|------|---------|
| `launch_agent` | Spawn a new `claude`/`codex` sub-agent process |
| `poll_agent` | Get status + output tail of one agent |
| `kill_agent` | Terminate a running agent (SIGTERM then force-kill) |
| `send_message` | Write to a running agent's stdin |
| `list_agents` | List all agents and their statuses |
| `wait` | Block until one or more agents finish, or 15-minute timeout |

Full parameters, return shapes, and the new `alive` / `idle_seconds` / `hint` fields are in [docs/tools.md](docs/tools.md).

---

## Agent Lifecycle

Each agent transitions through these states:

| Status | Meaning |
|--------|---------|
| `running` | Process is alive and produced output recently (< 60s ago) |
| `processing` | Process is STILL ALIVE but has produced no stdout/stderr for >= 60s -- working, thinking, or awaiting a temp-file handoff (renamed from `stalled`; not a failure). Recovers to `running` if output resumes |
| `completed` | Process exited with code 0, or Codex emitted `turn.completed` event |
| `failed` | Process exited with non-zero code |
| `killed` | Terminated by `kill_agent` |

Only `completed`, `failed`, and `killed` are terminal; `running` and `processing` are live. A health monitor runs every 10 seconds, and `poll_agent`/`list_agents` additionally reconcile exit synchronously so an exited process is reported immediately. `processing` agents recover to `running` if output resumes and are never auto-killed -- prefer `wait`/re-poll (or checking the agent's temp output) over `kill_agent`. Full semantics: [docs/reference/status-lifecycle.md](docs/reference/status-lifecycle.md).

---

## Documentation

- [docs/registration.md](docs/registration.md) -- per-platform registration (Claude Code, Codex, Gemini), prerequisites, install, config paths.
- [docs/tools.md](docs/tools.md) -- full Tool Reference for all six tools, including `alive` / `idle_seconds` / `hint` fields.
- [docs/usage.md](docs/usage.md) -- model & effort matrix, ultracode mechanism, underlying CLI invocations, usage examples.
- [docs/SPEC.md](docs/SPEC.md) -- full technical specification (architecture, schemas, status lifecycle, error catalogue).

---

## License

Apache-2.0 -- Copyright 2026 Lexi Blackburn

See [docs/SPEC.md](docs/SPEC.md) for the full technical specification.
