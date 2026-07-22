<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## section 14 : R-ID Derivation Map (D21)

Each canonical rule fragment has an **R-ID** defined once here; every derived
artifact renders one or more R-IDs. This table is the traceability mechanism (no
fragment `.txt` files; convention + the mirror test enforce it).

### 14.1 Canonical fragment definitions

| R-ID | Canonical definition (this doc) |
|---|---|
| **R-TAG** | section 1 single tag `<subagent-mcp state kind>` + mandatory-`state` disambiguation; no dead values |
| **R-SUPREMACY** | section 2 jointly binding hook tag + safety-scope; escalate-to-user; tag > ordinary user request (A4) |
| **R-SOLE-CHANNEL** | section 3 every launch in ON and OFF via `launch_agent`; native/harness/shell paths fragment permissions, instruction compliance, and context, so are FORBIDDEN |
| **R-ON-STRICT** | section 3 allowed-tools allowlist; no inline-by-right; one-time exception protocol |
| **R-SKILL-READ** | section 3 ON-only direct read of applicable `SKILL.md` + explicitly required same-folder files; no task action; approval only for expanded owner scope |
| **R-READ-LADDER** | section 3.1 poll_agent tail → ≤100-line summarizer → user reads; scratch-file PATH handoff (A2) |
| **R-NOHOOK** | section 5 UNKNOWN=tag-absence → warn + explain + one-time opt-out → fail-safe ON |
| **R-EXEMPT** | section 6 first-line `<this is a request from a parent process>` skips the regime; launch_agent upsert |
| **R-DROPOUT** | section 7 HALT-until-restored; only exit = explicit task abandonment |
| **R-MARKERS** | section 8 schema=5 markers + union MIGRATE_RE + duplicate collapse |
| **R-NO5CALL** | section 4 5-call rule DELETED everywhere; permanent grep gate |
| **R-START-OFF** | section 4 keyed sessions default OFF without setup-time state writes; keyless/undetectable metering fails safe ON |
| **R-LATCH-15** | section 4/10 15% latch + a planning stop of AT LEAST 4 open questions asked with the structured question tool (or natural prose where none exists), turned into the session's goal context; explicit session-keyed enabled:false (2h TTL) beats latch/fail-safe; explicit enabled:true may re-enable mid-session; unaffected by `contextCoaching` |
| **R-MODEL-SMART** | model selection unset defaults smart; server auto-picks and rejects selectors outside an explicitly user-approved override window |
| **R-HANDOFF-40** | section 10/13 goal-context unlock at **20%** utilization (ID retained for traceability; the number moved 40 -> 20): unlock handoff-write/read/clear; write gated >=20% with readable metering; the 20% constant is FIXED and never configurable; 4000/8000-char limits; 10-question pre-write and EXACTLY-4-question pre-read coaching |
| **R-HANDOFF-WARN-50** | section 10/13 wind-down warning (ID retained; the threshold is no longer the literal 50): at or above `handoffWarnThreshold` (user-level setting, default **60**, valid 40-90) warn every turn to wind down and append the handoff steer (no big-work exemption); `contextCoaching: false` (default `true`) mutes ONLY this warn/steer and `near_limit`, never the latch or the unlock; missing keys silently default to `true` / `60` |
| **R-TAG-TEMPLATE** | section 1 templated tag `<subagent-mcp state kind phase utilization>` + `Remaining Context=NN%` footer; any template/metering error => inject nothing |
| **R-HOOK-COACH-DOCTRINE** | contextual hook coaching preferred over frontmatter/system-prompt bulk; frontmatter only states that hook injections coach correct subagent-mcp use (prevents data corruption, hallucination, resource contention) |

### 14.2 Artifact × R-ID rendering

| Artifact | Renders | Mirrored fragments |
|---|---|---|
| MCP `instructions` (A3) | R-TAG, R-SUPREMACY, R-SOLE-CHANNEL, R-ON-STRICT, R-SKILL-READ, R-READ-LADDER, R-START-OFF, R-LATCH-15, R-MODEL-SMART, R-NOHOOK, R-EXEMPT, R-DROPOUT, R-NO5CALL | A2 semantics (compressed) |
| INIT_BLOCK (A1) | R-TAG, R-SUPREMACY, R-SOLE-CHANNEL, R-ON-STRICT, R-SKILL-READ, R-READ-LADDER, R-START-OFF, R-LATCH-15, R-MODEL-SMART, R-HOOK-COACH-DOCTRINE, R-NOHOOK, R-EXEMPT, R-DROPOUT | **A2** (D25) + **A4** (D7) |
| `orchestration-{claude,codex}.md` | R-EXEMPT, R-ON-STRICT, R-READ-LADDER, R-SUPREMACY, R-SOLE-CHANNEL, R-DROPOUT | : |
| `carryover-{claude,codex}.md` | R-EXEMPT, R-SUPREMACY, R-LATCH-15 (compat carrier for a current-session ON triggered by an inherited enable OR a 15% latch record; one-time remain-enabled confirmation) | : |
| `reminder-on.md` | R-EXEMPT, R-ON-STRICT, R-READ-LADDER, R-SUPREMACY | : |
| `reminder-off-{claude,codex}.md` | R-EXEMPT, R-START-OFF | : |
| `short-on.md` | R-EXEMPT, R-ON-STRICT (one-line) | : |
| `short-off.md` | R-EXEMPT, R-START-OFF (one-line) | : |
| `latch-{claude,codex}.md` | R-LATCH-15 | the latch coaching line is ONE verbatim harness-neutral string, byte-identical in both files |
| `handoff-{claude,codex}.md` | R-HANDOFF-40 / R-HANDOFF-WARN-50 | : |
| `~/.subagent-mcp/settings*.json` + `src/concurrency.ts` (`contextCoaching`, `handoffWarnThreshold`) | R-HANDOFF-WARN-50 (config surface; user level only) | : |
| `setup` context-coaching prompts (`src/setup.ts`) | R-HANDOFF-WARN-50 (first-run capture of both keys) | : |
| `tag-template.md` | R-TAG-TEMPLATE | : |
| `hook-core.ts` (tag/footer + phase/latch) | R-START-OFF, R-TAG-TEMPLATE | : |
| three handoff tool descriptions (`src/index.ts`) | R-HANDOFF-40 / R-HANDOFF-WARN-50 | : |
| `src/init.ts` migration | R-MARKERS | : |
| `launch_agent` (`ensureParentMarker`) | R-EXEMPT (enforcement) | : |
| Both tool descriptions | R-NO5CALL (absence) | : |

### 14.3 5-call deletion sweep (D24) : COMPLETED

**Completed : verified by `test/no-five-call.test.mjs`; historical checklist
removed.** The permanent grep gate (section 11.1) asserts `/5[ -]?call/i` matches zero
files under `src/` and `directives/`; a green run is the standing proof the
sweep landed, superseding the per-item checklist.

---

