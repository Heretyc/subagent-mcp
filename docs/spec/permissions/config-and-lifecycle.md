# Permission Config And Lifecycle

## One-screen summary

Permission inputs come from built-ins, user settings, repo Claude settings, and
repo Codex config, with deny and ask unioned and allow honored. Pending
permission requests are created only by typed harness channels, resolved only by
`respond_permission`, and children never receive that tool.

## Load when

- Touching config-source precedence, Codex-to-Claude mapping, config rename or
  back-compat, config keys, or `sandboxNetwork`.
- Touching `respond_permission`, `permission_requested`, pending-permission
  records, park timeout, FIFO/history caps, `wait`, `poll_agent`, `list_agents`,
  `send_message`, `kill_agent`, or child lockout.

## Do not load when

- Only touching engine verdicts, classes, or rule syntax. Use
  `ceiling-modes.md`.
- Only assessing accepted residual risks. Use `threat-model.md`.

## 3. Config sources, precedence, mapping

Fixed order (deny/ask unioned across all sources incl. repo; allow honored):

1. built-in SAFE/DANGER floor (compiled)
2. `~/.subagent-mcp/settings.json`
3. `~/.subagent-mcp/settings.local.json`
4. `<cwd>/.claude/settings.json`
5. `<cwd>/.claude/settings.local.json`
6. `<cwd>/.codex/config.toml` chain (root to cwd, closest wins), translated below

Only `permissions.{allow, deny, ask, additionalDirectories}` are read from Claude
settings; top-level `sandboxNetwork` is read from the global config.
`permissions.defaultMode` is parsed-and-discarded everywhere (never votes, never
selects a mode). deny/ask are **unioned** (tightening is safe); allow /
additionalDirectories are honored as-is (accepted risk, see `threat-model.md`).

### Codex to Claude mapping

| Codex | Claude | Resolution |
|---|---|---|
| `approval_policy` (any source) | : | Dropped. Fixed by ceiling: `yolo` to `never`, else `untrusted`. |
| `sandbox = read-only` | `deny[Edit,Write,NotebookEdit]` | Tightening; appended last. |
| `sandbox = workspace-write`/`danger-full-access` | : | Ignored; `workspace-write` is the non-yolo default. |
| `writable_roots` | `additionalDirectories` | Unioned (minus the config-file path). |
| filesystem path deny | `deny['Edit(path)','Write(path)']` | Tightening half; write-grants dropped. |
| network domain deny | `WebFetch(domain:host)` deny | Tightening. |
| network domain allow | `WebFetch(domain:host)` allow + Codex network opt-in | Still passes through `verdict()`; Codex workspace-write gets network so the approved action can run. |
| `sandbox_workspace_write.network_access = true` | Codex network opt-in | Parsed from `.codex/config.toml`. |
| Approve/accept | `allow`: **no `updated_input`** | Replays the original payload verbatim. |
| Deny/decline | `deny{message}`, no `interrupt` | Agent continues; never kills. |
| Abort/cancel | `deny{interrupt:true}` | Never emitted by smcp. |
| session grants | : | Not used; one-time grants only. |

Constructs not listed are not consumed; untranslatable tightening degrades to
the nearest broader tightening, untranslatable loosening is dropped;
unclassifiable to `ask`, never `allow`.

## 4. Config file rename and back-compat

`global-concurrency.jsonc` to `global-subagent-mcp-config.jsonc`
(`concurrency.ts:CONFIG_FILENAME`/`LEGACY_CONFIG_FILENAME`).
`resolveGlobalConfigPath` tries the new name first; if absent **and** the legacy
file exists, reads legacy (new keys still honored there: back-compat is about
the filename, not the schema), emits a one-time deprecation notice. No
auto-rename. One major-version grace period, then legacy dropped.

## 5. Lifecycle

`AgentStatus` gains a 7th member `permission_requested` (alive, holds its slot
like `processing`, exempt from the stalled flip). A pending record is created
only when a typed harness channel fires: Claude `canUseTool`, or a Codex
JSON-RPC approval landing in `pendingApprovals`. Nothing an agent prints, and
nothing `send_message` does, can create or satisfy one. `respond_permission` is
the only resolve path, keyed to a server-generated `request_id`.

- **`respond_permission`** `{agent_id, request_id?, decision: allow|deny, reason?}`
  : one-time only, no session grants, no `updated_input`. Omitted `request_id`
  answers the oldest. Parents only (children have no such tool: section 8).
  If the pending record has `escalate_to_human: true`, `allow` requires a
  non-empty `reason` audit note; `deny` has no extra friction.
  **Divergence:** an earlier draft's proposed required `responder` audit field
  is not in the shipped schema.
- **`wait` early return**: `permission_requested` is **not** terminal
  (`wait-helpers.ts:TERMINAL_STATUSES` requires `exitedAt !== null`). A separate
  selection returns unreported pendings alongside `finished`; the "fleet idle"
  short-circuit will not fire while an unreported pending exists.
- **`poll_agent`** adds summarized `pending_permissions` (oldest-first):
  `request_id`, `tool_name_or_method`, `harness_channel`, `permission_ceiling`,
  `escalation`, `irreversible`, `escalate_to_human`, `requested_at`,
  `age_seconds`. **`list_agents`** adds `pending_permission_count`; both surface
  `stale_permissive`.
- **Park timeout (5 min)** `PARK_TIMEOUT_MS`: unanswered to auto-deny, agent
  continues. An **smcp-added safety net**: Claude itself has no pending-decision
  timer; interactive/print/stdio and the Codex approval channels all block
  indefinitely absent this. Also bounds slot-squatting.
- **Per-agent FIFO cap 16** `PER_AGENT_FIFO_CAP`: overflow auto-denied
  (`pending-queue cap reached`), counted separately from park-timeout in
  telemetry.
- **Pending-permission history cap 200**: answered/auto-answered/errored records
  are retained FIFO; per-agent asked counts clear on agent close.
- **kill_agent** closes pendings as `deny('agent stopped by operator')` before
  the kill path; exit reconciliation stays first and authoritative.
- **`send_message`** is rejected while any request is pending. Codex PreToolUse
  deny enforcement fails open unless the heartbeat flag is fresh and its owner
  server pid is alive.

Per-request record (`pending-permissions.ts`): `request_id, agent_id`,
`harness_channel, tool_name_or_method, action, permission_ceiling, escalation`,
`irreversible, escalate_to_human, reason, suggestions, requested_at`,
`correlation_id, state, auto_answer_rule, asked_count_for_this_agent`
(+`answered_at/answer/answer_reason`). **Divergence:** `state` is `pending |
answered | auto_answered | errored`: code adds `errored`.

## 6. Config keys

| Key | Values | Default | Meaning |
|---|---|---|---|
| `permissionsCeiling` | `yolo`\|`auto`\|`manual` | `auto` | section 1 in `ceiling-modes.md` |
| `escalation` | `irreversible-only`\|`off` | `irreversible-only` | Auto mode only. `irreversible-only` sets `escalate_to_human: true` on irreversible NEUTRAL residue so the orchestrator must route it to the human. `off` leaves NEUTRAL residue to orchestrator judgment. In `manual`, all residue already routes to the human, so the key is informational; in `yolo`, no gating occurs. |
| `strictReadParity` | `warn`\|`off` | `warn` | Logging only; unparseable Codex approvals and malformed repo Codex TOML fail-closed to `ask`, but valid `#` inside strings and multiline strings parse normally. |
| `sandboxNetwork` | boolean | `false` | Codex only: when true, launches workspace-write with `sandbox_workspace_write.network_access=true`. Also enabled when effective allow rules are network-ish (`WebFetch`, broad `Bash`, or Bash rules for git/gh/npm/pnpm/yarn/curl/wget). Tradeoff: approvals still gate actions, but approved Codex processes can reach the network inside workspace-write. |
| `disableBypassPermissionsMode` | `disable` | : | User-scope only (`~/.subagent-mcp/`), tighten-only: caps the effective ceiling at `auto`. Repo scope has no effect. |

## 8. Child lockout

Children (`SUBAGENT_MCP_SUBAGENT=1`) get **no** `respond_permission` tool:
registration is gated on the env var (`index.ts`). A child cannot approve
another child's requests; a child's own config resolution runs through the same
DANGER-floor/config self-protection path as its parent.
