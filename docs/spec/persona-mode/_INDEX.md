# Persona-Mode Spec Index

Status: normative spec for the opt-in, inline-only persona passthrough on
`launch_agent`. This directory is the canonical home for the design; the
implementation lives in `src/persona.ts` (validation + SDK mapping),
`src/index.ts` (schema and launch gating), `src/drivers.ts` (Claude SDK
forwarding), and `src/concurrency.ts` + `src/configure.ts` (the config key).
This directory is design + contract only. Parameter and return shapes are
owned by `docs/tools.md`; exact candidate-error text is owned by
`docs/spec/auto-mode/resolution-errors.md`.

## What persona mode is

An opt-in way for `launch_agent` to apply an INLINE persona (an agent
definition: system prompt and tool restrictions) to the
spawned Claude sub-agent's main thread, via the Claude Agent SDK
`agent`/`agents` options. Personas are inline-only: the definition arrives in
the launch call itself, and the child keeps full SDK filesystem isolation
(`settingSources: []`) - no user/project settings, no `.claude/agents/`, no
skills, no CLAUDE.md load in the child, and no settings hooks executing
there. A launcher that keeps personas as on-disk files reads them itself and
passes their content inline; the file stays the source of truth, the read
just happens in the launcher.

The feature is OFF by default and, while off, is invisible: the persona
parameters exist in the schema but every call that supplies one is rejected,
and the options object handed to the SDK carries no persona keys.

## Safety-scope grounding

`docs/spec/safety-scope/03-subagents-platforms.md` (Sub-Agent Naming) bans
personas in sub-agent names and self-descriptions UNLESS the user explicitly
prescribed them. Setting `user.personaMode` to `enabled` through the
`configure` tool records that explicit user prescription: the gate error and
the key's documentation both instruct the agent to obtain explicit user
approval via the structured-question tool before setting it - never to enable
it on its own initiative - and its default is `off`. The orchestrator-authored-prompt rules of that spec are
unchanged; a persona supplements the launch prompt contract, it does not
replace it.

## Config key (user scope, set via the configure tool)

- `user.personaMode` : `"off"` (default) or `"enabled"`. Gates the
  launch parameters (`agent`, `agent_definition`; shapes in `docs/tools.md`). While `off`, supplying any of them is an error
  that names this key. The key lives in the per-user `settings.json`
  (`SUBAGENT_CONFIG_HOME` overridable), is re-read on every launch, and
  follows the `settings.local.json` overlay rules; `configure set` seeds its
  rewrite from the durable file only, so a local override is never promoted.
  Malformed values fall back silently to `off` on read; a set that cannot be
  applied (no top-level object in the file) fails loudly.

## Validation matrix

| Condition | Outcome |
|---|---|
| any persona param while `user.personaMode` is not `enabled` | error naming `user.personaMode` |
| `provider: "codex"` with any persona param | error (no Codex equivalent; never silently ignored) |
| `agent_definition` without `agent` | error (the name registers the definition) |
| `agent` without `agent_definition` | error (personas are inline-only; pass the definition in the launch call) |
| persona params with auto routing | candidate list constrained to `claude` before the attempt loop AND re-constrained on the advanced ruleset's output (the ruleset may return candidates not in its input); api slot insertion skipped; clean error if no claude candidate remains |

## Forwarding contract

When a launch passes validation, `ClaudeSdkDriver.open()` adds to the SDK
options, each key emitted only when its input is present:

- `agent` : the persona name.
- `agents` : `{ [agent]: definition }` with snake_case wire fields mapped to
  the SDK's camelCase (`disallowed_tools` -> `disallowedTools`).

`settingSources` stays hardcoded `[]` in every launch. The parent-process
marker upsert and the sub-orchestrator directive are untouched: they operate
on the user prompt, never the system prompt. The permission engine gate
(canUseTool + PreToolUse hook) applies to persona launches unchanged; persona
tool restrictions narrow the child's toolset on top of, never instead of, the
server's permission ceiling.

## Invariants

- Default off, zero behavior change: with the key unset, the SDK options
  object carries no persona keys.
- Personas never select models: the wire shape has no model field and the
  strict schema rejects one, so routing and model-selection-mode keep sole
  ownership of model choice.
- Claude SDK path only. Codex and direct API providers reject or exclude
  persona launches; nothing silently drops a persona.
- Child filesystem isolation is unconditional: no persona parameter can cause
  settings, skills, or hooks to load from disk into the child.
