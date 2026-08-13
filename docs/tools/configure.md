<!-- Part of docs/tools.md (split). See ../tools.md for full tool reference index. -->

## `configure`

List, read, or update subagent-mcp configuration by canonical key.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `"list" \| "get" \| "set"` | Yes | Operation to perform |
| `key` | string | Required for `get` and `set`; rejected for `list` | Canonical config key (discover with `action=list`) |
| `value` | string | Required for `set` on settable keys; rejected for `get`/`list` | New value as a string; read-only keys return a coaching message instead |

### Actions

**`list`**: Returns all known config keys with their effective values, metadata, and four dynamic key patterns. Results are sorted lexically by key. `value` and `key` must be omitted. Response: `{ ok: true, action: "list", restart_required: false, keys: ConfigRow[], patterns: string[] }`.

**`get`**: Returns the effective value and metadata for exactly one canonical key. `key` is required; `value` must be omitted. Response: `{ ok: true, action: "get", key, value, scope, path, settable, restart_required: false, restart_required_on_set, source? }`.

**`set`**: Writes a new value for a settable key after validation. Read-only keys (all `global.*`, `update.*`, and `mode.*`) never write; they return `{ ok: true, action: "set", key, status: "coached", path, backup: null, restart_required: false, message }` -- this is not an MCP error, it is returned even when `value` is omitted, and any supplied `value` is ignored. Unchanged writes return `status: "unchanged"` and create no backup. Successful writes return `{ ok: true, action: "set", key, value, status: "updated", path, backup, restart_required }`.

### Key catalog

The key catalog is discoverable at runtime and is not restated here:
`{"action": "list"}` returns one row per key with `key`, `value`, `type`,
`default`, `valid_values`, `scope`, `path`, `settable`,
`restart_required_on_set`, and `redacted`, plus the four dynamic key patterns
(`providers.<provider>`,
`providers.<provider>.{api_style|base_url|model|key_env}`,
`providers.<provider>.routing.<category>`, and `env.<ENV_NAME>`). See
[skills/smcp-config/references/settings.md](../../skills/smcp-config/references/settings.md)
for behavior a list row does not spell out.

Two row fields take non-obvious values:

- `restart_required_on_set` is a boolean except on whole-provider
  `providers.<provider>` rows, where it is the literal string
  `"if key_env changes"`.
- `get`/`list` rows may carry `source`. Besides env-override and
  `settings.local.json` labels, it can be the literal strings
  `"fallback (global file absent)"` (global keys read while the machine-global
  file is absent) or `"fallback (registry absent)"` (`update.autoUpdate` when
  the init registry is absent).

### Resolved config file paths

| Scope | Resolved path |
|-------|--------------|
| machine-global | installed `dist/global-subagent-mcp-config.jsonc`; falls back to `dist/global-concurrency.jsonc` when the primary is absent |
| providers | `<configHome>/providers.jsonc`; `configHome` honors `SUBAGENT_CONFIG_HOME`, else `~/.subagent-mcp` |
| env | `<configHome>/.env` |
| user settings write target | `<configHome>/settings.json` |
| user settings local override | `<configHome>/settings.local.json` (list/get return the merged effective value; set still writes `settings.json`) |
| auto-update registry | `~/.subagent-mcp/init-registry.json` (ignores `SUBAGENT_CONFIG_HOME`) |

`configure` always reports absolute resolved paths. It never calls a loader that scaffolds a missing global config file.

### Redaction

Values are redacted before serialization. Any canonical key or nested object property matching `/token|key|password|secret/i` has its value masked. All `env.*` values are always masked regardless of the variable name. Values shorter than 6 characters become `******`; values 6 characters or longer become the first 4 characters, a one-character ellipsis (the single U+2026 character, not three dots), and the last 2 characters (for example, `abcdefghxy` becomes `abcd` + ellipsis + `xy`). Submitted values never appear in errors, logs, or debug output.

### Global-scope read-only rule

All `global.*` keys are read-only through MCP because they affect all users on
the machine; `update.autoUpdate` and the `mode.*` keys are read-only as well. A
`set` on any of them succeeds with `status: "coached"` and a message naming the
fully resolved file a human must edit (`global.*`, `update.autoUpdate`) or the
tool to use instead (`orchestration-mode` for `mode.orchestration`,
`model-selection-mode` for `mode.modelSelection`). The exact message strings
live in `src/configure.ts` and are intentionally not copied here.

### `restart_required` semantics

`restart_required: true` in a set response means the changed value is in process environment state (`.env` entries, `key_env` field changes) and will not take effect until the MCP server process is restarted. `restart_required: false` means the value is re-read per-launch or per-evaluation with no restart needed. `list` and `get` always return `restart_required: false` because they make no change; each list row carries `restart_required_on_set` for reference.

### Provider and `.env` writes

Provider writes are validated before touching the real config: a candidate file is written atomically to a sibling path, validated, then removed; the real config is written only on success. `.env` writes are not schema-validated -- the submitted value is only checked for being non-empty and single-line (no CR, LF, or NUL). Every changed pre-existing file receives an atomic sibling backup (`<file>.bak-<epoch-ms>`) before replacement; a newly created file reports `backup: null`. An unchanged write creates neither backup nor real-file change and returns `status: "unchanged"`.

Error response (any action): `{ ok: false, action, key?, restart_required: false, error }` with `isError: true` set in the MCP envelope.
