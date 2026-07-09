<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## §10 — Persistence, Carryover & Disable

> **Truth source: `src/orchestration/marker.ts`** (module doc comment +
> `isActive()`). This section MIRRORS the code. The old
> `docs/spec/orchestration-mode/_INDEX.md` "marker-presence = state" /
> "default OFF = no marker" model is DELETED (that file is tombstoned) — do not
> reintroduce it.

- **Default ON; OFF is an explicit disable-record.** Orchestration is default
  ON. `isActive(cwd, sessionKey)` returns ON (`true`) UNLESS an unexpired
  disable-record file exists — a session-keyed `orch-disable-<hash>.json`
  (cwd-keyed `orch-disable-<cwdHash>.json` fallback when no session key is
  available), each holding `{ disabled_at }`. The current session is resolved
  through a **server-scoped** session pointer
  (`orch-session-<cwdHash>-<serverKey>.json`, keyed by cwd + server `ppid`), so a
  disable targets the requesting session; the legacy cwd-only
  `orch-session-<cwdHash>.json` pointer is still written for back-compat.
  **Absence of the legacy marker is NOT OFF.** The `orch-<cwdHash>.flag` marker (fields `owner_session`,
  `baseline_turn`, `provenance`, `carryover_ack`) is retained ONLY as legacy
  state for callers that still write/read it; its presence/absence no longer
  gates ON/OFF. `src/orchestration/marker.ts` is fail-safe (never throws;
  failed reads → default ON).
- **Time-bounded disable.** A disable-record is honored for
  `ORCH_DISABLE_TTL_MS` (~2h) from `disabled_at`; past that, `isDisableActive`
  lazily GCs the file and state re-arms to ON — even with no new session. So a
  user-approved disable is per-session and self-expiring, not permanent.
- **Tool flips, hook reports.** The `orchestration-mode` MCP tool writes state
  (`enabled:false` → disable-record; `enabled:true` → clears it / writes the
  legacy marker) — it injects nothing. The **separate per-turn hook** reads
  state via `isActive()` and reports the AUTHORITATIVE ON/OFF
  `<subagent-mcp state="...">`. Disk state is the only channel.
- **Carryover (`kind="carryover"`).** A NEW session may inherit a marker an
  earlier session left ON. The hook classifies FRESH / CARRYOVER / SAME-SESSION
  from `owner_session`, `provenance`, `carryover_ack`, current `session_id`; on
  CARRYOVER it emits the provider notice (notify + ask-to-remain + advise-fit)
  prepended to FULL, sets `carryover_ack = true`, and re-claims. The
  `carryover_ack` latch makes the notice fire EXACTLY ONCE per marker.
- **Disable:** **never on your own initiative.** You MAY *propose* OFF on
  task-fit mismatch (bounded/interactive/MCP-bound) — explain WHAT + WHY and ask
  via the structured-question tool; only explicit user approval may call
  `orchestration-mode enabled:false`, which writes the time-bounded
  disable-record above. The carryover directives reference this backstop when
  explaining when ON resumes.
- **Fail-safe ON is NOT the same as default ON.** Default ON is the normal
  hook-bearing state (no active disable-record). Fail-safe ON is the separate
  hookless / no-tag case (Gemini, desktop) where no state channel exists and
  state is UNKNOWN → default ON — see §5 (D18/D6) and the §9 host matrix. Both
  land on ON; only the disable-record can produce OFF.

---

## §11 — Tests (S7 gating + S4 non-gating)

### 11.1 GATING (S7) — block merge

| Test | Asserts | Decision |
|---|---|---|
| `test/launch-agent-upsert.test.mjs` | `ensureParentMarker` upsert: 7 cases (Appendix A7.2) | D20 / S8 |
| `test/no-five-call.test.mjs` | `/5[ -]?call/i` matches **zero** files under `src/` and `directives/` | D11 / D24 |
| `test/init-migration.test.mjs` | v1/schema=2 block → exactly one schema=3 block in-place (`updated`); double-legacy → collapsed to one; schema=3 present → idempotent (`ok`); one write per call | D22 / S3 |

### 11.2 NON-GATING (S4) — must exist before ship, does not block merge

| Test | Asserts | Decision |
|---|---|---|
| `test/mirror-fragments.test.mjs` | A2 read-ladder byte-identical in INIT_BLOCK ↔ MCP `instructions`; A4 supremacy clause byte-identical across the three host files | D25 / D7 |

---

## §12 — Failure-Mode Matrix

| Failure mode | Behavior | Explicit suppressor / exit |
|---|---|---|
| subagent-mcp dropout while ON | HALT-until-restored; nothing inline (§7) | user explicitly abandons the whole task (S5) — ends task, never inline-degrades |
| No hook injection (hookless host) | UNKNOWN (tag absence) → warn + explain → **fail-safe ON** (§5) | one-time per-session user opt-out (S6); sub-agent first-line exemption |
| Fail-safe-ON recursion / fork-bomb | child would re-orchestrate | **first-line exemption** (§6) + `launch_agent` silent upsert (A7) |
| Hook execution error | hook **emits `""`**; turn never crashes | n/a (fail-open to no-injection, which the host handles per §5) |
| Stale MCP `instructions` (S9) | FAT INIT_BLOCK governs the session | reconnect refresh (S9) |

---

## §13 — Cross-Provider / Structured-Question Tool Map

| Provider | Structured-question tool | Directive variants |
|---|---|---|
| Claude | `AskUserQuestion` | `orchestration-claude.md`, `carryover-claude.md`, `reminder-off-claude.md` |
| Codex | `request-user-input` | `orchestration-codex.md`, `carryover-codex.md`, `reminder-off-codex.md` |
| Shared | (per active provider) | `reminder-on.md`, `short-on.md`, `short-off.md` |

ProviderAdapter filenames are **unchanged** (hook-core contract preserved).

---

