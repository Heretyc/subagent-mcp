# Install Guide Index

Copy-pasteable install directions for getting the **MCP server** and each
host's supported orchestration wiring installed together.

> **Automated SOP:** for a permanent, repo-decoupled install (the addon copied to
> a stable global location, not run out of the checkout), use the
> [`subagent-mcp-installer`](../../skills/subagent-mcp-installer/SKILL.md) skill.
> It is the automated, standards-compliant SOP across all supported vendors and
> never installs from a worktree or temp path. The per-host pages below document
> supported manual/plugin install paths.

For MCP-only server registration, see
[docs/registration.md](../registration.md). Orchestration-hook install steps
belong in this `docs/install/` guide set. For what orchestration mode *is*, see
[docs/spec/dev-loop/orchestration-directive-architecture/sections-10-13.md section 10](../spec/dev-loop/orchestration-directive-architecture/sections-10-13.md).
The `orchestration-mode` MCP tool flips the toggle; each supported host's
per-turn hook performs the directive injection.

## Build prerequisite (do this first, every host)

The hook and server both run from `dist/`, which is **git-ignored** (not
committed). You must build it locally before any host can load it.

```bash
git clone https://github.com/Heretyc/subagent-mcp
cd subagent-mcp
npm install
npm run build      # tsc + copy-provider -> dist/index.js, dist/hooks/*.js
```

Requires **Node.js >= 20**. After the build, confirm these exist:

- `dist/index.js` : MCP server entry
- `dist/hooks/orchestration-claude.js` : Claude per-turn hook
- `dist/hooks/orchestration-claude-pretool.js` : Claude PreToolUse gate
- `skills/handoff-resume/SKILL.md` : Claude handoff resume Agent Skill
- `dist/hooks/orchestration-codex.js` : Codex per-turn hook

> **Distribution note:** `dist/` is git-ignored, so it must be built before any
> host can load it. The `subagent-mcp-installer` skill handles this via
> `npm pack` + `npm install -g`: the `prepare` script rebuilds `dist/` before
> packing, so the tarball ships a fresh `dist/` to a permanent, decoupled global
> location. For the plugin-marketplace approach, the plugin source must have a
> built `dist/` before Claude loads it. A local-path install can use your built
> working tree. A Git URL source needs the installed checkout built before use;
> if you see `ENOENT` for `dist/hooks/*.js`, build that plugin source.

## Per-host guides

| Host | Per-turn hook | Guide |
|---|---|---|
| Claude Code (CLI) | yes | [claude-code-cli.md](claude-code-cli.md) |
| Claude Desktop | **no** (MCP-only) | [claude-desktop.md](claude-desktop.md) |
| Codex CLI | yes | [codex-cli.md](codex-cli.md) |
| Codex Desktop / IDE | **no** (MCP-only) | [codex-desktop.md](codex-desktop.md) |
| Gemini CLI | **no** (MCP-only) | [gemini-cli.md](gemini-cli.md) |

Desktop hosts and Gemini CLI have no repo-documented `UserPromptSubmit` hook
host, so the `orchestration-mode` tool still flips the marker but **nothing is
injected per turn**. This is documented degradation, not a bug : use Claude Code
CLI or Codex CLI for the full behavior.

## Host capability matrix

| Host | Toggle works | Per-turn injection |
|---|---|---|
| Claude Code CLI | yes | yes (`UserPromptSubmit` + `PreToolUse`) |
| Codex CLI | yes | yes (bundled `SessionStart` + `UserPromptSubmit`) |
| Claude Desktop | yes | **no** : no hook host |
| Codex Desktop / IDE | yes | **no** : no hook host |
| Gemini CLI | yes | **no** : no hook injection; UNKNOWN defaults to ON |
