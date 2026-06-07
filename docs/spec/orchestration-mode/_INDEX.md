# Orchestration-Mode Spec Index

Status: normative spec for the `orchestration-mode` MCP tool and its bundled
per-turn hook. This directory is the canonical home for the design; the
implementation lives in `src/orchestration/**` and `src/hooks/**`, and the
ported directive text lives in `directives/**`. This directory is design +
contract only.

## What orchestration-mode is

A toggle. When ON, every top-level (non-subagent) user turn in a CLI host that
loads the bundled `UserPromptSubmit` hook gets an orchestrator-only directive
injected ahead of the prompt — re-pinning "delegate, do not execute directly"
so it survives long sessions and context drift. The MCP tool only flips the
toggle; a **separate hook process** does the per-turn injection.

This is a TypeScript port of the `~/nag` Python prototype. The directive text
is carried over verbatim; the cadence and toggle semantics are preserved.

## Purpose and governance

**Purpose.** Orchestration mode is for LONG-HORIZON work — tasks expected to
fill the context window if run to completion inline. When ON, the session should
operate like the ultracode workflow system: decompose the work and delegate to
subagents/workflows, hand results off via temp scratch files, and keep the
main/orchestrator context lean instead of doing the work inline.

**Enable.** Agents SHOULD enable orchestration mode whenever the user requests
long-horizon work.

**Disable.** The agent must NOT disable orchestration mode on its own
initiative. Disable ONLY after (1) obtaining EXPLICIT user permission, having
first (2) explained WHAT orchestration mode is, and (3) explained WHY it wants
to disable it. The permission request MUST use the provider-appropriate
interactive tool: `AskUserQuestion` (Claude Code) or `request-user-input`
(Codex). The directive assets enforce this per provider —
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

> The prototype carried stale inline "alternating / odd-turn" comments. The
> operative cadence is `% 5`, matching the prototype's own `INSTALL.md`. The
> stale comments are not reproduced in the port.

## Persistence and session-start carryover

> **SUPERSEDES** the earlier "default-off-on-startup" decision. The server NO
> LONGER clears the marker on startup.

**Default OFF = no marker.** Absence of a marker = OFF = **zero emission**. A
project never enabled stays OFF.

**Persistence.** Orchestration mode PERSISTS across process restarts/sessions for
a project: an explicitly enabled marker stays ON until it is disabled with
explicit user permission. The `isMain` startup path no longer calls
`clearForCwd`; `clearForCwd`/`disable` remain in use for the tool's
`enabled:false` path.

**Carryover detection.** Because the marker persists, the first turn of a NEW
session can inherit a marker an earlier session left ON. The hook classifies the
claim from `owner_session` vs the current `session_id`:

- **FRESH** (`baseline_turn == null` OR `owner_session == null`): just enabled in
  THIS session via the tool. Claim (`owner_session = current ?? null`, baseline =
  current turn) and emit the normal turn-0 **FULL** directive.
- **CARRYOVER** (`owner_session` is a real, *different* session — or current is
  undefined so same-session cannot be confirmed): the mode was ON at session
  start, carried from a prior session. **Re-claim** (owner = current, baseline =
  current turn) and emit the provider **CARRYOVER notice prepended to FULL**.
- **SAME-SESSION** (`owner_session === current`): normal `% 5` cadence; no
  re-claim, no notice.

The re-baseline on re-claim makes the carryover notice fire **exactly once** per
session; subsequent turns are SAME-SESSION cadence. Whole body is fail-safe (any
error → `''`). The Codex `SessionStart` path applies the same FRESH/CARRYOVER
classification (subagent suppression first).

**Carryover notice assets.** `directives/carryover-claude.md` and
`directives/carryover-codex.md` instruct the agent to (1) notify the user the
mode auto-activated at session start, (2) ask whether to keep it ON using the
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
`this is a request from a parent process`.

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
3. Directive text is ported verbatim from the prototype's SUB-AGENT-INVARIANT
   (claude variant, codex variant including its leading self-deactivation SCOPE
   line, and the off-turn one-liner).
4. Packaging: Claude Code CLI + Codex CLI bundle the hook AND the MCP server =
   full feature. Claude Desktop + Codex Desktop toggle but do not inject =
   documented degradation.
5. Persistence (SUPERSEDES the earlier startup-clear decision): the marker is
   NOT cleared on startup. Default OFF = absence of a marker; an enabled marker
   persists ON across sessions/restarts until disabled with permission. A new
   session that inherits an active marker re-claims it and emits a one-time
   carryover notice (notify + confirm + advise).

## The four distinct "hooks" paths (do not confuse them)

| Path | Role |
|---|---|
| `src/hooks/` | **Source** TypeScript hook entry shims. |
| `dist/hooks/` | **Compiled** JS the hosts actually execute (`tsc` output). |
| `hooks/hooks.json` | **Claude** plugin hook registration (`UserPromptSubmit`). |
| `codex/hooks.json` | **Codex** plugin hook registration (`SessionStart` + `UserPromptSubmit`). |

`directives/` is a fifth, separate location: uncompiled `.md` directive assets
at the repo root (the FULL claude/codex directives, the off-turn one-liner, and
the `carryover-claude.md` / `carryover-codex.md` session-start notices), resolved
at runtime via `CLAUDE_PLUGIN_ROOT` / `PLUGIN_ROOT` or `__dirname/../../directives`
from the compiled hook.

## Leaves

This directory currently has no leaf files; the contract is fully captured
above. Add leaves here if any sub-area grows its own normative detail.
