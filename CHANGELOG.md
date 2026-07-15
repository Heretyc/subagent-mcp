# Changelog

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
