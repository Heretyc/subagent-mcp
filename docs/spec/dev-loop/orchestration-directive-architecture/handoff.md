# Handoff tools

Normative spec for the three handoff tools (`handoff-write`, `handoff-read`,
`handoff-clear`). State uses the same stable project key as model-selection
mode: git common-dir when cwd is inside a repo, otherwise normalized cwd hash.
Files are named `handoff-<projectKey>.json`, plus optional overflow
`handoff-overflow-<projectKey>-<unix_ms>.md`; reads and clears also check the
legacy exact-cwd hash path so existing handoffs are not silently stranded.

## Constants

| Constant | Value | Description |
|---|---|---|
| `CODEX_AUTOCOMPACT_PCT` | 90 | Fixed threshold value used by Codex metering; `setup` writes the same value to Claude Code `settings.json` as `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "90"`. |
| `HANDOFF_REQUIRED_THRESHOLD_PCT` (H) | 80 | Mandatory handoff write threshold. H = CODEX_AUTOCOMPACT_PCT - 10. Not user-configurable. |
| `COMPACTION_DROP_THRESHOLD_PCT` | 10 | Minimum percentage-point drop between adjacent metering samples to classify a transition as auto-compaction. |
| `HANDOFF_UNLOCK_THRESHOLD_PCT` | 20 | Voluntary handoff-write unlock for goal-context capture. Fixed, not user-configurable. |
| `PLAN_LATCH_THRESHOLD_PCT` | 15 | Plan-phase latch. Fixed, not user-configurable. |

## Gating rules

- `handoff-write` is unlocked ONLY when the calling session is at or above
  20% context utilization (`used_percentage >= HANDOFF_UNLOCK_THRESHOLD_PCT`,
  i.e. phase = "handoff") AND metering is readable for that session. Below 20%,
  or when metering is unreadable, the tool refuses with an affirmative error
  (never silent) -- see exact strings below.
- The 20% unlock is a FIXED constant. It is not user-configurable, not
  env-overridable, and is unaffected by the `contextCoaching` setting. It is a
  GOAL-CONTEXT unlock: the session captures the DEFINABLE AND ACHIEVABLE goal
  it shaped at the 15% latch while it still has enough context to describe one.
- At 80% utilization (`HANDOFF_REQUIRED_THRESHOLD_PCT`) a mandatory handoff write
  is required when no eligible prepared record exists for the session. This
  mandatory enforcement is directive-only (no tool gate) and fires regardless of
  the `contextCoaching` setting; see the Mandatory Handoff Lifecycle section below.
- `handoff-read` and `handoff-clear` are ALWAYS available regardless of phase
  or utilization. `handoff-read` returns `NO_HANDOFF_FOUND` when no readable
  record exists; neither tool adds a lifecycle gate.

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
user-visible sentence cannot drift apart. The export name
`UNAVAILABLE_BELOW_40` is an import-compatibility alias for
`UNAVAILABLE_BELOW_UNLOCK`; it carries the 20% wording.

## Mandatory Handoff Lifecycle

The mandatory handoff lifecycle governs sessions approaching context compaction.

### Lifecycle states

```
working -> write_required (>= 80%) -> prepared (fresh handoff-write)
        -> session_handoff_required (compaction detected)
        -> resuming -> working
```

#### write_required (derived, no state file)

`write_required` is derived every turn from live metering data; no new state
file is written. It is true when: `used_percentage >= HANDOFF_REQUIRED_THRESHOLD_PCT`
(80%) AND no eligible prepared record exists for the current session. A hook
directive mandates a handoff write when this condition holds. The mandatory
enforcement is directive-only; no tool gate is added.

Automatic transition eligibility requires `version = HANDOFF_RECORD_VERSION`
(2), `lifecycle = "prepared"`, a non-empty string `generation`, and
`created_by_session` matching the current session.

#### prepared (fresh write at >= H%)

A fresh `handoff-write` at >= 80% utilization produces a `version = 2` record with:
- A randomly generated UUID stored as `generation`.
- `lifecycle = "prepared"`.

Any readable record that does not meet all four eligibility predicates is
ineligible for the automatic transition to `session_handoff_required`. If the
session writes multiple handoffs, only the stored record is considered.

#### session_handoff_required (compaction detected)

When compaction is detected (see Compaction Detection) and an eligible prepared
record exists for the session, that record transitions to
`session_handoff_required`. The hook injects a mandatory handoff-read directive
for **exactly one turn**. This injection:

- Fires regardless of the `contextCoaching` setting (coaching-off isolation).
- Is claimed exactly once per record generation.
- Transitions the record to `resuming` after the claim.
- Requires `handoff-read`; after a successful read, the caller asks exactly
  four structured confirmation questions before acting on the saved handoff.

#### resuming -> working

After the one-turn mandatory read injection is claimed the record moves to
`resuming`. With a current session key, a successful `handoff-read` stamps
`read_by_session` and `read_at`; `markRead` moves every version-2 record to
`working`, regardless of whether `lifecycle` or `generation` was complete.
Readable records with another version or no version are stamped but retain
their lifecycle schema. Without a current session key, the tool returns the
record without calling `markRead`.

### Readable ineligible records

Readable records that fail any automatic-eligibility predicate do not suppress
`write_required` and cannot enter `session_handoff_required` automatically.
This is separate from the read transition: `markRead` advances any version-2
record to `working`, even when its lifecycle or generation is incomplete, while
other readable versions retain their schema. Only a fresh `handoff-write` at or
above 80% produces all four eligible fields through the tool path.

## Compaction Detection

Compaction detection runs on the same `UserPromptSubmit` metering path as every
other phase computation. There is no `PreCompact`, `PostCompact`, or
`SessionStart` compaction detector and no arming ceremony.

Two independent conditions must BOTH hold for a sample pair to classify as
compaction:

1. **Utilization drop (necessary).** Comparing **one adjacent pair** of metering
   samples (the previous-turn and current-turn utilization percentages), the
   drop from previous to current is >= `COMPACTION_DROP_THRESHOLD_PCT` (10
   percentage points) and the previous sample is at or above
   `HANDOFF_REQUIRED_THRESHOLD_PCT` (80%). The drop is necessary but insufficient.
2. **Fresh structural compaction-generation proof (also required).** The current
   sample must carry structural evidence, lifted from the harness, that a fresh
   compaction generation occurred. The qualifying drop is honored only when a new
   structural proof accompanies it.

### Structural proof per harness

- **Claude (exact).** Scan the bounded transcript tail newest-first, skipping
  sidechain records, and select the newest exact main-chain record with
  `type === "system"` and `subtype === "compact_boundary"`. That boundary alone
  decides proof: `compactMetadata.trigger` must equal `"auto"` and its top-level
  `uuid` must be canonical 8-4-4-4-12 hexadecimal form. A newer manual boundary,
  missing metadata, or invalid UUID yields `null` and masks every older valid
  auto boundary. With no main-chain boundary, the optional field is omitted.
- **Codex.** The proof is a fresh compacted context-window identity: a newly
  observed `window_id` / `window_number` on the rollout indicating the context
  window was compacted. Codex exposes no auto-versus-manual compaction cause, so
  a manual `/compact` issued at or above 80% with a qualifying drop is
  structurally indistinguishable from auto-compaction and DOES trigger. This
  residual is an explicitly accepted limitation of the Codex signal.

### Proof persistence and replay

The last-observed compaction generation is persisted in the existing metering
record (`context-metering.md` section 2); no new config key, state file, or
dependency is introduced. An absent or `null` `compaction_generation` means that
sample carries no structural proof. When the adjacent prior sample has absent or
`null` generation proof, a fresh current structural proof may qualify if every
other adjacency, current-sample, threshold, drop, prepared-record, and replay
guard passes. That proof is persisted, and the same proof on a later pair is
rejected as replay, so a single compaction event fires the lifecycle at most once.

### Rejection criteria (unit-test each)

A sample pair is **rejected** (rebaselined, not classified as compaction) when
any of the following holds:

1. **Different session context**: the two samples differ in session ID, harness,
   source, model, or context window size.
2. **Cumulative usage**: the current sample's token count appears cumulative
   (total lifetime tokens) rather than last-turn non-cumulative tokens.
3. **Non-monotonic sequence**: sample timestamps or sequence numbers are
   out-of-order.
4. **Non-adjacent sequence**: the current sequence number is not exactly the
   previous sequence number plus one; sequence gaps are rejected.
5. **Stale sample**: either sample is outside the freshness window.
6. **Unknown percentage**: either utilization value is null or unresolvable.
7. **Previous below H**: the previous sample's utilization is below
   `HANDOFF_REQUIRED_THRESHOLD_PCT` (80%).
8. **Drop below threshold**: the drop is < `COMPACTION_DROP_THRESHOLD_PCT` (10
   percentage points).
9. **Claude newest boundary is not valid auto proof**: the newest main-chain
   `compact_boundary` is manual, lacks `compactMetadata.trigger = "auto"`, or
   lacks a canonical top-level UUID. The adapter returns `null` without scanning
   older boundaries. Codex reports no manual-compaction cause, which is the
   accepted residual noted above.
10. **Sub-agent session**: `SUBAGENT_MCP_SUBAGENT=1` is set.
11. **No fresh structural proof**: the current sample carries no new compaction
    generation (Claude: the newest main-chain boundary does not itself provide
    valid auto proof; Codex: no newly compacted window identity), so the drop is
    unproven.
12. **Replayed proof**: the current structural proof equals the compaction
    generation already persisted in the metering record; that event already fired.

Rejected pairs are rebaselined: the current sample becomes the new previous
sample for the next comparison, and its structural proof (if any) becomes the new
persisted generation baseline. No compaction event is reported for a rejected pair.

## Setup Reconciliation (Claude Code auto-compact)

`setup` reconciles Claude Code's user-scope `settings.json` by writing
`env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "90"`, preserving unrelated settings and
environment keys. It backs up the file before a write, reads the value back for
verification, and emits the normal Claude restart message. `CODEX_AUTOCOMPACT_PCT`
is the source constant that supplies the value `90`; it is not the Claude
setting name.

The unsupported shape is exactly a present `settings.json` `env` value that is
not a JSON object (including `null` or an array). Setup leaves that value
untouched, reports how to make `env` an object, and continues non-fatally. An
invalid settings file is reported as invalid JSON; no host-version capability
detection exists.

Codex CLI natively compacts at 90% and requires no setup-time change.

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
Handoff saved. Keep working in the current session. If the handoff is prepared, automatic compaction will require `handoff-read` for one turn before work resumes.
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
any) for the cwd. Clearing also resets the mandatory lifecycle: the successor
session in the same cwd derives `write_required` fresh when it reaches >= 80%
utilization and has no eligible prepared record.

The handoff lifecycle is not a one-time event. Each successor session that works
in the same cwd may write a voluntary handoff from 20% utilization; the
mandatory lifecycle (write_required, prepared, session_handoff_required) applies
when that session reaches 80% utilization. The write -> read -> re-append cycle
repeats for each successor session.
