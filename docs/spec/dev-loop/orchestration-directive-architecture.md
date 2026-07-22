# Orchestration Directive Architecture (schema=3) : RETRIEVAL MAP

> **D21 : GENERATIVE SOURCE OF TRUTH.** The normative content lives in the leaf
> files under `orchestration-directive-architecture/` (this doc was split per the
> repo's own >200-line decomposition rule). This file is a RETRIEVAL MAP only :
> it holds NO normative rules. Load the exact leaf you need; do NOT reason from
> this map alone. The MCP `instructions` (`src/index.ts`), the `INIT_BLOCK`
> (`src/init.ts`), the nine `directives/*.md`, and both tool descriptions are
> DERIVED from the leaves and COPY the Appendix A artifacts byte-for-byte.

## One-screen summary

`subagent-mcp` ships a per-turn orchestration regime expressed redundantly across
three surfaces (MCP `instructions`, upserted `INIT_BLOCK`, per-turn hook
directives). ON = delegate-only orchestrator (launch_agent sole channel, no
inline reads/writes). OFF = solo + provider-metered context tracking
(context-metering.md); ENFORCED-ON at the 15% latch, with the handoff tools
unlocking at 20% and the wind-down warning firing at the user-configured
threshold (default 60%, valid 40-90) unless `contextCoaching` is off (see
R-LATCH-15/R-HANDOFF-40/R-HANDOFF-WARN-50; the two R-IDs keep their historical
numbers). State is
reported SOLELY by the hook `<subagent-mcp state="...">` tag; hookless hosts →
UNKNOWN → fail-safe ON. Sub-agent first-line marker skips the whole regime.

Orchestration mode is **orthogonal** to the permission system: orchestration
mode governs *who* decides to delegate work to sub-agents; `permissionsCeiling`
(`docs/spec/permissions.md`) governs *what* a launched sub-agent may do without
escalation. The `permission_requested` status and the `respond_permission` tool
belong to the permission system, not this regime. (Note: the Claude PreToolUse
gate `src/orchestration/pretool.ts` denies the harness-native `Agent` launcher
for orchestrators **and** sub-agents alike : the SOLE-CHANNEL fork-bomb
guard, see `sections-05-09.md` section 6.3; Task widget tools and Explore are
not denied by the hook; it does **not** make a launched child's permission
decisions : those run through the shared engine in `src/drivers.ts`.)

## Leaf directory (load when / do not load when)

| Leaf | Covers | Load when | Do NOT load when |
|---|---|---|---|
| `orchestration-directive-architecture/sections-00-04.md` | section 0 layering/redundancy, section 1 single tag schema, section 2 precedence/joint-binding, section 3 ON model, section 4 OFF model | you need the tag schema, ON/OFF operating model, or precedence rules | you only need marker/persistence or test mechanics |
| `.../sections-05-09.md` | section 5 no-hook fail-safe ON + opt-out, section 6 first-line exemption + launch_agent upsert, section 7 dropout/HALT, section 8 markers/MIGRATE_RE/collapse, section 9 cross-provider matrix | debugging hookless hosts, sub-agent fork-bomb prevention, dropout, or block migration | you need the ON/OFF model or appendices |
| `.../sections-10-13.md` | section 10 persistence/carryover/disable, section 11 tests, section 12 failure matrix, section 13 structured-question tool map | reasoning about marker persistence, carryover, disable, or the test gates | you need tag/ON/OFF semantics |
| `.../derivation-map.md` | section 14 R-ID definitions, artifact×R-ID rendering, 5-call tombstone | tracing which artifact renders which canonical rule | authoring runtime behavior |
| `.../appendix-a1-a4.md` | A1 INIT_BLOCK (verbatim), A2 read-ladder, A3 MCP `instructions`, A4 supremacy clause | you must COPY a canonical artifact byte-for-byte | you only need prose explanation |
| `.../appendix-a5-directives.md` | A5 : the 9 `directives/*.md` files, verbatim | editing/regenerating a directive file | you need marker or test specs |
| `.../appendix-a6-a7.md` | A6 marker spec/MIGRATE_RE/collapse algorithm, A7 `ensureParentMarker` + 7 test cases | implementing init migration or the parent-marker upsert | you need the ON/OFF prose model |
| `.../statusline-signal.md` | Claude statusLine shim, `sl-*` records, harness percentage/window lift, setup wrapping, sweep | documenting or debugging Claude statusline context metering | you need ON/OFF prose semantics |

## Topic → leaf index

- single tag `<subagent-mcp state kind>`, no dead values → `sections-00-04.md` (section 1)
- joint binding, escalate-to-user, tag > user request → `sections-00-04.md` (section 2); verbatim clause → `appendix-a1-a4.md` (A4)
- ON allowed-tools, sole channel, read-ladder → `sections-00-04.md` (section 3); ladder verbatim → `appendix-a1-a4.md` (A2)
- OFF metering fail-safe + phase thresholds → `sections-00-04.md` (section 4), `context-metering.md`, `statusline-signal.md`, `handoff.md`
- `contextCoaching` / `handoffWarnThreshold` user settings (what they mute, what they never mute) → `context-metering.md` (section 3.1), `handoff.md`; install-time prompts → `docs/spec/dev-loop/init-registry-and-update.md`
- fail-safe ON / UNKNOWN / one-time opt-out → `sections-05-09.md` (section 5)
- first-line `<this is a request from a parent process>` skip + upsert → `sections-05-09.md` (section 6), `appendix-a6-a7.md` (A7)
- schema=3 markers, MIGRATE_RE, duplicate collapse → `sections-05-09.md` (section 8), `appendix-a6-a7.md` (A6)
- default-ON, disable-record, carryover, disable → `sections-10-13.md` (section 10) + `src/orchestration/marker.ts` (truth source)
- tests (gating/non-gating), 5-call gate → `sections-10-13.md` (section 11), `derivation-map.md` (section 14.3)
- INIT_BLOCK / MCP instructions verbatim → `appendix-a1-a4.md`
- the 9 directive files verbatim → `appendix-a5-directives.md`
- permission gating / `permissionsCeiling` / `respond_permission` /
  `permission_requested` (orthogonal to this regime) → `docs/spec/permissions.md`
- Claude statusLine side channel / `sl-*` records -> `statusline-signal.md`

## Trigger phrases

"orchestration ON/OFF", "delegate-only", "launch_agent", "read-escalation
ladder", "jointly binding / supremacy clause", "fail-safe ON", "no-hook / UNKNOWN
state", "first-line exemption / fork-bomb", "INIT_BLOCK", "MIGRATE_RE / schema=3
markers", "ensureParentMarker", "R-ID derivation", "5-call rule".

> **CRITICAL : do NOT answer orchestration questions from this map.** It is an
> index. Open the named leaf and read the normative text before acting or
> editing. Appendix A artifacts (A1:A7) are byte-canonical: COPY, never paraphrase.
