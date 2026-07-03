# Effort Resolution and Ultracode Mechanism

The effort-resolution decision logic and the ultracode `--settings` activation
mechanism. Part of the
[subagent-mcp technical specification](../SPEC.md). See
[docs/usage.md](../usage.md) for the user-facing model/effort matrix.

---

## Effort-Resolution Decision Logic

```
function resolveEffort(provider, model, effort):

  if effort == "ultracode":
    if NOT (provider == "claude" AND model IN ["opus", "opus-4-8"]):
      THROW: "ultracode effort is only available on Opus 4.8+ (got <provider>/<model>). Use xhigh for other models."
    RETURN { kind: "settings" }   # --> write temp JSON file, pass --settings

  if provider == "claude" AND model == "haiku":
    RETURN { kind: "none" }       # --> no --effort flag at all

  if provider == "claude" AND model IN ["sonnet", "opus", "opus-4-8", "fable"]:
    if effort IN ["medium", "high", "xhigh", "max"]:
      RETURN { kind: "flag", value: effort }

  if provider == "codex":
    if effort == "max":
      THROW: "max effort is not valid for gpt-5.5 (Codex). Valid: medium, high, xhigh."
    if effort IN ["medium", "high", "xhigh"]:
      RETURN { kind: "flag", value: effort }

  # Fallback (should not reach in practice given zod validation)
  RETURN { kind: "flag", value: "high" }
```

Decision table:

| provider | model | effort | Result |
|----------|-------|--------|--------|
| claude | haiku | any | `{ kind: "none" }` -- no `--effort` passed |
| claude | sonnet | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | opus / opus-4-8 | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | opus / opus-4-8 | ultracode | `{ kind: "settings" }` -- temp file path |
| claude | fable | medium/high/xhigh/max | `{ kind: "flag", value: effort }` |
| claude | any | ultracode (non-4.8) | THROW error |
| codex | gpt-5.5 | medium/high/xhigh | `{ kind: "flag", value: effort }` |
| codex | gpt-5.5 | max | THROW error |
| codex | gpt-5.5 | ultracode | THROW error (Opus-4.8+ only) |

---

## Ultracode `--settings` Mechanism

### What ultracode is

Ultracode is a Claude Code interactive mode that sets reasoning effort to `xhigh` AND grants standing `dynamic-workflow` permission. It is not an `--effort` flag value.

### Why `--effort ultracode` does not work

The Claude CLI validates the `--effort` argument against a known enum. `ultracode` is not in that enum. The CLI exits with an error when passed `--effort ultracode`. This was verified against `claude-opus-4-8`.

### How the server activates it headlessly

1. Write `{"ultracode":true}` to a temp file: `<os.tmpdir()>/subagent-uc-<uuid>.json`
2. Pass `--settings <path>` to the `claude` CLI instead of `--effort`
3. The Claude CLI reads the settings file and activates ultracode mode
4. On agent exit (any path: `close` event, `kill_agent`, spawn error), delete the temp file

This behavior is verified working on `claude-opus-4-8`. `--effort xhigh` alone does NOT activate ultracode.

### Cleanup

The temp settings file path is stored in `AgentState.ucSettingsPath`. It is deleted in:
- The `close` event handler (normal exit and `kill_agent` path)
- The `kill_agent` tool's `close` listener
- The spawn error handler in `launch_agent`
