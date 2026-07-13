<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## section 10 - Persistence, Carryover & Disable

> **Truth source: `src/orchestration/marker.ts`** (module doc comment +
> `isActive()`). This section MIRRORS the code. The old
> `docs/spec/orchestration-mode/_INDEX.md` "marker-presence = state" /
> "default OFF = no marker" model is DELETED; do not reintroduce it.

- **Default ON; OFF is an explicit session disable-record.** Orchestration is
  default ON. `isActive(cwd, sessionKey)` returns ON (`true`) UNLESS a
  session-scoped key names an unexpired `orch-disable-<hash>.json` file holding
  `{ disabled_at }`. Cwd-keyed disable records are no longer written or read.
  Anonymous keys and absent keys carry no disable authority and always read ON.
  The current session is resolved through a server-scoped session pointer
  (`orch-session-<cwdHash>-<serverKey>.json`, keyed by cwd + server `ppid`);
  on pointer miss, readers fall back to the legacy cwd-only pointer
  (`orch-session-<cwdHash>.json`) and still resolve to a real owner key. The
  legacy pointer is last-writer-wins across concurrent windows and bounded by
  the disable TTL. **Absence of the legacy marker is NOT OFF.** The
  `orch-<cwdHash>.flag` marker is retained only for claim/carryover cadence;
  its presence/absence no longer gates ON/OFF. `src/orchestration/marker.ts` is
  fail-safe (never throws; failed reads -> default ON).
- **Identity ladder is total.** Hooks resolve owner identity as
  `session_id` -> `tp-<hash(transcript_path)>` -> typed anonymous floor
  `anon-<host>-<cwdHash>`. The ladder degrades to the next-strongest signal,
  never to a guess and never to `undefined`. Empty `session_id` falls through.
  Anonymous owner keys are cadence-only: they can claim marker/reminder state,
  but cannot disable orchestration.
- **Anonymous cadence is bounded.** Anonymous claims re-anchor after
  `ANON_CLAIM_TTL_MS` (2h, declared independently from the disable TTL): one
  FULL directive restamps the claim, then normal reminder cadence resumes.
  Corrupt, missing, or future anonymous claim timestamps fail the window and
  re-anchor visibly.
- **Time-bounded disable.** A disable-record is honored for
  `ORCH_DISABLE_TTL_MS` (~2h) from `disabled_at`; past that, `isDisableActive`
  lazily GCs the file and state re-arms to ON, even with no new session. So a
  user-approved disable is per-session and self-expiring, not permanent.
- **Tool flips, hook reports.** The `orchestration-mode` MCP tool writes state
  (`enabled:false` -> session-keyed disable-record; `enabled:true` queries but
  does not mid-session re-enable) and injects nothing. If no session pointer is
  available, or the pointer resolves to an anonymous key, `enabled:false` is
  refused with guidance to use a one-time conversational opt-out. The separate
  per-turn hook reads state via `isActive()` and reports the AUTHORITATIVE ON/OFF
  `<subagent-mcp state="...">`. Disk state is the only channel.
- **Carryover (`kind="carryover"`).** A new owner may inherit a marker an
  earlier owner left ON. The hook classifies FRESH / CARRYOVER / SAME-OWNER from
  the per-owner claim map (`owners`, cap 8, evict oldest `claimed_at`) plus
  legacy mirror fields (`owner_session`, `baseline_turn`, `claimed_at`). Owner
  cap overflow evicts one oldest entry; it never wipes the whole map. On
  CARRYOVER it emits the provider notice (notify + ask-to-remain + advise-fit)
  prepended to FULL, sets `carryover_ack = true`, records this owner, and
  mirrors it to the legacy fields. The `carryover_ack` latch makes the notice
  fire EXACTLY ONCE per marker, while multiple live owners in one cwd no longer
  FULL-thrash each other after their first claim.
- **Disable:** **never on your own initiative.** You MAY propose OFF on
  task-fit mismatch (bounded/interactive/MCP-bound): explain WHAT + WHY and ask
  via the structured-question tool; only explicit user approval may call
  `orchestration-mode enabled:false`, which writes the time-bounded
  session-keyed disable-record above. Keyless hosts get only the one-time,
  non-persisted conversational opt-out. The carryover directives reference this
  backstop when explaining when ON resumes.
- **Directive read before claim mutation.** Hook code reads the directive body
  before it mutates marker, owner, or reminder-counter state. If directive-dir
  resolution or directive read fails, the turn does not consume a claim or
  counter update; the hook fails safe for that injection instead of aborting
  the session state machine.
- **Latch persistence (plan-phase force-enable).** When provider-metered context
  usage crosses `PLAN_LATCH_THRESHOLD_PCT` (15%), the hook writes a session-keyed
  `latch-<hash>.json` record (`{ rev: 2, latched: true, latched_at, session_id }`)
  once and force-enables orchestration for the remainder of that session. Records
  without the current `LATCH_REV` are treated inactive and best-effort unlinked on
  read; this lazily drops bug-era latches derived from stale context-window
  arithmetic. The latch PERSISTS through the 50% handoff phase and does not
  re-trigger its own coaching once tripped (no per-turn re-ask, unlike the
  retired OFF-mode upgrade-ask). It never silently expires mid-session (no
  `ORCH_DISABLE_TTL_MS` expiry applies to it); only a brand-new session (new
  owner key) starts latch-free, per default-OFF-per-session semantics. An explicit
  user `orchestration-mode enabled:false` disable-record (2h TTL, session-keyed)
  is STILL honored after the latch trips and wins over the latch, so the
  disable-check precedes the latch OR in the effective-active computation. See
  `context-metering.md` and `sections-00-04.md` (phase thresholds).
- **Handoff persistence (cwd-keyed, cross-session cycle).** A handoff record
  (`handoff-<cwdHash>.json`) is keyed by cwd, not session, so a successor session
  working in the same directory can read what its predecessor wrote via
  handoff-write. The write/read/clear cycle repeats at EACH successor session's
  50% crossing: the next session again winds down and may write a fresh handoff
  at its own 50% phase, which resets any prior reader binding (`read_by_session`,
  `read_at`) and replaces the prior record. Only the session that ran
  handoff-read (`read_by_session === current`) re-appends the saved content
  verbatim to its LONG reminders. See `handoff.md`.
- **Atomic state writes.** Every marker/state file (`orch-<cwdHash>.flag`, the
  session-keyed disable-record, reminder counters, and both session pointers)
  is written through
  `atomicWriteFile`/`atomicWriteJson` (`src/orchestration/atomic-write.ts`):
  write to a unique sibling `.<name>.<pid>.<time>.<rand>.tmp`, then `rename`
  onto the target so a concurrent reader sees either the whole old file or the
  whole new one, never a torn write. On a Windows `EEXIST`/`EPERM` rename over
  an existing target, it unlinks the target and retries; on any write/rename
  failure it best-effort unlinks the temp so no `.tmp` litter is left behind.
  This preserves the module's fail-safe contract (never throws to the hook).
  Reminder-counter updates are also serialized under the process-local cwd lock
  before the atomic temp-file write and rename.
- **Fail-safe ON is NOT the same as default ON.** Default ON is the normal
  hook-bearing state (no active disable-record). Fail-safe ON is the separate
  hookless / no-tag case (Gemini, desktop) where no state channel exists and
  state is UNKNOWN -> default ON; see section 5 (D18/D6) and the section 9 host matrix. Both
  land on ON; only a session-keyed disable-record can produce OFF.

---

## section 11 - Tests (S7 gating + S4 non-gating)

### 11.1 GATING (S7) - block merge

| Test | Asserts | Decision |
|---|---|---|
| `test/launch-agent-upsert.test.mjs` | `ensureParentMarker` upsert + shared `hasParentMarker` coherence | D20 / S8 |
| `test/no-five-call.test.mjs` | `/5[ -]?call/i` matches **zero** files under `src/` and `directives/` | D11 / D24 |
| `test/init-migration.test.mjs` | v1/schema=2 block -> exactly one schema=3 block in-place (`updated`); double-legacy -> collapsed to one; schema=3 present -> idempotent (`ok`); one write per call | D22 / S3 |

### 11.2 NON-GATING (S4) - must exist before ship, does not block merge

| Test | Asserts | Decision |
|---|---|---|
| `test/mirror-fragments.test.mjs` | A2 read-ladder byte-identical in INIT_BLOCK <-> MCP `instructions`; A4 supremacy clause byte-identical across the three host files | D25 / D7 |

---

## section 12 - Failure-Mode Matrix

| Failure mode | Behavior | Explicit suppressor / exit |
|---|---|---|
| subagent-mcp dropout while ON | HALT-until-restored; nothing inline (section 7) | user explicitly abandons the whole task (S5): ends task, never inline-degrades |
| No hook injection (hookless host) | UNKNOWN (tag absence) -> warn + explain -> **fail-safe ON** (section 5) | one-time per-session user opt-out (S6); sub-agent first-line exemption |
| Fail-safe-ON recursion / fork-bomb | child would re-orchestrate | **first-line exemption** (section 6) + `launch_agent` silent upsert (A7) |
| Hook execution error | hook emits `""`; turn never crashes | n/a (fail-open to no-injection, which the host handles per section 5) |
| Stale MCP `instructions` (S9) | FAT INIT_BLOCK governs the session | reconnect refresh (S9) |

---

## section 13 - Cross-Provider / Structured-Question Tool Map

| Provider | Structured-question tool | Directive variants |
|---|---|---|
| Claude | `AskUserQuestion` | `orchestration-claude.md`, `carryover-claude.md`, `reminder-off-claude.md` |
| Codex | `request-user-input` | `orchestration-codex.md`, `carryover-codex.md`, `reminder-off-codex.md` |
| Shared | (per active provider) | `reminder-on.md`, `short-on.md`, `short-off.md` |

ProviderAdapter filenames are unchanged (hook-core contract preserved).

### 13.1 Coaching structured-question map (metered lifecycle)

The metered latch/handoff coaching mandates exact question counts and call
splits per harness. These three rows are binding.

| Coaching trigger | Questions | Claude call shape | Codex call shape |
|---|---|---|---|
| 15% latch (plan phase) | 5 | 4 questions in one `AskUserQuestion` call + 1 question in a second `AskUserQuestion` call (four-plus-one, two calls; NEVER 5-in-one-call, NEVER any other split) | a single `request-user-input` call carrying all 5 questions (NOT split) |
| handoff-write pre-write (>=50%) | 10 | three `AskUserQuestion` calls (4+4+2; each call takes at most 4 questions) | one `request-user-input` call carrying all 10 |
| handoff-read pre-act | 5 | one call | one call |

Latch coaching bodies live in `directives/latch-claude.md` / `latch-codex.md`;
handoff coaching bodies in `directives/handoff-claude.md` / `handoff-codex.md`.
