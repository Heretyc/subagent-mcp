# subagent-mcp configure: settings reference

Canonical keys for the `configure` MCP tool. `<provider>` is one URI-encoded
provider-name segment (dots encoded as `%2E`). `<ENV_NAME>` must match
`[A-Za-z_][A-Za-z0-9_]*`. Every response reports `restart_required`;
`list`/`get` never write a file.

## The catalog is discoverable at runtime

Do not rely on a hand-written key table: `{"action":"list"}` returns every row
with `key`, `value`, `type`, `default`, `valid_values`, `scope`, `path`,
`settable`, `restart_required_on_set`, and `redacted` (plus optional
`source`), and the four dynamic patterns `providers.<provider>`,
`providers.<provider>.{api_style|base_url|model|key_env}`,
`providers.<provider>.routing.<category>`, and `env.<ENV_NAME>`. Always read
key names, defaults, and valid values from `list`/`get` output; never guess.
A row's `default` is the runtime fallback, not necessarily the value in a
scaffolded file.

Representative call:

```json
{ "action": "set", "key": "user.handoffWarnThreshold", "value": "75" }
```

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

## Read-only keys and coached sets

All `global.*` keys, `update.autoUpdate`, and the `mode.*` keys are read-only
through this tool. `set` on any of them is a successful no-op with
`status: "coached"` and a message naming the fully resolved file a human must
edit, or (for `mode.*`) the `orchestration-mode` / `model-selection-mode` tool
to use instead. The coached response is returned even when `value` is omitted,
and any supplied `value` is ignored.

## Behavior a list row does not spell out

- `get`/`list` rows may carry `source`. Besides env-override and
  `settings.local.json` labels, it can be the literal strings
  `"fallback (global file absent)"` (global keys read while the machine-global
  file is absent) or `"fallback (registry absent)"` (`update.autoUpdate` when
  the init registry is absent).
- `restart_required_on_set` is a boolean except on whole-provider
  `providers.<provider>` rows, where it is the literal string
  `"if key_env changes"`.
- Setting the whole `providers.<provider>` object is the only way to create a
  provider, because partial field writes cannot validate; the scalar fields
  (`api_style`, `base_url`, `model`, `key_env`) are settable on existing
  providers only. Provider writes validate the full candidate config in a
  scratch sibling file before the real file is touched, then atomically back
  up and rewrite the target with mode `0600`. Providers are re-read on every
  launch, which is why scalar edits need no restart.
- `providers.<provider>.key_env`: non-empty string; a matching non-placeholder
  `.env` entry must already exist (the variable-name regex is not enforced for
  this field).
- Routing slots: any safe integer; `>=1` inserts the provider at that
  one-based priority slot for the category, `<1` disables it there. The
  categories mirror `launch_agent` `task_category` values; `fallback_default`
  is intentionally not a routing key.
- `env.<ENV_NAME>` writes are shape-checked only (non-empty, single line: no
  CR, LF, or NUL). They preserve comments, blank lines, and unrelated
  assignments, replace the first matching assignment, drop later duplicates of
  the same name, back up atomically, and write mode `0600`. `process.env` is
  never mutated: environment changes need a host restart, so `env.*` and
  `key_env` changes report `restart_required: true`.

## Redaction

Applied once, to the whole response, before serialization.

- Any canonical key or nested property matching `/token|key|password|secret/i`
  is masked, as is every `env.*` value.
- Values shorter than six characters become the fixed mask `******`.
- Longer values become the first four characters, a one-character ellipsis
  (the single U+2026 character), and the last two characters; for example
  `abcdefghxy` renders as `abcd` + ellipsis + `xy`.
- Errors carry canonical keys and sanitized validator reasons only. A submitted
  value never appears in a response, error, or log. Paths and backup names may
  be reported; file contents may not.
