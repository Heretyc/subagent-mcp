<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## statusline-signal.md : Claude Statusline Context Signal

This leaf specifies the Claude statusline side channel used by
context-metering.md rung 1. It exists because Claude Code reports authoritative
context percentage to statusLine stdin, while `UserPromptSubmit` transcripts
still expose usage only for prior assistant turns.

### 1. Shim Contract

`dist/hooks/statusline-claude.js` is a command shim for Claude Code
`statusLine`. It reads the complete stdin payload, parses JSON if possible,
writes a best-effort side-channel record, then either delegates to an existing
statusline command or renders a minimal fallback line.

The shim consumes the same stdin payload Claude Code sends to `statusLine`.
The payload fields used by this project are:

```
{
  cwd?: string,
  session_id?: string,
  transcript_path?: string,
  context_window?: {
    used_percentage?: number,
    context_window_size?: number,
    current_usage?: {
      input_tokens?: number,
      output_tokens?: number,
      cache_creation_input_tokens?: number,
      cache_read_input_tokens?: number
    }
  }
}
```

Malformed, empty, or non-object payloads are treated as `{}`. The shim must
exit 0 and must never prevent the statusline from rendering.

### 2. Side-Channel Records

Statusline records live in `join(os.tmpdir(), "subagent-mcp")` and use
`atomicWriteJson` with mode `0600`; the directory is created with mode `0700`.

Filename selection uses this key ladder:

1. Non-empty `session_id`: `sl-<hashKey(session_id)>.json`.
2. Non-empty `transcript_path`: `sl-<hashKey("tp-" + hashKey(normalized transcript_path))>.json`.
3. Non-empty `cwd`: `sl-cwd-<cwdHash(cwd)>.json`.
4. No key: write is skipped.

Transcript paths are resolved, slash-normalized, lowercased on Windows, and
trimmed of a trailing slash. The cwd fallback uses the same cwd hash helper as
other cwd-keyed state.

Record schema:

```
{
  session_id?: string | null,
  used_percentage?: number | null,
  context_window_size?: number | null,
  usage: {
    input: number,
    output: number,
    cache_creation: number,
    cache_read: number
  },
  updated_at: number,
  source: "statusline"
}
```

A record is emitted only when `context_window.used_percentage` or
`context_window.context_window_size` is finite. Missing usage fields are stored
as zero. Parse, directory, and write failures are swallowed.

### 3. Delegation And Fallback

When setup finds an existing statusline command, it wraps that command:

```
node "<install>/dist/hooks/statusline-claude.js" <existing command>
```

The shim forwards the original stdin bytes to the wrapped command, forwards
the wrapped stdout to Claude when the complete output contains non-whitespace,
and inherits stderr. If the wrapped command emits no non-whitespace stdout, or
if no wrapped command is present, the fallback line is
`<model display_name or Claude> Ctx:<rounded %>%` when a percentage is present,
otherwise `<model display_name or Claude>`.

If the wrapped command cannot be spawned, the shim writes the fallback line.
All errors remain local to the shim. The never-break-the-statusline rule has
priority over side-channel freshness.

### 4. Hook Consumption

The Claude `UserPromptSubmit` hook reads statusline records by session key
first, then cwd. Reads accept only `source: "statusline"` records whose
`updated_at` is at most 24 hours old.

When present, `used_percentage` becomes `harnessPercentage` and wins in
`computeUsedPercentage`, clamped to `[0,100]`. When present and positive,
`context_window_size` becomes `harnessContextWindow`; the window resolver uses
`window_source: "harness"` before model mapping, family defaults, settings
hints, ratchets, prior floors, contradictions, and assumed defaults.

The transcript usage lift still supplies the model and usage fields from the
newest main-chain assistant line. The statusline signal only supplies the
authoritative percentage and, when available, the authoritative window.

### 5. Settings Reconciliation

Setup and installer deployment reconcile Claude `statusLine` idempotently.
If no statusLine exists, they register the shim directly. If a user command
already exists, they wrap it and preserve it as the inner command. If the shim
is already present, they preserve its inner command and only repair the shim
path when stale.

The reconciler never discards unrelated Claude hooks, never rewrites the inner
statusline command for style, and never requires users to abandon their custom
statusline. Re-running setup must converge to the same `statusLine` value.

### 6. State Sweep

`runHook` invokes `sweepHookState()` best-effort on each hook call. The sweep
is throttled by `sweep.stamp`; if the stamp mtime is younger than 1 hour, it
returns without scanning.

When it scans, it may delete:

- `latch-<16 hex>.json` records whose `rev` is absent, non-integer, or below
  `LATCH_REV`.
- `ctx-<16 hex>.json`, `sl-<16 hex>.json`, and `sl-cwd-<16 hex>.json`
  records older than 24 hours by `updated_at`, or by mtime when `updated_at`
  is absent or unreadable.

The sweep never deletes disable records, handoff records, slot records,
permission state, config files, or files whose names do not match the exact
patterns above. Delete failures are ignored because hooks must not fail host
turns.
