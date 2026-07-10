# Determination Rationale

Provenance of the directly benchmarked parent set (precedence 1:10): generation process, resolved
disputes, old→new mapping, and honest weaknesses. Per-category rationale and benchmarks are in
`category-rationale.md`. The 4 composite-inferred tiles (precedence 11:14) were added on top of this
parent set by a later owner-approved extension; their parent-map rationale lives in
`composite-inferred-tiles.md`, not here.

---

## Generation process

**Two candidate taxonomies** were generated independently under a Claude lens and a Codex lens.
Both embedded provider/model/effort fields inside category cards; all three reviewers discarded
those fields as noise under the binding impartiality rule and extracted only task-shape structure
(deliverable · cognitive demand · verification mode · benchmark-findability).

**Three-reviewer, 4-round adversarial debate.** Reviewer lenses:
- R1 : coverage-maximalist (bias toward tile diversity; initially proposed multimodal as a tile).
- R2 : benchmark-empiricist (bias toward measurable tiles; challenged architecture; proposed
  structured-extraction as a standalone tile and a 3-way agentic split).
- R3 : MECE/routing purist (bias toward minimal seams; provided the decisive argument in the
  agentic dispute; enforced the object-distinct/capability-orthogonal governing principle).

Mixed-provider validation sub-agents (max 2 per reviewer per round) confirmed external facts :
benchmark currency, the PlanBench plan-validity anchor, and the MLE-bench/DABstep boundary : without
endorsing any model.

**Unanimous 3-0 ratification** across all 5 disputes by round 4. A separate consensus-synthesizer
(not one of the 3 reviewers; self-review ban observed) produced the canonical document.

---

## The 5 resolved disputes

### 1. Security : category vs. modifier
*Resolved: category + `G_SEC` modifier, 3-0 (r1: 2-1 → r3: 3-0).*

R1 initially argued security is a modifier. Winning argument (R2/R3): the flagship measured leg is
**object-distinct offensive exploitation** verified by adversarial goal-achievement, with a benchmark
family disjoint from the critic/review family (Cybench/AIRTBench vs. RewardBench/JudgeBench).
Folding into `quality_review` would average two competencies and blind the profiler to the security
axis. Dual treatment (category + embedded-leg modifier) mirrors `math_proof`, removing the asymmetry
R3 initially flagged.

### 2. Multimodal : tile vs. modifier
*Resolved: `perception_required` modifier, not a tile, 3-0 (r1: 1-2 → r3: 3-0).*

R1 proposed a multimodal tile, citing real within-VLM rank-inversions. Winning argument (R2/R3):
modality is a cross-cutting **input property** with no distinct verification mode : a chart answer
verifies empirically (data's mode); a doc-summary verifies by faithfulness (synthesis's mode). A
tile would be internally non-MECE, overlapping every other tile. Governing principle:
*object-distinct ⇒ tile; capability-orthogonal-to-object ⇒ modifier.*

### 3. Architecture : keep vs. merge into synthesis
*Resolved: keep, redefined to plan-validity core + `architecture_complexity` modifier, 3-0 (r1: 2-1 → r3: 3-0).*

R2 argued architecture lacks direct benchmarks ("proxy ⇒ kill"). Winning argument (R1/R3):
"proxy ⇒ kill" over-applies : it would equally kill the `mechanical` floor, which R2 retains;
consistency forbids the floor exception without the ceiling exception. Re-anchored to
**constraint-satisfying plan-validity** (PlanBench/ACPBench, non-saturated on hard columns); this
verification mode (constraint-satisfaction over a to-be-built design) is distinct from synthesis's
(faithfulness over existing sources). Merging would place two verification modes in one tile.

### 4. Structured extraction : standalone tile vs. fold into mechanical
*Resolved: fold into `mechanical`, 3-0 (r2 proposed split; r1+r3: fold; r2 concedes by round 3).*

R2 proposed a standalone `structured_extraction` tile. Winning argument (R1/R3): extraction↔mechanical
doesn't change the routing decision (both select cheapest-capable tier); folding makes
structured-output benchmark coverage ride with the tile. R3's refinement: function-calling/BFCL
is relocated to `agentic_execution`'s floor (not kept here), so `mechanical` reports a coherent
low-spread floor rather than a bimodal profile.

### 5. Agentic : 3-way split vs. narrowed whole
*Resolved: narrowed whole, 3-0 (r2 proposed split; r1+r3: whole; r2 concedes by round 3).*

R2 proposed splitting `agentic_execution` into interactive/data/extraction tiles. Winning argument
(R3): R2's knife was inconsistent : it split agentic on "different benchmark family ⇒ split" while
merging architecture on "shared verification mode ⇒ merge." The split also relocates the seam
rather than resolving it: flagship data benches (DABstep/MLE-bench) are themselves agentic
harnesses, so the data and interactive children re-overlap on the agentic-data-science case.
One env-mutation-loop signal resolves classification; the split manufactures two fuzzy internal seams.

---

## Old → new mapping (orphan-free)

| Old id | Disposition | New id(s) |
|---|---|---|
| `math_proof` | kept | `math_proof` (+`G_MATH`) |
| `security_review` | kept | `security_review` (+`G_SEC`) |
| `architecture` | kept, redefined/narrowed | `architecture` (+`architecture_complexity` modifier) |
| `quality_review` | kept | `quality_review` (hosts `G_COMMIT`) |
| `debugging` | kept, precedence raised (5→3) | `debugging` |
| `agentic_execution` | kept, narrowed | `agentic_execution` (primary) + `data_analysis` (analytical-finding leg) + `mechanical` (deterministic-extraction leg) |
| `knowledge_synthesis` | kept, boundary-tightened, precedence lowered (7→9) | `knowledge_synthesis` |
| `coding` | kept, boundary-tightened | `coding` |
| `mechanical` | kept, absorbs deterministic single-pass extraction | `mechanical` |
| `fallback_default` | kept | `fallback_default` @99 |

Net-new tile `data_analysis`: carved from the homeless analytical-finding leg of `agentic_execution`
(primary source), with boundary intake from `coding` (write-code-to-analyze-a-dataset) and
`knowledge_synthesis` (quantitative-finding-over-structured-data). The deterministic sub-leg went
to `mechanical`; the iterate-to-harness-submission leg (MLE-bench) stayed in `agentic_execution`.
`perception_required` = modifier home for multimodal candidate (never a shipped category). **Orphans: 0.**

---

## Honest weaknesses

Two proxy-soft tiles + one partial-proxy tile : structural exceptions, not carving errors.

1. **`architecture` : weakest findability.** Plan-validity core measurable (PlanBench/ACPBench,
   non-saturated on hard columns); direct anchors are abstract-domain capability-proxies
   (Blocksworld/trip-planning), not software-design-quality; easy PlanBench column is saturating.
   **Marked first-to-displace** when a direct design-quality benchmark ships.

2. **`knowledge_synthesis` : soft/proxy-leaning.** No direct integrative-prose score; measured
   via long-context substrate + faithfulness + multi-doc proxies. Second-softest tile.

3. **`mechanical` : extraction-leg moderate / transform-leaf proxy-only.** Schema-bound extraction
   is measurable (StructEval/IFEval); pure-transform leaf (rename/grep/format) is irreducibly
   proxy : no benchmark scores "rename this variable." Explicitly flagged floor exception.

4. **`security_review` : split legs.** Offensive/CTF leg strong (Cybench/AIRTBench, non-saturated);
   secure-code-gen + vuln-verdict leg moderate-to-thin : exactly the leg `G_SEC` covers, making
   dual treatment (category + modifier) the correct structure.

**Shared anchors recorded:** `debugging` and `coding` share SWE-bench Verified (discriminator =
observed-failure precondition). `mechanical` extraction and `agentic_execution` floor both touch
BFCL (resolved by invocation-vs-transform axis). Both noted, not hidden.
