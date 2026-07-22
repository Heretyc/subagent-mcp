# Tool Description and MCP Metadata Rewrite

Normative. The first fenced block is the current `launch_agent` description in
`src/index.ts`, verbatim. The later fenced blocks are the parameter metadata.

## Rewritten tool description (verbatim)

```
Spawn a sub-agent session. CONTRACT: every `prompt` states objective + required output format + tools/sources + boundaries; the server auto-upserts the self-identification marker "<this is a request from a parent process>" as the true first line (idempotent, never duplicated, body never mutated), so you need not add it. SCALE to complexity: ~1 agent for a simple fact-find, 2-4 for comparisons; never one-shot a multi-phase task: SPLIT into atomic steps that each map to ONE task_category, one agent per step. AUTO MODE (mandatory first attempt unless an override is licensed below): pass only `prompt` + `task_category`, NO overrides; the server picks the best provider/model/effort for that category. FAILOVER: a launch-time failure (incl. a provider usage/rate-limit refusal before any output) quietly cascades down the ranking, and the switch is reported to you in `failover_note`; if EVERY candidate fails you get one loud error listing each candidate + reason. A provider+model override is PINNED: one attempt, no substitution. `provider`/`model`/`effort` are OVERRIDES, licensed on the 1st/2nd attempt ONLY when the task verifiably needs a specific capability: STATE that capability; `model` requires `provider`, `effort` requires `provider`+`model`; ultracode effort is Opus 4.8+ only. SOLE CHANNEL: while this server is connected this is the ONLY sanctioned way to spawn sub-agents in BOTH orchestration states; harness-native Task/Agent tools are FORBIDDEN. Children run with env SUBAGENT_MCP_SUBAGENT=1 so orchestration hooks skip them (not orchestrators, no carryover re-trigger). Launch returns `processing` (alive); a later `stalled` is alive-but-quiet (thinking or awaiting a temp-file handoff), NOT dead: wait or re-poll, don't kill (see poll_agent). DEADLOCK RULE: you MUST set `deadlock=true` when, and ONLY when, 2 attempts for the SAME atomic task have already failed/been unsatisfactory (the 3rd attempt onward; re-wording or re-splitting does NOT make it a new task), and NEVER otherwise: from the 3rd attempt deadlock outranks any capability override: drop provider/model/effort.
```

Rationale: the live string states the prompt contract, scaling rule, quiet
launch-time failover, visible `failover_note`, loud exhaustion, pinned
provider+model behavior, override gate, sole launch channel, liveness, and
deadlock rule.

## `deadlock` param metadata gloss (verbatim)

The `deadlock` param `.describe(...)` string. This and the `DEADLOCK RULE:`
sentence in the tool description are the ONLY two deadlock strings in
agent-visible TOOL METADATA. One additional agent-visible deadlock string
exists at runtime: the `validatePresence` error in `src/routing.ts` for
deadlock combined with provider/model/effort. It is error text, not metadata;
it now mirrors the same 3rd-attempt/drop-overrides rule and must stay in the
same attempts+task-identity vocabulary. Per the tool-surface opacity invariant
(`routing-table-contract.md section Tool-surface opacity`) NONE of these may name tiers,
branches, counters, or windows : only attempts and task identity. Both
metadata strings encode the same trigger: 2 failed/unsatisfactory launch
attempts for the SAME atomic task (re-wording or re-splitting the prompt does
NOT change task identity), so the 3rd attempt onward MUST set `deadlock=true`
and drop any overrides. Two precise clauses live in the param gloss only: the
unchanged-parts clause ("splitting a failed task does NOT reset attempts for
its unchanged parts") and the attempt-counting clause ("re-launching for the
same deliverable means the prior attempt COUNTS as failed/unsatisfactory" :
this closes the dodge of classifying every prior attempt as partial progress
so the count never reaches 2). The tool description carries the compact
"or re-splitting" form of the same anti-dodge family.

```
MANDATE: ALWAYS set deadlock=true when, and ONLY when, 2 launch attempts for the SAME atomic task have already failed or been unsatisfactory : the 3rd attempt onward. Re-wording the prompt does NOT make it a different task; splitting a failed task does NOT reset attempts for its unchanged parts; re-launching for the same deliverable means the prior attempt COUNTS as failed/unsatisfactory ('partial progress' is not an exemption). NEVER set it on a 1st or 2nd attempt, NEVER for a different task, NEVER speculatively. Auto mode only: cannot be combined with provider/model/effort : from the 3rd attempt deadlock outranks any capability override, so drop those params. Passing false is identical to omitting it.
```

## `task_category` param metadata gloss (verbatim)

The `task_category` param `.describe(...)` string. Lead line + the 15 caveman
glosses (token-efficient: articles/filler dropped, exact technical terms kept).
A calling agent self-classifies from these alone. Tiles 11:14 are
composite-inferred (no direct benchmark) and follow `mechanical`, before
`fallback_default`.

This table and the fenced string below are normative; the live
`TASK_CATEGORY_GLOSS` in `src/index.ts` matches them verbatim.

```
REQUIRED. Task shape -> routing category (server picks best model for it). Pick ONE: math_proof: deliverable=proof/derivation/formally-checkable result; proof IS deliverable; deductive step-validity under axioms; verified by proof-checker not tests. security_review: deliverable=security verdict/threat-assessment/demonstrated-exploit; adversarial reasoning over attack surface; vuln, auth/authz, crypto, exploitability. debugging: deliverable=verified fix/root-cause; ONLY observed failure (error, crash, red test, regression, flake) preconditions work; done when symptom resolved. quality_review: deliverable=evaluative verdict on existing NON-security artifact, NO observed failure; review diff/PR, compare A-vs-B, validate-vs-spec; never self-review. architecture: deliverable=cross-module design/plan, NO code, NO execution loop; system structure, interface/migration strategy, decompose-into-tasks; >2 files or public API. agentic_execution: deliverable=target end-state via iterate in mutating env (act/observe/adapt loop); run/deploy/provision/browse, tool/function-call, iterate-until-tests-pass. data_analysis: deliverable=empirical finding/model ABOUT structured dataset; query/SQL/dataframe answer, statistic, fit-model-report-drivers; finding scored even if code runs. coding: deliverable=bounded runnable code artifact, one-pass; implement function/module/feature/script, write tests, single-module refactor; compiles/passes-tests. knowledge_synthesis: deliverable=novel integrated prose over sources; synthesize/summarize/translate/draft/explain-across-files; verified by faithfulness/coherence not exact-match. mechanical: deliverable=deterministic single-pass transform/leaf op, exact-match checkable; find/grep/list/rename/reformat/format-convert/extract-to-fixed-schema; minimal reasoning. prompt_engineering: deliverable=designed/optimized prompt or prompt-system steering an LLM/agent; author/refine/eval instructions; system prompt, few-shot, template, prompt rubric; comp-infer parents knowledge_synthesis+coding+quality_review; no direct benchmark. vulnerability_research: deliverable=NOVEL vuln discovery/root-cause/PoC, NOT broad CVE summary; find flaw, root-cause, build PoC; fuzzing, reverse-engineer, exploit primitive; comp-infer parents security_review+debugging+coding; no direct benchmark. molecular_biology: deliverable=reasoned molecular/computational-biology result; sequences, structures, pathways, -omics data; comp-infer parents knowledge_synthesis+data_analysis+math_proof; no direct benchmark. ml_accelerator_design: deliverable=hardware/software design for ML acceleration; dataflow, tiling, memory hierarchy, kernel, roofline; comp-infer parents architecture+coding+math_proof; no direct benchmark. fallback_default: no category matches with confidence (under-specified/mixed/tied); read-only; PREFER splitting work into smaller atomic steps each mapping to one category.
```

## The 15 glosses (also returned in `caveman_category_descriptions`)

Each gloss = deliverable + when-to-use, derived from
`.spec/references/work-categories.md` (Definition + Classify-signals +
Boundary). These are the canonical per-key strings:

| Key | Caveman gloss |
|---|---|
| `math_proof` | deliverable=proof/derivation/formally-checkable result; proof IS deliverable; deductive step-validity under axioms; verified by proof-checker not tests |
| `security_review` | deliverable=security verdict/threat-assessment/demonstrated-exploit; adversarial reasoning over attack surface; vuln, auth/authz, crypto, exploitability |
| `debugging` | deliverable=verified fix/root-cause; ONLY when observed failure (error, crash, red test, regression, flake) preconditions work; done when symptom resolved |
| `quality_review` | deliverable=evaluative verdict on existing NON-security artifact, NO observed failure; review diff/PR, compare A-vs-B, validate-vs-spec; never self-review |
| `architecture` | deliverable=cross-module design/plan, NO code, NO execution loop; system structure, interface/migration strategy, decompose-into-tasks; >2 files or public API |
| `agentic_execution` | deliverable=target end-state via iterate in mutating env (act/observe/adapt loop); run/deploy/provision/browse, tool/function-call, iterate-until-tests-pass |
| `data_analysis` | deliverable=empirical finding/model ABOUT structured dataset; query/SQL/dataframe answer, statistic, fit-model-report-drivers; finding scored even if code runs |
| `coding` | deliverable=bounded runnable code artifact, one-pass; implement function/module/feature/script, write tests, single-module refactor; compiles/passes-tests |
| `knowledge_synthesis` | deliverable=novel integrated prose over sources; synthesize/summarize/translate/draft/explain-across-files; verified by faithfulness/coherence not exact-match |
| `mechanical` | deliverable=deterministic single-pass transform/leaf op, exact-match checkable; find/grep/list/rename/reformat/format-convert/extract-to-fixed-schema; minimal reasoning |
| `prompt_engineering` | deliverable=designed/optimized prompt or prompt-system steering an LLM/agent; author/refine/eval instructions; system prompt, few-shot, template, prompt rubric; comp-infer parents knowledge_synthesis+coding+quality_review; no direct benchmark |
| `vulnerability_research` | deliverable=NOVEL vuln discovery/root-cause/PoC, NOT broad CVE summary; find flaw, root-cause, build PoC; fuzzing, reverse-engineer, exploit primitive; comp-infer parents security_review+debugging+coding; no direct benchmark |
| `molecular_biology` | deliverable=reasoned molecular/computational-biology result; sequences, structures, pathways, -omics data; comp-infer parents knowledge_synthesis+data_analysis+math_proof; no direct benchmark |
| `ml_accelerator_design` | deliverable=hardware/software design for ML acceleration; dataflow, tiling, memory hierarchy, kernel, roofline; comp-infer parents architecture+coding+math_proof; no direct benchmark |
| `fallback_default` | no category matches with confidence (under-specified/mixed/tied); read-only; PREFER splitting work into smaller atomic steps each mapping to one category |

Keep the param description string in sync with this table if either is edited.

## Model-selection gating

The override license above ("`provider`/`model`/`effort` licensed on 1st/2nd attempts") is
ADDITIONALLY gated by `model-selection-mode`:

- Default mode is `smart`; in `smart` the server REJECTS ALL selector-bearing calls (any
  `provider`/`model`/`effort`), regardless of the 1st/2nd-attempt license.
- Enable path: call `model-selection-mode(user-approved-overrides)` with explicit interactive
  user authorization. Only then are selector overrides accepted.
- The window is 30 minutes wall-clock, enforced lazily (checked at call time); re-enabling does
  NOT refresh it.
- On lapse, mode reverts to `smart` and selector-bearing calls are rejected again.
