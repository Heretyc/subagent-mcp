# Orchestration Directive Architecture (schema=2) — RETRIEVAL MAP

> **D21 — GENERATIVE SOURCE OF TRUTH.** The normative content lives in the leaf
> files under `orchestration-directive-architecture/` (this doc was split per the
> repo's own >200-line decomposition rule). This file is a RETRIEVAL MAP only —
> it holds NO normative rules. Load the exact leaf you need; do NOT reason from
> this map alone. The MCP `instructions` (`src/index.ts`), the `INIT_BLOCK`
> (`src/init.ts`), the nine `directives/*.md`, and both tool descriptions are
> DERIVED from the leaves and COPY the Appendix A artifacts byte-for-byte.

## One-screen summary

`subagent-mcp` ships a per-turn orchestration regime expressed redundantly across
three surfaces (MCP `instructions`, upserted `INIT_BLOCK`, per-turn hook
directives). ON = delegate-only orchestrator (launch_agent sole channel, no
inline reads/writes). OFF = solo + per-turn >200-line upgrade check. State is
reported SOLELY by the hook `<subagent-mcp state="...">` tag; hookless hosts →
UNKNOWN → fail-safe ON. Sub-agent first-line marker skips the whole regime.

## Leaf directory (load when / do not load when)

| Leaf | Covers | Load when | Do NOT load when |
|---|---|---|---|
| `orchestration-directive-architecture/sections-00-04.md` | §0 layering/redundancy, §1 single tag schema, §2 precedence/co-supremacy, §3 ON model, §4 OFF model | you need the tag schema, ON/OFF operating model, or precedence rules | you only need marker/persistence or test mechanics |
| `…/sections-05-09.md` | §5 no-hook fail-safe ON + opt-out, §6 first-line exemption + launch_agent upsert, §7 dropout/HALT, §8 markers/MIGRATE_RE/collapse, §9 cross-provider matrix | debugging hookless hosts, sub-agent fork-bomb prevention, dropout, or block migration | you need the ON/OFF model or appendices |
| `…/sections-10-13.md` | §10 persistence/carryover/disable, §11 tests, §12 failure matrix, §13 structured-question tool map | reasoning about marker persistence, carryover, disable, or the test gates | you need tag/ON/OFF semantics |
| `…/derivation-map.md` | §14 R-ID definitions, artifact×R-ID rendering, 5-call tombstone | tracing which artifact renders which canonical rule | authoring runtime behavior |
| `…/appendix-a1-a4.md` | A1 INIT_BLOCK (verbatim), A2 read-ladder, A3 MCP `instructions`, A4 supremacy clause | you must COPY a canonical artifact byte-for-byte | you only need prose explanation |
| `…/appendix-a5-directives.md` | A5 — the 9 `directives/*.md` files, verbatim | editing/regenerating a directive file | you need marker or test specs |
| `…/appendix-a6-a7.md` | A6 marker spec/MIGRATE_RE/collapse algorithm, A7 `ensureParentMarker` + 7 test cases | implementing init migration or the parent-marker upsert | you need the ON/OFF prose model |

## Topic → leaf index

- single tag `<subagent-mcp state kind>`, no dead values → `sections-00-04.md` (§1)
- co-supremacy, escalate-to-user, tag > user request → `sections-00-04.md` (§2); verbatim clause → `appendix-a1-a4.md` (A4)
- ON allowed-tools, sole channel, read-ladder → `sections-00-04.md` (§3); ladder verbatim → `appendix-a1-a4.md` (A2)
- OFF >200-line cumulative footprint upgrade ask → `sections-00-04.md` (§4)
- fail-safe ON / UNKNOWN / one-time opt-out → `sections-05-09.md` (§5)
- first-line `<this is a request from a parent process>` skip + upsert → `sections-05-09.md` (§6), `appendix-a6-a7.md` (A7)
- schema=2 markers, MIGRATE_RE, duplicate collapse → `sections-05-09.md` (§8), `appendix-a6-a7.md` (A6)
- persistence marker `orch-<cwdHash>.flag`, carryover, disable → `sections-10-13.md` (§10) + `docs/spec/orchestration-mode/_INDEX.md`
- tests (gating/non-gating), 5-call gate → `sections-10-13.md` (§11), `derivation-map.md` (§14.3)
- INIT_BLOCK / MCP instructions verbatim → `appendix-a1-a4.md`
- the 9 directive files verbatim → `appendix-a5-directives.md`

## Trigger phrases

"orchestration ON/OFF", "delegate-only", "launch_agent", "read-escalation
ladder", "co-supreme / supremacy clause", "fail-safe ON", "no-hook / UNKNOWN
state", "first-line exemption / fork-bomb", "INIT_BLOCK", "MIGRATE_RE / schema=2
markers", "ensureParentMarker", "R-ID derivation", "5-call rule".

> **CRITICAL — do NOT answer orchestration questions from this map.** It is an
> index. Open the named leaf and read the normative text before acting or
> editing. Appendix A artifacts (A1–A7) are byte-canonical: COPY, never paraphrase.
