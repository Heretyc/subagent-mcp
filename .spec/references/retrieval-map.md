# Routing Retrieval Map

One-screen lookup from `task_category` / `rag_pointer` to the smallest authoritative docs. Use
`classification_precedence` in the routing table for order; this file is only a retrieval map.

**Load this when:** mapping a prompt to a `task_category`; resolving a routing `rag_pointer`;
auditing taxonomy coverage.
**Do not load when:** executing an already-classified task and no routing/taxonomy lookup is needed.

| Category | Authoritative definition | Elaboration leaf |
|---|---|---|
| `math_proof` | `.spec/references/work-categories.md#math_proof--precedence-1--alias-formal_reasoning_proof` | `docs/spec/task-taxonomy/category-rationale.md` |
| `security_review` | `.spec/references/work-categories.md#security_review--precedence-2--alias-security_assessment` | `docs/spec/task-taxonomy/category-rationale.md` |
| `debugging` | `.spec/references/work-categories.md#debugging--precedence-3--alias-failure_diagnosis_repair` | `docs/spec/task-taxonomy/category-rationale.md` |
| `quality_review` | `.spec/references/work-categories.md#quality_review--precedence-4--alias-artifact_evaluation` | `docs/spec/task-taxonomy/category-rationale.md` |
| `architecture` | `.spec/references/work-categories.md#architecture--precedence-5--no-benchmark-legible-alias--the-proxy-exception-absence-is-the-honest-signal` | `docs/spec/task-taxonomy/category-rationale.md` |
| `agentic_execution` | `.spec/references/work-categories.md#agentic_execution--precedence-6--alias-interactive_tool_execution` | `docs/spec/task-taxonomy/category-rationale.md` |
| `data_analysis` | `.spec/references/work-categories.md#data_analysis--precedence-7--alias-data_analysis_query--net-new-tile` | `docs/spec/task-taxonomy/category-rationale.md` |
| `coding` | `.spec/references/work-categories.md#coding--precedence-8--alias-code_implementation` | `docs/spec/task-taxonomy/category-rationale.md` |
| `knowledge_synthesis` | `.spec/references/work-categories.md#knowledge_synthesis--precedence-9--alias-complex_reasoning_synthesis` | `docs/spec/task-taxonomy/category-rationale.md` |
| `mechanical` | `.spec/references/work-categories.md#mechanical--precedence-10--alias-deterministic_leaf_and_extraction` | `docs/spec/task-taxonomy/category-rationale.md` |
| `prompt_engineering` | `.spec/references/work-categories.md#prompt_engineering--precedence-11--composite-inferred-no-benchmark-alias` | `docs/spec/task-taxonomy/composite-inferred-tiles.md` |
| `vulnerability_research` | `.spec/references/work-categories.md#vulnerability_research--precedence-12--composite-inferred-no-benchmark-alias` | `docs/spec/task-taxonomy/composite-inferred-tiles.md` |
| `molecular_biology` | `.spec/references/work-categories.md#molecular_biology--precedence-13--composite-inferred-no-benchmark-alias` | `docs/spec/task-taxonomy/composite-inferred-tiles.md` |
| `ml_accelerator_design` | `.spec/references/work-categories.md#ml_accelerator_design--precedence-14--composite-inferred-no-benchmark-alias` | `docs/spec/task-taxonomy/composite-inferred-tiles.md` |
| `fallback_default` | `.spec/references/work-categories.md#fallback_default--precedence-99-no-match` | `docs/spec/task-taxonomy/_INDEX.md` |

