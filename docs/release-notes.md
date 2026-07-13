# Release Notes

Operator-facing release notes for `subagent-mcp`. Newest version first.

The publishing procedure itself (dual-registry contract, version-sync gate,
auth) lives in [docs/spec/dev-loop/release-publishing.md](spec/dev-loop/release-publishing.md);
this page records what each release changes for operators.

Historical entries:

- [v2.12.7 to v2.12.4](release-notes/v2.12.7-to-v2.12.4.md)
- [v2.12.2 and earlier](release-notes/v2.12.2-and-earlier.md)

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
