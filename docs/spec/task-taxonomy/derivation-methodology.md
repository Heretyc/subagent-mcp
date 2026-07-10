# Derivation Methodology

**Status: methodology-of-record.** The taxonomy is **fixed and immutable**. This document records
the 7 criteria used to produce it. It is not an invitation to re-derive, rename, reorder, or
reshape the categories. If a skill run surfaces evidence the taxonomy is wrong (genuinely homeless
task shape, broken boundary), surface it as `needs_user`; taxonomy changes happen here, under
owner approval, not inside skills or routing code.

---

## The 7 criteria

Every candidate category set was evaluated against all 7 criteria. A proposed category failing
any criterion was rejected or reshaped.

### 1. Bounded cardinality

Target: a **directly benchmarked parent set** sized to the minimum distinct competency surfaces the
routing layer must resolve (floor ≥8), bounded above (original ceiling ≤12) by the cost of
classification entropy and the benchmark-coverage ceiling. This criterion produced the
benchmark-derived parent tiles (precedence 1:10) : each one earns its slot only if a real public
benchmark family measures it (criterion 6).

**Composite extension.** On top of the parent set, the taxonomy admits **composite-inferred** tiles
(precedence 11:14: `prompt_engineering`, `vulnerability_research`, `molecular_biology`,
`ml_accelerator_design`). These are exempt from the benchmark-findability criterion *by
construction*: no public benchmark scores the whole shape, so they carry no benchmark alias and are
**never directly benchmarked**. Their routing competency is **inferred downstream** by composing
their parent tiles (see `composite-inferred-tiles.md` for the parent map). The full spine is
therefore **14 categories** : directly benchmarked parents + 4 composite-inferred : plus
`fallback_default`@99, which is never one of the 14: it is a no-match catch-all, read-only, never
overriding a hard gate.

### 2. Generic-agentic task-shape (4 axes)

Categories are defined on four axes : no axis refers to a provider, model, effort tier, or route:

- **Deliverable** : what the task produces (proof-object, exploitability verdict, design plan,
  code artifact, environment end-state, dataset finding, integrated prose, deterministic transform).
- **Cognitive demand** : what type of reasoning the work requires.
- **Verification mode** : how correctness is checked: deductive validity · adversarial
  goal-achievement · constraint-satisfaction · compile/test · harness end-state · factoid score ·
  faithfulness/coherence · exact-match/rule-conformance.
- **Benchmark-findability** : whether real public benchmarks measure this tile with adequate spread.

Categories must be generic across agentic contexts. They classify task shapes, not execution
environments or provider capabilities.

### 3. MECE / tiling

The 14 categories + `fallback_default` must tile the task space:
- **Mutually exclusive**: each realistic prompt classifies into exactly one tile under the
  precedence chain and the per-pair discriminating signals.
- **Collectively exhaustive**: `fallback_default`@99 closes the set : no prompt is homeless.

A proposed tile that overlaps every other tile on its verification mode is a **modifier**, not a
tile. The governing principle: *object-distinct ⇒ tile; capability-orthogonal-to-object ⇒ modifier.*

### 4. Route-distinctness (decision-relevance, NOT model preference)

A proposed tile earns a slot only if the split changes which **competency** is selected under
provider-agnostic evaluation : i.e., the tile selects a meaningfully different competency on the
routing decision. Two tiles that are indistinguishable on this axis are merger candidates. The
test: *if a router could not see any provider names, would this split still change the ranking?*

This criterion is strictly about task-shape distinctness; it never names or implies a preferred
provider, model, or effort tier.

### 5. Gate-preservation as impartial modifiers

Existing routing gates (`G_MATH`, `G_SEC`, `G_COMMIT`, context gates, `G_DATA`, `G_SANDBOX`) are
**modifiers** : orthogonal to the tile, firing on top of the matched category. They encode impartial
policies (what must happen), never preferred routes (who does it).

A modifier is category-coupled (`G_MATH`↔`math_proof`, `G_SEC`↔`security_review`,
`G_COMMIT`↔`quality_review`) or cross-cutting; in neither case does it consume a tile slot or a
precedence rank. Gates must be restated as capability/handling requirements with no provider or
model names. Any gate that currently hard-codes a provider name is flagged for owner neutralization
before the taxonomy feeds impartial profiling.

### 6. Benchmark-findability

Each **parent** tile (precedence 1:10) must map to real, public benchmarks with adequate spread
(not all frontrunners at ≥95%). A parent tile with no measurable benchmark : or only proxy anchors
: is flagged as a weakness and marked first-to-be-displaced when a direct measure ships. The
**composite-inferred** tiles (11:14) are exempt by construction: they have no benchmark alias and
derive competency from their parents, so this criterion does not gate them.

Benchmarks measure categories; they never endorse a model. The canonical 41-source, Tier 1:5
source list is in `.spec/references/work-categories.md` section G and `references/benchmark-sources.md`.

Three structural exceptions are acknowledged (not carving errors : see `determination-rationale.md` section H):
- `architecture`: plan-validity core measurable; software-design-prose surface thin and proxy-leaning.
- `knowledge_synthesis`: no direct integrative-prose score; proxy via long-context + faithfulness families.
- `mechanical` (transform leaf): pure-deterministic-transform (rename/grep/format) is irreducibly proxy.

### 7. Homeless-case audit

Before ratification, every candidate set was subjected to a homeless-case audit: enumerate
high-volume real prompt shapes and verify each lands in exactly one tile. Any homeless shape
(no tile claims it at adequate confidence) is grounds for a new tile or a boundary revision.

The audit that produced the fixed taxonomy identified `data_analysis` as the single most-homeless
high-volume shape (previously smeared across `agentic_execution`, `knowledge_synthesis`, and
`coding`), which became the net-new tile in the final set.

---

## Canonical-source-list-for-stability principle

The benchmark source list is ordered: per-bench official leaderboard → independent aggregator →
vendor model cards (symmetric, all families read the same way) → arXiv/OpenReview → trackers.
Preference aggregators are for orientation only, never the capability number. The full list is in
`.spec/references/work-categories.md` section G.

Stability rule: held-out / contamination-resistant leaderboards take precedence over
community-edited sources. Vendor cards are read symmetrically : no vendor's self-report is taken
on its own without independent corroboration.
