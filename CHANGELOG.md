# Changelog

## 3.0.1

### Fixed

- API provider `base_url` that includes a trailing `/v1` no longer double-appends
  the version path (was producing `/v1/v1/chat/completions` and a 404). A 404 now
  distinguishes an unknown model from a wrong `base_url` instead of always
  reporting "model not found".
- Bumped transitive `hono` to clear a high-severity npm audit advisory
  (GHSA-wwfh-h76j-fc44). Not runtime-reachable here (stdio transport only).

### Docs

- Corrected the `smcp-help` and `smcp-doctor` skills to describe the API routing
  engine as live since 3.0.0 (they still said it "ships in a later release").
- Refreshed the README example image.

## 3.0.0

### BREAKING

- First release with direct API provider support. The provider union now includes
  `api` alongside `claude` and `codex`; configured API providers can make direct
  Claude Messages or OpenAI-compatible HTTP calls instead of only launching CLI
  sub-agents.

### Added

- API provider config through `providers.jsonc`, including per-category slot
  routing for API providers.
- HTTP client support for Claude Messages and OpenAI-compatible API styles.
- Once-per-session launch gate for the first API-routed request.
- `SUBAGENT_MCP_DISABLE_API_PROVIDERS=1` escape hatch to skip API providers and
  fall back to CLI candidates.
- Always-on workspace-write sandbox network access and a first-run permission
  ceiling menu.
- Handoff-resume flow now asks 4 questions after the handoff read.
