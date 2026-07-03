<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## §14 — R-ID Derivation Map (D21)

Each canonical rule fragment has an **R-ID** defined once here; every derived
artifact renders one or more R-IDs. This table is the traceability mechanism (no
fragment `.txt` files; convention + the mirror test enforce it).

### 14.1 Canonical fragment definitions

| R-ID | Canonical definition (this doc) |
|---|---|
| **R-TAG** | §1 single tag `<subagent-mcp state kind>` + mandatory-`state` disambiguation; no dead values |
| **R-SUPREMACY** | §2 co-supreme hook tag + safety-scope; escalate-to-user; tag > ordinary user request (A4) |
| **R-SOLE-CHANNEL** | §3 every launch via `launch_agent`; native/shell spawn FORBIDDEN |
| **R-ON-STRICT** | §3 allowed-tools allowlist; no inline-by-right; one-time exception protocol |
| **R-READ-LADDER** | §3.1 poll_agent tail → ≤100-line summarizer → user reads; scratch-file PATH handoff (A2) |
| **R-OFF-UPGRADE** | §4 >200-line cumulative footprint; ask every qualifying turn; no latch; reset-on-ask |
| **R-NOHOOK** | §5 UNKNOWN=tag-absence → warn + explain + one-time opt-out → fail-safe ON |
| **R-EXEMPT** | §6 first-line `<this is a request from a parent process>` skips the regime; launch_agent upsert |
| **R-DROPOUT** | §7 HALT-until-restored; only exit = explicit task abandonment |
| **R-MARKERS** | §8 schema=2 markers + union MIGRATE_RE + duplicate collapse |
| **R-NO5CALL** | §4 5-call rule DELETED everywhere; permanent grep gate |

### 14.2 Artifact × R-ID rendering

| Artifact | Renders | Mirrored fragments |
|---|---|---|
| MCP `instructions` (A3) | R-TAG, R-SUPREMACY, R-SOLE-CHANNEL, R-ON-STRICT, R-READ-LADDER, R-OFF-UPGRADE, R-NOHOOK, R-EXEMPT, R-DROPOUT, R-NO5CALL | **A2** (read ladder, D25) |
| INIT_BLOCK (A1) | R-TAG, R-SUPREMACY, R-SOLE-CHANNEL, R-ON-STRICT, R-READ-LADDER, R-OFF-UPGRADE, R-NOHOOK, R-EXEMPT, R-DROPOUT | **A2** (D25) + **A4** (D7) |
| `orchestration-{claude,codex}.md` | R-EXEMPT, R-ON-STRICT, R-READ-LADDER, R-SUPREMACY, R-SOLE-CHANNEL, R-DROPOUT | — |
| `carryover-{claude,codex}.md` | R-EXEMPT, R-SUPREMACY (compat carrier for inherited/legacy ON; one-time remain-enabled confirmation) | — |
| `reminder-on.md` | R-EXEMPT, R-ON-STRICT, R-READ-LADDER, R-SUPREMACY | — |
| `reminder-off-{claude,codex}.md` | R-EXEMPT, R-OFF-UPGRADE | — |
| `short-on.md` | R-EXEMPT, R-ON-STRICT (one-line) | — |
| `short-off.md` | R-EXEMPT, R-OFF-UPGRADE (one-line) | — |
| `src/init.ts` migration | R-MARKERS | — |
| `launch_agent` (`ensureParentMarker`) | R-EXEMPT (enforcement) | — |
| Both tool descriptions | R-NO5CALL (absence) | — |

### 14.3 5-call deletion sweep (D24) — COMPLETED

**Completed — verified by `test/no-five-call.test.mjs`; historical checklist
removed.** The permanent grep gate (§11.1) asserts `/5[ -]?call/i` matches zero
files under `src/` and `directives/`; a green run is the standing proof the
sweep landed, superseding the per-item checklist.

---

