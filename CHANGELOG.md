# Changelog

## 3.0.3

### Changed

- Renamed the handoff skill to the smcp-* standard: `handoff-resume` is now
  `smcp-handoff`, deployed via the generalized smcp deploy with a new
  `/smcp:handoff` slash-command. Old trigger phrases ("handoff-resume",
  "resume handoff", "resume work") still work; `update` migrates away a stale
  `~/.claude/skills/handoff-resume` install. `doctor` now expects 4 skills +
  4 commands.
- Handoff tools (`handoff-write`/`handoff-read`/`handoff-clear`) now unlock at
  40% context utilization; the every-turn wind-down warnings still start at
  50%. The 15% orchestration latch is unchanged.

## 3.0.2

### Fixed

- `subagent-mcp setup` and `update` now install the `/smcp:*` Agent Skills
  (`smcp-doctor`, `smcp-help`, `smcp-status`) and their slash-commands into
  `~/.claude/skills/` and `~/.claude/commands/`. Previously only the
  handoff-resume skill was deployed, so the smcp skills/commands never landed
  in Claude Code after install.
- `doctor` now checks for the installed smcp skills/commands and WARNs when
  they are missing, instead of reporting all-green.
- `package.json` `files` now ships `.claude-plugin/` and `.codex-plugin/` so the
  plugin/marketplace path is available from the npm package.

### Added

- `init` managed block now directs agents to track multi-step work with the
  harness-native task tracking tool (if one exists), injected into AGENTS.md,
  CLAUDE.md, and GEMINI.md.

## 3.0.1

### Fixed

- API provider `base_url` that includes a trailing `/v1` no longer double-appends
  the version path (was producing `/v1/v1/chat/completions` and a 404). A 404 now
  distinguishes an unknown model from a wrong `base_url` instead of always
  reporting "model not found".
- Bumped transitive `hono` to clear a high-severity npm audit advisory
  (GHSA-wwfh-h76j-fc44). Not runtime-reachable here (stdio transport only).

### Docs

- Corrected the `smcp-help` and `smcp-doctor` skills to describe the API routing
  engine as live since 3.0.0 (they still said it "ships in a later release").
- Refreshed the README example image.

## 3.0.0

### BREAKING

- First release with direct API provider support. The provider union now includes
  `api` alongside `claude` and `codex`; configured API providers can make direct
  Claude Messages or OpenAI-compatible HTTP calls instead of only launching CLI
  sub-agents.

### Added

- API provider config through `providers.jsonc`, including per-category slot
  routing for API providers.
- HTTP client support for Claude Messages and OpenAI-compatible API styles.
- Once-per-session launch gate for the first API-routed request.
- `SUBAGENT_MCP_DISABLE_API_PROVIDERS=1` escape hatch to skip API providers and
  fall back to CLI candidates.
- Always-on workspace-write sandbox network access and a first-run permission
  ceiling menu.
- Handoff-resume flow now asks 4 questions after the handoff read.
