# Release Notes

Operator-facing release notes for `subagent-mcp`. Newest version first.

The publishing procedure itself (dual-registry contract, version-sync gate,
auth) lives in [docs/spec/dev-loop/release-publishing.md](spec/dev-loop/release-publishing.md);
this page records what each release changes for operators.

Historical entries:

- [v2.12.7 to v2.12.4](release-notes/v2.12.7-to-v2.12.4.md)
- [v2.12.2 and earlier](release-notes/v2.12.2-and-earlier.md)

---

## v3.1.10

### Deny and lifecycle behavior

- Claude `permissions.deny` now converges to `["Agent"]` only; Task widget
  tools and Explore remain usable.
- Upgrade silently removes legacy `Task`, `Explore`, and `Agent(Explore)` deny
  entries. `doctor` offers repair, while `uninstall` reverts the smcp-owned
  Claude and Codex suppression state without touching unrelated settings.
- Codex native-agent suppression remains `multi_agent = false` only.

---

## v3.1.7

### Continuous audit hardening

- **ISS-080:** Hardened host/plugin-root validation so invalid plugin roots are
  rejected instead of trusted.
- Added static native-agent suppression checks for Claude, Codex, and Gemini
  setup paths, with doctor coverage for missing layers.
- Preserved the sole-channel rule across both orchestration states and kept
  smart model selection as the default unless the user explicitly approves an
  override window.
- Unblocked PR-time CI for continuous-audit branches and Node 20 timer behavior.

## v3.1.6

### Codex context-window metering

- Codex now forwards the harness-reported `model_context_window` as the metering
  window, so occupancy is computed as `last_token_usage / model_context_window`.
  A 155K-used / 258K-window turn reports ~60% USED / ~40% remaining instead of a
  false 100% driven by cumulative token accounting.
- Codex `SessionStart` renders the USED utilization from a fresh persisted
  metering record for the current session; stale or absent records stay unknown.
- Semantics unchanged and clarified in docs: the hook tag `utilization` is the
  USED percentage and the footer `Remaining Context` is the remaining
  percentage.

---

## v3.1.5

### Codex metering and routing

- Fixed Codex context metering to use `last_token_usage` for current context
  occupancy. Cumulative `total_token_usage` remains accounting data and no
  longer trips orchestration to 100% when cached input dominates.
- Updated shipped Codex routing so the public `gpt-5.6` selector launches the
  current `gpt-5.6-sol` backend id.
- Expanded provider failover classification for `401`, `403`, `429`, `5xx`, and
  auth-like launch errors, including direct API-provider retries.

---

## v2.12.11

### Session-5 audit hardening

- **ISS-040..047, ISS-049:** Shipped the session-5 premise-audit batch with
  targeted fixes across orchestration, documentation, and validation surfaces.
- Added the ASCII prose policy and `check:prose` gate coverage.
- Added the README configuration section and Gemini CLI install guide.

---

## v2.12.10

### Session-4 audit hardening

- **ISS-028:** Hardened the untrusted-output envelope against literal terminator
  escape.
- **ISS-030:** Made Codex TOML parsing quote- and multiline-aware so malformed
  config fails closed only on real malformation.
- **ISS-031:** Restricted orchestration disables to session-keyed-only behavior.
- **ISS-032:** Keyed Codex `SessionStart` state by session.
- **ISS-033:** Added a total identity ladder with an anonymous floor and
  per-owner claims map.
- **ISS-034:** Made orchestration state writes atomic with temp-file cleanup.
- **ISS-035:** Matched shared parent-marker detection to the exact predicate.
- **ISS-037:** Added a no-api-keys gate.
- **ISS-038:** Converted guard coverage to behavioral tests.
- **ISS-039:** Fixed registration docs for the current config filename and legacy
  fallback.

---
