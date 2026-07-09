# Release Notes

Operator-facing release notes for `subagent-mcp`. Newest version first.

The publishing procedure itself (dual-registry contract, version-sync gate,
auth) lives in [docs/spec/dev-loop/release-publishing.md](spec/dev-loop/release-publishing.md);
this page records what each release changes for operators.

---

## v2.12.7

### Republish of v2.12.6 with a CI publish fix

- **Republishes v2.12.6** (its npm publish failed in CI).
- **Pin npm to 11.5.1 in the publish workflow** — npm@latest ships broken
  sigstore, breaking `--provenance` publishes.

---

## v2.12.6

### Lifecycle correctness, session-scoped disable, and docs

- **Interactive agents hold their concurrency slot until driver close.** A slot is
  no longer released the instant an interactive agent goes idle; it stays reserved
  through the full driver lifecycle and is freed only when the driver actually
  closes. Prevents over-subscription where a still-open interactive session's slot
  was handed to another launch.
- **Server-scoped session pointer.** `disable` now targets the requesting session
  rather than a process-global pointer, so a disable issued from one session no
  longer disrupts another session sharing the server.
- **Tests wired into `npm test`.** The lifecycle-matrix and
  output-hook-registration suites are now part of the default `npm test` run
  instead of living outside the gate.
- **`mcp-compliance` check no longer masked.** A stray permission-system re-import
  was shadowing the compliance check; removed so the check runs and reports
  honestly.
- **Codex hook POSIX command fixed** for macOS/Linux — the hook now emits a
  portable POSIX command that runs correctly on non-Windows hosts.
- **Docs.** README now opens with the ratified core premise; concurrency docs use
  the canonical config filename throughout.

---

## v2.12.5

### Unified permission system for launched sub-agents

- **New `permissionsCeiling` posture** (`yolo` | `auto` | `manual`, default
  `auto`). One shared engine (`src/permission-engine.ts`) gates every launched
  sub-agent's tool calls on both Claude and Codex: SAFE floor auto-allows,
  DANGER floor auto-denies, NEUTRAL residue parks for a decision. `manual` caps
  every non-denied action to a parked ask; `yolo` reproduces the old ungated
  behavior byte-for-byte.
- **Behavior change (BREAKING-ish): Codex spawn posture.** Non-yolo Codex agents
  now launch with `approvalPolicy: 'untrusted'` + `sandbox: 'workspace-write'`
  instead of the old hardcoded `never` + `danger-full-access`. Every mutation
  now generates an approval that the shared engine evaluates. **Cost:** any repo
  that already ships `deny`/`ask` rules will see more parked approvals than
  before. Set `permissionsCeiling: 'yolo'` to restore the old zero-approval
  behavior exactly.
- **Config file renamed** `global-concurrency.jsonc` →
  `global-subagent-mcp-config.jsonc`. Back-compat: the legacy filename is still
  read (with a one-time deprecation notice) when the new file is absent, for one
  major version. No auto-rename of your existing file. New keys: `escalation`,
  `strictReadParity`, and user-scope `disableBypassPermissionsMode`.
- **New tool `respond_permission`** (`{agent_id, request_id?, decision, reason?}`,
  parents only, one-time grants). **New status `permission_requested`**: alive,
  holds its slot, surfaces in `poll_agent` (`pending_permissions`), `list_agents`
  (`pending_permission_count`), and returns early from `wait`. Unanswered
  requests auto-deny after a 5-minute park timeout (an smcp-added safety net —
  Claude has no pending-decision timer); per-agent pending queue caps at 16.
- **Default change:** with no config present the effective posture is now `auto`,
  a net **tightening** vs the pre-2.12.5 ambient-yolo behavior (which ran
  `bypassPermissions`/`danger-full-access` with no gating). An upgrade with no
  config only ever tightens.
- **Beta-cycle hardening:** forwarded `agentId` consistently through permission
  decisions, gated Codex `PreToolUse` Bash approvals through the shared engine,
  made parked Codex waits return as soon as approval is needed, serialized poll
  reads during permission parking, and demoted manual-mode SAFE actions to asks.
- **Accepted risks** (hostile-repo `allow[]` honored; orchestrator self-answer in
  manual mode; Codex in-sandbox read blind spots; yolo remains fully ungated) are
  documented plainly in
  [docs/spec/permissions.md](spec/permissions.md#7-threat-model--accepted-risks-stated-plainly).

---

## v2.12.4
*v2.12.3 on npm is a stale pre-fix build published in error — deprecated; this release (2.12.4) is the real fix set.*

### Directive calibration and guarded relays

- Managed init blocks now use schema=3 wording with a provenance line,
  calibrated "jointly binding" precedence language, and an explicit fail-safe-ON
  rationale for hookless hosts.
- `poll_agent` and `wait` relays now treat sub-agent output as untrusted by
  escaping and enveloping relayed text, including launch-failure stderr; relay
  paths escape before slicing so truncation cannot expose raw directive text.
- Safety-scope and spec documentation now include the calibration rules used by
  the managed-block rewording.
- Adds case-insensitive lexicon regression coverage for directive calibration.

### Wait reliability, reap policy, and governance-spec alignment

- `wait` no longer surfaces a raw tool error when a just-renamed
  zombie-intents claim file is momentarily unreadable (Windows
  rename-visibility gap, AV scan, or Dropbox sync lock); the drain now
  returns empty and the poll continues cleanly.
- A turn-`finished` but still-interactive agent now releases its
  concurrency slot at turn-finish instead of holding it for the idle
  window. The agent stays alive and `send_message`-able and is
  force-killed only after 6 minutes of no `send_message`/`poll_agent`
  activity (was a 30-second terminal reap); `poll_agent` now refreshes
  the idle clock alongside `send_message`.
- Governance specs realigned to code truth: orchestration is default ON,
  with OFF represented by a time-bounded disable-record — the stale
  marker-presence "default OFF" spec has been tombstoned.

---

## v2.12.2

### Update notices, fable routing, and zombie report visibility

- `zombie_report` is now caller-visible only from `poll_agent` and
  `list_agents`, using one shared `zombies: <agent_ids>` format; all other
  tool responses, hook stdout, and pretool output keep culling silent.
- The server now checks npmjs dist-tags on connect and, when a newer version is
  available, appends a throttled hook notice to run `subagent-mcp update` and
  then `subagent-mcp setup`; `checkForUpdates` and `SUBAGENT_UPDATE_CHECK=0`
  disable the check.
- Adds `fable` as the launch id for `claude-fable-5` in auto-routing and
  explicit Claude overrides with medium/high/xhigh/max effort; ultracode remains
  Opus-4.8 only.

## v2.10.4

### Live slot heartbeat and owner-aware reaping

- Live `processing` and `stalled` agents now refresh global slot metadata from
  the server reconcile timer and from the `wait` loop, not only from external
  tool-call cadence.
- Older slot-file timestamps no longer move an in-memory live agent heartbeat
  backward or self-classify the agent as stale.
- Cross-process stale culling skips slots owned by a still-live server PID, and
  only kills a managed child when ownership metadata shows the owner is gone.

### RCA

- Trigger: long-running `wait` calls could block for up to 15 minutes while
  live slot files stopped being refreshed.
- Impact: other sessions could misclassify healthy Claude/Codex drivers as
  stale, unlink their slots, and undercount the global cap while processes
  accumulated.
- Root cause: slot liveness used provider-visible activity plus MCP tool-call
  maintenance cadence instead of a wall-clock owner heartbeat.
- Contributing factors: stale disk metadata could drag fresh in-memory state
  backward, and cross-process culling did not check owner-server liveness.
- Detection gap: tests covered stale slot reaping, but not live owned stale
  slots during blocked `wait` calls.
- Fix/tests: live slot heartbeats, owner-aware stale culling, and regression
  tests for safe no-kill behavior and `wait`-loop refresh.

## v2.10.3

### Silent launch zombie reaping

- `launch_agent` still runs zombie maintenance before spawning, but no longer
  returns a caller-facing `zombie_report` field.
- Zombie cleanup remains visible through `poll_agent`, `list_agents`, and
  `wait`, where culled agents report `zombie_killed` as before.

## v2.10.1

### Global concurrent-subagent cap

Adds a machine-global live subagent cap across all sessions and processes on
the machine. The shared-state count includes agents from other active sessions
and the whole recursive descendant tree; slots free when agents finish or are
killed.

- New `global-concurrency.jsonc` config with `globalConcurrentSubagents`
  (default `20`, minimum `10`). Invalid, unset, or `0` values reset to `20`;
  values `1`-`9` are pinned to `10`.
- The config has no environment-variable override, is re-read on every
  `launch_agent` call, and is retained across installs / updates like the
  advanced routing directives file.
- Before cap rejection, launch/tool/hook paths cull zombie agents by default:
  stale live agents after 6 minutes idle, terminal-but-alive agents after 30
  seconds, with graceful process-tree termination then force after 20 seconds.
  As of v2.12.2, only `poll_agent` and `list_agents` surface the caller-visible
  zombie report when cleanup occurs.
- Adds unit coverage for config validation, template parsing, cap rejection,
  slot reservation, and idempotent release.

## v2.9.0

### Claude session-limit failover

When a Claude sub-agent's **final output** is the session-limit surface
(`You've hit your session limit · resets …`), subagent-mcp now treats it as a
**transient provider failure** and silently fails over to the next routing
candidate, the same way it already handles other launch-time transient
failures.

- Detection is anchored to that exact Claude wording, **Claude-provider and
  final-output only** — it does not match mid-stream text or other providers.
- The reset time is **never parsed, stored, or exposed**. subagent-mcp only
  recognizes that the limit was hit, then re-routes.
- Failover runs through the existing **launch-time / spawn-grace** transient
  path, not a post-start re-route. There is **no new retry policy** and no new
  configuration knob.
- **No public MCP response schema changed.** Operators see the same
  auto-mode fallback behavior they already get on other transient failures.

### New CLI subcommand: `subagent-mcp init --global`

Upserts the managed init/directive block into each provider's **official global
user-config file** instead of a project tree:

| Provider | Global file |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |

These are the homedir dotdir paths on **macOS, Windows, and Linux**. Scope is
**exactly those three files** — nothing else is touched.

- Honors `--dry-run` (preview), `--remove` (delete the managed block), and
  `--force`.
- **Mutually exclusive** with `--root`, `--files`, `--copilot`, and `--cursor`;
  use `init --root` for per-project consumer repos, `init --global` for the
  user-level config.

```bash
subagent-mcp init --global            # upsert into the three global files
subagent-mcp init --global --dry-run  # preview the changes
subagent-mcp init --global --remove   # remove the managed block
```

### Orchestration directive: `/workflows` permitted alongside the orchestrator tools

The orchestrator's allowed-tools rule now permits the **`/workflows`** tool in
addition to the structured-question tool and `subagent-mcp`. This applies to
**all providers**. Orchestrators may use `/workflows` while still routing every
execution step through sub-agents.
