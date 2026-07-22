<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## section 5 : No-Hook Fail-Safe-ON + One-Time Opt-Out (D18 / S6 / D6 / D7)

Hosts that inject no hook block (Gemini, desktop apps, any session without hook
injection : D6) cannot report `state`. The tag is absent, so state is UNKNOWN,
never an emitted `state="unknown"` value.

On such a host (S6, three parts):

1. Emit the UNKNOWN-STATE WARNING (base literal from C3):
   `subagent-mcp: no hook injection detected : orchestration state unknown; defaulting to ON`
2. Explain why: no hook injection was detected, so the agent cannot verify
   orchestration state and defaults to ON to prevent uncontrolled inline
   execution.
3. Allow a one-time per-session opt-out: if the user is not running an
   orchestration workflow, they may explicitly opt out of ON for this session.
   This opt-out does not persist and is not recorded. The next new session
   defaults back to the ON warning.

The sub-agent first-line exemption in section 6 is the only automatic
suppressor of this fail-safe default. It prevents fail-safe ON from recursing
into child sessions.

### 5.1 No-hook hosts vs hook-covered hosts

The context-metered redesign does not change no-hook host behavior. No-hook
hosts cannot report state, cannot be metered, and keep the existing
default-ON-when-UNKNOWN doctrine.

Distinguish this from the hook-covered-host rule in `sections-00-04.md` and
`context-metering.md`: on hosts that do fire hooks, orchestration starts
default OFF per session, and ON is reached only by an explicit enable record,
an active 15% latch, or the metering-undetectable fail-safe. That metering
fail-safe applies only where hooks fire but provider-reported context size
cannot be measured.

---

## section 6 : Sub-Agent First-Line Exemption + `launch_agent` Upsert (D19 / D20 / S8)

The first-line exemption and `SUBAGENT_MCP_SUBAGENT=1` spawn-env carve-out are
unchanged by the context-metered redesign. Metering, the 15% latch, the 20%
handoff unlock, and the configurable wind-down warning threshold (default 60%)
do not alter these carve-outs.

### 6.1 The exemption (D19)

Any session whose prompt's literal first line begins with the exact string
`<this is a request from a parent process>` skips the entire init and
orchestration regime: it ignores the INIT_BLOCK and every `<subagent-mcp>` tag.
This is the canonical child-session identifier and the only exception to all
mandates.

"First line" means character position 0 up to the first newline. Leading blank
lines do not count. Child identity is a first-line skip, never a tag attribute.
The hook emits `""` for a sub-agent turn. Every injected directive also
restates this check so a stray injection into a child self-skips.

### 6.2 Silent upsert (D20 / S8)

`launch_agent` silently upserts the marker as the true first line of every
sub-agent prompt when absent, and does not duplicate it when present. Appendix
A7 (`ensureParentMarker`) is the contract: BOM-tolerant on the first-line
comparison only, CRLF-safe, idempotent, and never mutates the prompt body. It
is wired into all launch paths. The D20 unit test is gating.

### 6.3 Fork-bomb hardening : native-tool denial + depth cap

Two code-enforced guards backstop the prose exemption:

1. Claude PreToolUse denies the harness-native `Agent` launcher even when
   the caller is a sub-agent (`SUBAGENT_MCP_SUBAGENT=1`). Task widget tools
   and Explore are not denied by the hook. The sole-channel rule is enforced
   on sub-agents, not just the root orchestrator.
2. Each launch stamps `SUBAGENT_MCP_DEPTH = parent depth + 1`. Main
   orchestrator depth is 0, sub-orchestrators depth is 1, and workers depth is
   2. `launch_agent` is code-rejected at depth >= 2. A legacy sub-agent with
   `SUBAGENT_MCP_SUBAGENT=1` but no depth is treated as depth 1.

### 6.4 Sub-orchestrator exemption-override (sole sanctioned case)

The sub-orchestrator env pair (`SUBAGENT_MCP_SUBAGENT=1` AND `SUBAGENT_MCP_SUB_ORCHESTRATOR=1`)
is the SOLE case where the first-line exemption's skip of the orchestration regime is OVERRIDDEN.
A sub-orchestrator session has the first-line parent-process marker (it IS a sub-agent) but MUST
NOT skip orchestration because it is a delegate-only orchestrator for its section.

Override mechanism: `runHook` in `src/orchestration/hook-core.ts` checks the env pair BEFORE the
`isSubagent` bail at line 756. When both are set it emits the orchestration tag stateless
per-turn (kind="sub-orchestrator") and returns WITHOUT falling through to the bail.

Anti-fork-bomb analysis with env strip:
- The `sub-orchestrator: true` flag is available only at depth 0 (`ERR_SUBORCH_DEPTH` at depth >= 1).
- `buildChildEnv` unconditionally DELETES `SUBAGENT_MCP_SUB_ORCHESTRATOR` from every child env
  UNLESS this specific launch explicitly sets it. A sub-orchestrator's OWN workers get
  `SUBAGENT_MCP_SUBAGENT=1, SUBAGENT_MCP_DEPTH=2` with NO sub-orchestrator marker.
- Workers at depth 2 cannot spawn (the depth cap rejects `launch_agent` at >= 2).
- The directive in the sub-orchestrator's prompt also states "NEVER set sub-orchestrator: true",
  but this is a belt-and-suspenders prose guard; the code-enforced strip + depth cap make
  env-based orchestrator propagation impossible even if the prompt is disobeyed.

The sub-orchestrator remains a sub-agent for depth accounting, worktree carve-out, and pretool
handling. Only the hook-skip consequence of the first-line exemption is overridden.

### 6.4 Hook-side child detection ladder

Hook adapters detect child turns by degrading to the next-strongest signal,
never to a guess and never to `undefined`: spawn env
`SUBAGENT_MCP_SUBAGENT=1`, host-structured metadata, then exact wire marker.

Claude structured metadata is `agent_id` or a sub-agent
`CLAUDE_CODE_ENTRYPOINT`. Codex structured metadata is the `source`
object/enum. For Codex object-form `source`, child detection accepts the legacy
`subagent` key, known `subAgent*` kind names as object keys, and those same
names in `kind` or `type` discriminator values. This is intentionally
schema-tolerant because local Codex rollouts have not made the object shape
stable.

The final marker tier uses the shared `hasParentMarker()` predicate from
`src/launch-prompt.ts`, the same constant/extractor used by
`ensureParentMarker`. It is case-sensitive and accepts only the exact bracketed
marker at character position 0 on the physical first line, with BOM and CRLF
comparison tolerance. Leading blank lines, line-2 markers, bracketless prose,
case variants, and mid-line substrings do not count.

---

## section 7 : Dropout / HALT Semantics + Task-Abandonment Exit (D12 / D23 / S5)

If subagent-mcp stops responding while orchestration is ON:

- Halt and ask the user. Do nothing inline.
- Keep re-checking and remain halted until subagent-mcp returns. No auto-degrade.
- The only user exit is explicit task abandonment: aborting ends the task and
  never switches the orchestrator into inline work.

---

## section 8 : Markers, Union Migration & Collapse (D9 / D17 / D22 / S2 / S3)

### 8.1 Markers, migration, and collapse

Managed blocks use:

```text
<!-- subagent-mcp:managed:begin schema=3 -->
... managed block body ...
<!-- subagent-mcp:managed:end -->
```

The outer `subagent-mcp:` prefix is unchanged for external tooling stability.
The `:managed:` segment makes the block self-describing; `schema=N` is the
version/format dial. No migration note is written inside the block.

`MIGRATE_RE` matches both legacy and managed blocks:
`/<!-- subagent-mcp:(?:managed:)?begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:(?:managed:)?end -->/`.
The optional `managed:` group and schema bump force one re-upsert for prior
installs. On duplicate or corrupt blocks, init replaces the first match with
the new block, deletes remaining matches up to the bounded cap, collapses blank
runs once, and performs one `atomicWrite`. `removeManagedBlock` uses the same
regex, so it strips legacy v1/schema=2 and schema=3.

### 8.2 Edit protocol for do-not-edit / schema-marked blocks

Any block labeled "do not edit between markers", carrying a `schema=N` marker,
or otherwise looking machine-managed must be flagged and proposed before it is
touched. Before making any edit:

1. Say that the block looks installer-managed and editing it in place risks a
   silent overwrite on the next `init` re-upsert.
2. Propose the safer default: write the change to an adjacent unmanaged file
   and let the user decide whether to merge it into the managed block.
3. Edit the managed block in place only if the user, having heard the risk,
   still asks for it directly.

### 8.3 Enable and latch records

The context-metered redesign adds two session-keyed state files under
`join(os.tmpdir(), "subagent-mcp")`, written through `atomicWriteJson` with dir
`0o700` and file `0o600`:

| Record | File | Shape | Semantics |
|---|---|---|---|
| Enable | `orch-enable-<hashKey(sessionKey)>.json` | `{ enabled_at: number }` | explicit opt-in that raises a default-OFF hook-covered session to ON; same 2h TTL and lazy-GC pattern as disable; disable still wins |
| Latch | `latch-<hashKey(sessionKey)>.json` | `{ latched: true, latched_at: number, session_id: string }` | written once at the first 15% plan-phase crossing; does not expire by time while the record exists; persists through the 20% handoff phase and the wind-down warning threshold for that session, and is unaffected by `contextCoaching` |

A brand-new session with a new `sessionKey` starts latch-free.

---

## section 9 : Cross-Provider Behavior (D6 / D7 / D18)

| Host | Hook fires? | `state` source | Structured-question tool | Behavior |
|---|---|---|---|---|
| Claude Code CLI | Yes | hook tag | `AskUserQuestion` | authoritative ON/OFF |
| Codex CLI | Yes | hook tag | `request-user-input` | authoritative ON/OFF |
| Gemini CLI | No | tag absent | n/a | UNKNOWN, warn, fail-safe ON (section 5) |
| Desktop apps | Toggle session disable, inject nothing | tag absent | n/a | UNKNOWN, warn, fail-safe ON (section 5) |

The supremacy clause (A4) is byte-identical in all three host files regardless
of whether that host fires hooks. Fail-safe ON lives in the INIT_BLOCK and MCP
`instructions` prose. Hook-core emits `""` on any error and for any sub-agent
turn, never a `<subagent-mcp>` tag.
