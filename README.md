# subagent-mcp

[![npm version](https://img.shields.io/npm/v/@heretyc/subagent-mcp?label=npm)](https://www.npmjs.com/package/@heretyc/subagent-mcp)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![node](https://img.shields.io/node/v/@heretyc/subagent-mcp)](https://www.npmjs.com/package/@heretyc/subagent-mcp)
[![CI](https://github.com/Heretyc/subagent-mcp/actions/workflows/claude-routine.yml/badge.svg)](https://github.com/Heretyc/subagent-mcp/actions/workflows/claude-routine.yml)

MCP server that launches and manages always-interactive Claude Code and Codex sub-agent sessions — on macOS, Linux, and Windows. No direct API calls. No API keys.

## Install

### Prerequisites (runtime)

To run the published CLI you need:

- Node.js >= 18  (`node --version`)
- `claude` CLI — globally installed and authenticated  (`claude --version`)
- `codex` CLI — globally installed and authenticated  (`codex --version`; optional if you only use Claude paths)

Building from source needs additional developer tooling — see [CONTRIBUTING.md § Prerequisites](CONTRIBUTING.md#prerequisites).

### npmjs (default)

No authentication, no `.npmrc` configuration, and no PAT required. The package is publicly available on [npmjs.com](https://www.npmjs.com/package/@heretyc/subagent-mcp).

```bash
npm install -g @heretyc/subagent-mcp
```

**Use this path for all standard installs.**

### GitHub Packages (org-internal pin / supply-chain auditing)

Use this path when your organization's `.npmrc` already routes the `@heretyc` scope through GitHub Packages, when you need supply-chain audit tracing against the org-internal artifact, or when you run inside a GitHub Actions workflow whose `GITHUB_TOKEN` carries `read:packages`. Otherwise prefer npmjs above — it is simpler and needs no credentials.

```bash
# One-time machine setup
echo "@heretyc:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> ~/.npmrc
# PAT must be a classic PAT with the read:packages scope

npm install -g @heretyc/subagent-mcp
```

> **Note:** GitHub Packages requires authentication even for public packages. If you see `401 Unauthorized`, verify your PAT has the `read:packages` scope and has not expired. GitHub Packages does not render a README page — the live documentation appears on [npmjs.com](https://www.npmjs.com/package/@heretyc/subagent-mcp).

## Quick Start

**1. Install** (see [Install](#install) above):

```bash
npm install -g @heretyc/subagent-mcp
```

**2. Register the MCP server + orchestration hooks:**

```bash
subagent-mcp setup
```

Installing the package only ships the binary — it does **not** auto-wire anything. `subagent-mcp setup` auto-detects Claude Code / Codex and registers the MCP server plus the per-turn orchestration-mode hooks. Preview with `subagent-mcp setup --dry-run`.

**3. Restart your host.**

Restart your Claude Code or Codex session so it picks up the new binary. On Codex, run `/hooks` and trust the new hook.

**4. Initialize the orchestration invariant (recommended):**

```bash
subagent-mcp init --global
```

`init --global` writes the managed invariant block into the providers' official global user-config files — `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md` — set up once, works across every project. For a single project instead, use `subagent-mcp init --root /path/to/project` to write into that project's instruction files. `--global` and `--root` are mutually exclusive.

For manual wiring, Gemini CLI, Claude Desktop, and developer install from source, see [docs/registration.md](docs/registration.md).

## Features

- Start Claude or Codex interactive sessions as managed sub-agents from any MCP host
- Poll status, stream stdout/stderr tails, and enqueue follow-up messages to live sessions
- Concurrency caps: 5 concurrent Claude + 5 concurrent Codex agents (only `processing` agents count toward the cap; `stalled` agents do not hold a slot)
- Liveness tracking via the visible provider stream (Claude SDK events, Codex app-server JSONL): agents with no parsed visible provider stream item for 10 minutes enter `stalled` state (still alive, just quiet — thinking or awaiting a temp-file handoff), and recover to `processing` if the visible stream resumes
- Ultracode mode for Opus 4.8 via `--settings {"ultracode":true}` — see [docs/usage.md](docs/usage.md)
- Cross-platform exe resolution (Windows: npm-prefix .exe paths; macOS/Linux: PATH + Homebrew/usr-local fallbacks); immediate `taskkill /t /f` (Windows) / `SIGKILL` (POSIX) force-kill; no graceful shutdown period
- stdio MCP transport; built with `@modelcontextprotocol/sdk` + `zod`
- `orchestration-mode` tool — toggles orchestrator directives injected by bundled Claude Code / Codex hooks; Claude also gets a deterministic `PreToolUse` gate

## Orchestration Mode

**ON:** the agent operates as an orchestrator — hook injection governs each session turn, preventing inline reads or writes, and all work is delegated through sub-agent tools.

**OFF:** the agent operates normally, with no orchestration constraints.

Toggle with the `orchestration-mode` tool. Desktop hosts toggle the mode but receive no hook injection. See [docs/spec/dev-loop/orchestration-directive-architecture.md](docs/spec/dev-loop/orchestration-directive-architecture.md) for full semantics.

## Auto Mode

`launch_agent` supports **auto mode**: pass `prompt` + `task_category` and the server picks the best provider/model/effort for that category from its routing table, silently falling back to the next-best candidate on any launch-time failure.

`provider`, `model`, and `effort` are optional overrides — omit them to get the auto-selected best combination. Rules: passing `model` requires `provider`; passing `effort` requires both `provider` and `model`.

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

## Configuration

### Global concurrent-subagent cap

subagent-mcp enforces a machine-global cap on the number of **live concurrent subagents** across all agentic sessions and MCP server processes on the machine. The count includes agents started by other active sessions and the whole recursive descendant tree; slots free as agents finish or are killed.

The cap is configured in `global-concurrency.jsonc`, a dedicated dist-sibling file in the install directory. It is separate from the advanced routing directives file, ships as a commented template, and is retained across installs and updates by the same preserve-user-edits mechanism as the advanced routing directives.

Set `globalConcurrentSubagents` in that file. The default is `20`; the minimum valid value is `10`. Validation is forced: `0`, unset, missing, or invalid values reset to `20`, and values `1` through `9` are pinned up to `10`. There is no environment-variable override; the file is the sole source of truth. The file is re-read on every `launch_agent` call, so edits take effect on the next launch with no server restart.

When the cap is reached, `launch_agent` is rejected immediately; it never queues. Before cap checks, hooks and tool calls run default zombie culling with no config knob: live agents idle for more than 6 minutes and terminal-but-alive agents idle for more than 30 seconds are terminated process-tree-first, then force-killed after 20 seconds if needed. Reports include `zombies`, and `poll_agent` keeps the tail with `zombie_killed` when culling terminates an agent.

## Tools

Eight tools are exposed over the stdio MCP transport.

| Tool | Description |
|---|---|
| `launch_agent` | Start a new sub-agent session with a prompt and optional task category / overrides |
| `poll_agent` | Check status and stream tail output for a running agent |
| `kill_agent` | Terminate a running or stalled agent |
| `send_message` | Enqueue a message into a running agent's stdin |
| `list_agents` | List all tracked agents and their current status |
| `wait` | Block until a specific agent reaches a terminal state |
| `orchestration-mode` | Toggle orchestration-mode ON/OFF; controls whether hook directives are injected into agent sessions |
| `model-selection-mode` | Control model selection: `smart` (auto-pick) or `user-approved-overrides` (30-min override window) |

Full parameters, return shapes, and the `alive` / `idle_seconds` / `hint` / `recent_stream` fields are in [docs/tools.md](docs/tools.md).

## Agent Lifecycle

Each agent transitions through these states:

| Status | Meaning |
|---|---|
| `processing` | Driver alive with a visible provider-stream heartbeat in the last 10 minutes — actively working. Launch time counts as the initial heartbeat |
| `stalled` | Driver STILL ALIVE but no parsed visible provider stream item for >= 10 minutes — working, thinking, or awaiting a temp-file handoff (not a failure). Recovers to `processing` if the visible stream resumes |
| `finished` | Current turn completed, or driver exited with code 0 |
| `errored` | Process exited with non-zero code |
| `stopped` | Terminated by `kill_agent` |

`processing` and `stalled` are live. `stalled` means the driver is alive but quiet (>= 10 min no visible stream); it recovers automatically and is never auto-killed — do not `kill_agent` a stalled agent. `wait` does not return on `stalled`. Full semantics: [docs/reference/status-lifecycle.md](docs/reference/status-lifecycle.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/registration.md](docs/registration.md) | Per-platform setup: Claude Code, Codex, Gemini CLI, Claude Desktop; manual wiring; developer install from source |
| [docs/tools.md](docs/tools.md) | Full tool reference — all eight tools, parameters, return shapes |
| [docs/usage.md](docs/usage.md) | Model & effort matrix, ultracode mode, CLI invocations, usage examples |
| [docs/SPEC.md](docs/SPEC.md) | Full technical specification — architecture, schemas, status lifecycle, error catalogue |
| [docs/spec/interactive-drivers.md](docs/spec/interactive-drivers.md) | Always-interactive Claude/Codex driver model |
| [docs/release-notes.md](docs/release-notes.md) | Operator-facing release notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor guide — dev environment, build, test, publish |

## License

Apache-2.0 — Copyright 2026 Lexi Blackburn

See [LICENSE](LICENSE).
