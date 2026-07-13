# Permission Threat Model

## One-screen summary

The permission system accepts several explicit residual risks: hostile repo
allow rules are honored, a compromised orchestrator can self-answer manual
requests, Codex network and in-sandbox behavior has harness-specific limits,
and `yolo` bypasses all gating including config-file protection.

## Load when

- Evaluating whether a permission change widens, narrows, or conflicts with an
  accepted residual risk.
- Touching security rationale, threat wording, cross-harness caveats, or
  divergence notes.

## Do not load when

- Only implementing ceiling modes, classes, path scoping, or rule syntax. Use
  `ceiling-modes.md`.
- Only implementing config ingestion, pending-permission lifecycle, or child
  lockout. Use `config-and-lifecycle.md`.

## 7. Threat model: accepted risks (stated plainly)

- **Hostile repo `allow[]` is fully honored.** A repo's `.claude`/`.codex`
  settings can pre-approve mutating actions and widen
  `allow`/`additionalDirectories`; this is the documented accepted risk.
  Bounded, not eliminated: DANGER/config self-protection cannot be widened and
  Codex `untrusted` still routes mutations through `verdict()`. **Residual:**
  repo `allow:['Bash']` under `manual` can auto-allow Claude Bash if no other
  deny/ask matches. Closing it means refusing repo `allow[]`, which the mandate
  forbids.
- **Orchestrator self-answer in manual mode (J1-1 residual).**
  `respond_permission` takes no attestation; a compromised orchestrator can
  answer `manual` requests itself. Accepted: it already holds `kill_agent`/
  `send_message`/`launch_agent`; no `responder` provenance field shipped.
- **Codex sandbox network.** `auto`/`manual` default to workspace-write with no
  network. `sandboxNetwork` or network-ish allow rules reopen network while
  keeping `approvalPolicy:'untrusted'`; `yolo` remains the blunt fallback that
  removes both approval gating and the sandbox.
- **Codex in-sandbox blind spots.** Under `untrusted`, Codex's own known-safe
  reads may auto-run without reaching `verdict()`; no mutation escapes approval.
- **Codex approval TOCTOU (J2-16).** smcp evaluates a `fileChange` path at
  decision time; execution follows in the child. A symlink swapped between is a
  narrow, accepted gap: bounded by `untrusted` requiring an approval to exist at
  all.
- **Config-file integrity.** Startup SHA-256 + per-launch re-check surfaces
  `ceiling_integrity: changed_since_startup`; the config path is a DANGER-floor
  write target under `auto`/`manual`. **Divergence:** the earlier design called
  this "the one rule that survives yolo." In the shipped code `yolo` returns
  `allow` before the engine runs (and Claude `bypassPermissions` skips
  `canUseTool`), so **under yolo the config file is not gated either**: yolo
  means no gating, no exception.
- **Cross-harness residuals.** Network enforced by Codex sandbox but on Claude
  only via `WebFetch(domain:)` rules. Deny-reason delivery shape differs
  (attached tool_result vs turn-prefix notice).

## 9. See also

`interactive-drivers.md` (launch values);
`dev-loop/orchestration-directive-architecture.md` (orchestration mode is
orthogonal: who delegates vs what a sub-agent may do);
`../reference/status-lifecycle.md` (`permission_requested`).
