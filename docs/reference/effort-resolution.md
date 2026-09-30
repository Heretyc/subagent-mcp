# Effort Resolution and Ultracode Mechanism

The effort-resolution decision logic and the ultracode settings activation
mechanism. Part of the
[subagent-mcp technical specification](../SPEC.md). See
[docs/usage.md](../usage.md) for the user-facing model/effort matrix.

---

## Effort-Resolution Decision Logic

```
function resolveEffort(provider, model, effort):

  if effort == "low":
    THROW: "low effort is not supported. Valid efforts: medium, high, xhigh, max, ultracode."

  # ultracode is verified solely on Opus 4.8 (pinned opus-4-8). Generic `opus`
  # resolves to GA Opus 5.5 and is NOT ultracode-capable.
  if effort == "ultracode":
    if NOT (provider == "claude" AND model == "opus-4-8"):
      THROW: "ultracode effort is only available on Opus 4.8 (got <provider>/<model>). Use xhigh for other models."
    RETURN { kind: "settings" }   # --> write temp settings.json, pass --settings

  if provider == "claude" AND model IN ["haiku", "sonnet-4-5"]:
    RETURN { kind: "none" }       # --> no effort option (extended-thinking models)

  if provider == "claude" AND model IN CLAUDE_EFFORT_LADDERS:
    # Per-model ladder (SSOT: CLAUDE_EFFORT_LADDERS in src/effort.ts). A tier
    # ABSENT from THIS model's ladder is REJECTED loudly, never remapped:
    #   opus / opus-5-5 / opus-5 / opus-4-8 / opus-4-7,
    #   sonnet / sonnet-5-5 / sonnet-5,
    #   fable / fable-5-1 / fable-5            -> medium|high|xhigh|max
    #   opus-4-6 / sonnet-4-6                  -> medium|high|max  (NO xhigh)
    #   opus-4-5                               -> medium|high  (NO xhigh, NO max)
    if effort IN ladder(model):
      RETURN { kind: "flag", value: effort }
    THROW: "<effort> effort is not supported by claude/<model>. Supported: <ladder>. No silent downgrade."

  if provider == "codex":
    # max is valid on CODEX_MAX_MODELS: the gpt-6 family (astra/sol/luna), the
    # gpt-5.6 trio (sol/terra/luna), and the generic gpt-5.6 alias (pins
    # gpt-5.6-sol and inherits its max). Only gpt-5.5 has no max tier.
    if effort == "max" AND model NOT IN CODEX_MAX_MODELS:
      THROW: "max effort is not valid for <model> (Codex). Valid: medium, high, xhigh."
    if effort IN ["medium", "high", "xhigh", "max"]:
      RETURN { kind: "flag", value: effort }

  # No silent high fallback: an unrecognized model/effort pair fails loudly.
  THROW: "unsupported model/effort combination: <provider>/<model> @ <effort>."
```

Decision table:

| provider | model | effort | Result |
|----------|-------|--------|--------|
| any | any | low | THROW error -- low is banned |
| claude | haiku / sonnet-4-5 | any (ignored) | `{ kind: "none" }` -- no effort option |
| claude | sonnet (GA 5.5) / sonnet-5-5 / sonnet-5 | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | sonnet-4-6 | medium/high/max | `{ kind: "flag" }`; xhigh THROWS (no silent downgrade) |
| claude | opus (GA 5.5) / opus-5-5 / opus-5 / opus-4-7 | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | opus-4-6 | medium/high/max | `{ kind: "flag" }`; xhigh THROWS |
| claude | opus-4-5 | medium/high | `{ kind: "flag" }`; xhigh/max THROW |
| claude | opus-4-8 | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | opus-4-8 | ultracode | `{ kind: "settings" }` -- temp file path |
| claude | fable (GA 5.1) / fable-5 / fable-5-1 | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | any non-opus-4-8 | ultracode | THROW error (Opus 4.8 only) |
| codex | gpt-5.5 | medium/high/xhigh | `{ kind: "flag", value: effort }` |
| codex | gpt-5.5 | max | THROW error (gpt-5.5 has no max tier) |
| codex | gpt-5.6 / gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| codex | gpt-6-astra / gpt-6-sol / gpt-6-luna | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| codex | any | ultracode | THROW error (Opus 4.8 only) |

---

## Ultracode `--settings` Mechanism

### What ultracode is

Ultracode is a Claude Code interactive mode that sets reasoning effort to `xhigh` AND grants standing `dynamic-workflow` permission. It is not an `--effort` flag value.

### Why `--effort ultracode` does not work

The Claude CLI validates the `--effort` argument against a known enum. `ultracode` is not in that enum. The CLI exits with an error when passed `--effort ultracode`. This was verified against `claude-opus-4-8`.

### How the server activates it headlessly

1. Write `{"ultracode":true}` to a per-agent temp settings file: `<os.tmpdir()>/subagent-mcp/perm-<agentId>/settings.json` (dir mode `0700`, file mode `0600` on POSIX; Windows applies fs defaults)
2. Pass `--settings <path>` to the Claude CLI instead of an effort flag
3. The Claude session reads the settings file and activates ultracode mode
4. On agent exit (any path: `close` event, `kill_agent`, spawn error), delete the temp file

This behavior is verified working on `claude-opus-4-8`. `--effort xhigh` alone does NOT activate ultracode.

### Cleanup

The temp settings file path is stored in `AgentState.ucSettingsPath`. It is deleted in:
- The `close` event handler (normal exit and `kill_agent` path)
- The `kill_agent` tool's `close` listener
- The spawn error handler in `launch_agent`
