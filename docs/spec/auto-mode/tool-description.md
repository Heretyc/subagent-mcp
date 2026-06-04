# Tool Description and MCP Metadata Rewrite

Normative. The verbatim strings B2 wires into the `launch_agent` tool
registration in `src/index.ts`. Lead with auto mode; keep the existing factual
notes; carry a caveman self-classification gloss on `task_category`.

## Rewritten tool description (verbatim)

```
Spawn a sub-agent. AUTO MODE: pass just `prompt` + `task_category` and the server picks the best provider/model/effort for that category from its routing table, launching the best candidate and silently falling back to the next-best if a launch fails. `provider`/`model`/`effort` are OPTIONAL overrides and are usually unnecessary — omit them to get the auto-selected best combination (rules: if you pass `model` you must pass `provider`; if you pass `effort` you must pass both `provider` and `model`). If you are unsure which task_category fits, do NOT submit one large amorphous task — break the work into smaller atomic steps that each map to a single category and launch one agent per step. Spawns the LOCALLY INSTALLED `claude` and `codex` CLI binaries as child processes; does NOT call the Anthropic or OpenAI HTTP APIs (no API keys, no SDK). Note: ultracode effort is Opus-4.8+ only (induced via a temp `--settings {"ultracode":true}` file; the CLI rejects `--effort ultracode`). Status `processing` means ALIVE with visible provider activity in the last 10 minutes (counts against concurrency caps); `stalled` means ALIVE but no parsed visible provider stream item for 10 minutes (thinking or awaiting a temp-file handoff, NOT dead, does not count against caps) — wait or re-poll rather than killing.
```

Rationale (Structure/Clarity reviewers): auto mode leads; the override rule is
stated once, compactly; the "split amorphous work" guidance appears here AND in
the error hints (`resolution-matrix.md`) so it survives whether the caller reads
docs or only hits an error. The CLI-not-API and `processing!=dead` facts are
preserved verbatim from the current description.

## `task_category` param metadata gloss (verbatim)

The `task_category` param `.describe(...)` string. Lead line + the 11 caveman
glosses (token-efficient: articles/filler dropped, exact technical terms kept).
A calling agent self-classifies from these alone.

```
REQUIRED. Task shape -> routing category (server picks best model for it). Pick ONE: math_proof: deliverable=proof/derivation/formally-checkable result; proof IS deliverable; deductive step-validity under axioms; verified by proof-checker not tests. security_review: deliverable=security verdict/threat-assessment/demonstrated-exploit; adversarial reasoning over attack surface; vuln, auth/authz, crypto, exploitability. debugging: deliverable=verified fix/root-cause; ONLY when observed failure (error, crash, red test, regression, flake) preconditions work; done when symptom resolved. quality_review: deliverable=evaluative verdict on existing NON-security artifact, NO observed failure; review diff/PR, compare A-vs-B, validate-vs-spec; never self-review. architecture: deliverable=cross-module design/plan, NO code, NO execution loop; system structure, interface/migration strategy, decompose-into-tasks; >2 files or public API. agentic_execution: deliverable=target end-state via iterate in mutating env (act/observe/adapt loop); run/deploy/provision/browse, tool/function-call, iterate-until-tests-pass. data_analysis: deliverable=empirical finding/model ABOUT structured dataset; query/SQL/dataframe answer, statistic, fit-model-report-drivers; finding scored even if code runs. coding: deliverable=bounded runnable code artifact, one-pass; implement function/module/feature/script, write tests, single-module refactor; compiles/passes-tests. knowledge_synthesis: deliverable=novel integrated prose over sources; synthesize/summarize/translate/draft/explain-across-files; verified by faithfulness/coherence not exact-match. mechanical: deliverable=deterministic single-pass transform/leaf op, exact-match checkable; find/grep/list/rename/reformat/format-convert/extract-to-fixed-schema; minimal reasoning. fallback_default: no category matches with confidence (under-specified/mixed/tied); read-only; PREFER splitting work into smaller atomic steps each mapping to one category.
```

## The 11 glosses (also returned in `caveman_category_descriptions`)

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
| `fallback_default` | no category matches with confidence (under-specified/mixed/tied); read-only; PREFER splitting work into smaller atomic steps each mapping to one category |

Keep the param description string in sync with this table if either is edited.
