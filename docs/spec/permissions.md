# Permission System

Normative spec for how `subagent-mcp` gates what a **launched sub-agent** may do.
Reflects the code on branch `feat/permission-system` (`src/permission-engine.ts`,
`src/pending-permissions.ts`, `src/permission-classes.json`, `src/concurrency.ts`,
`src/drivers.ts`, `src/index.ts`). Where an earlier design draft and the code
disagree, this documents the **code**; divergences are called out inline.

## 1. Ceiling modes

`permissionsCeiling` is a machine-wide posture from
`global-subagent-mcp-config.jsonc` (§6). Read fresh per `launch_agent` and
snapshotted into the agent at launch (before the first `await`), never re-read.

| Mode | Effect (truthful) |
|---|---|
| `yolo` | No gating. Claude: `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`; Codex: `approvalPolicy: 'never'` + `sandbox: 'danger-full-access'`. Byte-identical to pre-2.12.5. The engine is **not** consulted — including for the config file itself (§7 divergence). |
| `auto` | **Default.** Engine gates: SAFE→allow, DANGER→deny, NEUTRAL residue→ask (parks). `min(ceiling, vote)` with `auto`=`allow` cap, so the vote passes through unchanged. |
| `manual` | Same engine, ceiling caps every vote at `ask`: `min(ask, vote)`. SAFE that would `allow` becomes `ask`; DANGER stays `deny`. Every non-denied action parks for an answer. |

Value resolution (`concurrency.ts:parsePermissionsCeilingConfig`): absent file or
key → `auto`; invalid/corrupt value → fail-closed to `manual`; whole-file parse
failure → `manual`.

## 2. Shared engine

One pure function, `verdict(op, rules)` (`src/permission-engine.ts`), called by
**both** the Claude `canUseTool` callback and the Codex approval handler — one
implementation, no second copy.

- **Verdict** `allow | deny | ask`; **classification** `safe | danger | neutral`
  from `src/permission-classes.json`.
- **Order inside `verdict()`**: DANGER → `deny` immediately (before any rule — no
  `allow[]` from any source downgrades a DANGER match). Else merged ruleset with
  precedence **deny > ask > allow**. Else SAFE → `allow`. Else NEUTRAL residue →
  `ask` (never silently allowed).
- **Ceiling** (`applyPermissionCeiling`): `yolo`→`allow`; `manual`→`min(vote,ask)`;
  `auto`→`min(vote,allow)`. Rank `deny(0) < ask(1) < allow(2)`.

**Classes** (`permission-classes.json`):
- **SAFE**: tools `Read/Glob/Grep/LS`; bash prefixes `ls cat pwd echo git status
  git diff git log` (word-boundary — `ls:*` ≠ `lsof`); WebFetch preapproved hosts.
- **DANGER** (auto-denied under `manual`/`auto`): `rm -rf`/`--force`; `git push
  --force*`; `curl|sh`/`wget|sh`; `sudo`; `chmod 777`; `npm/pnpm/yarn publish`;
  disk-format; writes touching `.git .ssh .aws .claude .codex .vscode`; writes to
  `global-subagent-mcp-config.jsonc` or legacy `global-concurrency.jsonc`.
- **NEUTRAL**: everything else — rule match, else `ask`.

**`irreversible` flag**: a DANGER subset (force-push, `git reset --hard`/`rebase`/
`filter-branch`, `DROP`/`TRUNCATE ... TABLE`, publish, `aws/gcloud/az ... delete`).
It does not change the verdict. For NEUTRAL residue that parks under `auto`, the
pending record carries `irreversible` and may set `escalate_to_human` per the
`escalation` config key. DANGER remains denied before any pending record.

**Rule syntax** (Claude `PermissionRule`, verbatim; `parsePermissionRule` +
`matchesRule`): `Tool` / `Tool()` / `Tool(*)` / `*`-tool match anything of that
tool. Bash: `Bash(prefix:*)` word-boundary; `*`→`[\s\S]*`; compound commands
(`&& ; || |`) excluded from a single-segment allow; `allow` strips only
`SAFE_ENV_VARS` (`NODE_ENV GOOS LANG`), deny/ask strips **all** env prefixes; over
`MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50` → `ask`. Paths matched against
`op.paths` **and** `op.resolvedPaths` (symlink parity; engine does no I/O). WebFetch
`WebFetch(domain:host)` subdomain-suffix match. MCP `server__tool` split on `__`.

## 3. Config sources, precedence, mapping

Fixed order (deny/ask unioned across all sources incl. repo; allow honored):
1. built-in SAFE/DANGER floor (compiled)
2. `~/.subagent-mcp/settings.json`
3. `~/.subagent-mcp/settings.local.json`
4. `<cwd>/.claude/settings.json`
5. `<cwd>/.claude/settings.local.json`
6. `<cwd>/.codex/config.toml` chain (root→cwd, closest wins), translated below

Only `permissions.{allow, deny, ask, additionalDirectories}` are read from Claude
settings; top-level `sandboxNetwork` is read from the global config.
`permissions.defaultMode` is parsed-and-discarded everywhere (never votes, never
selects a mode). deny/ask are **unioned** (tightening is safe); allow /
additionalDirectories are honored as-is (accepted risk, §7).

### Codex → Claude mapping

| Codex | Claude | Resolution |
|---|---|---|
| `approval_policy` (any source) | — | Dropped. Fixed by ceiling: `yolo`→`never`, else `untrusted`. |
| `sandbox = read-only` | `deny[Edit,Write,NotebookEdit]` | Tightening; appended last. |
| `sandbox = workspace-write`/`danger-full-access` | — | Ignored; `workspace-write` is the non-yolo default. |
| `writable_roots` | `additionalDirectories` | Unioned (minus the config-file path). |
| filesystem path deny | `deny['Edit(path)','Write(path)']` | Tightening half; write-grants dropped. |
| network domain deny | `WebFetch(domain:host)` deny | Tightening. |
| network domain allow | `WebFetch(domain:host)` allow + Codex network opt-in | Still passes through `verdict()`; Codex workspace-write gets network so the approved action can run. |
| `sandbox_workspace_write.network_access = true` | Codex network opt-in | Parsed from `.codex/config.toml`. |
| Approve/accept | `allow` — **no `updated_input`** | Replays the original payload verbatim. |
| Deny/decline | `deny{message}`, no `interrupt` | Agent continues; never kills. |
| Abort/cancel | `deny{interrupt:true}` | Never emitted by smcp. |
| session grants | — | Not used; one-time grants only. |

Constructs not listed are not consumed; untranslatable tightening degrades to the
nearest broader tightening, untranslatable loosening is dropped; unclassifiable →
`ask`, never `allow`.

## 4. Config file rename & back-compat

`global-concurrency.jsonc` → `global-subagent-mcp-config.jsonc`
(`concurrency.ts:CONFIG_FILENAME`/`LEGACY_CONFIG_FILENAME`).
`resolveGlobalConfigPath` tries the new name first; if absent **and** the legacy
file exists, reads legacy (new keys still honored there — back-compat is about the
filename, not the schema), emits a one-time deprecation notice. No auto-rename.
One major-version grace period, then legacy dropped.

## 5. Lifecycle

`AgentStatus` gains a 7th member `permission_requested` (alive, holds its slot
like `processing`, exempt from the stalled flip). A pending record is created only
when a typed harness channel fires — Claude `canUseTool`, or a Codex JSON-RPC
approval landing in `pendingApprovals`. Nothing an agent prints, and nothing
`send_message` does, can create or satisfy one. `respond_permission` is the only
resolve path, keyed to a server-generated `request_id`.

- **`respond_permission`** `{agent_id, request_id?, decision: allow|deny, reason?}`
  — one-time only, no session grants, no `updated_input`. Omitted `request_id`
  answers the oldest. Parents only (children have no such tool — §8).
  If the pending record has `escalate_to_human: true`, `allow` requires a
  non-empty `reason` audit note; `deny` has no extra friction.
  **Divergence:** an earlier draft proposed a required `responder:
  'human'|'orchestrator'` audit field; the shipped schema has none.
- **`wait` early return**: `permission_requested` is **not** terminal
  (`wait-helpers.ts:TERMINAL_STATUSES` requires `exitedAt !== null`). A separate
  selection returns unreported pendings alongside `finished`; the "fleet idle"
  short-circuit will not fire while an unreported pending exists.
- **`poll_agent`** adds summarized `pending_permissions` (oldest-first):
  `request_id`, `tool_name_or_method`, `harness_channel`, `permission_ceiling`,
  `escalation`, `irreversible`, `escalate_to_human`, `requested_at`, `age_seconds`.
  **`list_agents`** adds `pending_permission_count`; both surface `stale_permissive`.
- **Park timeout (5 min)** `PARK_TIMEOUT_MS` — unanswered → auto-deny, agent
  continues. An **smcp-added safety net**: Claude itself has no pending-decision
  timer; interactive/print/stdio and the Codex approval channels all block
  indefinitely absent this. Also bounds slot-squatting.
- **Per-agent FIFO cap 16** `PER_AGENT_FIFO_CAP` — overflow auto-denied
  (`pending-queue cap reached`), counted separately from park-timeout in telemetry.
- **kill_agent** closes pendings as `deny('agent stopped by operator')` before the
  kill path; exit reconciliation stays first and authoritative.
- **`send_message`** is rejected while any request is pending.

Per-request record (`pending-permissions.ts`): `request_id, agent_id,
harness_channel, tool_name_or_method, action, permission_ceiling, escalation,
irreversible, escalate_to_human, reason, suggestions, requested_at,
correlation_id, state, auto_answer_rule, asked_count_for_this_agent`
(+`answered_at/answer/answer_reason`). **Divergence:** `state` is `pending |
answered | auto_answered | errored` — code adds `errored`.

## 6. Config keys

| Key | Values | Default | Meaning |
|---|---|---|---|
| `permissionsCeiling` | `yolo`\|`auto`\|`manual` | `auto` | §1 |
| `escalation` | `irreversible-only`\|`off` | `irreversible-only` | Auto mode only. `irreversible-only` sets `escalate_to_human: true` on irreversible NEUTRAL residue so the orchestrator must route it to the human. `off` leaves NEUTRAL residue to orchestrator judgment. In `manual`, all residue already routes to the human, so the key is informational; in `yolo`, no gating occurs. |
| `strictReadParity` | `warn`\|`off` | `warn` | Logging only; unparseable Codex approvals always fail-closed to `ask`. |
| `sandboxNetwork` | boolean | `false` | Codex only: when true, launches workspace-write with `sandbox_workspace_write.network_access=true`. Also enabled when effective allow rules are network-ish (`WebFetch`, broad `Bash`, or Bash rules for git/gh/npm/pnpm/yarn/curl/wget). Tradeoff: approvals still gate actions, but approved Codex processes can reach the network inside workspace-write. |
| `disableBypassPermissionsMode` | `disable` | — | User-scope only (`~/.subagent-mcp/`), tighten-only: caps the effective ceiling at `auto`. Repo scope has no effect. |

## 7. Threat model — accepted risks (stated plainly)

- **Hostile repo `allow[]` is fully honored.** A repo's `.claude`/`.codex`
  settings can pre-approve mutating actions and widen
  `allow`/`additionalDirectories`; this is the documented accepted risk. Bounded,
  not eliminated: DANGER/config self-protection cannot be widened and Codex
  `untrusted` still routes mutations through `verdict()`. **Residual:** repo
  `allow:['Bash']` under `manual` can auto-allow Claude Bash if no other deny/ask
  matches. Closing it means refusing repo `allow[]`, which the mandate forbids.
- **Orchestrator self-answer in manual mode (J1-1 residual).**
  `respond_permission` takes no attestation; a compromised orchestrator can answer
  `manual` requests itself. Accepted — it already holds `kill_agent`/
  `send_message`/`launch_agent`; no `responder` provenance field shipped.
- **Codex sandbox network.** `auto`/`manual` default to workspace-write with no
  network. `sandboxNetwork` or network-ish allow rules reopen network while
  keeping `approvalPolicy:'untrusted'`; `yolo` remains the blunt fallback that
  removes both approval gating and the sandbox.
- **Codex in-sandbox blind spots.** Under `untrusted`, Codex's own known-safe
  reads may auto-run without reaching `verdict()`; no mutation escapes approval.
- **Codex approval TOCTOU (J2-16).** smcp evaluates a `fileChange` path at decision
  time; execution follows in the child. A symlink swapped between is a narrow,
  accepted gap — bounded by `untrusted` requiring an approval to exist at all.
- **Config-file integrity.** Startup SHA-256 + per-launch re-check surfaces
  `ceiling_integrity: changed_since_startup`; the config path is a DANGER-floor
  write target under `auto`/`manual`. **Divergence:** the earlier design called
  this "the one rule that survives yolo." In the shipped code `yolo` returns
  `allow` before the engine runs (and Claude `bypassPermissions` skips
  `canUseTool`), so **under yolo the config file is not gated either** — yolo means
  no gating, no exception.
- **Cross-harness residuals.** Network enforced by Codex sandbox but on Claude only
  via `WebFetch(domain:)` rules. Deny-reason delivery shape differs (attached
  tool_result vs turn-prefix notice).

## 8. Child lockout
Children (`SUBAGENT_MCP_SUBAGENT=1`) get **no** `respond_permission` tool — the
registration is gated on the env var (`index.ts`). A child cannot approve another
child's requests; a child's own config resolution runs through the same
DANGER-floor/config self-protection path as its parent.
## 9. See also
`interactive-drivers.md` (launch values); `dev-loop/orchestration-directive-architecture.md` (orchestration mode is orthogonal — who delegates vs what a sub-agent may do); `../reference/status-lifecycle.md` (`permission_requested`).
