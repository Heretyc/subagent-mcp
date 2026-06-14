# Advanced-Ruleset Visibility and Post-Spawn Failover

Normative. Defines (1) how a ruleset-altered decision is exposed in
`launch_agent` and `poll_agent` payloads, and (2) the post-spawn grace-window
failover contract. Both sections deliberately AMEND `../auto-mode/` clauses;
the amendments are enumerated explicitly at the end of each section.

## Visibility fields

`AgentState` gains two optional fields, threaded through `tryLaunchCandidate`
exactly like `routingTier` (an optional trailing param, stored at
registration):

```ts
rulesetApplied?: boolean;
rulesetOriginalSelection?: { provider: string; model: string; effort: string };
```

Presence rule — fields exist ONLY when the ruleset actually ALTERED the
routing decision, determined by an order-sensitive `(provider, model, effort)`
triple-list comparison of the pre-ruleset vs post-ruleset candidate lists.
Ran-but-passthrough and gate-disabled launches look BYTE-IDENTICAL to the
pre-feature payload shape (existing absent-field test assertions stay valid).

- `ruleset_original_selection` = the PRE-ruleset rank-1 candidate.
- The FINAL selection is already the payload's top-level
  `provider`/`model`/`effort` — the candidate that actually launched, which
  after failover may not be the ruleset's rank-1. Original vs final is
  therefore fully readable from one payload.

`launch_agent` success payload, conditionally extended (illustrative):

```json
{
  "agent_id": "<uuid>",
  "status": "processing",
  "provider": "codex",
  "model": "gpt-5.5",
  "effort": "xhigh",
  "task_category": "coding",
  "ruleset_applied": true,
  "ruleset_original_selection": { "provider": "claude", "model": "opus-4-8", "effort": "ultracode" }
}
```

`poll_agent` output: next to the existing `routing_tier` conditional spread,
add `...(agent.rulesetApplied ? { ruleset_applied: true,
ruleset_original_selection: agent.rulesetOriginalSelection } : {})`.

No tool-description text changes — no mcp-compliance byte-cap risk.

### Explicit-mode failure shape

If the ruleset modified an explicit launch, `skipped` may hold more than one
entry, and `ERR_EXPLICIT_FAILED` assumes exactly one attempt. The guard
becomes `isExplicit && !rulesetApplied` → `ERR_EXPLICIT_FAILED`; otherwise
fall through to the numbered `ERR_ALL_FAILED` shape (the only shape that can
report N != 1 attempts).

### Amendments (visibility)

- `../auto-mode/param-contract.md` ("the launch payload carries no
  routing-internal fields"): amended — the conditional `ruleset_applied` +
  `ruleset_original_selection` pair is the single sanctioned exception.
- `../auto-mode/routing-table-contract.md` ("`poll_agent.routing_tier` is the
  sole sanctioned tier/branch exposure"): amended to an enumerated list —
  `routing_tier`, `ruleset_applied`, `ruleset_original_selection`. Nothing
  else; deadlock/branch/window state remains invisible everywhere.

## Post-spawn grace-window failover

Bug being fixed: launch success used to be declared solely on the child
`spawn` event. A provider that spawns and dies immediately (codex installed
but not logged in) was a FALSE success — the agent registered, the attempt
loop never advanced, and the failure surfaced only later via `poll_agent`.

Contract:

1. `tryLaunchCandidate` wires the provider driver fully BEFORE waiting:
   persistent `error` handler, stdout/stderr/`close` handlers, and initial
   user input submission. Stream output during the window is therefore
   captured, and a healthy provider has accepted its first turn.
2. THEN it awaits a race between the child `exit` event and a
   `SPAWN_GRACE_MS` timer, BEFORE registering the agent.
3. ANY exit within the window — any exit code INCLUDING 0, or any signal — is
   a LAUNCH-TIME failure: the candidate is pushed to `skipped` with a reason
   of the form (illustrative; tests assert it contains the exit code):
   `process exited (code <code-or-signal>) within <SPAWN_GRACE_MS>ms of
   spawn: <last stderr line>` — and the loop SILENTLY advances. The agent is
   never registered; the existing `close` handler cleans up. Rationale: a CLI
   that exits in under the window without consuming the task did not launch;
   auth failures are non-zero anyway, and code-0 instant exits are equally
   useless to the orchestrator.
   SOLE EXCEPTION: a provider driver whose `AgentState` was already finalized by
   its turn-completion marker (the dedicated `turnCompleted` flag set by the
   stdout data/flush scans — NOT `status`, which any code-0 exit also sets to
   `finished`) is a legitimate fast COMPLETION: it IS registered and IS a
   launch success, never a failover trigger — failing it would silently
   re-execute a completed task on the next candidate. Because `exit` can be
   delivered before the final stdout chunk, the grace path awaits `close`
   (streams drained, flush scanned) before deciding. This is
   the ONLY exception; any other exit — including code 0 without that
   finalization — remains a launch-time failure.
4. `SPAWN_GRACE_MS` defaults to **1500**. `SUBAGENT_SPAWN_GRACE_MS` overrides
   it (non-negative integer; `0` disables post-start early-exit detection). The
   override is a TEST-ONLY seam: legacy fixtures can exit instantly by design
   and would otherwise all fail. Production deployments
   never set it. (The goal's "hardcoded" constraint applies only to the
   2-minute ruleset timeout.)
5. Exhaustion rule: `ERR_ALL_FAILED` is emitted ONLY after EVERY candidate in
   the (possibly ruleset-modified) list has been tried. Not-installed
   (ENOENT), not-logged-in (early exit), and any other launch-time error all
   advance silently; NOTHING aborts the cycle early.
6. Cost: every successful launch gains up to +1.5 s latency inside
   `launch_agent`. Accepted — launches are infrequent, and first-output gating
   would misclassify slow-thinking claude starts.
7. AFTER the window: late deaths remain TASK outcomes observed via
   `poll_agent`/`wait` (the existing `reconcileAgent`/close-handler paths are
   untouched) and are NEVER failover triggers.

### Amendments (failover)

- `../auto-mode/routing-table-contract.md` ("launch_agent returns immediately
  after a successful `spawn` ... eventual death is never a fallback trigger"):
  amended — success now additionally requires surviving the grace window;
  the never-a-fallback-trigger rule is rescoped to AFTER the window.
- `../auto-mode/resolution-matrix.md` anti-example ("do NOT treat a
  sub-agent's eventual TASK failure as a fallback trigger"): rescoped the same
  way — in-window exits are launch-time failures, post-window deaths are task
  outcomes.

## Negative constraints

- Never expose `ruleset_applied`/`ruleset_original_selection` on passthrough
  or disabled launches — absence is part of the contract.
- Never re-run the ruleset script per failover attempt (the list is final).
- Never register an agent that exited inside the grace window, except one
  finalized by its provider turn-completion marker (the sole exception in item 3).
- Never treat a post-window death as a failover trigger.
- Never set `SUBAGENT_SPAWN_GRACE_MS` in production wiring or docs examples.

## When to stop and ask the owner

Changing the 1500 ms default, exposing more ruleset internals in payloads, or
making in-window exits count as success beyond the provider completion exception
are owner-level decisions.
