# Interactive Provider Drivers

Normative model for launched agents.

## Invariant

All launched agents are interactive sessions. `launch_agent` starts a provider
driver, submits the initial prompt as the first user input, and stores only
in-memory session state. `send_message` enqueues later user input on that same
driver. Callers observe output with `poll_agent` or `wait`.

There is no one-shot fallback path:

- Claude never uses `claude -p`, raw `stream-json` print mode, or prompt-then-close stdin.
- Codex never uses `codex exec`, prompt CLI arguments, or ignored stdin.
- Raw child stdin is not the public send path.

## Claude

Claude uses `@anthropic-ai/claude-agent-sdk` continuous conversation APIs.
Launch creates one SDK `query()` session using an async user-message input
stream. The launch prompt is pushed first; `send_message` pushes subsequent
SDK user messages.

Supported options are preserved where the SDK exposes them: `cwd`, model,
supported effort, bypass permission mode, default tools, max turns, environment,
local Claude executable path, and ultracode settings file. Unsupported startup
or missing SDK APIs fail the MCP call loudly.

## Codex

Codex starts `codex app-server --stdio` and speaks its JSONL protocol. Launch
sends `initialize`, `initialized`, `thread/start`, and the first `turn/start`.
`send_message` queues later `turn/start` requests for the same thread; queued
turns submit after the active turn completes.

Supported options are preserved where the protocol exposes them: `cwd`, model,
and effort. Approval policy and sandbox policy are NOT configurable today —
`drivers.ts` hardcodes them (`approvalPolicy: 'never'`,
`sandboxPolicy: dangerFullAccess`) and neither appears in `DriverLaunchOptions`.
Unsupported startup or protocol failures fail the MCP call loudly.

> **PLANNED / FUTURE (not yet implemented):** configurable approval policy and
> sandbox policy via `DriverLaunchOptions`. Until then the hardcoded values above
> are authoritative.

## Lifecycle

Provider output is normalized into the existing stdout/stderr capture and
visible-stream parser. A provider turn-completion marker sets status
`finished` for the current turn without requiring the session to close. If
`alive` remains true, `send_message` can move the agent back to `processing`.

`kill_agent` closes the provider driver immediately. Closed drivers report
terminal `stopped`, `errored`, or process-finished status through the existing
poll/list/wait paths.
