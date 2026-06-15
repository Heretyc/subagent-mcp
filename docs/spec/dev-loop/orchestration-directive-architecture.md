# Orchestration Directive Architecture (schema=2)

> **D21 — THIS DOCUMENT IS THE GENERATIVE SOURCE OF TRUTH.** The MCP
> `instructions` string (`src/index.ts`), the upserted `INIT_BLOCK`
> (`src/init.ts`), the nine `directives/*.md` files, and both tool descriptions
> are **DERIVED** from this document. They must not drift from it. When any of
> them disagrees with this doc, this doc is authoritative and the derived
> artifact is the bug. Downstream implementation tasks **COPY the canonical
> verbatim artifacts in Appendix A byte-for-byte**; do not paraphrase them.

---

## §0 — Overview & Layering

### 0.1 Why this exists

`subagent-mcp` ships a per-turn orchestration regime that must be expressed
identically across many surfaces (a connect-once MCP `instructions` string, a
managed block upserted into host instruction files, and per-turn injected hook
directives). Those surfaces are **redundant by design** (D16, D25, D7). Without
a single generative source they drift. This document is that source.

### 0.2 Layering (most-canonical → most-ephemeral)

```
docs/spec/dev-loop/orchestration-directive-architecture.md   ← THIS DOC (generative truth, D21)
        │  derives
        ▼
MCP `instructions` string (src/index.ts)                     ← canonical runtime model (D16); read ONCE at MCP initialize
        │  pointed-to by / partially mirrored into
        ▼
INIT_BLOCK (src/init.ts → CLAUDE.md / AGENTS.md / GEMINI.md)  ← FAT per-session safety net (S10); upserted managed block
        │  reinforced per-turn by
        ▼
hook directives (directives/*.md)                            ← short, state-aware per-turn reminders/carriers
```

- **MCP `instructions`** is the canonical runtime operating model (D16). It is
  read once at the MCP `initialize` handshake and refreshes only on client
  reconnect (S9). It carries the full model **plus labeled examples** (D28).
- **INIT_BLOCK** is a **FAT** block (S10): it carries the full ON operating
  model, the co-supreme precedence clause, and the read-escalation ladder
  **inline and verbatim** — so a session is fully governed even when the MCP
  `instructions` are stale or absent. It carries **no few-shot examples** (D28).
- **Directives** are short, state-aware per-turn reminders that point back to
  the MCP `instructions`; they restate only the load-bearing rules.

### 0.3 Redundancy is intentional and managed

Two fragments are **deliberately duplicated** and MUST be kept byte-identical:

| Fragment | Mirrored across | Decision | Guard |
|---|---|---|---|
| Read-escalation ladder paragraph (Appendix **A2**) | INIT_BLOCK ↔ MCP `instructions` | D25 | `test/mirror-fragments.test.mjs` (S4, non-gating) |
| Supremacy / co-supremacy clause (Appendix **A4**) | INIT_BLOCK as upserted into CLAUDE.md ↔ AGENTS.md ↔ GEMINI.md | D7 | `test/mirror-fragments.test.mjs` (S4, non-gating) |

Anti-drift mechanism (S4) = **convention** (this doc + the derivation map in
§8) **plus** a mirror byte-identity CI test. The mirror test is **NON-GATING**
(it does not block merge); the three S7 tests are the hard gate (§11). Rejected:
fragment `.txt` registry files (C4) and a build-step generator — both add
format/EOL/tooling fragility for no safety gain over convention + CI.

### 0.4 Known limitations (status)

- **Stale MCP instructions (S9):** the `instructions` string refreshes only on
  client reconnect. The FAT INIT_BLOCK (S10) is the per-session safety net that
  covers a stale-instructions window.
- **OFF-mode footprint self-estimation (D3/D27):** the >200-line cumulative
  footprint is **model self-estimated**; there is no hook-side line counter. A
  future hook-side counter (D30 candidate) would harden it to deterministic.
- **Mirror test non-gating (S4 vs S7):** byte-identity drift between the two
  A2 occurrences would not block merge, only surface on the next CI run.

---

## §1 — Single Tag Schema (S1 / D26)

There is exactly **ONE** tag type. Its **attributes** select the variant (D26).
It replaces the legacy three-name zoo (`<ORCHESTRATION-INVARIANT>`,
`<ORCHESTRATION-CARRYOVER>`, `<SUB-AGENT-INVARIANT>`).

```
<subagent-mcp state="on|off" kind="directive|reminder|carryover|carrier">
```

| Attribute | Values | Meaning |
|---|---|---|
| `state` | `on`, `off` | Authoritative orchestration mode, reported **solely** by the harness-hook injection. **There is NO `state="unknown"` value.** |
| `kind` | `directive`, `reminder`, `carryover`, `carrier` | Which carrier emitted the block. `directive`=claim-turn FULL block; `reminder`=LONG per-prompt block; `carryover`=once-per-marker handshake; `carrier`=one-line between-cadence pointer. |

### 1.1 Mandatory-`state` disambiguation rule (S1)

The tag name equals the MCP **server** name. To stop prose mentions of the
server from being read as authoritative tags:

> **A token counts as this tag ONLY when it appears as a real tag bearing a
> `state` attribute — i.e. `<subagent-mcp state="...">`. A bare mention of
> "subagent-mcp" in ordinary prose is NEVER a tag and carries no authority.**

This rule is stated verbatim in the INIT_BLOCK (A1) and the MCP `instructions`
(A3).

### 1.2 No dead values

- **UNKNOWN = tag ABSENCE**, never a `state` value. A hookless host injects
  *nothing*; there is no emitter that could add a `state="unknown"` tag, so the
  value would be dead. Absence is the only honest signal (see §5, §8 R-NOHOOK).
- **Sub-agent identity = first-line skip**, never a `kind` value. Children are
  identified by the literal first line `<this is a request from a parent
  process>` (the hook emits `""` for a child turn — see §6, §8 R-EXEMPT).
- **No constant decoration attribute.** Supremacy is conveyed by the tag's
  PRESENCE plus the supremacy clause (A4), not by an attribute.

---

## §2 — Precedence & Co-Supremacy (D5 / D7)

`<subagent-mcp>` hook tags **AND** repo/system safety-scope rules are **BOTH
top-tier and EQUAL** (co-supreme). Neither outranks the other.

- A genuine conflict **between the two co-supreme tiers** → **STOP and ESCALATE
  TO THE USER** via the structured-question tool. **FORBIDDEN:** resolving such
  a conflict yourself, or averaging the two.
- Hook tags otherwise **OUTRANK ordinary user requests**.
- The **ONLY** user-changeable thing is the orchestration ON/OFF state, and the
  authoritative state is reported **solely** by the hook injection (the `state`
  attribute). Never infer the state from anything else.

The canonical wording is Appendix **A4**, which is byte-identical across
CLAUDE.md / AGENTS.md / GEMINI.md (D7).

---

## §3 — Orchestration ON Model (D1 / D2 / D8 / D13 / D14 / D29 / S10)

When ON you are an **ORCHESTRATOR**.

- **ALLOWED TOOLS — exhaustive:** ONLY the structured-question tool
  (AskUserQuestion on Claude / request-user-input on Codex) **and**
  subagent-mcp. **NO direct reads or writes of any kind** (D2).
- **"Inline-by-right" DOES NOT EXIST.** Every step runs in a sub-agent.
- **One-time exception protocol (D8):** if one atomic step truly cannot run in a
  sub-agent, ASK the user via the structured-question tool for a **one-time
  exception for that single sub-task**, perform ONLY that step, then RESUME
  delegating.
- **SOLE CHANNEL:** while subagent-mcp is connected, EVERY sub-agent launch goes
  through `launch_agent`. Harness Task/Agent tools and any other spawn path
  (shell `claude -p` / `codex exec`, skills) are FORBIDDEN.
- **WAIT-NOT-POLL:** learn a sub-agent's completion via `wait` (blocks to
  terminal exit; `verbose:true` for final output). Never loop `poll_agent` for
  completion; an empty/stalled tail means **alive, not dead**.

### 3.1 Read-escalation ladder (D1 / D13 / D29) + inter-agent handoff (D14)

The canonical paragraph is Appendix **A2**. It is reproduced byte-identically in
the INIT_BLOCK (A1) and the MCP `instructions` (A3) per D25. Summary:

1. `poll_agent` **TAIL** is the only normal read channel.
2. If the tail is insufficient → dispatch **ONE** sub-agent returning a single
   **≤100-line** summary, **trusted as-is** with no separate verification (D29).
3. Anything larger → the **USER** reads the document directly.

Large inter-agent data (D14): the orchestrator assigns **scratch-file PATHS**
(`%TEMP%` Windows / `/tmp` POSIX) in prompts; the producer writes, the consumer
reads; the orchestrator **NEVER** reads those files.

---

## §4 — Orchestration OFF Model (B / D3 / D4 / D11 / D15 / D24 / D27)

When OFF you work solo, **but** you run a per-turn upgrade check.

- **Definition (D3):** a *long-horizon task* = any task whose **TOTAL CONTEXT
  FOOTPRINT** (input you read **+** output you produce) exceeds **200 lines** of
  text.
- **Measurement (D27):** maintain a **CUMULATIVE** count of that footprint,
  accumulated **across turns since your last upgrade ask**.
- **Cadence (D4 / D15):** after **EVERY** user turn, evaluate the cumulative
  count; if it qualifies, **STOP and ASK** the user via the structured-question
  tool whether to switch ON. Ask on **EVERY** qualifying turn; a decline does
  **NOT** latch or suppress future asks.
- **Reset:** reset the cumulative counter to zero **ONLY** when you actually
  ask (stated identically in INIT_BLOCK and the OFF directives, so the reset is
  not asymmetric).
- **You never assert ON yourself in OFF mode** — you only ask; state is
  authoritative from the hook.

**THE 5-CALL RULE IS DELETED (D11 / D24).** It is gone from the INIT_BLOCK, MCP
`instructions`, both tool descriptions, all nine directive files, and
`hook-core.ts` source comments; the repo managed blocks purge it automatically
on re-upsert. The OFF >200-line cumulative footprint check **silently replaces**
it. A permanent grep gate (`test/no-five-call.test.mjs`, §11) keeps it gone.

---

## §5 — No-Hook Fail-Safe-ON + One-Time Opt-Out (D18 / S6 / D6 / D7)

Hosts that inject **no** hook block (Gemini, desktop apps, any session without
hook injection — D6) cannot report `state`. The tag is **ABSENT** ⇒ state is
**UNKNOWN** (never an emitted `state="unknown"` value).

On such a host (S6, three parts):

1. **Emit the UNKNOWN-STATE WARNING** (base literal from C3):
   `subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON`
2. **Briefly EXPLAIN WHY:** *no hook injection detected — cannot verify
   orchestration state; defaulting to ON to prevent uncontrolled inline
   execution.*
3. **Allow a ONE-TIME per-session opt-out:** *If you are not currently running
   an orchestration workflow, you may explicitly opt out of ON for this session
   by saying so now; this opt-out does not persist and is not recorded.* If the
   user opts out, honor OFF **for this session only** (no persistence, no
   recording; the next new session defaults back to the ON warning).

The **sub-agent first-line exemption (§6) is the ONLY automatic suppressor** of
this fail-safe default — it prevents fail-safe-ON from recursing into a
fork-bomb.

---

## §6 — Sub-Agent First-Line Exemption + `launch_agent` Upsert (D19 / D20 / S8)

### 6.1 The exemption (D19)

> **Any session whose prompt's literal FIRST LINE begins with the exact string
> `<this is a request from a parent process>` SKIPS the ENTIRE init /
> orchestration regime** — it ignores the INIT_BLOCK and every `<subagent-mcp>`
> tag. This is the canonical child-session identifier and the **ONLY exception
> to all mandates**. It exists to stop the §5 fail-safe-ON default from
> recursively orchestrating child sessions (fork-bomb prevention).

"First line" = the literal line at character position 0 up to the first newline.
**Leading blank lines do NOT count** — the marker must be physically line 1.
Child identity is a **first-line SKIP, never a tag attribute** (the hook emits
`""` for a sub-agent turn). Defensive guard: every injected directive (A5) also
restates this first-line check so a stray injection into a child self-skips.

### 6.2 Silent upsert (D20 / S8)

`launch_agent` **silently UPSERTS** the marker as the **TRUE first line** of
every sub-agent prompt when absent, and does **not** duplicate it when present.
The contract is Appendix **A7** (`ensureParentMarker`). It is BOM-tolerant on
the first-line comparison only, CRLF-safe, idempotent, and **never mutates the
prompt body**. It is wired into **all** launch paths (Claude Agent SDK + Codex
app-server). The D20 unit test (A7.2 / §11) is **GATING**.

---

## §7 — Dropout / HALT Semantics + Task-Abandonment Exit (D12 / D23 / S5)

If subagent-mcp stops responding **while orchestration is ON**:

- **HALT and ask the user.** Do **nothing** inline.
- **HALT UNTIL RESTORED:** keep re-checking and remain halted until subagent-mcp
  returns. **No auto-degrade.**
- **The only user exit is explicit task abandonment (S5):**

  > *The only user choices are keep-waiting (the default) or explicitly abandon
  > the whole task; aborting ends the task, it never switches you to inline
  > work.*

There is no inline-degrade path. Aborting **terminates the task entirely**; it
never converts the orchestrator into an inline worker.

---

## §8 — Markers, Union Migration & Collapse (D9 / D17 / D22 / S2 / S3)

### 8.1 Markers (S2)

```
<!-- subagent-mcp:managed:begin schema=2 -->
... managed block body ...
<!-- subagent-mcp:managed:end -->
```

The outer `subagent-mcp:` prefix is **unchanged** (external-tooling stability);
the `:managed:` segment makes the block self-describing; `schema=N` is the
version/format dial (D9 bump). **No migration note inside the block** (D9).

### 8.2 Union migration regex (S3) — verified vs real `init.ts`

```
MIGRATE_RE = /<!-- subagent-mcp:(?:managed:)?begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:(?:managed:)?end -->/
```

Replaces the current `BEGIN_RE` at `src/init.ts` line 31. The `(?:managed:)?`
group makes it match **both** generations in one pattern (full spec + collapse
algorithm in Appendix **A6**). The bump (`v1` → `schema=2`) forces a re-upsert on
every prior install (captured legacy text never `=== block`, so the `updated`
path always runs first re-init).

### 8.3 Collapse (S3)

On `>1` global match (corrupted/duplicate prior install): replace the **FIRST**
match with the new block, loop-delete the remaining matches (bounded cap 8),
`collapseBlankRuns` once, single `atomicWrite`, stderr note. Result: **exactly
one** schema=2 block. `removeManagedBlock` uses the same `MIGRATE_RE` so
`--remove` strips legacy v1 **and** schema=2.

---

## §9 — Cross-Provider Behavior (D6 / D7 / D18)

| Host | Hook fires? | `state` source | Structured-question tool | Behavior |
|---|---|---|---|---|
| Claude Code CLI | Yes | hook tag | `AskUserQuestion` | authoritative ON/OFF |
| Codex CLI | Yes | hook tag | `request-user-input` | authoritative ON/OFF |
| Gemini CLI | No | — (tag absent) | n/a | UNKNOWN → warn → **fail-safe ON** (§5) |
| Desktop apps | Toggle marker, inject nothing | — (tag absent) | n/a | UNKNOWN → warn → **fail-safe ON** (§5) |

The supremacy clause (A4) is byte-identical in all three host files **regardless
of whether that host fires hooks** (D7). No hook-core behavior change is
required for fail-safe-ON; it lives entirely in the INIT_BLOCK + MCP
`instructions` prose. The hook **emits `""` on any error** and for any sub-agent
turn (never a `<subagent-mcp>` tag).

---

## §10 — Persistence, Carryover & Disable

- **Persistence:** the ON/OFF marker is per-project and survives
  restarts/sessions until disabled with explicit user permission.
- **Carryover (`kind="carryover"`):** an inherited-ON marker triggers a
  once-per-marker handshake — (1) notify the user it carried over; (2) ask
  (structured-question tool) whether to keep ON; (3) advise fit. Decline →
  `orchestration-mode enabled:false`. After the answer the handshake is done; do
  not re-raise.
- **Disable:** **never on your own initiative.** You MAY *propose* OFF on
  task-fit mismatch (bounded/interactive/MCP-bound) — explain WHAT + WHY and ask
  via the structured-question tool; only explicit approval may call
  `orchestration-mode enabled:false`.

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
| `carryover-{claude,codex}.md` | R-EXEMPT, R-SUPREMACY (carryover handshake) | — |
| `reminder-on.md` | R-EXEMPT, R-ON-STRICT, R-READ-LADDER, R-SUPREMACY | — |
| `reminder-off-{claude,codex}.md` | R-EXEMPT, R-OFF-UPGRADE | — |
| `short-on.md` | R-EXEMPT, R-ON-STRICT (one-line) | — |
| `short-off.md` | R-EXEMPT, R-OFF-UPGRADE (one-line) | — |
| `src/init.ts` migration | R-MARKERS | — |
| `launch_agent` (`ensureParentMarker`) | R-EXEMPT (enforcement) | — |
| Both tool descriptions | R-NO5CALL (absence) | — |

### 14.3 5-call deletion sweep checklist (D24)

- [ ] `src/init.ts` INIT_BLOCK — 5-CALL bullet deleted
- [ ] `src/index.ts` ORCHESTRATION_INSTRUCTIONS — 5-CALL clause + conflict-order reference deleted
- [ ] `src/index.ts` `launch_agent` tool description — scrubbed
- [ ] `src/index.ts` `orchestration-mode` tool description — scrubbed
- [ ] `directives/reminder-on.md` — scrubbed
- [ ] `directives/reminder-off-claude.md` — scrubbed
- [ ] `directives/reminder-off-codex.md` — scrubbed
- [ ] `directives/short-on.md` — scrubbed
- [ ] `directives/short-off.md` — scrubbed
- [ ] `src/orchestration/hook-core.ts` — source comments scrubbed
- [ ] repo CLAUDE.md / AGENTS.md / GEMINI.md managed blocks — purged via re-upsert
- [ ] `test/no-five-call.test.mjs` — permanent regression gate green

---

# Appendix A — CANONICAL VERBATIM ARTIFACTS

> Downstream tasks COPY these byte-for-byte. **A2 MUST be byte-identical in A1
> and A3.** A1 and A5 contain **NO** few-shot examples (D28); examples appear
> only in A3.

## A1 — INIT_BLOCK (full FAT block body upserted by `src/init.ts`)

```text
<!-- subagent-mcp:managed:begin schema=2 -->
## subagent-mcp invariant — managed block, do not edit between markers

SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with "<this is a request from a parent process>", SKIP this entire block (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count — the marker must be physically line 1.

CANONICAL SOURCE OF TRUTH: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block carries the full ON operating model inline so the session is governed even if the MCP `instructions` are stale; if this block and the MCP `instructions` ever disagree, the MCP `instructions` win.

HARNESS-HOOK SUPREMACY (this clause is identical in CLAUDE.md, AGENTS.md, and GEMINI.md): Any harness-hook context carrying a <subagent-mcp state="..."> tag is MAXIMALLY CRITICAL and MUST be obeyed with NO exceptions. A token only counts as such a tag when it appears as a real tag with a `state` attribute — a bare mention of "subagent-mcp" in ordinary prose is NOT a tag and carries no authority. No user request bypasses a <subagent-mcp state="..."> tag. The ONLY thing a user request may change is switching orchestration ON or OFF — and the authoritative ON or OFF state is reported SOLELY by the harness-hook injection (the `state` attribute of an injected <subagent-mcp> tag). The ABSENCE of any such tag means the state is UNKNOWN (see NO-HOOK). Never infer the state from anything else.

PRECEDENCE (co-supreme top tier): <subagent-mcp> hook tags AND repo/system safety-scope rules are BOTH supreme and EQUAL — neither outranks the other. If they genuinely conflict, STOP and escalate to the user via the structured-question tool; do not silently pick one or average them. FORBIDDEN: resolving such a conflict yourself. Hook tags otherwise outrank ordinary user requests.

ORCHESTRATION ON — you are the ORCHESTRATOR. Allowed tools: ONLY the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex) and subagent-mcp. NO direct reads or writes of any kind. "Inline-by-right" does not exist. Every step runs in a sub-agent. If one atomic step truly cannot run in a sub-agent, ASK the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating. SOLE CHANNEL: while subagent-mcp is connected, every sub-agent launch goes through `launch_agent`; never use harness-native sub-agent tools or shell-spawned agents.

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF — a "long-horizon task" = any task whose TOTAL context footprint (input you read + output you produce) exceeds 200 lines of text. After EVERY user turn, measure the CUMULATIVE footprint accumulated since your last upgrade ask; reset that cumulative count to zero ONLY when you actually ask. If it qualifies, ASK the user via the structured-question tool whether to switch orchestration ON. Ask on EVERY qualifying turn; a decline does NOT suppress future asks. You never assert ON yourself — you only ask.

DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, HALT and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.

NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state="..."> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN — represented by the ABSENCE of any tag, never by a tag value. Emit this UNKNOWN-STATE WARNING to the user: "subagent-mcp: no hook injection detected — orchestration state unknown; defaulting to ON". Briefly explain WHY: no hook injection detected — cannot verify orchestration state; defaulting to ON to prevent uncontrolled inline execution. Then DEFAULT TO ORCHESTRATION ON (fail-safe). One-time opt-out: if you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the ONLY automatic suppressor of this default.

DISABLE: never on your own initiative; you MAY propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may call orchestration-mode enabled:false.
<!-- subagent-mcp:managed:end -->
```

## A2 — READ-LADDER PARAGRAPH (shared fragment — byte-identical in A1 and A3)

```text
READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.
```

## A3 — MCP `instructions` string (TRIMMED to <= 2048 bytes; verbatim copy of ORCHESTRATION_INSTRUCTIONS in `src/index.ts`)

> Claude Code silently truncates server `instructions` at ~2 KB (see
> skills/subagent-mcp-installer/references/compliance.md). This string is therefore
> capped at <= 2048 bytes and carries only the BINDING core; all dropped detail,
> rationale, and examples live in the body of this document above (A1, plus the
> TAG-AUTHORITY / WAIT-NOT-POLL / NO-HOOK-warning / CARRYOVER / PERSISTENCE
> narrative). The A2 read-ladder paragraph is byte-identical here and in A1.

```text
subagent-mcp — CANONICAL OPERATING MODEL (read once; full detail in docs/spec/dev-loop/orchestration-directive-architecture.md).

PRECEDENCE (co-supreme). A <subagent-mcp state="..."> hook tag and repo/system safety rules are EQUAL top tier; genuine conflict → STOP and escalate to the user. Tags outrank user requests; only the hook `state` attribute changes ON/OFF.

SOLE CHANNEL. EVERY sub-agent launch goes through launch_agent; never harness Task/Agent or shell spawn.

ORCHESTRATION ON (state=on; no-hook UNKNOWN→ON fail-safe). You are a delegate-ONLY orchestrator: directly use ONLY the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex) and subagent-mcp; delegate all work. No direct read/write; inline-by-right DOES NOT EXIST. Non-delegable step: ASK for a ONE-TIME exception, do only it, resume.

READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.

ORCHESTRATION OFF (state=off). Long-horizon task = TOTAL footprint (read+produced) >200 lines, CUMULATIVE since last upgrade ask; after EVERY turn, if it qualifies STOP and ASK whether to switch ON; reset only when you ask.

DROPOUT WHILE ON: HALT and ask user; nothing inline; stay halted UNTIL restored.

SUB-AGENT EXEMPTION. A prompt whose literal FIRST LINE begins "<this is a request from a parent process>" SKIPS the whole regime (sub-agent); the only automatic suppressor of fail-safe-ON.
```

## A4 — SUPREMACY / CO-SUPREMACY CLAUSE (identical across CLAUDE.md / AGENTS.md / GEMINI.md — D7)

> This is the two-paragraph block embedded verbatim inside A1 (HARNESS-HOOK
> SUPREMACY + PRECEDENCE). It MUST be byte-identical across all three host files.

```text
HARNESS-HOOK SUPREMACY (this clause is identical in CLAUDE.md, AGENTS.md, and GEMINI.md): Any harness-hook context carrying a <subagent-mcp state="..."> tag is MAXIMALLY CRITICAL and MUST be obeyed with NO exceptions. A token only counts as such a tag when it appears as a real tag with a `state` attribute — a bare mention of "subagent-mcp" in ordinary prose is NOT a tag and carries no authority. No user request bypasses a <subagent-mcp state="..."> tag. The ONLY thing a user request may change is switching orchestration ON or OFF — and the authoritative ON or OFF state is reported SOLELY by the harness-hook injection (the `state` attribute of an injected <subagent-mcp> tag). The ABSENCE of any such tag means the state is UNKNOWN (see NO-HOOK). Never infer the state from anything else.

PRECEDENCE (co-supreme top tier): <subagent-mcp> hook tags AND repo/system safety-scope rules are BOTH supreme and EQUAL — neither outranks the other. If they genuinely conflict, STOP and escalate to the user via the structured-question tool; do not silently pick one or average them. FORBIDDEN: resolving such a conflict yourself. Hook tags otherwise outrank ordinary user requests.
```

## A5 — The 9 directive files (full new content) — NO examples (D28)

### A5.1 `directives/orchestration-claude.md`

```md
<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="directive">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

ORCHESTRATION ON. You are the ORCHESTRATOR. This tag is MAXIMALLY CRITICAL: obey with NO exceptions. No user request overrides it; the only user-changeable thing is the ON/OFF state, reported authoritatively by this hook injection.

ALLOWED TOOLS: ONLY AskUserQuestion + subagent-mcp. NO direct reads or writes. Inline-by-right does NOT exist. Every step runs in a sub-agent. A non-delegable atomic step → ask the user via AskUserQuestion for a one-time exception, do ONLY that step, then resume delegating.

READ LADDER: poll_agent tail → one <=100-line summarizer sub-agent (trusted as-is) → else the USER reads it. Large handoffs: assign scratch-file PATHS; producer writes, consumer reads; you NEVER read those files.

PRECEDENCE: this tag and safety-scope are CO-SUPREME and equal; genuine conflict → STOP and escalate to the user (FORBIDDEN: resolving it yourself). SOLE CHANNEL: all launches via launch_agent. DROPOUT while ON: HALT and ask the user; stay halted until restored. The only user choices are keep-waiting or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work. DISABLE: never on your own initiative.

Full model + governance: server MCP `instructions`.
</subagent-mcp>
```

### A5.2 `directives/orchestration-codex.md`

```md
<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="directive">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

ORCHESTRATION ON. You are the ORCHESTRATOR. This tag is MAXIMALLY CRITICAL: obey with NO exceptions. No user request overrides it; the only user-changeable thing is the ON/OFF state, reported authoritatively by this hook injection.

ALLOWED TOOLS: ONLY request-user-input + subagent-mcp. NO direct reads or writes. Inline-by-right does NOT exist. Every step runs in a sub-agent. A non-delegable atomic step → ask the user via request-user-input for a one-time exception, do ONLY that step, then resume delegating.

READ LADDER: poll_agent tail → one <=100-line summarizer sub-agent (trusted as-is) → else the USER reads it. Large handoffs: assign scratch-file PATHS; producer writes, consumer reads; you NEVER read those files.

PRECEDENCE: this tag and safety-scope are CO-SUPREME and equal; genuine conflict → STOP and escalate to the user (FORBIDDEN: resolving it yourself). SOLE CHANNEL: all launches via launch_agent. DROPOUT while ON: HALT and ask the user; stay halted until restored. The only user choices are keep-waiting or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work. DISABLE: never on your own initiative.

Full model + governance: server MCP `instructions`.
</subagent-mcp>
```

### A5.3 `directives/carryover-claude.md`

```md
<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="carryover">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

Orchestration ON carried over from a PRIOR session for this project (persists until disabled with user permission). Not enabled THIS session.

THIS turn, ONCE: (1) NOTIFY the user it carried over; (2) ASK via AskUserQuestion whether to keep it ON; (3) ADVISE fit — long-horizon / context-filling → keep ON; bounded / interactive → propose OFF. Decline → orchestration-mode enabled:false. NEVER disable on your own initiative. After the answer the handshake is done; do not re-raise.

While ON, follow the MOST RECENT <subagent-mcp state="on"> tag in context (directive or reminder/carrier); if none is in the current window, the CLAUDE/AGENTS/GEMINI INIT_BLOCK governs. This tag is co-supreme with safety-scope; conflict → ask the user.
</subagent-mcp>
```

### A5.4 `directives/carryover-codex.md`

```md
<!-- INJECTED PRE-PROMPT DIRECTIVE — BINDING, NON-NEGOTIABLE -->
<subagent-mcp state="on" kind="carryover">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag.

Orchestration ON carried over from a PRIOR session for this project (persists until disabled with user permission). Not enabled THIS session.

THIS turn, ONCE: (1) NOTIFY the user it carried over; (2) ASK via request-user-input whether to keep it ON; (3) ADVISE fit — long-horizon / context-filling → keep ON; bounded / interactive → propose OFF. Decline → orchestration-mode enabled:false. NEVER disable on your own initiative. After the answer the handshake is done; do not re-raise.

While ON, follow the MOST RECENT <subagent-mcp state="on"> tag in context (directive or reminder/carrier); if none is in the current window, the CLAUDE/AGENTS/GEMINI INIT_BLOCK governs. This tag is co-supreme with safety-scope; conflict → ask the user.
</subagent-mcp>
```

### A5.5 `directives/reminder-on.md`

```md
<!-- INJECTED PER-PROMPT REMINDER — BINDING -->
<subagent-mcp state="on" kind="reminder">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag (you are a sub-agent).

Orchestration ON. You are the orchestrator: delegate EVERY step. Allowed tools = ONLY the structured-question tool (AskUserQuestion / request-user-input) + subagent-mcp; NO direct reads or writes; inline-by-right does not exist. Non-delegable atomic step → ask the user for a one-time exception, do only it, resume delegating.

READ LADDER: poll_agent tail → one <=100-line summarizer sub-agent (trusted as-is) → else the user reads it. Large handoffs via scratch-file PATHS you never read.

WAIT-NOT-POLL: learn finish via `wait` (verbose:true for output); never loop poll_agent for completion. poll_agent = single diagnostic; stalled/empty = alive, not dead.

This tag is co-supreme with safety-scope (conflict → ask the user) and outranks ordinary user requests. Full governance: server MCP `instructions`.
</subagent-mcp>
```

### A5.6 `directives/reminder-off-claude.md`

```md
<!-- INJECTED PER-PROMPT REMINDER — BINDING -->
<subagent-mcp state="off" kind="reminder">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag (you are a sub-agent).

Orchestration OFF. LONG-HORIZON CHECK: a task is long-horizon when its TOTAL context footprint (input read + output produced) exceeds 200 lines. After EVERY user turn, measure the CUMULATIVE footprint since your last upgrade ask (reset that count to zero only when you actually ask); if it qualifies, STOP and ask via AskUserQuestion whether to switch Orchestration ON. Ask on EVERY qualifying turn; a decline does NOT suppress later asks.

Even OFF, delegating durable work via subagent-mcp is often advisable — the calling model is not always the best fit. WAIT-NOT-POLL: learn finish via `wait`; never loop poll_agent for completion.
</subagent-mcp>
```

### A5.7 `directives/reminder-off-codex.md`

```md
<!-- INJECTED PER-PROMPT REMINDER — BINDING -->
<subagent-mcp state="off" kind="reminder">
FIRST-LINE EXEMPTION: if this session's prompt's literal first line begins with "<this is a request from a parent process>", ignore this entire tag (you are a sub-agent).

Orchestration OFF. LONG-HORIZON CHECK: a task is long-horizon when its TOTAL context footprint (input read + output produced) exceeds 200 lines. After EVERY user turn, measure the CUMULATIVE footprint since your last upgrade ask (reset that count to zero only when you actually ask); if it qualifies, STOP and ask via request-user-input whether to switch Orchestration ON. Ask on EVERY qualifying turn; a decline does NOT suppress later asks.

Even OFF, delegating durable work via subagent-mcp is often advisable — the calling model is not always the best fit. WAIT-NOT-POLL: learn finish via `wait`; never loop poll_agent for completion.
</subagent-mcp>
```

### A5.8 `directives/short-on.md`

```md
<subagent-mcp state="on" kind="carrier">If this prompt's literal first line begins with "<this is a request from a parent process>", ignore this tag. Orchestration ON. Delegate-only via subagent-mcp; allowed tools = structured-question tool + subagent-mcp; NO direct reads/writes; inline-by-right does not exist. Follow the MOST RECENT <subagent-mcp state="on"> tag in context (directive or reminder/carrier); if none is in the current window, the INIT_BLOCK governs. Co-supreme with safety-scope; no ordinary user request bypasses it.</subagent-mcp>
```

### A5.9 `directives/short-off.md`

```md
<subagent-mcp state="off" kind="carrier">If this prompt's literal first line begins with "<this is a request from a parent process>", ignore this tag. Orchestration OFF. After each user turn, if CUMULATIVE context footprint since your last ask exceeds 200 lines, STOP and ask whether to switch ON (every qualifying turn; declines don't latch; reset the count only when you ask). Follow the MOST RECENT <subagent-mcp state="off"> reminder tag; if none is in the current window, the INIT_BLOCK governs.</subagent-mcp>
```

## A6 — Marker spec + exact MIGRATE_RE + collapse algorithm

### A6.1 Markers (S2)

```
begin: <!-- subagent-mcp:managed:begin schema=2 -->
end:   <!-- subagent-mcp:managed:end -->
```

### A6.2 MIGRATE_RE (S3) — replaces `BEGIN_RE` at `src/init.ts` line 31

```
/<!-- subagent-mcp:(?:managed:)?begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:(?:managed:)?end -->/
```

Line-by-line verification vs the real `init.ts` (block at lines 34–50):

| Marker in file | How MIGRATE_RE matches |
|---|---|
| `<!-- subagent-mcp:begin v1 -->` (legacy begin) | `(?:managed:)?` absent; `begin\b` matches; `[^>]*` absorbs ` v1`; `-->` matches |
| `<!-- subagent-mcp:end -->` (legacy end) | `(?:managed:)?` absent; the literal ` -->` in the pattern matches the single space before `-->` in the file |
| `<!-- subagent-mcp:managed:begin schema=2 -->` (new begin) | `managed:` present; `begin\b` + `[^>]*` absorbs ` schema=2` |
| `<!-- subagent-mcp:managed:end -->` (new end) | `managed:` present; ` -->` matches |

The body is matched non-greedily (`[\s\S]*?`) so on two adjacent legacy blocks
the first match stops at the FIRST end-marker, leaving the rest for the collapse
loop.

### A6.3 `upsertInitBlock` wiring

- `opts.remove` branch: gate on `MIGRATE_RE.test(body)`; `removeManagedBlock`
  uses `MIGRATE_RE` for both `match` and `replace` → `--remove`/`--uninstall`
  strips legacy v1 **and** schema=2.
- main branch: replace `BEGIN_RE.test(body)` with `MIGRATE_RE.test(body)`;
  capture `body.match(MIGRATE_RE)?.[0]`; if `=== block` → `ok` (idempotent),
  else `next = body.replace(MIGRATE_RE, block)` → `updated` (positional in-place
  rewrite; keeps position after the first heading; no orphan/duplicate).
- no match → `insertAfterFirstHeading` (unchanged).
- BOM/EOL preservation and `atomicWrite` unchanged.

### A6.4 Duplicate-collapse algorithm (S3)

```
matches = body.match(new RegExp(MIGRATE_RE, 'g'))
if matches && matches.length > 1:
    next = body.replace(MIGRATE_RE, block)        # replace FIRST occurrence with the new block
    removed = 0
    while removed < 8 and MIGRATE_RE.test(next, after the first block):
        next = next.replace(MIGRATE_RE-after-first, '')   # delete each remaining legacy/dup block
        removed++
    next = collapseBlankRuns(next, eol)           # ONCE, after the loop
    status = 'updated'
    stderr: "collapsed N duplicate managed blocks"
    # single atomicWrite
```

Bounded cap = 8 (matches `OWNER_CAP`). In-memory only; exactly one
`atomicWrite` per call. Result: exactly ONE schema=2 block.

### A6.5 Version bump (D9)

`v1` → `schema=2` (plus the `:managed:` segment) forces a re-upsert on every
prior install because the captured legacy text never `=== block`. **No migration
note inside the block**; migration guidance lives in release notes + this doc.

## A7 — `ensureParentMarker` spec (S8 / D20) + the 7 unit-test cases

### A7.1 Behavior spec

Exported pure function in `src/launch-prompt.ts` (re-exported from
`src/index.ts` for testability):

```
export function ensureParentMarker(prompt: string): string
```

- `MARKER = "<this is a request from a parent process>"`.
- Compute the **literal first line** = substring from position 0 up to the first
  `\n` (the prompt may use `\n` or `\r\n`; **strip a trailing `\r`** before
  comparison).
- For the `startsWith(MARKER)` comparison **only**, strip a leading BOM
  (`﻿`) from the first line. **Do NOT mutate the prompt body** (S8).
- **Do NOT strip leading whitespace** — the spec is "literal first line begins
  with MARKER" (D19). A marker preceded by spaces on line 1, or on line 2, is
  treated as ABSENT.
- If the first line (after BOM-strip) `startsWith(MARKER)` → return `prompt`
  **unchanged** (no duplicate).
- Else → return `MARKER + "\n" + prompt`.
- Empty / whitespace-only prompts → marker prepended.
- **Idempotent, silent.** Wired into ALL launch paths (Claude Agent SDK + Codex
  app-server).

### A7.2 Unit-test cases — `test/launch-agent-upsert.test.mjs` (node:test, GATING)

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | ABSENT → prepend | `"do X"` | first line `=== MARKER`; body `"do X"` preserved |
| 2 | PRESENT line 1 → no duplicate | prompt already starting with MARKER on line 1 | `result === input`; marker count `=== 1` |
| 3 | PRESENT + trailing content on line 1 | `MARKER + " extra\nrest"` | unchanged (`startsWith` satisfied) |
| 4 | CRLF, marker on line 1 | `MARKER + "\r\n" + rest` | unchanged; single occurrence |
| 5 | MARKER not first (line 2) | `"intro\n" + MARKER + "\n..."` | treated as ABSENT → prepended; **two** occurrences total (proves first-line-anchored) |
| 6 | empty string | `""` | `MARKER + "\n"` |
| 7 | BOM-prefixed marker line | `"﻿" + MARKER + "\nrest"` | treated as PRESENT → unchanged |

All 7 must pass before merge (gating, S7).
