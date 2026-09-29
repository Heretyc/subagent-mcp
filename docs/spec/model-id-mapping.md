# Model ID Mapping

How `launch_agent` model selectors map to the CLI/wire model id passed to each
provider. Source of truth: `mapModel` in `src/effort.ts`. Generic
`opus`/`sonnet`/`fable` track the current GA model; explicit version aliases stay
pinned to their exact ids and are never silently advanced.

| Alias | Mapped model id | Provider | Notes |
|-------|-----------------|----------|-------|
| `haiku` | `claude-haiku-4-5` | claude | Effort ignored |
| `sonnet` | `claude-sonnet-5-5` | claude | Generic alias, tracks GA Sonnet 5.5 |
| `sonnet-5-5` | `claude-sonnet-5-5` | claude | Explicit pin |
| `sonnet-5` | `claude-sonnet-5` | claude | Explicit pin |
| `sonnet-4-6` | `claude-sonnet-4-6` | claude | Explicit pin; never substituted to 5.5 |
| `sonnet-4-5` | `claude-sonnet-4-5-20250929` | claude | Explicit pin (dated); effort ignored |
| `opus` | `claude-opus-5-5` | claude | Generic alias, tracks GA Opus 5.5 |
| `opus-5-5` | `claude-opus-5-5` | claude | Explicit pin |
| `opus-5` | `claude-opus-5` | claude | Explicit pin |
| `opus-4-8` | `claude-opus-4-8` | claude | Explicit pin; the only ultracode-capable model |
| `opus-4-7` | `claude-opus-4-7` | claude | Explicit pin |
| `opus-4-6` | `claude-opus-4-6` | claude | Explicit pin |
| `opus-4-5` | `claude-opus-4-5-20251101` | claude | Explicit pin (dated) |
| `fable` | `claude-fable-5-1` | claude | Generic alias, tracks GA Fable 5.1 |
| `fable-5-1` | `claude-fable-5-1` | claude | Explicit pin |
| `fable-5` | `claude-fable-5` | claude | Routing-table/ruleset only; not a selectable explicit override |
| `gpt-5.5` | `gpt-5.5` (passed as-is) | codex | No `max` tier (xhigh ceiling) |
| `gpt-5.6` | `gpt-5.6-sol` on the Codex app-server wire; reported publicly as `gpt-5.6` | codex | Generic alias pins the `gpt-5.6-sol` wire model and inherits its verified `max` tier |
| `gpt-5.6-sol` | `gpt-5.6-sol` (passed as-is) | codex | Account-verified pin; `max`-legal |
| `gpt-5.6-terra` | `gpt-5.6-terra` (passed as-is) | codex | Account-verified pin; `max`-legal |
| `gpt-5.6-luna` | `gpt-5.6-luna` (passed as-is) | codex | Account-verified pin; `max`-legal |
| `gpt-6-astra` | `gpt-6-astra` (passed as-is) | codex | `max`-legal |
| `gpt-6-sol` | `gpt-6-sol` (passed as-is) | codex | `max`-legal |
| `gpt-6-luna` | `gpt-6-luna` (passed as-is) | codex | `max`-legal |

Selectable explicit overrides (the `launch_agent` model enum): `haiku`, `sonnet`,
`sonnet-5-5`, `sonnet-5`, `sonnet-4-6`, `sonnet-4-5`, `opus`, `opus-4-8`,
`opus-5-5`, `opus-5`, `opus-4-7`, `opus-4-6`, `opus-4-5`, `fable`, `fable-5-1`
(claude); `gpt-5.5`, `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`,
`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` (codex).
`fable-5` is a launchable routing-table/ruleset id only and is not accepted as an
explicit override.

The `api` provider dispatches arbitrary configured model strings from
`providers.jsonc`; it has no fixed roster and is internal auto-slot routing only,
never a selectable explicit override.
