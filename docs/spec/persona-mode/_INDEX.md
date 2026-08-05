# Persona-Mode Spec Index

Status: normative spec for the opt-in persona passthrough on `launch_agent`.
This directory is the canonical home for the design; the implementation lives
in `src/persona.ts` (validation + SDK mapping), `src/index.ts` (schema and
launch gating), `src/drivers.ts` (Claude SDK forwarding), and
`src/concurrency.ts` + `src/configure.ts` (the two user-scope config keys).
This directory is design + contract only. Parameter and return shapes are
owned by `docs/tools.md`; exact candidate-error text is owned by
`docs/spec/auto-mode/resolution-errors.md`.

## What persona mode is

An opt-in way for `launch_agent` to apply a persona (an agent definition:
system prompt, tool restrictions, preloaded skills) to the spawned Claude
sub-agent's main thread, via the Claude Agent SDK `agent`/`agents` options.
The feature is OFF by default and, while off, is invisible: the three persona
parameters exist in the schema but every call that supplies one is rejected,
and the options object handed to the SDK carries no persona keys.

## Safety-scope grounding

`docs/spec/safety-scope/03-subagents-platforms.md` (Sub-Agent Naming) bans
personas in sub-agent names and self-descriptions UNLESS the user explicitly
prescribed them. Setting `user.personaMode` to `enabled` through the
`configure` tool IS that explicit user prescription: the key is settable only
by deliberate configuration, never by the orchestrator's own initiative, and
its default is `off`. The orchestrator-authored-prompt rules of that spec are
unchanged; a persona supplements the launch prompt contract, it does not
replace it.

## Config keys (user scope, set via the configure tool)

- `user.personaMode` : `"off"` (default) or `"enabled"`. Gates the three
  launch parameters (`agent`, `agent_definition`, `system_prompt_append`;
  shapes in `docs/tools.md`). While `off`, supplying any of them is an error
  that names this key.
- `user.settingSources` : JSON array subset of `["user","project","local"]`,
  no duplicates, default `[]`. Forwarded to the SDK `settingSources` option on
  every Claude launch. This key is independent of `user.personaMode`: it takes
  effect whenever set, and turning persona mode off does not clear it. `[]`
  keeps full SDK isolation: no user/project settings, no `.claude/agents/`,
  no CLAUDE.md in the child. Include `"project"` or `"user"` to let named
  personas load from `.claude/agents/` on disk.

SECURITY: non-empty `settingSources` lets the child SDK load settings files
that can carry executable configuration (hooks, helpers). Those execute inside
the child under the SDK's own rules and do NOT route through this server's
permission gate. Treat widening `settingSources` as trusting the settings
files it exposes; keep it `[]` when launching into untrusted working trees.

Both keys live in the per-user `settings.json` (`SUBAGENT_CONFIG_HOME`
overridable), are re-read on every launch, and follow the same
`settings.local.json` overlay rules as the other user keys, with one write
rule: `configure set` seeds its rewrite from the durable `settings.json` only,
so a `settings.local.json` override of one key is never copied into the
durable file by a set of the other key. Malformed values fall back silently to
the defaults on read; a set that cannot be applied (no top-level object in the
file) fails loudly.

## Validation matrix

| Condition | Outcome |
|---|---|
| any persona param while `user.personaMode` is not `enabled` | error naming `user.personaMode` |
| `provider: "codex"` with any persona param | error (no Codex equivalent; never silently ignored) |
| `agent_definition` without `agent` | error (the name registers the definition) |
| `system_prompt_append` combined with `agent` | error (the SDK applies the selected agent's own system prompt to the main thread, leaving the preset append undefined; fold the text into the definition's prompt) |
| `agent` without `agent_definition`, and `user.settingSources` includes neither `project` nor `user` | error naming `user.settingSources` (definition must load from disk) |
| persona params with auto routing | candidate list constrained to `claude` before the attempt loop AND re-constrained on the advanced ruleset's output (the ruleset may return candidates not in its input); api slot insertion skipped; clean error if no claude candidate remains |

## Forwarding contract

When a launch passes validation, `ClaudeSdkDriver.open()` adds to the SDK
options, each key emitted only when its input is present:

- `agent` : the persona name.
- `agents` : `{ [agent]: definition }` with snake_case wire fields mapped to
  the SDK's camelCase (`disallowed_tools` -> `disallowedTools`).
- `systemPrompt` : `{ type: "preset", preset: "claude_code", append }`.
- `settingSources` : the configured `user.settingSources` value; `[]` when
  unset (this key is always emitted).

The parent-process marker upsert and the sub-orchestrator directive are
untouched: they operate on the user prompt, never the system prompt. The
permission engine gate (canUseTool + PreToolUse hook) applies to persona
launches unchanged; persona tool restrictions narrow the child's toolset on
top of, never instead of, the server's permission ceiling.

## Invariants

- Default off, zero behavior change: with both keys unset, the SDK options
  object carries no persona keys and `settingSources` is `[]`.
- Inline persona definitions never select models: the wire shape has no model
  field and the strict schema rejects one. KNOWN LIMIT: a named persona loaded
  from `.claude/agents/` on disk may carry a `model` in its frontmatter, and
  the SDK applies that model to the child's main thread; the server cannot
  inspect or strip it. Launch metadata reports the routed model, so a
  frontmatter pin makes the report diverge from what runs. Prefer inline
  definitions when model accounting matters.
- Claude SDK path only. Codex and direct API providers reject or exclude
  persona launches; nothing silently drops a persona.
