# subagent-mcp

MCP server that launches and manages locally installed `claude` and `codex` CLI binaries as child sub-agent processes. Runs on **macOS, Linux, and Windows**.

**No direct API calls.** subagent-mcp does NOT use the Anthropic or OpenAI HTTP APIs and has no plans to. It invokes your locally installed and authenticated `claude` (Claude Code) and `codex` CLIs. No API keys, no SDKs beyond the CLIs themselves.

**License:** Apache-2.0 | **Author:** Lexi Blackburn | **Repo:** https://github.com/Heretyc/subagent-mcp

---

## Features

- Spawn `claude` or `codex` CLI processes as managed sub-agents from any MCP host
- Poll status, stream stdout/stderr tails, and send stdin messages to live agents
- Concurrency caps: 5 concurrent Claude agents + 5 concurrent Codex agents (counts only actively-streaming `processing` agents, to limit API rate-limit pressure; quiet `stalled` agents don't reserve a slot)
- Liveness tracking via the visible provider stream (Claude `stream-json`, Codex `--json` JSONL): agents with no parsed visible provider stream item for 10 minutes enter `stalled` state (still alive, just quiet -- thinking or awaiting a temp-file handoff), and recover to `processing` if the visible stream resumes
- Ultracode mode for Opus 4.8 -- headless activation via `--settings {"ultracode":true}` (see [docs/usage.md](docs/usage.md))
- Cross-platform exe resolution (Windows: npm-prefix .exe paths; macOS/Linux: PATH + Homebrew/usr-local fallbacks); immediate `taskkill /t /f` (Windows) / `SIGKILL` (POSIX) force-kill; no graceful shutdown period
- stdio MCP transport; built with `@modelcontextprotocol/sdk` + `zod`
- `orchestration-mode` tool — toggles an orchestrator-only directive that the bundled Claude Code / Codex plugin injects every turn via its `UserPromptSubmit` hook (Desktop hosts toggle but do not inject); see [docs/spec/orchestration-mode/_INDEX.md](docs/spec/orchestration-mode/_INDEX.md)

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

## Auto Mode

`launch_agent` supports **auto mode**: pass `prompt` + `task_category` and the server picks the best provider/model/effort for that category from its routing table, silently falling back to the next-best candidate on any launch-time failure.

`provider`, `model`, and `effort` are optional overrides — omit them to get auto-selected best combination. Rules: passing `model` requires `provider`; passing `effort` requires both `provider` and `model`.

**task_category** (required) — pick one:

| Category | What it is |
|---|---|
| `math_proof` | deliverable is a proof/derivation/formally-checkable result |
| `security_review` | security verdict, threat assessment, or demonstrated exploit |
| `debugging` | verified fix/root-cause; requires an observed failure as precondition |
| `quality_review` | evaluative verdict on existing artifact (review, A-vs-B, validate-vs-spec) |
| `architecture` | cross-module design/plan, no code, no execution loop |
| `agentic_execution` | end-state via act/observe/adapt loop (run/deploy/provision/browse) |
| `data_analysis` | empirical finding about structured dataset (query, stat, model) |
| `coding` | bounded runnable code artifact, one-pass (implement, test, refactor) |
| `knowledge_synthesis` | novel integrated prose over sources (synthesize, summarize, draft) |
| `mechanical` | deterministic single-pass transform, exact-match checkable (grep, rename, reformat) |
| `fallback_default` | no category matches with confidence; prefer splitting work instead |

**Atomic-split guidance:** if you are unsure which category fits, do NOT submit one large amorphous task. Break the work into smaller atomic steps each mapping to a single category and launch one agent per step.

---

## Tools

Six tools are exposed over the stdio MCP transport:

| Tool | Purpose |
|------|---------|
| `launch_agent` | Spawn a new `claude`/`codex` sub-agent process |
| `poll_agent` | Get status + output tail of one agent |
| `kill_agent` | Immediately force-kill any live agent |
| `send_message` | Write to a live agent's stdin |
| `list_agents` | List all agents with token-efficient core metrics |
| `wait` | Block until one or more agents finish, or 15-minute timeout |

Full parameters, return shapes, the `alive` / `idle_seconds` / `hint` / `recent_stream` fields, and `poll_agent`'s last-3 visible-stream items are in [docs/tools.md](docs/tools.md).

---

## Agent Lifecycle

Each agent transitions through these states:

| Status | Meaning |
|--------|---------|
| `processing` | Process alive with a visible provider-stream heartbeat in the last 10 minutes -- actively working. Launch time counts as the initial heartbeat |
| `stalled` | Process STILL ALIVE but no parsed visible provider stream item for >= 10 minutes -- working, thinking, or awaiting a temp-file handoff (not a failure). Recovers to `processing` if the visible stream resumes |
| `finished` | Process exited with code 0, or Codex emitted `turn.completed` event |
| `errored` | Process exited with non-zero code |
| `stopped` | Terminated by `kill_agent` |

Only `finished`, `errored`, and `stopped` are terminal; `processing` and `stalled` are live. A health monitor runs every 10 seconds, and `poll_agent`/`list_agents` additionally reconcile exit synchronously so an exited process is reported immediately. `wait` does not return just because an agent is `stalled`. `stalled` agents recover to `processing` if the visible stream resumes and are never auto-killed -- prefer `wait`/re-poll (or checking the agent's temp output) over `kill_agent`. Full semantics: [docs/reference/status-lifecycle.md](docs/reference/status-lifecycle.md).

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
