# subagent-mcp configure: full settings catalog

Canonical keys for the `configure` MCP tool. `<provider>` is one URI-encoded
provider-name segment (dots encoded as `%2E`). `<ENV_NAME>` must match
`[A-Za-z_][A-Za-z0-9_]*`. "Default" is the runtime fallback, not necessarily
the value in a scaffolded file. Every response reports `restart_required`;
`list`/`get` never write a file.

## Resolved files by scope

Report absolute paths, never `~`.

| scope | resolved file |
|---|---|
| machine-global | installed `dist/global-subagent-mcp-config.jsonc` beside the compiled modules; legacy `dist/global-concurrency.jsonc` only when the canonical file is absent |
| providers | `<config-home>/providers.jsonc` |
| env | `<config-home>/.env` |
| user settings (write target) | `<config-home>/settings.json` |
| user settings (override) | `<config-home>/settings.local.json`; read-merged and reported as `source`, never written |
| auto-update registry | `~/.subagent-mcp/init-registry.json` (does **not** honor `SUBAGENT_CONFIG_HOME`) |
| orchestration mode | no configure-owned file; queried through the mode helpers |
| model selection mode | path from `modelModePath(cwd)`; owned by `model-selection-mode` |

`<config-home>` is `SUBAGENT_CONFIG_HOME` when set, otherwise `~/.subagent-mcp`.

## Machine-global keys (tool-read-only)

All six live in the installed machine-global file and affect every user on the
machine. `configure` never writes them: `set` is a successful no-op with
`status: "coached"` naming the fully resolved path a human must edit.

| key | type | default | valid values | restart |
|---|---|---|---|---|
| `global.globalConcurrentSubagents` | integer | `20` | integer `>=10` used as-is; `1..9` clamps to `10`; non-integer or `<=0` falls back to `20`; re-read per `launch_agent` | false |
| `global.checkForUpdates` | boolean | `true` | `true`/`false`; forced false by `NO_UPDATE_NOTIFIER`, `CI`, `NODE_ENV=test`, or `SUBAGENT_UPDATE_CHECK=0|false` (case-insensitive), reported via `source` | true for an already-started update cycle |
| `global.permissionsCeiling` | enum | `auto` when missing; malformed file fails closed to `manual` | `auto`, `manual`, `yolo` | false |
| `global.escalation` | enum | `irreversible-only` | `irreversible-only`, `off` | false |
| `global.strictReadParity` | enum | `warn` | `warn`, `off` | false |
| `global.sandboxNetwork` | boolean | parser fallback `true` when missing/invalid; the shipped scaffold explicitly writes `false` | `true`, `false` | false |

None are redacted.

```json
{ "action": "get", "key": "global.globalConcurrentSubagents" }
```

## User settings keys (settable)

Written to `settings.json` with comments and unrelated keys preserved,
atomically backed up first. If `settings.local.json` overrides the key, the
response reports the effective value and its `source` instead of claiming the
requested value took effect. Neither is redacted; neither requires a restart.

| key | type | default | valid values |
|---|---|---|---|
| `user.contextCoaching` | boolean | `true` | exactly `true` or `false` |
| `user.handoffWarnThreshold` | integer | `60` | whole integer `40..90`; out-of-range or malformed input is rejected, not normalized |

```json
{ "action": "set", "key": "user.handoffWarnThreshold", "value": "75" }
```

## Update key (tool-read-only)

| key | scope | type | default | valid values | restart |
|---|---|---|---|---|---|
| `update.autoUpdate` | per-user init registry | boolean | runtime fallback `false`; first-run setup normally records `true` | `true`, `false` | true for an already-started update cycle |

Per-user, not machine-global. `set` coaches the user to edit
`~/.subagent-mcp/init-registry.json` by hand. Not redacted.

```json
{ "action": "get", "key": "update.autoUpdate" }
```

## Mode keys (tool-read-only, delegated)

| key | type | default | valid values |
|---|---|---|---|
| `mode.orchestration` | state | effective session state computed by the mode code | `ON`, `disabled-this-session`, plus `session_scope` metadata |
| `mode.modelSelection` | state | `smart` | `smart`, `user-approved-overrides`, plus timestamp/window metadata |

`set` never mutates mode state; it directs the caller to the `orchestration-mode`
tool (`enabled=true|false`) or the `model-selection-mode` tool
(`mode="smart"|"user-approved-overrides"`). Not redacted, no restart.

```json
{ "action": "get", "key": "mode.orchestration" }
```

## Provider keys (settable)

All live in `<config-home>/providers.jsonc`. Every write validates the full
candidate config in a scratch sibling file before the real file is touched,
then atomically backs up and rewrites the target with mode `0600`. Only API
providers (entries with `api_style`) appear in this namespace.

| key | type | valid values | restart | redacted |
|---|---|---|---|---|
| `providers.<provider>` | JSON object | complete API-provider object with usable `api_style`, `base_url`, `model`, `key_env`, and all 14 routing keys; unknown extra fields may be preserved. This is the only way to create a provider, because partial field writes cannot validate | true only if `key_env` changes | nested `key_env` value is deep-redacted |
| `providers.<provider>.api_style` | enum | `claude`, `openai` | false | no |
| `providers.<provider>.base_url` | string | non-empty string | false | no |
| `providers.<provider>.model` | string | non-empty string | false | no |
| `providers.<provider>.key_env` | string | env var name matching `[A-Za-z_][A-Za-z0-9_]*`; a matching non-placeholder `.env` entry must already exist | true | yes (key matches `/key/i`) |

Scalar fields are settable on an existing provider only, unless the whole
candidate validates. Providers are re-read on every launch, which is why scalar
edits need no restart.

### Routing slots (settable)

All 14 keys take the form `providers.<provider>.routing.<category>`, type
integer slot, no restart, not redacted. Value rules: any safe integer; `>=1`
inserts the provider at that one-based priority slot for the category; `<1`
(for example `-1`) disables it there. Categories:

`math_proof`, `security_review`, `debugging`, `quality_review`, `architecture`,
`agentic_execution`, `data_analysis`, `coding`, `knowledge_synthesis`,
`mechanical`, `prompt_engineering`, `vulnerability_research`,
`molecular_biology`, `ml_accelerator_design`.

`fallback_default` is intentionally not a routing key.

```json
{ "action": "set", "key": "providers.acme.routing.coding", "value": "1" }
```

## Env keys (settable)

| key | scope | type | valid values | restart | redacted |
|---|---|---|---|---|---|
| `env.<ENV_NAME>` | `<config-home>/.env` | secret string | non-empty single-line value (no `\r`, `\n`, or NUL); name must match `[A-Za-z_][A-Za-z0-9_]*` | true | always, even when the name lacks a secret-ish word |

Writes preserve comments, blank lines, and unrelated assignments, replace the
first matching assignment, drop later duplicates of the same name, back up
atomically, and write mode `0600`. `process.env` is never mutated: the contract
is that environment changes need a host restart.

```json
{ "action": "set", "key": "env.ACME_API_KEY", "value": "sk-real-key" }
```

## Redaction

Applied once, to the whole response, before serialization.

- Any canonical key or nested property matching `/token|key|password|secret/i`
  is masked, as is every `env.*` value.
- Values shorter than six characters become the fixed mask `******`.
- Longer values become the first four characters, a one-character ellipsis, and
  the last two characters, for example `abcdefghxy` renders as `abcd`+ellipsis+`xy`.
- Errors carry canonical keys and sanitized validator reasons only. A submitted
  value never appears in a response, error, or log. Paths and backup names may
  be reported; file contents may not.

## Listing

```json
{ "action": "list" }
```

Returns one row per concrete key, sorted by key, each with `key`, `value`,
`scope`, `type`, `default`, `valid_values`, `settable`,
`restart_required_on_set`, `redacted`, `path`, and optional `source`, plus the
four dynamic patterns: `providers.<provider>`,
`providers.<provider>.{api_style|base_url|model|key_env}`,
`providers.<provider>.routing.<category>`, and `env.<ENV_NAME>`.
