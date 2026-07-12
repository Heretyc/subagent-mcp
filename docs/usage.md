# Model, Effort, and Usage

Model/effort matrix, the ultracode mechanism, provider startup behavior, and
example calls. See [README.md](../README.md) for the overview,
[docs/tools.md](tools.md) for the tool reference, and
[docs/SPEC.md](SPEC.md) for the full effort-resolution decision logic.

Auto mode (pass just `prompt` + `task_category`, omit provider/model/effort and
the server auto-selects): see [docs/spec/auto-mode/_INDEX.md](spec/auto-mode/_INDEX.md).

---

## Model and Effort Matrix

| Provider | Model | Valid Efforts | Notes |
|----------|-------|---------------|-------|
| claude | haiku | (any value accepted, effort ignored) | SDK session takes no effort for Haiku |
| claude | sonnet | medium, high, xhigh, max | Passed to the Claude Agent SDK where supported |
| claude | opus / opus-4-8 | medium, high, xhigh, max, **ultracode** | `opus` and `opus-4-8` both map to `claude-opus-4-8` |
| claude | fable | medium, high, xhigh, max | Maps to `claude-fable-5` |
| codex | gpt-5.5 | medium, high, xhigh | Passed in the app-server `turn/start` request |

**Ultracode mechanism:** The Claude CLI rejects `--effort ultracode` with an error. Ultracode is the Claude Code interactive reasoning mode (sets reasoning effort to xhigh AND grants standing dynamic-workflow permission). To activate it headlessly, the server writes a temporary JSON file `{"ultracode":true}` to the OS temp directory and passes `--settings <file>` to the CLI instead of an `--effort` flag. The temp file is deleted on agent exit. Requesting `ultracode` on any non-Opus-4.8 model (including `fable` and `gpt-5.5`) returns an error.

---

## Provider Startup

**Claude:** launch creates a long-lived Claude Agent SDK `query()` session using
the local Claude executable, `cwd`, model, and SDK-owned permission/tool/turn
settings. The initial prompt is enqueued as the first SDK user message, and
`send_message` enqueues later user messages to the same session. The Claude
command builder does not emit `--permission-mode`, `--tools`, or `--max-turns`
CLI args.

Non-ultracode options:
```
model: <mapped-id>
effort: <e>       # omitted for Haiku
permissionMode: bypassPermissions
tools: claude_code preset
maxTurns: 50
```

Ultracode uses `settings: <tmpdir/subagent-uc-<uuid>.json>` instead of an effort
option. The settings file contains `{"ultracode":true}` and is deleted when the
driver closes.

**Codex:** launch starts:
```
codex app-server --stdio
```
The server then sends app-server JSONL protocol messages: `initialize`,
`thread/start`, and `turn/start`. `send_message` queues later `turn/start`
requests on the same thread after the active turn completes.

---

## Usage Examples

**Launch an Opus 4.8 ultracode agent:**

```json
{
  "tool": "launch_agent",
  "arguments": {
    "provider": "claude",
    "model": "opus-4-8",
    "effort": "ultracode",
    "prompt": "Refactor the authentication module to use JWTs.",
    "cwd": "C:\\Users\\YourName\\project"
  }
}
```

Returns `{ "agent_id": "abc-123", "status": "processing", ... }`. Then poll:

```json
{ "tool": "poll_agent", "arguments": { "agent_id": "abc-123" } }
```

Pass `verbose: true` to also get `final_output`, the agent's final assistant turn text extracted from its captured stdout (also available per finished entry on `wait` with `verbose: true`):

```json
{ "tool": "poll_agent", "arguments": { "agent_id": "abc-123", "verbose": true } }
```

**Launch a Codex gpt-5.5 xhigh agent:**

```json
{
  "tool": "launch_agent",
  "arguments": {
    "provider": "codex",
    "model": "gpt-5.5",
    "effort": "xhigh",
    "prompt": "Write a Python script that parses JSON logs and summarizes error rates.",
    "cwd": "C:\\Users\\YourName\\project"
  }
}
```
