# subagent-mcp

[![npm version](https://img.shields.io/npm/v/@heretyc/subagent-mcp?label=npm)](https://www.npmjs.com/package/@heretyc/subagent-mcp)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![node](https://img.shields.io/node/v/@heretyc/subagent-mcp)](https://www.npmjs.com/package/@heretyc/subagent-mcp)
[![CI](https://github.com/Heretyc/subagent-mcp/actions/workflows/claude-routine.yml/badge.svg)](https://github.com/Heretyc/subagent-mcp/actions/workflows/claude-routine.yml)

## Core premise

subagent-mcp is an MCP (stdio) server that turns any AI coding assistant
(Claude Code, Codex, Gemini CLI) into a **manager/orchestrator of a team of
AI sub-agents** running on macOS, Linux, and Windows. It drives the locally
authenticated `claude` and `codex` CLIs you already signed into — **no direct
HTTP API calls and no API keys, ever** (an explicit, permanent non-goal). It
serves developers running big, long-horizon coding jobs who want to escape a
single conversation's context limits and vendor lock-in.

Its central promise: the orchestrator **monitors but never reads or writes
files itself** — every step is delegated to a fresh sub-agent, so the
orchestrator's context fills only with ≤100-line summaries. This extends
effective context "geometrically" instead of linearly, enabling marathon tasks
with little or no compaction. Guarantees/invariants it promises: a single
machine-global, provider-agnostic concurrency cap (default 20, min 10; rejects
at cap, never queues); fail-safe **ON** on hosts lacking hooks (unknown
orchestration state defaults to ON); orchestration state is authoritative only
via harness-verified `<subagent-mcp state="...">` hook tags, never inferred from
prose (guards against directive drift/hallucination); sub-agents run **gated by
default** (permission ceiling `auto`); and automatic model/provider/effort
routing per task category so the user never picks a model.

## Key problems it solves

- **Context exhaustion / compaction on long tasks** — delegate-only
  orchestration keeps the manager's context holding summaries, not raw files,
  so long jobs run with minimal compaction.
- **Single-vendor blind spots and lock-in** — mixed Claude + Codex (provider-
  agnostic) operation means one vendor's weakness or outage doesn't blind or
  block the whole job.
- **No API keys / no direct API calls** — drives locally signed-in vendor CLIs
  instead of the Anthropic/OpenAI HTTP APIs, avoiding key management and cost of
  a gateway.
- **Directive drift & hallucination over long runs** — operating rules are
  re-injected redundantly (MCP `instructions`, INIT_BLOCK, per-turn hooks,
  managed AGENTS.md/CLAUDE.md/GEMINI.md blocks) and made authoritative via
  harness-verified state tags.
- **Model-selection burden** — a benchmark-derived routing table auto-picks
  provider/model/effort from a plain-English prompt + task category.
- **Uncontrolled/unsafe sub-agent actions** — a shared permission engine gates
  sub-agent operations (SAFE→allow, DANGER→deny, NEUTRAL→park for a decision)
  with `auto`/`manual`/`yolo` ceilings and one-time `respond_permission`.
- **Runaway fan-out / resource contention** — one machine-wide concurrency cap
  and worktree isolation (branch-per-task) with a first-line sub-agent
  carve-out to prevent fork-bomb recursion.
- **Orchestrator observability** — a fixed set of tools (launch/poll/kill/
  send_message/list/wait/respond_permission + orchestration & model modes) plus
  a status lifecycle (processing/stalled/finished/errored/stopped/
  zombie_killed/permission_requested) so a quiet agent isn't mistaken for dead.

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

### The 9 tools at a glance

| Tool | What it does |
|---|---|
| `launch_agent` | Start a sub-agent on a task (just give a prompt + a task category) |
| `poll_agent` | Check how an agent is doing and read its latest output |
| `kill_agent` | Stop a running or quiet agent |
| `send_message` | Send a follow-up message to a live agent |
| `list_agents` | See every agent and its current status |
| `wait` | Pause until a specific agent finishes |
| `respond_permission` | Approve or deny a sub-agent's parked permission request |
| `orchestration-mode` | Turn manager-mode ON or OFF |
| `model-selection-mode` | Let the server auto-pick the model, or allow manual overrides |

You never have to choose a model. Give `launch_agent` a plain-English prompt and
a **task category** (e.g. "coding", "debugging", "security_review") and the
server picks the best provider, model, and effort for that kind of work.

### How many run at once

There is a single machine-wide limit on how many sub-agents run at the same time
across everything on your computer. The **default is 20**. When the limit is
reached, a new `launch_agent` is turned down right away — it does not wait in a
queue. You change the number in the `global-subagent-mcp-config.jsonc` file in
the install folder (minimum 10); the file is re-read on every launch, so no
restart is needed.

> **Renamed in 2.12.5:** this file was `global-concurrency.jsonc`. The old name
> is still read (with a one-time deprecation notice) when the new file is absent,
> for one major version. Rename it yourself when convenient — nothing auto-renames
> it.

The same settings file includes `checkForUpdates` (default `true`). When a newer
npm version exists, the per-turn hook can show a throttled notice to run
`subagent-mcp update` and then `subagent-mcp setup`. Set `checkForUpdates` to
`false`, or run with `SUBAGENT_UPDATE_CHECK=0` / `false`, to disable that check.

## Permissions

Launched sub-agents run **gated** by default (new in 2.12.5). Set
`permissionsCeiling` in `global-subagent-mcp-config.jsonc`:

| Mode | What a sub-agent can do |
|---|---|
| `auto` | **Default.** Safe reads auto-allow, dangerous actions auto-deny, everything else parks for your decision. |
| `manual` | Same, but *every* non-denied action parks for a decision — nothing auto-allows. |
| `yolo` | No gating at all — the pre-2.12.5 behavior. |

When a sub-agent's action parks, its status becomes `permission_requested` and it
shows up in `poll_agent`/`list_agents` and returns early from `wait`. Answer it
with the **`respond_permission`** tool:

```
respond_permission(agent_id="…", decision="allow" | "deny", reason="…")
```

One-time only (no session-wide grants). Omit `request_id` to answer the oldest
pending request. Unanswered requests auto-deny after 5 minutes; the sub-agent
keeps running either way. Full spec: [docs/spec/permissions.md](docs/spec/permissions.md).

## Basic debugging

- **"An agent looks stuck."** A quiet agent is usually **still alive**, not
  dead. After ~10 minutes with no output an agent is marked `stalled` — it's
  thinking or waiting on a hand-off. It recovers on its own. **Do not kill a
  stalled agent**, and `wait` will not return on one.
- **"It won't start a new agent (cap reached)."** You've hit the concurrent
  limit. Use `list_agents` to see what's running and `kill_agent` on anything
  you no longer need — that frees a slot immediately. Raising the number in
  `global-subagent-mcp-config.jsonc` also works.
- **"Where are the logs?"** Each agent's recent output is available any time via
  `poll_agent`. The server's own diagnostics go to your host's normal MCP
  server log (your Claude Code or Codex session logs) — all server logging goes
  to stderr, never mixed into results.

## Documentation

| Document | Contents |
|---|---|
| [docs/spec/arch-rationale.md](docs/spec/arch-rationale.md) | Why it's built this way — the full design rationale |
| [docs/registration.md](docs/registration.md) | Per-platform setup: Claude Code, Codex, Gemini CLI, Claude Desktop |
| [docs/tools.md](docs/tools.md) | Full tool reference — all nine tools, parameters, return shapes |
| [docs/usage.md](docs/usage.md) | Model & effort matrix, ultracode mode, usage examples |
| [docs/SPEC.md](docs/SPEC.md) | Full technical specification |
| [docs/spec/permissions.md](docs/spec/permissions.md) | Permission system — ceiling modes, shared engine, threat model |
| [docs/reference/status-lifecycle.md](docs/reference/status-lifecycle.md) | Agent status meanings (processing / stalled / finished / errored / stopped / permission_requested) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developer guide — build, test, publish, contribution workflow |

## License

Apache-2.0 — Copyright 2026 Lexi Blackburn

See [LICENSE](LICENSE).
