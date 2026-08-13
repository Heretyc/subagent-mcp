<!-- Part of orchestration-directive-architecture (split from sections-00-04.md). Retrieval map: ../orchestration-directive-architecture.md -->

## section 4 : Orchestration OFF Model (B / D3 / D4 / D11 / D15 / D24 / D27)

Orchestration starts **OFF by default** every session (hook-covered hosts); it turns ON only via
an explicit user enable, an active 15% latch, or the metering-undetectable fail-safe. When OFF you work solo.

- **Provider-metered footprint (D3/D27):** OFF-mode footprint is now
  provider-metered (context-metering.md) and is never estimated by the model;
  the D3/D27 self-estimation note is RETIRED. Hooks lift provider-reported
  usage only and never tokenize or count lines hook-side.
- **Metering-undetectable fail-safe (D4 / D15):** when context usage cannot be
  measured for the session (no recognized model window, or no provider usage
  numbers), the hook fails safe to **ON**. A fail-safe-ON turn still reports
  `phase=normal`, because phase reflects metering, not enforcement.
- **Phase constants (all FIXED, never user-configurable):**

  | Constant | Value | Meaning |
  |---|---|---|
  | `PLAN_LATCH_THRESHOLD_PCT` | 15 | Triggers the persisted orchestration latch |
  | `HANDOFF_UNLOCK_THRESHOLD_PCT` | 20 | Unlocks voluntary handoff-write (goal-context capture) |
  | `HANDOFF_REQUIRED_THRESHOLD_PCT` (H) | 80 | Mandatory handoff write threshold |
  | `CODEX_AUTOCOMPACT_PCT` | 90 | Codex threshold and value written to Claude `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (H = CODEX_AUTOCOMPACT_PCT - 10) |
  | `COMPACTION_DROP_THRESHOLD_PCT` | 10 | Minimum drop (pp) to classify a sample pair as auto-compaction |

- **Phase definitions:** given `used_percentage` (0-100, or `null` when
  undetectable):
  - `null` -> **normal**
  - `used_percentage >= 20` (HANDOFF_UNLOCK_THRESHOLD_PCT) -> **handoff**
  - `used_percentage >= 15` (PLAN_LATCH_THRESHOLD_PCT) -> **plan**
  - otherwise -> **normal**

  `write_required` is a **derived** condition evaluated each turn (not a stored
  phase): true when `used_percentage >= 80` AND no eligible prepared handoff
  record exists for the current session.

- **plan phase (15%):** a persisted latch force-enables orchestration and
  coaches a one-time planning stop of AT LEAST 4 open planning questions (see
  sections-10-13, R-LATCH-15).
- **handoff phase (20%):** the handoff-write/read/clear tools unlock, with no
  mandatory action at that point; the unlock is a GOAL-CONTEXT unlock that lets
  the session record the goal it shaped at the 15% latch while it still has the
  context to describe one (see handoff.md, R-HANDOFF-20).
- **mandatory handoff (80%, R-HANDOFF-80):** when `write_required` is
  derived true, the hook injects a mandatory handoff-write directive
  (directive-only, no tool gate). The injection fires regardless of
  `contextCoaching`. On compaction detection (an adjacent-sample >= 10-point drop
  from a sample at or above 80% that is ALSO accompanied by a fresh structural
  compaction-generation proof from the implemented Claude or Codex adapter; see
  handoff.md) the hook injects a mandatory one-turn handoff-read directive.
  After a successful read, the caller asks exactly four structured confirmation
  questions before acting. `contextCoaching` does NOT mute mandatory lifecycle
  injections.
- **You never assert ON yourself in OFF mode** : you only work solo or ask;
  state is authoritative from the hook.

**THE 5-CALL RULE IS DELETED (D11 / D24).** It is gone from the INIT_BLOCK, MCP
`instructions`, both tool descriptions, all nine directive files, and `hook-core.ts`
comments; repo managed blocks purge it on re-upsert. The provider-metered phase model
(context-metering.md) **silently replaces** it, and a permanent grep gate
(`test/no-five-call.test.mjs`, section 11) keeps it gone.
