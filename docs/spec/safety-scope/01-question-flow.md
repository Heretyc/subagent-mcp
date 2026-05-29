# Safety Scope 01: Question Flow

## 2. Final Confirmation Only

For every cascade that fires, confirmation of understanding happens exactly once
at the end of the question flow, after all required clarification questions,
consent questions, read-only passes, and evidence-gathering steps are complete.
Do NOT lead each clarification or consent block with a confirm-understanding
question.

The final confirmation is its own AskUserQuestion-equivalent block with exactly
one question and exactly two user-visible options. It is additional to the
tier's mandatory clarification-question floor.

The final confirmation question MUST begin exactly:

```text
To Confirm:
```

After `To Confirm:`, explain what the user wants in the maximum detail the
active question tool allows without truncation. Include requested outcome,
scope, target files/systems, constraints, safety or consent boundaries, key
assumptions, and planned next action. Do not split this confirmation across
multiple questions. If the tool rejects or truncates the question text, retry
once with a compressed version preserving scope, constraints, and planned next
action.

Use header `Confirm`. Use exactly one confirmation question and exactly two
options. Preferred visible options are exactly:

```text
This is correct.
This is not right, ask me 5 more questions to clarify further
```

If a strict schema rejects the second label as too long, use label `This is not
right` and description `Ask me 5 more questions to clarify further.` This is
only a formatting fallback; the visible meaning must remain unchanged.

If the user selects the second option, ask exactly 5 additional clarification
questions, then issue a new final confirmation block. No work beyond read-only
investigation, question construction, and required consent handling begins until
the user selects `This is correct.`

Codex `request_user_input` may add an automatic free-form option. A free-form
final-confirmation response is not confirmation. Treat it as `This is not
right`, ask exactly 5 more clarification questions, then issue a new final
confirmation block.

Public Claude Code, Codex, and Gemini CLI documentation found no hard character
maximum for the main question text. Use as much detail as the active tool
accepts, but do not rely on unlimited display. If the tool rejects, truncates,
or visibly clips the final confirmation, compress and retry once instead of
splitting confirmation into multiple questions.

## 3. Read Then Ask Once

Clarifying questions are constructed in non-interleaved phases:

1. Minimal read-only pass: gather just enough context to identify scope, target,
   environment, and obvious blockers.
2. Deeper read-only pass: inspect readily available artifacts and freely
   available online material when permitted by this directive.
3. Single logical clarification block: ask all mandatory clarification questions
   for the current cascade at once. If the required count exceeds the active
   tool limit, split only as much as the tool requires, treat split calls as one
   logical block, and do not insert confirmation between them.
4. Consent block, if needed: ask consent questions separately from clarification
   questions.
5. Final confirmation block: ask the single final confirmation required above.

Online research during read-only passes is permitted only for materials freely
available without login. If a source requires authentication, skip it and use
already available material. Login-gated research is never performed during the
cursory pass. A pre-authenticated MCP server already in the environment is
approved for online research.

## 4. Clarification And Consent Separation

Clarification questions and consent questions are NEVER mixed in one
AskUserQuestion-equivalent call. Clarification blocks contain only
clarification questions. Consent blocks contain only binary approve/deny
consent questions.

Neither clarification blocks nor consent blocks begin with confirm-understanding.
The only confirm-understanding question is the final confirmation block.

## 5. No Self-Trigger

The agent MAY NOT ask clarification questions outside the cascade conditions in
section 1. The phrase "when needed" is stricken. There is no soft judgment
trigger.

If unresolved ambiguity appears mid-work that the cascade did not surface, halt
and surface the specific unresolved item to the user. This halt-and-surface is
not a cascade, is not subject to mandatory count, and does not trigger final
confirmation unless the user response itself qualifies for a cascade.
