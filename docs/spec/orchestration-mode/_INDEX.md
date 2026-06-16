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
hook process** injects. The hook also emits a per-prompt reminder cadence while
OFF (see Cadence); heavy guidance lives in MCP metadata (see next section).

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
- **Per-turn directives** (`directives/**`): the FULL `<ORCHESTRATION-INVARIANT>`
  block (delegate-default / inline-by-right partition + temp-file IPC +
  disable-governance pointer, ultra-compressed) injects on CLAIM turns only;
  steady state is the per-prompt reminder cadence — the LONG mode-specific
  `<ORCHESTRATION-INVARIANT>` block (`reminder-on.md` /
  `reminder-off-<provider>.md`) every 5th prompt, and between prompts a
  state-aware short pointer — `short-on.md` when ON, `short-off.md` when OFF
  (provider-neutral, wrapped in `<SUB-AGENT-INVARIANT>`). The long
  persistence/governance prose lives in metadata; carryover notices keep their
  notify/ask/advise instruction.

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

## Subdivision (smallest auditable step)

When ON, the orchestrator delegates the **smallest auditable step** that yields
an observable, independently-verifiable artifact — it does NOT 1-shot
multi-phase work (e.g. bundling implement + test + docs + build into a single
sub-agent). This is a strong default with a judgment escape: trivial steps may
be combined, but for code or other non-trivial steps the orchestrator SHOULD
dispatch an independent verifier sub-agent before proceeding to the next step.
The rule lives in the ON-state per-turn assets only (full directive
`orchestration-<provider>.md`, `reminder-on.md`, `short-on.md`) — it governs how
the orchestrator delegates, which applies solely while orchestration is ON.

## Architecture (two cooperating processes)

- **The tool** (`orchestration-mode`, registered in `src/index.ts`) writes or
  deletes a per-project **marker file**. It does no injection itself.
- **The hook** (`dist/hooks/orchestration-claude*.js` /
  `orchestration-codex.js`) runs once per user turn/tool gate as its own process, reads
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

## Cadence and toggle (per-prompt reminder counter)

- A per-prompt counter (`src/orchestration/reminder.ts`, state file
  `remind-<cwdHash>.json`, owner-stamped by session; a session change restarts
  it) drives the cadence in BOTH marker states. Every 5th counted prompt emits
  the LONG mode-specific `<ORCHESTRATION-INVARIANT>` block
  (`reminder-on.md` when ON, `reminder-off-<provider>.md` when OFF); every
  prompt between emits the state-aware short pointer — `short-on.md` when ON,
  `short-off.md` when OFF.
- ON claim turns (FRESH enable / CARRYOVER re-claim) emit the **FULL**
  directive plus the ON reminder block and re-baseline the counter to the
  period boundary, so the next LONG fires exactly 5 prompts later. FULL fires
  on claim turns only; steady state is the leaner tagged reminder.
- The OFF long variants and OFF short pointer (`short-off.md`) carry the
  5-CALL RULE: ask via the provider question tool before enabling when work
  outgrows 5 tool calls, and keep subagent-mcp as the sole sub-agent channel
  even while OFF.
- Codex `SessionStart` covers turn 0 directly when active (FULL + ON reminder
  on FRESH, CARRYOVER notice prepended when inherited; counter re-baselined);
  Codex `UserPromptSubmit` runs the normal counter cadence.

## Persistence and session-start carryover

> **SUPERSEDES** the earlier "default-off-on-startup" decision. The server NO
> LONGER clears the marker on startup.

**Default OFF = no marker.** Absence of a marker = OFF = no orchestration
claim or FULL directive (the per-prompt OFF reminder cadence still runs). A
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
- **SAME-SESSION** (`owner_session === current`): normal counter cadence; no
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
2. (SUPERSEDED 2026-06-11 by the per-prompt reminder counter — see Cadence.)
   Originally: FULL when `relTurn % 5 == 0`, else a one-line reminder. Now FULL
   fires on claim turns only; the counter drives LONG/rule-carrier cadence in
   both states.
3. Split delivery: heavy operating-model + governance guidance lives in MCP
   server `instructions` (read once at initialize); the hook injects the compact
   `<ORCHESTRATION-INVARIANT>` directive on claim turns (codex variant keeps its
   leading self-deactivation SCOPE line) and the
   `<ORCHESTRATION-INVARIANT>`/rule-carrier cadence on all other prompts.
4. Packaging: Claude Code CLI + Codex CLI bundle the hook AND the MCP server =
   full feature. Claude Desktop + Codex Desktop toggle but do not inject =
   documented degradation.
5. Persistence (SUPERSEDES the earlier startup-clear decision): the marker is
   NOT cleared on startup. Default OFF = absence of a marker; an enabled marker
   persists ON across sessions/restarts until disabled with permission. A new
   session that inherits an active marker re-claims it and emits an ack-latched
   one-time carryover notice (notify + confirm + advise).

## Hook Paths And Deterministic Enforcement

Do not confuse `src/hooks/` source shims, `dist/hooks/` host JS,
`hooks/hooks.json` Claude registration, `codex/hooks.json` Codex registration,
and `directives/` assets resolved at runtime via plugin roots. Claude also
ships `orchestration-claude-pretool.js`: while `alive.flag` is fresh it denies
native `Task`/`Agent`/`Explore` and asks on the 6th inline tool call; missing or
stale liveness fails open.
