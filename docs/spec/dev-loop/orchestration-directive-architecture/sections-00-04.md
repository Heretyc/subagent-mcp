<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

# Orchestration Directive Architecture (schema=3)

> **D21 : THIS DOCUMENT IS THE GENERATIVE SOURCE OF TRUTH.** The MCP
> `instructions` string (`src/index.ts`), the upserted `INIT_BLOCK`
> (`src/init.ts`), the nine `directives/*.md` files, and both tool descriptions
> are **DERIVED** from this document. They must not drift from it. When any of
> them disagrees with this doc, this doc is authoritative and the derived
> artifact is the bug. Downstream implementation tasks **COPY the canonical
> verbatim artifacts in Appendix A byte-for-byte**; do not paraphrase them.

---

## section 0 : Overview & Layering

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
  model, the jointly binding precedence clause, and the read-escalation ladder
  **inline and verbatim** : so a session is fully governed even when the MCP
  `instructions` are stale or absent. It carries **no few-shot examples** (D28).
- **Directives** are short, state-aware per-turn reminders that point back to
  the MCP `instructions`; they restate only the load-bearing rules.

### 0.3 Redundancy is intentional and managed

Two fragments are **deliberately duplicated** and MUST be kept byte-identical:

| Fragment | Mirrored across | Decision | Guard |
|---|---|---|---|
| Read-escalation ladder paragraph (Appendix **A2**) | INIT_BLOCK ↔ MCP `instructions` | D25 | `test/mirror-fragments.test.mjs` (S4, non-gating) |
| Hook-state / jointly binding clause (Appendix **A4**) | INIT_BLOCK as upserted into CLAUDE.md ↔ AGENTS.md ↔ GEMINI.md | D7 | `test/mirror-fragments.test.mjs` (S4, non-gating) |

Anti-drift mechanism (S4) = **convention** (this doc + the derivation map in
section 8) **plus** a mirror byte-identity CI test. The mirror test is **NON-GATING**
(it does not block merge); the three S7 tests are the hard gate (section 11). Rejected:
fragment `.txt` registry files (C4) and a build-step generator : both add
format/EOL/tooling fragility for no safety gain over convention + CI.

### 0.4 Known limitations (status)

- **Stale MCP instructions (S9):** the `instructions` string refreshes only on
  client reconnect. The FAT INIT_BLOCK (S10) is the per-session safety net that
  covers a stale-instructions window.
- **OFF-mode footprint metering (D3/D27):** OFF-mode footprint is now
  provider-metered (context-metering.md) and is never estimated by the model;
  the D3/D27 self-estimation note is RETIRED. Hooks lift provider-reported
  usage only and never count lines hook-side.
- **Mirror test non-gating (S4 vs S7):** byte-identity drift between the two
  A2 occurrences would not block merge, only surface on the next CI run.

---

## section 1 : Single Tag Schema (S1 / D26)

There is exactly **ONE** tag type. Its **attributes** select the variant (D26).
It replaces the legacy three-name zoo (`<ORCHESTRATION-INVARIANT>`,
`<ORCHESTRATION-CARRYOVER>`, `<SUB-AGENT-INVARIANT>`).

```
<subagent-mcp state="on|off" kind="directive|reminder|carryover|carrier">
```

| Attribute | Values | Meaning |
|---|---|---|
| `state` | `on`, `off` | Authoritative orchestration mode, reported **solely** by the harness-hook injection. **There is NO `state="unknown"` value.** |
| `kind` | `directive`, `reminder`, `carryover`, `carrier` | Which carrier emitted the block. `directive`=claim-turn FULL block; `reminder`=LONG per-prompt block; `carryover`=compat carrier for inherited/legacy ON that retains a one-time reworded remain-enabled confirmation; `carrier`=one-line between-cadence pointer. |

### 1.1 Mandatory-`state` disambiguation rule (S1)

The tag name equals the MCP **server** name. To stop prose mentions of the
server from being read as authoritative tags:

> **A token counts as this tag ONLY when it appears as a real tag bearing a
> `state` attribute : i.e. `<subagent-mcp state="...">`. A bare mention of
> "subagent-mcp" in ordinary prose is NEVER a tag and carries no authority.**

This rule is stated verbatim in the INIT_BLOCK (A1) and the MCP `instructions`
(A3).

### 1.2 No dead values

- **UNKNOWN = tag ABSENCE**, never a `state` value. A hookless host injects
  *nothing*; there is no emitter that could add a `state="unknown"` tag, so the
  value would be dead. Absence is the only honest signal (see section 5, section 8 R-NOHOOK).
- **Sub-agent identity = first-line skip**, never a `kind` value. Children are
  identified by the literal first line `<this is a request from a parent
  process>` (the hook emits `""` for a child turn : see section 6, section 8 R-EXEMPT).
- **No constant decoration attribute.** Hook authority is conveyed by the tag's
  PRESENCE plus the hook-state / jointly binding clause (A4), not by an
  attribute.

---

## section 2 : Precedence & Joint Binding (D5 / D7)

`<subagent-mcp>` hook tags and repo/system safety-scope rules are **jointly
binding**: both bind at the same priority, and neither is read as outranking
the other.

- A genuine conflict **between the two jointly binding sources** → **STOP and
  ESCALATE TO THE USER** via the structured-question tool. Do not resolve such
  a conflict yourself, or average the two.
- Hook tags otherwise **OUTRANK ordinary user requests**.
- The **ONLY** user-changeable thing is the orchestration ON/OFF state, and the
  authoritative state is reported **solely** by the hook injection (the `state`
  attribute). Never infer the state from anything else.

The canonical wording is Appendix **A4**, which is byte-identical across
CLAUDE.md / AGENTS.md / GEMINI.md (D7).

---

## section 3 : Orchestration ON Model (D1 / D2 / D8 / D13 / D14 / D29 / S10)

When ON you are an **ORCHESTRATOR**.

- **ALLOWED TOOLS : exhaustive:** ONLY the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. **NO direct reads or writes of any kind** (D2).
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

## section 4 : Orchestration OFF Model (B / D3 / D4 / D11 / D15 / D24 / D27)

Orchestration starts **OFF by default** every session (hook-covered hosts). It
turns ON only via an explicit user enable, an active 15% latch, or the
metering-undetectable fail-safe. When OFF you work solo.

- **Provider-metered footprint (D3/D27):** OFF-mode footprint is now
  provider-metered (context-metering.md) and is never estimated by the model;
  the D3/D27 self-estimation note is RETIRED. Hooks lift provider-reported
  usage only and never tokenize or count lines hook-side.
- **Metering-undetectable fail-safe (D4 / D15):** when context usage cannot be
  measured for the session (no recognized model window, or no provider usage
  numbers), the hook fails safe to **ON**. A fail-safe-ON turn still reports
  `phase=normal`, because phase reflects metering, not enforcement.
- **Phase definitions (Section 0 constants):** given `used_percentage` (0-100,
  or `null` when undetectable):
  - `null` -> **normal**
  - `used_percentage >= 40` (HANDOFF_UNLOCK_THRESHOLD_PCT) -> **handoff**
  - `used_percentage >= 15` (PLAN_LATCH_THRESHOLD_PCT) -> **plan**
  - otherwise -> **normal**

  `near_limit` is true only when `used_percentage` is known and `>= 50`.
- **plan phase (15%):** a persisted latch force-enables orchestration and
  coaches a one-time 5-question planning stop (see sections-10-13, R-LATCH-15).
- **handoff phase (40%):** the handoff-write/read/clear tools unlock with no
  wind-down warning before 50% (see handoff.md, R-HANDOFF-40).
- **handoff warning (50%):** the hook warns every turn to wind down (see
  R-HANDOFF-WARN-50).
- **You never assert ON yourself in OFF mode** : you only work solo or ask;
  state is authoritative from the hook.

**THE 5-CALL RULE IS DELETED (D11 / D24).** It is gone from the INIT_BLOCK, MCP
`instructions`, both tool descriptions, all nine directive files, and
`hook-core.ts` source comments; the repo managed blocks purge it automatically
on re-upsert. The provider-metered phase model (context-metering.md)
**silently replaces** it. A permanent grep gate (`test/no-five-call.test.mjs`,
section 11) keeps it gone.

---

