# Handoff tools

Normative spec for the three handoff tools (`handoff-write`, `handoff-read`,
`handoff-clear`). State is cwd-keyed (see context-metering.md for the state
dir and file-naming scheme: `handoff-<cwdHash(cwd)>.json`, plus an optional
overflow file `handoff-overflow-<cwdHash(cwd)>-<unix_ms>.md`).

## Gating rules

- `handoff-write` is unlocked ONLY when the calling session is at or above
  50% context utilization (`used_percentage >= HANDOFF_THRESHOLD_PCT`, i.e.
  phase = "handoff") AND metering is readable for that session. Below 50%,
  or when metering is unreadable, the tool refuses with an affirmative error
  (never silent) -- see exact strings below.
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

UNAVAILABLE_BELOW_50 =
"handoff-write is not available until this session reaches 50% context utilization (currently below threshold)."

OVERSIZE_CONTENT =
"handoff content exceeds the 4000-character limit; shorten it, or move the excess (up to 8000 additional characters) into a separate file and reference its full path inside the 4000-character content."

OVERSIZE_OVERFLOW =
"handoff overflow content exceeds the 8000-character limit; shorten the overflow file content and retry."
```

```
NO_HANDOFF_FOUND =
"No handoff found for this directory. Resume the previous session and ask it to write one via handoff-write."
```

## Pre-write coaching (handoff-write)

Before writing, the hook and tool description coach the session to ask the
user 10 clarifying questions via the structured-question tool. The intent of
these 10 questions is to build a `/goal` prompt for the next session to
resume from.

## Post-read coaching (handoff-read)

After a successful `handoff-read`, the session must read the saved handoff,
then confirm user intent via EXACTLY 4 structured questions before acting on
it. Confirm: resume objective, current blocker, files/state to preserve, and
next concrete action plus permission to proceed in this session.

## Handoff-resume Skill Deployment

`subagent-mcp setup` deploys the packaged Claude Agent Skill from
`skills/smcp-handoff/SKILL.md` to
`~/.claude/skills/smcp-handoff/SKILL.md`. Missing or stale targets are
repaired by re-running setup. Codex is intentionally not targeted because
Codex has no Agent Skill mechanism; the MCP instructions carry the handoff
guidance there.

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
successor session that works in the same cwd and later crosses the 50%
threshold again unlocks `handoff-write` again, and the same write -> coach
-> read -> re-append cycle repeats for that successor session.
