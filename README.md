# subagent-mcp

MCP server that launches and manages always-interactive Claude Code and Codex sub-agent sessions. Runs on **macOS, Linux, and Windows**.

**No direct API calls.** subagent-mcp does NOT use the Anthropic or OpenAI HTTP APIs and has no plans to. Claude sessions use the Claude Agent SDK against your local Claude Code executable; Codex sessions use your local `codex app-server`. No API keys.

**License:** Apache-2.0 | **Author:** Lexi Blackburn | **Repo:** https://github.com/Heretyc/subagent-mcp

---

## Features

- Start Claude or Codex interactive sessions as managed sub-agents from any MCP host
- Poll status, stream stdout/stderr tails, and enqueue follow-up messages to live sessions
- Concurrency caps: 5 concurrent Claude agents + 5 concurrent Codex agents (counts only actively-streaming `processing` agents, to limit API rate-limit pressure; quiet `stalled` agents don't reserve a slot)
- Liveness tracking via the visible provider stream (Claude SDK events, Codex app-server JSONL): agents with no parsed visible provider stream item for 10 minutes enter `stalled` state (still alive, just quiet -- thinking or awaiting a temp-file handoff), and recover to `processing` if the visible stream resumes
- Ultracode mode for Opus 4.8 -- headless activation via `--settings {"ultracode":true}` (see [docs/usage.md](docs/usage.md))
- Cross-platform exe resolution (Windows: npm-prefix .exe paths; macOS/Linux: PATH + Homebrew/usr-local fallbacks); immediate `taskkill /t /f` (Windows) / `SIGKILL` (POSIX) force-kill; no graceful shutdown period
- stdio MCP transport; built with `@modelcontextprotocol/sdk` + `zod`
- `orchestration-mode` tool — toggles orchestrator directives injected by bundled Claude Code / Codex hooks; Claude also gets a deterministic `PreToolUse` gate (Desktop hosts toggle but do not inject); see [docs/spec/orchestration-mode/_INDEX.md](docs/spec/orchestration-mode/_INDEX.md)

---

## Quick Start

**Prerequisites:** Node.js >= 18, plus the `claude` and/or `codex` CLIs installed globally and authenticated.

Installed via [GitHub Packages](https://github.com/Heretyc/subagent-mcp/pkgs/npm/subagent-mcp). One-time `.npmrc` setup required (GitHub Packages requires auth even for public packages):

```bash
# 1. Configure registry for @heretyc scope (once per machine)
echo "@heretyc:registry=https://npm.pkg.github.com" >> ~/.npmrc

# 2. Authenticate — use a classic PAT with read:packages scope
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc

# 3. Install and wire
npm install -g @heretyc/subagent-mcp
subagent-mcp setup
```

`setup` detects which vendors are present, registers the MCP server, and writes orchestration-mode hooks. Idempotent — safe to re-run after updates. Pass `--dry-run` to preview.

For consumer projects, run `subagent-mcp init --root /path/to/project` to upsert
the managed invariant block into `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`.
Use `--dry-run` to preview, `--remove` to uninstall the block, and `--force`
only if you intentionally run inside this source repo.

To install the block into the providers' **official global user-config files**
instead — `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md` —
run `subagent-mcp init --global`. It honors `--dry-run`/`--remove`/`--force`
and is mutually exclusive with `--root`/`--files`/`--copilot`/`--cursor`. See
[docs/registration.md](docs/registration.md).

After setup, restart your Claude Code or Codex session. On Codex, run `/hooks` and trust the new hook.

**Updating:** `subagent-mcp update && subagent-mcp setup`

For manual wiring, developer install from source, Gemini CLI, and Claude Desktop, see [docs/registration.md](docs/registration.md).

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
| `prompt_engineering` | designed/optimized prompt or prompt-system steering an LLM/agent (composite-inferred) |
| `vulnerability_research` | discovery + PoC of a novel vulnerability (composite-inferred) |
| `molecular_biology` | reasoned molecular/computational-biology result over sequences, structures, or -omics data (composite-inferred) |
| `ml_accelerator_design` | hardware/software design for ML acceleration — dataflow, kernel, roofline (composite-inferred) |
| `fallback_default` | no category matches with confidence; prefer splitting work instead |

The last four are **composite-inferred**: they carry no dedicated benchmark and their routing competency is composed from parent categories rather than measured directly.

**Atomic-split guidance:** if you are unsure which category fits, do NOT submit one large amorphous task. Break the work into smaller atomic steps each mapping to a single category and launch one agent per step.

---

## Tools

Six tools are exposed over the stdio MCP transport:

| Tool | Purpose |
|------|---------|
| `launch_agent` | Start a new `claude`/`codex` sub-agent session |
| `poll_agent` | Get status + output tail of one agent |
| `kill_agent` | Immediately force-kill any live agent |
| `send_message` | Enqueue a user message on a live session |
| `list_agents` | List all agents with token-efficient core metrics |
| `wait` | Block until one or more agents finish, or 15-minute timeout |

Full parameters, return shapes, the `alive` / `idle_seconds` / `hint` / `recent_stream` fields, and `poll_agent`'s last-3 visible-stream items are in [docs/tools.md](docs/tools.md).

---

## Agent Lifecycle

Each agent transitions through these states:

| Status | Meaning |
|--------|---------|
| `processing` | Driver alive with a visible provider-stream heartbeat in the last 10 minutes -- actively working. Launch time counts as the initial heartbeat |
| `stalled` | Driver STILL ALIVE but no parsed visible provider stream item for >= 10 minutes -- working, thinking, or awaiting a temp-file handoff (not a failure). Recovers to `processing` if the visible stream resumes |
| `finished` | Current turn completed, or driver exited with code 0 |
| `errored` | Process exited with non-zero code |
| `stopped` | Terminated by `kill_agent` |

`processing` and `stalled` are live. `finished` is reportable for `wait`; if `alive` is still true, `send_message` can start the next turn on the same session. A health monitor runs every 10 seconds, and `poll_agent`/`list_agents` additionally reconcile driver exit synchronously. `wait` does not return just because an agent is `stalled`. `stalled` agents recover to `processing` if the visible stream resumes and are never auto-killed -- prefer `wait`/re-poll over `kill_agent`. Full semantics: [docs/reference/status-lifecycle.md](docs/reference/status-lifecycle.md).

---

## Documentation

- [docs/registration.md](docs/registration.md) -- per-platform registration (Claude Code, Codex, Gemini), prerequisites, install, config paths.
- [docs/tools.md](docs/tools.md) -- full Tool Reference for all six tools, including `alive` / `idle_seconds` / `hint` fields.
- [docs/usage.md](docs/usage.md) -- model & effort matrix, ultracode mechanism, underlying CLI invocations, usage examples.
- [docs/SPEC.md](docs/SPEC.md) -- full technical specification (architecture, schemas, status lifecycle, error catalogue).
- [docs/spec/interactive-drivers.md](docs/spec/interactive-drivers.md) -- always-interactive Claude/Codex driver model.
- [docs/release-notes.md](docs/release-notes.md) -- operator-facing release notes (current: **v2.9.0**).

---

## License

Apache-2.0 -- Copyright 2026 Lexi Blackburn

See [docs/SPEC.md](docs/SPEC.md) for the full technical specification.
