# Model, Effort, and Usage

Model/effort matrix, the ultracode mechanism, the underlying CLI invocations,
and example calls. See [README.md](../README.md) for the overview,
[docs/tools.md](tools.md) for the tool reference, and
[docs/SPEC.md](SPEC.md) for the full effort-resolution decision logic.

---

## Model and Effort Matrix

| Provider | Model | Valid Efforts | Notes |
|----------|-------|---------------|-------|
| claude | haiku | (any value accepted, effort ignored) | CLI takes no `--effort` for Haiku |
| claude | sonnet | low, medium, high, xhigh, max | Passed as `--effort <value>` |
| claude | opus / opus-4-8 | low, medium, high, xhigh, max, **ultracode** | `opus` and `opus-4-8` both map to `claude-opus-4-8` |
| codex | gpt-5.5 | low, medium, high, xhigh | Passed as `-c model_reasoning_effort="<value>"` |

**Ultracode mechanism:** The Claude CLI rejects `--effort ultracode` with an error. Ultracode is the Claude Code interactive reasoning mode (sets reasoning effort to xhigh AND grants standing dynamic-workflow permission). To activate it headlessly, the server writes a temporary JSON file `{"ultracode":true}` to the OS temp directory and passes `--settings <file>` to the CLI instead of an `--effort` flag. The temp file is deleted on agent exit. Requesting `ultracode` on any non-Opus-4.8 model (including `gpt-5.5`) returns an error.

---

## Underlying CLI Invocations

**Claude:**
```
claude -p --model <mapped-id> [--effort <e> | --settings <ultracode.json>]
  --permission-mode bypassPermissions --tools default --max-turns 50
  --output-format json
```
Prompt is sent via stdin.

**Codex:**
```
codex exec -C <cwd> -m gpt-5.5 -c 'model_reasoning_effort="<e>"'
  --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json "<prompt>"
```

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

Returns `{ "agent_id": "abc-123", "status": "running", ... }`. Then poll:

```json
{ "tool": "poll_agent", "arguments": { "agent_id": "abc-123" } }
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
