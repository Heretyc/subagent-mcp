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
- **Phase definitions (Section 0 constants):** given `used_percentage` (0-100,
  or `null` when undetectable):
  - `null` -> **normal**
  - `used_percentage >= 20` (HANDOFF_UNLOCK_THRESHOLD_PCT) -> **handoff**
  - `used_percentage >= 15` (PLAN_LATCH_THRESHOLD_PCT) -> **plan**
  - otherwise -> **normal**

  Both phase constants are FIXED and never user-configurable.

  `near_limit` is true only when `used_percentage` is known, `contextCoaching`
  is enabled, and `used_percentage >= handoffWarnThreshold` (default 60, valid
  40-90; see context-metering.md section 3.1).
- **plan phase (15%):** a persisted latch force-enables orchestration and
  coaches a one-time planning stop of AT LEAST 4 open planning questions (see
  sections-10-13, R-LATCH-15).
- **handoff phase (20%):** the handoff-write/read/clear tools unlock, with no
  wind-down warning at that point : the unlock is a GOAL-CONTEXT unlock that
  lets the session record the goal it shaped at the 15% latch while it still has
  the context to describe one (see handoff.md, R-HANDOFF-40).
- **wind-down warning (default 60%, user-configurable 40-90):** at or above
  `handoffWarnThreshold` the hook warns every turn to wind down and appends the
  handoff steer (see R-HANDOFF-WARN-50). `contextCoaching: false` mutes this
  warning and steer ONLY; the 15% latch and the 20% unlock are unaffected. Both
  keys are user-level only (`global-subagent-mcp-config.jsonc`); missing keys
  silently default to `true` / `60`.
- **You never assert ON yourself in OFF mode** : you only work solo or ask;
  state is authoritative from the hook.

**THE 5-CALL RULE IS DELETED (D11 / D24).** It is gone from the INIT_BLOCK, MCP
`instructions`, both tool descriptions, all nine directive files, and `hook-core.ts`
comments; repo managed blocks purge it on re-upsert. The provider-metered phase model
(context-metering.md) **silently replaces** it, and a permanent grep gate
(`test/no-five-call.test.mjs`, section 11) keeps it gone.
