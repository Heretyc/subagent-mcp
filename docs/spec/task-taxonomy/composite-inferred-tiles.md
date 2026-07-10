# Composite-Inferred Tiles

Methodology and parent-map rationale for the 4 **composite-inferred** task categories
(precedence 11:14). These extend the directly benchmarked parent set (precedence 1:10, see
`category-rationale.md` / `determination-rationale.md`) without altering it. Operational
definitions : signals, examples, boundaries : live in `.spec/references/work-categories.md`.

---

## What "composite-inferred" means

A composite-inferred tile names a high-demand object-of-work that is **real and routable** but that
**no single public benchmark scores end-to-end**. Rather than invent a fabricated benchmark or smear
the shape across parents at classification time, the taxonomy mints an explicit tile and records the
parent tiles whose competencies compose it.

Two properties distinguish these tiles from the parent set:

- **No benchmark alias.** Parent tiles carry a benchmark-legible alias (e.g. `code_implementation`);
  composite tiles carry none. There is no direct measure of the whole shape.
- **Never directly benchmarked.** A profiler never assigns a composite tile a direct score. It
  **infers** the routing competency downstream by composing the scores of the parent tiles in the
  parent map below. The composition rule itself (how parents combine) is a profiler concern, not a
  taxonomy concern; the taxonomy fixes only the parent set per composite.

They remain first-class for classification: a prompt matching a composite's signals classifies into
it under the precedence chain (first-match after `mechanical`).

---

## Parent map

| Composite tile (precedence) | Parent tiles | Why these parents |
|---|---|---|
| `prompt_engineering` (11) | `knowledge_synthesis` + `coding` + `quality_review` | Authoring/optimizing prompts is prose-craft over instructions (synthesis), template/scaffold construction (coding), and candidate-vs-criteria evaluation of outputs (quality_review). |
| `vulnerability_research` (12) | `security_review` + `debugging` + `coding` | Discovering a novel vuln is adversarial attack-surface reasoning (security_review), fault localization / root-causing a crash (debugging), and PoC/exploit construction (coding). |
| `molecular_biology` (13) | `knowledge_synthesis` + `data_analysis` + `math_proof` | Reasoned biology results draw on literature/mechanism synthesis (synthesis), quantitative analysis over -omics/experimental data (data_analysis), and formal/quantitative derivation (math_proof). |
| `ml_accelerator_design` (14) | `architecture` + `coding` + `math_proof` | Accelerator design is system-structure/dataflow design (architecture), kernel/codegen implementation (coding), and roofline/asymptotic modeling (math_proof). |

The parent map is an **object-of-work decomposition**, not a route: it names which competencies the
work composes, never a provider, model, effort tier, or route.

---

## Why mint tiles instead of reusing parents

Each composite shape is **high-volume and homeless** under the parent set alone: classifying
"fuzz this parser and PoC the exploitable crashes" as bare `security_review` loses the
debugging+coding legs that determine which member can actually do it. Minting the tile keeps the
classification honest and lets the profiler compose a competency estimate from the parents instead
of forcing a single ill-fitting parent score.

Because they are benchmark-exempt by construction, composite tiles do **not** weaken the
benchmark-findability criterion (`derivation-methodology.md` section 6) : that criterion gates only the
parent set.

---

## Stability

The parent set and the composite extension are both **immutable inputs** to skills and routing
code. Adding, removing, renaming, or re-parenting a composite tile is an owner-approved taxonomy
change made here and in `.spec/references/work-categories.md`, not inside a skill run. A skill that
finds a genuinely homeless shape surfaces it as `needs_user`.

---

Author: Lexi Blackburn : https://github.com/Heretyc/ : June 2026
