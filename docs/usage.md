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
| claude | opus / opus-5-5 | medium, high, xhigh, max | `opus` and `opus-5-5` map to `claude-opus-5-5`; API default effort is `medium` |
| claude | opus-4-8 | medium, high, xhigh, max, **ultracode** | Maps to `claude-opus-4-8`; ultracode CLI-verified on this explicit pin |
| claude | fable / fable-5-1 | medium, high, xhigh, max | `fable` and `fable-5-1` map to `claude-fable-5-1` |
| codex | gpt-5.5, gpt-5.6 | medium, high, xhigh | Passed in the app-server `turn/start` request; public `gpt-5.6` maps to wire model `gpt-5.6-sol` |
| codex | gpt-6-astra | medium, high, xhigh | Passed as-is to the Codex app-server |

**Ultracode mechanism:** The Claude CLI rejects `--effort ultracode` with an error. Ultracode is the Claude Code interactive reasoning mode (sets reasoning effort to xhigh AND grants standing dynamic-workflow permission). To activate it headlessly, the server writes a temporary JSON file `{"ultracode":true}` to the OS temp directory and passes `--settings <file>` to the CLI instead of an `--effort` flag. The temp file is deleted on agent exit. Requesting `ultracode` on any model other than `opus-4-8` (including `opus-5-5`, `fable`, `fable-5-1`, `gpt-5.5`, and `gpt-6-astra`) returns an error; the server throws rather than silently substituting a different effort level. The `low` effort level is never accepted; the server throws on any `low` request regardless of model or provider.

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

**Launch a Codex gpt-5.5/gpt-5.6 xhigh agent:**

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

---

## Agentic Swarm

For objectives projected to span multiple sessions, use the `swarm` tool to
start a staged 7-step coaching workflow.

**Start a swarm (returns stage-1 planning coaching):**

```json
{ "tool": "swarm", "arguments": {} }
```

The server returns stage-1 coaching with the exact instruction to call
`swarm(1)` when that stage is done. Each `swarm(N)` call registers stage N as
complete and returns the next stage's coaching plus the exact next call.

**Report a stage complete and receive the next coaching:**

```json
{ "tool": "swarm", "arguments": { "stage": 1 } }
```

**Abandon an active swarm:**

```json
{ "tool": "swarm", "arguments": { "stage": 0 } }
```

**Stage-6 sub-orchestrator dispatch (one launch per plan file path):**

```json
{
  "tool": "launch_agent",
  "arguments": {
    "task_category": "agentic_execution",
    "sub-orchestrator": true,
    "prompt": "You are a sub-orchestrator. Read the plan at /tmp/swarm-plan-1-backend.md and implement its disjoint section. Serialize any agents that write overlapping paths. Return JSON: {status, summary, source_locators, risks, writes_requested}.",
    "cwd": "C:\\Users\\YourName\\project"
  }
}
```

The child receives the server's delegate-only orchestration directive in its
prompt. Its own sub-agents are normal workers; `sub-orchestrator: true` never
inherits to grandchildren. Available to the main orchestrator only (depth 0);
the server rejects the flag at greater depth. Auto mode only -- omit
provider/model/effort.
