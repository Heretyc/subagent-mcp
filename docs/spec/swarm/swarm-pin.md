<!-- Part of docs/spec/swarm/_INDEX.md (split). See _INDEX.md for the full swarm spec. -->

## Performance pin design

### Overview

A per-process in-memory timestamp (`pinExpiresAt`) inside the swarm session gates whether
`resolveBranch` in `src/swarm.ts` returns `"performance"` for a pure-auto launch. When inactive,
`resolveBranch` reproduces today's expression exactly: `pureAuto && deadlockActive`. With pin
active it is: `pureAuto && (deadlockActive || swarmPinActive)`.

The pin is QUIET. No tool description, coaching text, or error message ever names the performance
band, routing tiers, counters, or windows. Observability is only the existing `routing_tier`
field in `poll_agent` (reports "performance" on pinned launches) and the new
`get_status.swarm.*` fields (sanctioned in `docs/spec/auto-mode/routing-table-contract.md`).

### Arm / restart

`pinExpiresAt` is set to `now + SWARM_PIN_WINDOW_MS` (3,600,000 ms = 1 hour) ONLY on:
- The idle start (`swarm(null)`): transitions to ACTIVE(1), pin armed.
- Accepted `swarm(1)`: ACTIVE(1)->ACTIVE(2), pin RESTARTED (replaces expiry).
- Accepted `swarm(2)`: ACTIVE(2)->ACTIVE(3), pin RESTARTED.
- Accepted `swarm(3)`: ACTIVE(3)->ACTIVE(4), pin RESTARTED.

Each restart REPLACES the expiry timestamp rather than extending it: a call at t+50min restarts
the window from t+50min, not from t.

### Auto-off triggers

Two auto-off triggers; whichever fires first wins:

1. **Handoff-next (trigger 1):** accepted `swarm(4)` sets `pinExpiresAt = null` immediately,
   because stage 5 (handoff) is now the next stage. The pin is off at the moment the call returns.
2. **1-hour lazy expiry (trigger 2):** `pinActive(now)` returns false once `now >= pinExpiresAt`.
   Boundary is strict: active strictly BEFORE expiry, inactive at exactly +1h. No timers; the same
   lazy pattern as `src/orchestration/model-mode.ts`.

Post-handoff stages (5, 6, 7) and cold re-entry via `swarm(5)` never arm or restart the pin.

### Call-site

The pin is consulted at exactly ONE code path: `src/index.ts` line 1478 via
`resolveBranch(pureAuto, deadlockWindow.active(), swarmSession.pinActive(Date.now()))`.
Explicit launches (`provider`/`provider_model`/`explicit` modes) are never `pureAuto` and always
read `cost_efficiency` regardless of pin state. The `slotInsert` gate (which inserts API provider
slots) is keyed on `branch === "cost_efficiency"`, so pinned auto launches lose API slots
automatically. The deadlock `consume()` at the success path stays and is a no-op when unarmed.

### Anti-gaming rationale

Performance-band routing is deliberately reachable outside manual/profiler paths only through (a) the
deadlock window - bounded to 3 launches and gated on 2 real failures - and (b) the swarm pin - bounded
to 1 hour, armed only by a genuine swarm start, RESTARTED ONLY BY AN ACCEPTED FORWARD ADVANCE into a
pre-handoff stage, and force-cleared the moment handoff becomes the next stage. A REPEATED call to an
already-reported stage does NOT restart the window, so spamming stage reports cannot hold the pin open:
the sequential 1..4 walk allows at most 4 restarts per active phase and the pin dies at handoff
regardless. One residual lever is not closed: swarm(0) (reset) followed by swarm(null) (start)
re-arms a fresh 1-hour pin window even when no stage work was completed between the two calls, and
the sequence may be repeated. This is accepted, not prevented. The lever carries limited practical
force: the pin is reachable ONLY from inside a live swarm, each exercise costs a full discard of all
accumulated stage progress, and a session willing to pay that cost could equally advance through real
pre-handoff stages to hold the same pin duration - the shortcut buys nothing an honest workflow does
not already receive.
There is NO standalone lever, flag, or parameter that selects the performance band, and no swarm
response or tool description ever names it; an orchestrator therefore cannot game routing into
always-high-performance during normal operation - pinning exists only inside swarm's pre-handoff
stages and dies with them.
