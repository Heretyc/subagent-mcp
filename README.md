# subagent-mcp

[![npm version](https://img.shields.io/npm/v/@heretyc/subagent-mcp?label=npm)](https://www.npmjs.com/package/@heretyc/subagent-mcp)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![node](https://img.shields.io/node/v/@heretyc/subagent-mcp)](https://www.npmjs.com/package/@heretyc/subagent-mcp)
[![CI](https://github.com/Heretyc/subagent-mcp/actions/workflows/claude-routine.yml/badge.svg)](https://github.com/Heretyc/subagent-mcp/actions/workflows/claude-routine.yml)

Turn any AI coding assistant into a **manager of other AI agents**. subagent-mcp
lets your Claude Code or Codex session start, watch, message, and stop a whole
team of AI sub-agents — on macOS, Linux, and Windows. **No direct API calls. No
API keys.** It drives the `claude` and `codex` command-line tools you already
signed into.

## What it does

Normally one AI assistant does all the work in one conversation. That
conversation fills up, slows down, and eventually forgets its early context. As
of a certain size it "compacts" — summarizing and dropping detail.

subagent-mcp changes the shape of the work. Your assistant becomes an
**orchestrator**: it hands each task to a fresh sub-agent, watches the results,
and moves on — without ever doing the reading or writing itself.

## Why it works this way

Four bets drive the whole design. The full reasoning lives in
[docs/spec/arch-rationale.md](docs/spec/arch-rationale.md); the short version:

- **The effective memory grows geometrically.** Because the orchestrator only
  ever holds *summaries* of what its sub-agents did — never the raw files — its
  own memory fills up far more slowly. That means **very long tasks with little
  or no compaction**.
- **Mixed providers avoid blind spots.** Using Claude *and* Codex together means
  one vendor's weak spot or outage doesn't blind or block the whole job — and
  you're never locked in to a single vendor.
- **Ruthless token efficiency.** Every hand-off is compressed and every read is
  kept small, so the system stays fast and cheap even on marathon tasks.
- **Durable, authoritative reminders.** The operating rules are re-injected every
  turn through official host hooks, so the assistant doesn't drift off-task or
  start making things up over a long run.

## Install

### What you need first

- Node.js 18 or newer  (`node --version`)
- `claude` CLI — installed and signed in  (`claude --version`)
- `codex` CLI — installed and signed in  (`codex --version`; optional if you
  only use Claude)

Building from source needs extra developer tools — see
[CONTRIBUTING.md](CONTRIBUTING.md).

### Install the package

```bash
npm install -g @heretyc/subagent-mcp
```

This is the standard install for everyone. (Organizations pinning the package
through GitHub Packages should see [docs/registration.md](docs/registration.md).)

### Wire it into your assistant

```bash
subagent-mcp setup
```

Installing the package only ships the program — it does **not** connect anything
on its own. `subagent-mcp setup` finds your Claude Code / Codex install and
registers both the server and the per-turn orchestration hooks. Preview first
with `subagent-mcp setup --dry-run`.

### Restart, then turn on the invariant

Restart your Claude Code or Codex session so it picks up the new tools. On Codex,
run `/hooks` and trust the new hook. Then (recommended):

```bash
subagent-mcp init --global
```

This writes a small managed "always delegate" rule block into your global
assistant config once, so it works across every project. For a single project
instead, use `subagent-mcp init --root /path/to/project`. Full per-platform
wiring (Gemini CLI, Claude Desktop, manual setup) is in
[docs/registration.md](docs/registration.md).

## How to operate it

### Orchestration mode: ON vs OFF

- **ON** — your assistant acts as a pure manager. It never reads or writes files
  directly; it delegates every step to sub-agents. Best for big, long-running
  jobs.
- **OFF** — your assistant works normally, on its own, with no delegation rules.

Flip it with the `orchestration-mode` tool. (Desktop apps can toggle the mode
but don't receive the per-turn hook reminders.)

### The 8 tools at a glance

| Tool | What it does |
|---|---|
| `launch_agent` | Start a sub-agent on a task (just give a prompt + a task category) |
| `poll_agent` | Check how an agent is doing and read its latest output |
| `kill_agent` | Stop a running or quiet agent |
| `send_message` | Send a follow-up message to a live agent |
| `list_agents` | See every agent and its current status |
| `wait` | Pause until a specific agent finishes |
| `orchestration-mode` | Turn manager-mode ON or OFF |
| `model-selection-mode` | Let the server auto-pick the model, or allow manual overrides |

You never have to choose a model. Give `launch_agent` a plain-English prompt and
a **task category** (e.g. "coding", "debugging", "security_review") and the
server picks the best provider, model, and effort for that kind of work.

### How many run at once

There is a single machine-wide limit on how many sub-agents run at the same time
across everything on your computer. The **default is 20**. When the limit is
reached, a new `launch_agent` is turned down right away — it does not wait in a
queue. You change the number in the `global-concurrency.jsonc` file in the
install folder (minimum 10); the file is re-read on every launch, so no restart
is needed.

## Basic debugging

- **"An agent looks stuck."** A quiet agent is usually **still alive**, not
  dead. After ~10 minutes with no output an agent is marked `stalled` — it's
  thinking or waiting on a hand-off. It recovers on its own. **Do not kill a
  stalled agent**, and `wait` will not return on one.
- **"It won't start a new agent (cap reached)."** You've hit the concurrent
  limit. Use `list_agents` to see what's running and `kill_agent` on anything
  you no longer need — that frees a slot immediately. Raising the number in
  `global-concurrency.jsonc` also works.
- **"Where are the logs?"** Each agent's recent output is available any time via
  `poll_agent`. The server's own diagnostics go to your host's normal MCP
  server log (your Claude Code or Codex session logs) — all server logging goes
  to stderr, never mixed into results.

## Documentation

| Document | Contents |
|---|---|
| [docs/spec/arch-rationale.md](docs/spec/arch-rationale.md) | Why it's built this way — the full design rationale |
| [docs/registration.md](docs/registration.md) | Per-platform setup: Claude Code, Codex, Gemini CLI, Claude Desktop |
| [docs/tools.md](docs/tools.md) | Full tool reference — all eight tools, parameters, return shapes |
| [docs/usage.md](docs/usage.md) | Model & effort matrix, ultracode mode, usage examples |
| [docs/SPEC.md](docs/SPEC.md) | Full technical specification |
| [docs/reference/status-lifecycle.md](docs/reference/status-lifecycle.md) | Agent status meanings (processing / stalled / finished / errored / stopped) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developer guide — build, test, publish, contribution workflow |

## License

Apache-2.0 — Copyright 2026 Lexi Blackburn

See [LICENSE](LICENSE).
