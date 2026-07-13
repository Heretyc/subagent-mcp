# Registering the MCP Server

Retrieval map for per-platform registration of `subagent-mcp` across Claude
Code, Codex, and Gemini CLIs. This page is an index : load the one matched leaf
under [`registration/`](registration/), not the whole folder. Replace the path
in each leaf's examples with the absolute path where you cloned the repo.

This is the MCP-only server registration reference. Orchestration-hook install
steps, including plugin/npm/manual wiring and per-host hook verification, belong
in [docs/install/_INDEX.md](install/_INDEX.md). See
[README.md](../README.md) for the project overview and [docs/SPEC.md](SPEC.md)
for the full technical specification.

## Topic index

| Topic | Leaf |
|---|---|
| Prerequisites, `npm install`, `setup`, global settings, `init --global`, source install | [`registration/prerequisites-and-install.md`](registration/prerequisites-and-install.md) |
| Claude Code / Claude Desktop MCP-server config | [`registration/claude-code.md`](registration/claude-code.md) |
| Codex MCP-server config (`config.toml`) | [`registration/codex.md`](registration/codex.md) |
| Gemini MCP-server config (`settings.json`) | [`registration/gemini.md`](registration/gemini.md) |

## Aliases / synonyms

- register / wire / add / connect the server -> the per-host leaf for that vendor
- install / setup / bootstrap -> `prerequisites-and-install.md`
- plugin / hook / injection / `UserPromptSubmit` / per-turn directive -> `docs/install/_INDEX.md`
- global config / machine settings / update check / concurrency cap -> `prerequisites-and-install.md` (Global settings)
- `init --global` / global user-config / managed block -> `prerequisites-and-install.md`

## Task -> doc

| Task | Load |
|---|---|
| Install from npmjs or GitHub Packages and auto-wire both CLIs | `prerequisites-and-install.md` |
| Tune `globalConcurrentSubagents` / `checkForUpdates` | `prerequisites-and-install.md` |
| Upsert managed blocks into provider global user-config | `prerequisites-and-install.md` (`init --global`) |
| Add the server to Claude Code (user or project scope) | `claude-code.md` |
| Add the server to Codex | `codex.md` |
| Add the server to Gemini | `gemini.md` |
| Turn on per-turn orchestration injection | `docs/install/_INDEX.md` |

## Symptom -> doc

| Symptom | Load |
|---|---|
| `401 Unauthorized` installing from GitHub Packages | `prerequisites-and-install.md` (GitHub Packages `.npmrc` auth) |
| CLI not found / not on PATH | `prerequisites-and-install.md` (Prerequisites) |
| Server registered but no per-turn directive appears | `docs/install/_INDEX.md` (desktop hosts / Gemini inject nothing) |
| Claude plugin load fails with duplicate-hooks error | `docs/install/_INDEX.md` (manifest must not re-declare hooks/mcpServers) |
| Codex hook never fires | `docs/install/_INDEX.md` (absolute path for `orchestration-codex.js`) |

## Workflow map

Install -> wire server (per-host leaf) -> (optional) install orchestration
hook/plugin -> verify (`claude mcp list` / `/mcp` / restart Gemini).

## Load-this-when rules

- Load exactly one vendor leaf for a single-host wiring task; load
  `prerequisites-and-install.md` first only if the CLIs are not yet installed.
- Load `docs/install/_INDEX.md` when per-turn hook/injection is in scope; bare
  MCP registration does not need it.
- Do not preload the whole `registration/` folder : match a row above first.
