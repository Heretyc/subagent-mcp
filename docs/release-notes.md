# Release Notes

Operator-facing release notes for `subagent-mcp`. Newest version first.

The publishing procedure itself (dual-registry contract, version-sync gate,
auth) lives in [docs/spec/dev-loop/release-publishing.md](spec/dev-loop/release-publishing.md);
this page records what each release changes for operators.

---

## v2.10.0

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
- At cap, `launch_agent` is rejected immediately, never queued. Operators free
  slots manually with `list_agents` + `kill_agent`; there is no automatic
  cleanup or zombie reaping.
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
