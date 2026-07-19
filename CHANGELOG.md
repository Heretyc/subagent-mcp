# Changelog

## 3.1.2

### Changed

- Refreshed routing-table data from profiler run `20260717-full-01`, including
  new provider families, open-weight provenance handling, pin-aware rank sort,
  and provider enum unification.

## 3.1.1

### Changed

- `update` now prompts the setup init-scope menu (project vs global;
  non-TTY/--unattended = global) when the init registry is missing or empty,
  replacing the previous directory-scan backfill.

### Fixed

- `update` now prunes its own temp backup files (`<name>.bak-update-*`) to
  most-recent-per-basename after a clean update, preventing unbounded
  accumulation.

## 3.1.0

### Added

- Interactive setup init-scope menu: project vs global; `--unattended` and
  non-TTY runs default to global.
- Init deployment registry at `~/.subagent-mcp/init-registry.json`, tracking
  `globalInit`, `autoUpdate`, and entries. `update` auto-runs `init --global`
  when flagged, prunes backups to the most recent, alerts registered dirs
  (`--quiet`), `--force` re-inits all, handles stale-dir and empty-registry
  backfill cases, `init --remove`/`uninstall` deregister, and `doctor` checks
  the registry.
- Default-on update notifier nag that never blocks stdio boot, honors
  `NO_UPDATE_NOTIFIER`, skips CI/test, plus opt-in self-update with a 48h
  cooldown, npm provenance gate, and one-line notice. Setup enable prompt
  defaults YES; `--unattended` is YES.

### Changed

- `smcp-handoff` coaching now requires definable and achievable goals and
  run-until-achieved.
- 15% latch planning coaching reduced from 5 questions to 4 in a single call;
  handoff-read pre-act confirmation aligned to 4.

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
