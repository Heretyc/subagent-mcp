# Handoff tools

Normative spec for the three handoff tools (`handoff-write`, `handoff-read`,
`handoff-clear`). State uses the same stable project key as model-selection
mode: git common-dir when cwd is inside a repo, otherwise normalized cwd hash.
Files are named `handoff-<projectKey>.json`, plus optional overflow
`handoff-overflow-<projectKey>-<unix_ms>.md`; reads and clears also check the
legacy exact-cwd hash path so existing handoffs are not silently stranded.

## Gating rules

- `handoff-write` is unlocked ONLY when the calling session is at or above
  20% context utilization (`used_percentage >= HANDOFF_UNLOCK_THRESHOLD_PCT`,
  i.e. phase = "handoff") AND metering is readable for that session. Below 20%,
  or when metering is unreadable, the tool refuses with an affirmative error
  (never silent) -- see exact strings below.
- The 20% unlock is a FIXED constant. It is not user-configurable, not
  env-overridable, and is unaffected by the `contextCoaching` setting. It is a
  GOAL-CONTEXT unlock: the session captures the DEFINABLE AND ACHIEVABLE goal
  it shaped at the 15% latch while it still has enough context to describe one,
  rather than at the old wind-down-adjacent point.
- The wind-down warning is a SEPARATE, later, user-configurable threshold
  (default 60%; see the wind-down warning section below). Unlocking the handoff
  tools at 20% does not warn, and muting the warning does not lock the tools.
- `handoff-read` and `handoff-clear` are ALWAYS available regardless of
  phase or utilization. They are gated only by whether a handoff record
  exists for the cwd or not.

## Character limits and error strings

- Inline handoff content is capped at 4000 characters
  (`HANDOFF_CONTENT_LIMIT`).
- Overflow content, written to a separate file when the inline cap is not
  enough, is capped at 8000 additional characters (`HANDOFF_OVERFLOW_LIMIT`).
  The overflow file's full absolute path must be referenced inside the
  4000-character inline content.

The following error/coaching strings are exact and must not be altered:

```
UNAVAILABLE_NO_METERING =
"handoff-write is not available due to missing context size data. It will become available once context usage can be measured for this session."

UNAVAILABLE_BELOW_UNLOCK =
"handoff-write is not available until this session reaches 20% context utilization (currently below threshold)."

OVERSIZE_CONTENT =
"handoff content exceeds the 4000-character limit; shorten it, or move the excess (up to 8000 additional characters) into a separate file and reference its full path inside the 4000-character content."

OVERSIZE_OVERFLOW =
"handoff overflow content exceeds the 8000-character limit; shorten the overflow file content and retry."
```

```
NO_HANDOFF_FOUND =
"No handoff found for this directory. Resume the previous session and ask it to write one via handoff-write."
```

`UNAVAILABLE_BELOW_UNLOCK` is pinned to `HANDOFF_UNLOCK_THRESHOLD_PCT` by a
template-literal type in `src/orchestration/handoff.ts`, so the constant and the
user-visible sentence cannot drift apart. The old threshold-bearing export name
`UNAVAILABLE_BELOW_40` remains only as a deprecated alias for import
compatibility; it carries the 20% wording.

## Wind-down warning (separate from the unlock)

At or above the wind-down warning threshold the hook warns EVERY turn to wind
down and appends the handoff steer (`directives/handoff-{claude,codex}.md`).
That threshold is user-configurable:

| Setting | Values | Default |
|---|---|---|
| `contextCoaching` | `true` or `false` | `true` |
| `handoffWarnThreshold` | integer percent, valid `40`-`90` | `60` |

- Configuration is USER-LEVEL ONLY: the machine-local
  `~/.subagent-mcp/settings.json` / `settings.local.json`. There is no per-repo
  or per-project override, and the repo-scoped `.claude/settings*.json` files
  contribute `permissions.*` only.
- Missing keys default silently to `contextCoaching: true` and
  `handoffWarnThreshold: 60`; any out-of-range or malformed number resolves to
  `60`.
- `contextCoaching: false` mutes ONLY the at-or-above-threshold wind-down
  warning and its handoff steer (and the `near_limit` flag that backs them). It
  does NOT affect the 15% latch, the latch coaching, or the 20% handoff-write
  unlock, and `handoff-write` / `handoff-read` / `handoff-clear` stay callable.

## Pre-write coaching (handoff-write)

Before writing, the hook and tool description coach the session to ask the
user 10 clarifying questions via the structured-question tool. The intent of
these 10 questions is to build a `/goal` prompt for the next session to
resume from, carrying forward the goal context set at the 15% latch.

## Post-read coaching (handoff-read)

After a successful `handoff-read`, the session must read the saved handoff,
then confirm user intent via EXACTLY 4 structured questions before acting on
it. Confirm: resume objective, current blocker, files/state to preserve, and
next concrete action plus permission to proceed in this session.

## Handoff-resume Skill Deployment

`subagent-mcp setup` deploys the packaged Agent Skills to
`~/.claude/skills/<name>` for Claude Code and `$HOME/.agents/skills/<name>` for
Codex CLI. Missing or stale targets are repaired by re-running setup. Codex
skills appear through Codex's normal skill discovery; the MCP instructions still
carry fallback handoff guidance.

## Post-write response (exact, byte-for-byte)

On a successful `handoff-write`, the MCP tool responds with EXACTLY the
following string, character-for-character:

```
We are ready to start a new session, to avoid wasting tokens, use the structured question tool to confirm that the user is ready to use the `smcp-handoff skill` in the next new session to resume work and has cleared the current /goal (if present) - or you will be compelled to keep working on a potential /goal that needs to be halted for a new session.
```

## LONG-reminder re-append rule

After a successful `handoff-read`, only the reading session is bound as
`read_by_session` on the handoff record. For the remainder of that session's
lifetime, every LONG reminder injection (every `REMINDER_PERIOD`-th turn,
i.e. every 5th turn) appends the saved handoff content verbatim after the
reminder body, before the closing tag. If the handoff record has a non-null
`overflow_path`, a line noting that full path is appended alongside the
content. No other session receives this re-append behavior, even if it also
reads the same handoff record later (last-read-wins rebinds
`read_by_session` to the newest reader only).

## handoff-clear and cycle repetition

`handoff-clear` deletes the saved handoff record (and its overflow file, if
any) for the cwd. The handoff lifecycle is not a one-time event: each
successor session that works in the same cwd and later crosses the 20%
unlock threshold again unlocks `handoff-write` again, and the same write -> coach
-> read -> re-append cycle repeats for that successor session.
