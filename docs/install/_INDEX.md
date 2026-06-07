# Install Guide Index

Copy-pasteable install directions for getting the **MCP server** and the
per-turn **orchestration-mode hook** installed together on each supported host.

For the lighter, MCP-only registration reference (no orchestration hook) see
[docs/registration.md](../registration.md). For what orchestration mode *is*,
see [docs/spec/orchestration-mode/_INDEX.md](../spec/orchestration-mode/_INDEX.md).

## Build prerequisite (do this first, every host)

The hook and server both run from `dist/`, which is **git-ignored** (not
committed). You must build it locally before any host can load it.

```bash
git clone https://github.com/Heretyc/subagent-mcp
cd subagent-mcp
npm install
npm run build      # tsc + copy-provider -> dist/index.js, dist/hooks/*.js
```

Requires **Node.js >= 18**. After the build, confirm these exist:

- `dist/index.js` — MCP server entry
- `dist/hooks/orchestration-claude.js` — Claude per-turn hook
- `dist/hooks/orchestration-codex.js` — Codex per-turn hook

> **Distribution note:** because `dist/` is git-ignored, only a **local-path**
> plugin install (which copies your built working tree) ships the server and
> hook. Installing this plugin from a git/GitHub URL would clone *without*
> `dist/` and fail with `ENOENT`. Keep installs local-path, or build after
> cloning.

## Per-host guides

| Host | Per-turn hook | Guide |
|---|---|---|
| Claude Code (CLI) | yes | [claude-code-cli.md](claude-code-cli.md) |
| Claude Desktop | **no** (MCP-only) | [claude-desktop.md](claude-desktop.md) |
| Codex CLI | yes | [codex-cli.md](codex-cli.md) |
| Codex Desktop / IDE | **no** (MCP-only) | [codex-desktop.md](codex-desktop.md) |

Desktop hosts have no `UserPromptSubmit` hook host, so the `orchestration-mode`
tool still flips the marker but **nothing is injected per turn**. This is
documented degradation, not a bug — use a CLI host for the full behavior.

## Host capability matrix

| Host | Toggle works | Per-turn injection |
|---|---|---|
| Claude Code CLI | yes | yes (bundled `UserPromptSubmit` hook) |
| Codex CLI | yes | yes (bundled `SessionStart` + `UserPromptSubmit`) |
| Claude Desktop | yes | **no** — no hook host |
| Codex Desktop / IDE | yes | **no** — no hook host |
