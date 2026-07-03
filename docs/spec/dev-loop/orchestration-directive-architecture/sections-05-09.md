<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

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
| Desktop apps | Toggle session disable, inject nothing | — (tag absent) | n/a | UNKNOWN → warn → **fail-safe ON** (§5) |

The supremacy clause (A4) is byte-identical in all three host files **regardless
of whether that host fires hooks** (D7). No hook-core behavior change is
required for fail-safe-ON; it lives entirely in the INIT_BLOCK + MCP
`instructions` prose. The hook **emits `""` on any error** and for any sub-agent
turn (never a `<subagent-mcp>` tag).

---

