<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## §10 — Persistence, Carryover & Disable

> **Persistence mechanics MIRROR `docs/spec/orchestration-mode/_INDEX.md`**
> ("Architecture", "Persistence and session-start carryover", locked decision
> #5). That index is authoritative for the marker; this section restates it.
> The stale `orch-session-*.json` / `orch-disable-*.json` / "defaults ON per
> session" model is DELETED — do not reintroduce it.

- **Single marker, presence = state.** State is ONE per-project marker at
  `os.tmpdir()/subagent-mcp/orch-<cwdHash>.flag` (`cwdHash` = first 16 hex of
  `sha256(normalizeCwd(cwd))`). **PRESENCE = ENABLED (ON); ABSENCE = DISABLED
  (OFF).** There is NO `enabled` field and NO `cwd` field — cwd lives in the
  FILENAME. Fields: `owner_session`, `baseline_turn`, `provenance`
  (`user-enabled`/`carried-over`/`null`), `carryover_ack`. `src/orchestration/marker.ts`
  is fail-safe (never throws; failed reads → safe defaults).
- **Tool flips, hook reports.** The `orchestration-mode` MCP tool ONLY writes
  the marker (`enabled:true`) or deletes it (`enabled:false`) — it injects
  nothing. The **separate per-turn hook** reads the marker and reports the
  AUTHORITATIVE ON/OFF `<subagent-mcp state="...">`. Disk marker is the only channel.
- **Persists across sessions/restarts.** An enabled marker stays ON until
  disabled; it is NOT cleared on startup (SUPERSEDES the old startup-clear).
  **Default OFF = no marker.**
- **Carryover (`kind="carryover"`).** A NEW session may inherit a marker an
  earlier session left ON. The hook classifies FRESH / CARRYOVER / SAME-SESSION
  from `owner_session`, `provenance`, `carryover_ack`, current `session_id`; on
  CARRYOVER it emits the provider notice (notify + ask-to-remain + advise-fit)
  prepended to FULL, sets `carryover_ack = true`, and re-claims. The
  `carryover_ack` latch makes the notice fire EXACTLY ONCE per marker.
- **Disable:** **never on your own initiative.** You MAY *propose* OFF on
  task-fit mismatch (bounded/interactive/MCP-bound) — explain WHAT + WHY and ask
  via the structured-question tool; only explicit user approval may call
  `orchestration-mode enabled:false`, which DELETES the marker.
  A user-approved disable is per-session and time-bounded: the disable record
  expires after the ~2-hour backstop in `src/orchestration/marker.ts`, re-arming
  ON even if no new session started. The carryover directives reference this
  backstop when explaining when ON resumes.
- **Fail-safe ON is NOT persistence.** It applies ONLY to hookless / no-tag
  hosts (Gemini, desktop) where no marker/hook channel exists and state is
  UNKNOWN → default ON — see §5 (D18/D6) and the §9 host matrix. On hook-bearing
  hosts, marker presence/absence is the SOLE source of ON/OFF.

---

## §11 — Tests (S7 gating + S4 non-gating)

### 11.1 GATING (S7) — block merge

| Test | Asserts | Decision |
|---|---|---|
| `test/launch-agent-upsert.test.mjs` | `ensureParentMarker` upsert: 7 cases (Appendix A7.2) | D20 / S8 |
| `test/no-five-call.test.mjs` | `/5[ -]?call/i` matches **zero** files under `src/` and `directives/` | D11 / D24 |
| `test/init-migration.test.mjs` | v1 block → exactly one schema=2 block in-place (`updated`); double-legacy → collapsed to one; schema=2 present → idempotent (`ok`); one write per call | D22 / S3 |

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

