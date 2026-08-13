# Changelog

## 3.2.0

### Added

- `swarm` tool: 7-stage agentic workflow coach for objectives projected to span
  multiple sessions. The server tracks the current stage in memory for the
  process lifetime; each `swarm(N)` call registers stage N complete and returns
  the next stage's coaching with the exact next call. `swarm()` starts from
  idle; `swarm(0)` abandons. `swarm(5)` from idle is the designated
  post-handoff re-entry (in-memory state does not survive the session boundary).
  All replies are non-error; out-of-order and invalid calls return corrective
  coaching without advancing state.
- Performance routing for the pre-handoff swarm stages (1-4): the server
  applies routing optimizations while genuine forward progress is being made.
  Repeating a stage report never extends this -- only an accepted forward
  advance does, and routing state is cleared when handoff becomes the next
  step. A fresh `swarm()` start is required to re-arm (anti-gaming).
- `launch_agent` flag `sub-orchestrator: true` (main orchestrator only, depth
  0): launches a child as a delegate-only orchestrator with the server's
  enforcement directive injected into the prompt and the sub-orchestrator env
  marker set. The child's own sub-agents run as normal workers and never
  inherit the flag (the server strips the marker from grandchildren, and the
  depth cap prevents further spawning). Rejected at depth > 0.
- Sub-orchestrator instructions variant served to flagged children; per-turn
  hook directive `directives/sub-orchestrator-on.md` injected for stateless
  enforcement; `respond_permission` available to sub-orchestrators so they can
  answer their workers' parked permission requests.
- `get_status.swarm` snapshot field: `active`, `current_stage`, `stage_name`,
  `pin_active`, and `pin_expires_at`.
- Unit tests: `swarm-stage-machine`, `swarm-pin`, `sub-orchestrator-flag`; e2e
  test `swarm-e2e`.
- Full spec and user documentation for the swarm workflow and sub-orchestrator
  contract.

## 3.1.12

### Added

- `configure` MCP tool: list, read, or update subagent-mcp configuration by
  canonical key (`action=list`, `action=get`, `action=set`). Covers all static
  keys (`global.*`, `user.*`, `update.*`, `mode.*`) and dynamic provider/env
  keys. Secret-matching values and all `env.*` values are always redacted in
  responses. Machine-global and mode-owned keys are read-only through MCP; set
  attempts return a coaching message and the resolved file path instead of
  writing. Provider writes are validated in a scratch candidate file before
  the real file is touched; `.env` writes are shape-checked (non-empty,
  single-line) only. Every changed pre-existing file receives a sibling
  backup. `.env` and `key_env` changes report `restart_required: true`; all
  other settable keys report `restart_required: false`.
- `smcp-config` Agent Skill and `/smcp:config` slash command: interactive
  wrapper around the `configure` tool, deployed by `setup` for Claude Code and
  Codex alongside the existing `smcp-*` skills.

## 3.1.11

### Fixed

- Pure auto now quietly traverses the full, fresh per-call ranking on any
  launch-time failure; reroutes expose `failover_note`, while exhaustion loudly
  lists every attempted candidate and reason.

### Changed

- `provider+model` overrides are pinned to one attempt with no substitute;
  provider-only overrides still try matching routes before de-duplicated auto
  fallbacks.

## 3.1.10

### Fixed

- Claude `permissions.deny` now converges to `["Agent"]` only. Upgrade silently
  removes legacy `Task`, `Explore`, and `Agent(Explore)` entries; `doctor`
  detects stale entries and offers repair; `uninstall` reverts the smcp-owned
  `Agent` entry.

### Changed

- Task widget tools and Explore are no longer statically denied or matched by
  the runtime native-agent gate.
- Codex setup writes only `multi_agent = false`; no `disabled_tools` entries.

## 3.1.9

### Fixed

- The shipped 15% latch directives no longer contradict the released spec.
  `directives/latch-claude.md` and `directives/latch-codex.md` carried a
  superseded "ask up to 4 open planning questions in a SINGLE
  structured-question call" line, while the authoritative A5.5/A5.6 spec fences
  already specified the harness-neutral floor. Both files now carry the canonical
  line verbatim and are byte-identical: "ask AT LEAST 4 open planning questions
  using the structured question tool, or natural prose if not available." The
  question count is a FLOOR, not a cap, and prose is an allowed fallback where no
  structured-question tool exists. The separate `handoff-read` confirmation is a
  different policy and remains at EXACTLY 4.

### Added

- Regression guards that pin the latch coaching line to its exact bytes, assert
  full-body byte-identity between the two latch directives, and compare the
  shipped directives against their A5.5/A5.6 spec fences. The previous
  intent-level assertions passed against the drifted text, which is how the
  mismatch reached a release.

## 3.1.7

### Fixed

- Continuous-audit PR branches now satisfy the worktree branch guard.
- Node 20 CI no longer fails the API-provider timeout regression test because
  of internal timers scheduled after abort.

### Changed

- Release notes now catalog the continuous-audit hardening batch covering
  sole-channel/native-agent enforcement, smart-default model selection, and
  host-defense init checks.

## 3.1.6

### Fixed

- Codex context-window reporting: the harness-advertised
  `token_count.info.model_context_window` is now forwarded as the metering
  window (`window_source: "harness"`), so a 155K-used / 258K-window turn meters
  ~60% USED (~40% remaining) from `last_token_usage` instead of the cumulative
  `total_token_usage`, preventing a false 100%/unknown state.
- Codex `SessionStart` (turn 0) now renders the USED utilization and phase from
  a still-fresh persisted metering record for the current owner; a stale or
  absent record stays `unknown` (no stale data is lifted forward).

## 3.1.5

### Fixed

- Codex context metering now uses `last_token_usage` for current context
  occupancy and ignores absurd cumulative-token fallbacks, preventing cached
  billing totals from forcing a false 100% orchestration state.
- Codex `gpt-5.6` routing and generated output now use `gpt-5.6-sol`.
- Auto-mode failover now treats `401`, `403`, `429`, `5xx`, and auth-like launch
  errors as transient provider failures across CLI and API providers.

## 3.1.4

### Fixed

- Provider failover no longer stalls terminal sub-agent startup and in-turn
  turns: a failed primary provider now fails over cleanly at both launch and
  mid-turn instead of hanging.
- Context metering no longer reports a false 100% utilization; the meter
  reflects actual context usage.
- Fresh parent `GH_TOKEN` is now injected into child sub-agent environments so
  spawned agents inherit current GitHub credentials.

### Changed

- Codex `gpt-5.6` now maps to the correct wire model identifier.
- Handoff artifacts are more portable across environments.

## 3.1.1

### Changed

- `update` now prompts the setup init-scope menu (project vs global;
  non-TTY/--unattended = global) when the init registry is missing or empty,
  replacing the previous directory-scan backfill.

### Fixed

- `update` now prunes its own temp backup files (`<name>.bak-update-*`) to
  most-recent-per-basename after a clean update, preventing unbounded
  accumulation.

Older releases: [CHANGELOG/archive.md](CHANGELOG/archive.md).
