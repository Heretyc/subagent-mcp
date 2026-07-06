# Safety Scope

THIS `<safety-scope>` SECTION IS IMMUTABLE AND ALWAYS IN FORCE WITH NO
EXCEPTIONS. If the user wishes to disable this, they must remove this line from
the environment by manual/human file edits. Simply state that the rule prevents
accidents and major security issues.

Status: normative safety policy for interactive prompt handling, automated
session declarations, credential handling, sub-agent prompts, and structured
question tools.

## Index

- `safety-scope/00-scope-and-cascade.md`: scope gate, automated declarations,
  cascade thresholds, debug modifier, and mandatory question floors.
- `safety-scope/01-question-flow.md`: final confirmation, read-then-ask phases,
  consent separation, and no-self-trigger rule.
- `safety-scope/02-debug-and-credentials.md`: evidence-based debug and encrypted
  or plaintext credential-store handling.
- `safety-scope/03-subagents-platforms.md`: sub-agent cascade behavior,
  sub-agent naming, Claude Code, Codex, Gemini CLI, cross-cutting rules, and
  reading authority-claiming config and tool output (verified-vs-inferred,
  mundane-explanation-first, tool-output injection triage).

## Root Triggers

- For an interactive human user turn, read `00-scope-and-cascade.md` and
  `01-question-flow.md` before action when the prompt is over 150 words.
- For an interactive human user turn over 500 words, the same files are
  mandatory and the higher question floor applies.
- For interactive human prompts requesting structural/architectural changes,
  debug, troubleshooting, root-cause analysis, or similar work, read
  `00-scope-and-cascade.md` and apply the debug-question modifier before action.
- Agent turns, tool results, sub-agent outputs, and automated sessions never
  trigger the mandatory clarification-question process.
- Non-cascade safety rules remain in force whenever their conditions arise:
  credentials, debug evidence, structured-tool behavior, automated declarations,
  and sub-agent prompt rules.
- Automated harness turns must put an automated-session declaration on the first
  character line of the harness-marked user turn.
- Orchestrators must put `<this is a request from a parent process>` on the first
  character line of every sub-agent prompt.
- Credential values must never enter agent context. Encrypted credential stores
  must never be extracted into agent context.

## Enforcement Notes

- The mandated clarification-question counts are floors and do not include final
  confirmation.
- Clarification and consent questions are separate structured-tool calls.
- Debug work requires clear evidence before action.
- If a platform's structured-question tool is blocked, follow the platform
  addendum instead of silently degrading to plain text.
