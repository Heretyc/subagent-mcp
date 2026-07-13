# Model-Selection-Mode Spec Index

Status: normative spec for the `model-selection-mode` MCP tool. This directory
is the canonical home for the design; the implementation lives in
`src/orchestration/model-mode.ts` (wired into `launch_agent` and tool
registration in `src/index.ts`), and the per-project state file is a sibling of
the orchestration marker. This directory is design + contract only.

## What model-selection-mode is

A per-project mode that gates the `launch_agent` tool's model/provider/effort
SELECTOR params. Two modes only:

- **`smart`** : the DEFAULT, used whenever the mode is unset. In smart mode,
  `launch_agent` KEEPS `provider`/`model`/`effort` in its schema but REJECTS any
  call that supplies them. The server auto-selects the best model. The rejection
  tells the agent the best model is already being selected from latest
  benchmarking data, rigorous research, and environment conditions the agent may
  be unaware of.
- **`user-approved-overrides`** : grants a 30-minute window during which
  `launch_agent` honors `provider`/`model`/`effort` normally.

The MCP tool only flips the mode (and stamps the enable-timestamp). No hook and
no background process are involved; enforcement happens inside `launch_agent`
itself.

## Scope

Only `launch_agent`'s `provider`/`model`/`effort` selectors are gated by this
mode. No other tool is affected. The selector params stay in the `launch_agent`
schema in BOTH modes : the mode changes whether supplying them is honored or
rejected, not whether they exist.

For this gate, a selector is supplied when its value is not `undefined`. An
empty string still counts as supplied and is rejected in `smart` before any
override path can honor it.

## Smart-mode rejection and fallback ladder

On a smart-mode rejection the agent is instructed: if it has a specific scoped
need for a particular provider/model/effort it must ALWAYS stop and use the
structured-question tool to ask the user for authorization, then call
`model-selection-mode` with `user-approved-overrides`.

- Structured-question tool by provider: `AskUserQuestion` on Claude,
  `request-user-input` on Codex. If no structured tool exists, fall back to a
  plain yes/no question.

**Fallback ladder** (when the agent cannot complete the ask path):

- **(a) Structured-question tool itself is broken (provider issue).** The
  subagent works until it needs to ask, then RETURNS to its caller with the
  question + possible multiple-choice answers. The orchestrator asks the user
  and relaunches the subagent.
- **(b) A real error caused the block.** The user MUST be consulted before
  continuing.

## Honor-based authorization

`user-approved-overrides` MUST NOT be enabled without explicit interactive user
authorization obtained via the structured-question tool (or plain yes/no if
none exists). Enforcement is honor-based : the tool CANNOT technically verify
that authorization was obtained; the metadata makes the requirement binding.
Never enable on your own initiative.

(Parallel to orchestration-mode's disable rule: the provider-appropriate
interactive tool is mandatory, and the agent must not act unilaterally.)

## 30-minute lazy-revert window

- **Wall-clock from enable time.** The window is measured against the
  enable-timestamp recorded when `user-approved-overrides` was set.
- **Lazy enforcement, no background timer.** The enable-timestamp is stored. On
  EACH `launch_agent` call the elapsed time is compared against 30 minutes. If
  more than 30 minutes have elapsed, the mode reverts to `smart` and smart-mode
  behavior applies to that call.
- **No refresh / no extend.** Re-calling `model-selection-mode` with
  `user-approved-overrides` while a window is already active does NOT extend or
  refresh the clock. The original enable-timestamp stands.

## Persistence

The last mode AND the override window's enable-timestamp persist across MCP
server restarts. State is a per-project file keyed by `cwd`, sibling to the
orchestration marker.

- On restart the mode is RESTORED (NOT reset to `smart`), and the remaining
  window time is restored from the stored enable-timestamp.
- Because the timer is lazy, a window that already expired during downtime
  simply reverts on the next `launch_agent` call.

State file location: `os.tmpdir()/subagent-mcp/model-<cwdHash>.json`, mirroring
the orchestration marker (`orch-<cwdHash>.flag`). `cwdHash` keys the file to the
project working directory.

## The locked decisions

1. Two modes only: `smart` (default when unset) and `user-approved-overrides`.
2. Smart mode keeps selector params in schema but rejects calls that supply
   them (`value !== undefined`, including empty strings); the server selects
   automatically. Rejection message cites benchmarking data, research, and
   environment conditions.
3. Override enablement is honor-based and REQUIRES explicit interactive user
   authorization via the structured-question tool (provider-appropriate, or
   yes/no fallback). Never self-initiated.
4. 30-minute window, wall-clock from enable, enforced LAZILY on each
   `launch_agent` call. No background timer. No refresh on re-enable.
5. Mode + enable-timestamp persist across restarts in a per-project state file
   (`model-<cwdHash>.json`, sibling to the orchestration marker); on restart the
   mode is restored, not reset.
6. Scope is limited to `launch_agent`'s `provider`/`model`/`effort` selectors;
   no other tool is gated.
7. Failover behavior by mode. `smart` mode rejects any supplied selector and
   auto-selects, so the auto-mode attempt loop runs and same-call failover on
   transient provider errors applies (the loop silently advances across
   ruleset-selected candidates; `../auto-mode/routing-table-contract.md`).
   `user-approved-overrides` mode, when the caller supplies any selector,
   produces an override launch: a SINGLE attempt, NO failover. If that attempt
   fails, the error is `explicit launch ... failed` for all three selectors
   (`provider + model + effort`) or `override launch ... failed` for partial
   selectors; when the failure classifies as `transient_provider`
   (`classifyFailureReason`), a `Note:` line is appended advising the caller to
   switch to auto mode (omit the selectors) for automatic silent failover
   (`../auto-mode/resolution-matrix.md`). Enabling `user-approved-overrides`
   does NOT grant failover - override-mode single-attempt hard-fail semantics
   apply regardless of model-selection-mode.
