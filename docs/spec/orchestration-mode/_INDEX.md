# Orchestration-Mode Spec Index

Status: normative spec for the `orchestration-mode` MCP tool and its bundled
per-turn hook. This directory is the canonical home for the design; the
implementation lives in `src/orchestration/**` and `src/hooks/**`, and the
ported directive text lives in `directives/**`. This directory is design +
contract only.

## What orchestration-mode is

A toggle. When ON, every top-level (non-subagent) user turn in a CLI host gets
a delegate-default directive with inline-by-right partitions only for
main-session-only capability. The MCP tool only flips the toggle; a **separate
hook process** injects. This TypeScript port of `~/nag` preserves cadence and
toggle semantics; heavy guidance moved to MCP metadata (see next section).

## Where the guidance lives (metadata vs per-turn)

Heavy operating-model + governance guidance lives in **MCP server metadata**
(read once when a host connects); the per-turn hook injects only a **compact
caveman-ultra reminder**:

- **Server `instructions`** (`ORCHESTRATION_INSTRUCTIONS` in `src/index.ts`,
  passed as the second `McpServer` arg → emitted in the `initialize` result)
  carries the full account: what orchestration mode is, the delegate operating
  model, temp-file handoff, persistence, carryover, and the disable-governance
  rule naming both provider tools. The `orchestration-mode` **tool description**
  is the operational summary and points at the instructions.
- **Per-turn directives** (`directives/**`) are reduced to a compact reminder:
  the `<SUB-AGENT-INVARIANT>` wrapper + HTML comment marker + the
  delegate-default / inline-by-right partition invariant + temp-file IPC, all
  ultra-compressed, plus a one-line pointer that disabling needs explicit user
  permission via the provider tool. The long persistence/governance prose was
  dropped from the injection (now in metadata); carryover notices keep their
  event-specific notify/ask/advise instruction, ultra-compressed.

**`ultracode` references removed.** The operating-model phrasing is now generic
"workflow orchestration / delegate to sub-agents and workflows" across the
directives and the orchestration-mode tool description. (The unrelated
`ultracode` *effort* level in `effort.ts`/`routing.ts` is a separate, untouched
CLI feature.)

## Purpose and governance

**Purpose.** Orchestration mode is for LONG-HORIZON work — tasks expected to
fill the context window if run to completion inline. When ON, the session should
act as a workflow orchestrator: decompose the work and delegate to
subagents/workflows, hand results off via temp scratch files, and keep the
main/orchestrator context lean instead of doing the work inline.

**Enable.** Agents SHOULD enable orchestration mode whenever the user requests
long-horizon work. **Disable.** The agent must NOT disable orchestration mode on its own
initiative. Disable ONLY after (1) obtaining EXPLICIT user permission, having
first (2) explained WHAT orchestration mode is, and (3) explained WHY it wants
to disable it. The permission request MUST use the provider-appropriate
interactive tool, and the directive assets enforce this per provider:
`directives/orchestration-claude.md` names `AskUserQuestion` only,
`directives/orchestration-codex.md` names `request-user-input` only.

## Architecture (two cooperating processes)

- **The tool** (`orchestration-mode`, registered in `src/index.ts`) writes or
  deletes a per-project **marker file**. It does no injection itself.
- **The hook** (`dist/hooks/orchestration-claude.js` /
  `orchestration-codex.js`) runs once per user turn as its own process, reads
  the marker, and decides what (if anything) to emit on stdout. The tool and
  the hook never share memory — the marker file on disk is the only channel.
- **Shared marker module** (`src/orchestration/marker.ts`) is imported by both
  sides as the single source of truth for marker location and format. Every fs
  op is fail-safe: the module never throws to its caller; failed reads return
  safe defaults.

Marker location: `os.tmpdir()/subagent-mcp/orch-<cwdHash>.flag`, where
`cwdHash` is the first 16 hex chars of `sha256(normalizeCwd(cwd))`.
`normalizeCwd` resolves the path, strips a leading `\\?\`, converts `\` to `/`,
lowercases on win32, and strips a trailing `/` — so `C:\X\` and `c:/x` key to
the same marker on Windows.

Marker fields: `enabled`, `cwd`, `owner_session`, `baseline_turn`,
`provenance` (`user-enabled` / `carried-over` / `null`), and `carryover_ack`
(missing fields default to `null` / `false` for backward compatibility).

## Cadence and toggle (mirrors the prototype)

- `relTurn` is measured from toggle-ON. The first turn after enabling is the
  **baseline** (`relTurn 0`) and emits the **FULL** directive.
- For each later turn: `rel = turn - baseline`. Emit **FULL** when
  `rel % 5 == 0`, otherwise emit the **one-line off-turn reminder**.
- `turn` is counted from the transcript, fail-safe to `0` (which forces FULL,
  i.e. the failure is visible, not silent).
- Codex `SessionStart` covers turn 0 directly (when active and not a subagent:
  emits FULL on a FRESH claim, or the CARRYOVER notice + FULL when the marker was
  inherited from a prior session — see Persistence below); Codex
  `UserPromptSubmit` runs the normal `% 5` cadence.

> Stale prototype "alternating / odd-turn" comments are not reproduced; cadence
> is `% 5`, matching the prototype's own `INSTALL.md`.

## Persistence and session-start carryover

> **SUPERSEDES** the earlier "default-off-on-startup" decision. The server NO
> LONGER clears the marker on startup.

**Default OFF = no marker.** Absence of a marker = OFF = **zero emission**. A
project never enabled stays OFF.

**Persistence.** Orchestration mode PERSISTS across process restarts/sessions for
a project: an enabled marker stays ON until disabled with explicit user
permission. `provenance` records user-enabled vs carried-over state, and
`carryover_ack` makes the carryover notice ack-latched: it fires once per
project marker and survives later re-claims. The `isMain` startup path no longer
calls `clearForCwd`; `clearForCwd`/`disable` remain for `enabled:false`.

**Carryover detection.** Because the marker persists, the first turn of a NEW
session can inherit a marker an earlier session left ON. The hook classifies the
claim from `owner_session`, `provenance`, `carryover_ack`, and current
`session_id`:

- **FRESH** (`baseline_turn == null` OR `owner_session == null`): just enabled in
  THIS session via the tool. Claim (`owner_session = current ?? null`, baseline =
  current turn) and emit the normal turn-0 **FULL** directive.
- **CARRYOVER** (`owner_session` is a real, *different* session — or current is
  undefined so same-session cannot be confirmed): stamp `provenance =
  carried-over`; if `carryover_ack` is false, emit the provider **CARRYOVER
  notice prepended to FULL** and set `carryover_ack = true`; then re-claim
  (owner = current, baseline = current turn).
- **SAME-SESSION** (`owner_session === current`): normal `% 5` cadence; no
  re-claim, no notice.

The ack latch, not session-key stability, makes the carryover notice fire
**exactly once** per project marker; subsequent turns are SAME-SESSION cadence.
Whole body is fail-safe (any error → `''`). The Codex `SessionStart` path applies
the same FRESH/CARRYOVER classification (subagent suppression first).

**Carryover notice assets.** `directives/carryover-claude.md` and
`directives/carryover-codex.md` instruct the agent to (1) notify the user the
mode carried over at session start, (2) ask whether to keep it ON using the
provider tool (`AskUserQuestion` for Claude, `request-user-input` for Codex —
each variant names ONLY its own tool), and (3) advise whether keeping it ON fits
the user's initial request. If the user declines, the agent calls
`orchestration-mode` with `enabled:false`.

## Subagent suppression

A subagent turn emits nothing. Claude treats a turn as a subagent when
`payload.agent_id` is truthy or `CLAUDE_CODE_ENTRYPOINT` is one of
`local-agent`, `sdk-cli`, `sdk-ts`, `sdk-py`. Codex treats it as a subagent
when `payload.source` carries a `subagent` key (0.131+) or is one of the known
`subAgent*` source strings, or the prompt's first line contains
`this is a request from a parent process`. `launch_agent` children carry
`SUBAGENT_MCP_SUBAGENT=1`, and both provider hooks skip when it is set.

## Host capability matrix

| Host | Toggle works | Per-turn injection |
|---|---|---|
| Claude Code CLI | yes | yes (bundled `UserPromptSubmit` hook) |
| Codex CLI | yes | yes (bundled `SessionStart` + `UserPromptSubmit` hooks) |
| Claude Desktop | yes | **no** — no `UserPromptSubmit` hook host |
| Codex Desktop | yes | **no** — no `UserPromptSubmit` hook host |

Desktop degradation is **documented behavior, not a bug**: the marker still
flips, but with no hook host nothing is injected per turn.

## The five locked decisions

1. Per-project temp marker file keyed by a hash of the working directory.
2. Cadence mirrors the prototype: FULL when `relTurn % 5 == 0`, else a one-line
   reminder; `relTurn` measured from toggle-ON (the toggle-ON turn is
   `relTurn 0` → FULL).
3. Split delivery: heavy operating-model + governance guidance lives in MCP
   server `instructions` (read once at initialize); the per-turn hook injects a
   compact caveman-ultra reminder (`<SUB-AGENT-INVARIANT>` wrapper, codex variant
   keeps its leading self-deactivation SCOPE line, plus the off-turn one-liner)
   with the delegate-default / inline-by-right partition invariant.
4. Packaging: Claude Code CLI + Codex CLI bundle the hook AND the MCP server =
   full feature. Claude Desktop + Codex Desktop toggle but do not inject =
   documented degradation.
5. Persistence (SUPERSEDES the earlier startup-clear decision): the marker is
   NOT cleared on startup. Default OFF = absence of a marker; an enabled marker
   persists ON across sessions/restarts until disabled with permission. A new
   session that inherits an active marker re-claims it and emits an ack-latched
   one-time carryover notice (notify + confirm + advise).

## The four distinct "hooks" paths (do not confuse them)

| Path | Role |
|---|---|
| `src/hooks/` | **Source** TypeScript hook entry shims. |
| `dist/hooks/` | **Compiled** JS the hosts actually execute (`tsc` output). |
| `hooks/hooks.json` | **Claude** plugin hook registration (`UserPromptSubmit`). |
| `codex/hooks.json` | **Codex** plugin hook registration (`SessionStart` + `UserPromptSubmit`). |

`directives/` is a fifth location: uncompiled directive assets resolved at
runtime via `CLAUDE_PLUGIN_ROOT` / `PLUGIN_ROOT` or `__dirname/../../directives`.

## Leaves

No leaf files yet; the contract is fully captured above.
