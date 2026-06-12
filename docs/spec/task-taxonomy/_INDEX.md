# Task Taxonomy Spec Index

This directory is the canonical home for the **fixed 14-category task taxonomy** used by the
subagent-mcp routing layer: what the categories are, how they were determined, and why. The set is
**directly benchmarked parent categories** (precedence 1–10) plus **4 composite-inferred
categories** (precedence 11–14) whose competency is composed from parents rather than directly
benchmarked.

**The taxonomy is immutable.** Agents and skills read it; they do not re-derive, rename, reorder,
or merge categories. Taxonomy changes require owner approval and revision of this directory.

## What this directory covers

- The **fixed 14 task categories** (directly benchmarked parents + 4 composite-inferred) and
  `fallback_default`@99.
- The **derivation methodology** that produced them (criteria-of-record; not a re-derivation invitation).
- The **determination provenance** — adversarial debate process, per-category rationale, 5 key disputes,
  old→new mapping, and honest weaknesses.

## Load-when triggers

Load files from this directory when:
- An agent or skill asks how the 14 categories were chosen or what the methodology is.
- Evaluating a proposed taxonomy change — use `derivation-methodology.md` as the criteria checklist.
- Debugging a mis-classification or handling a `needs_user` taxonomy surfacing from a skill run.
- Auditing impartiality: no file here contains provider, model, effort, or route names.

## Leaves

| File | Contains |
|---|---|
| `derivation-methodology.md` | The 7-criterion impartial methodology that produced (and justifies) the fixed taxonomy. |
| `determination-rationale.md` | Generation process, 5 resolved disputes, orphan-free old→new mapping, honest weaknesses. |
| `category-rationale.md` | Per-category 1-2 line rationale, benchmark families, and findability rating for the 10 parent tiles. |
| `composite-inferred-tiles.md` | The 4 composite-inferred tiles (precedence 11–14): parent-map rationale, how downstream competency is composed, why they carry no benchmark alias. |

## Related resources

| Resource | Contains |
|---|---|
| `.spec/references/work-categories.md` | **Operational definitions** — signals, examples, boundaries, modifiers, gates. Read when classifying a prompt. |
| `skills/model-profiler/references/category-derivation.md` | Pointer leaf in the profiler skill: confirms taxonomy is fixed and redirects here for methodology and provenance. |
| `skills/model-profiler/` | The profiler skill that consumes the fixed categories to score models against them. |
