# Category Rationale

Per-category rationale, benchmark families, and findability for the directly benchmarked parent
tiles (precedence 1:10). The 4 composite-inferred tiles (precedence 11:14) carry no benchmark family
and are covered in `composite-inferred-tiles.md`. For the determination process, disputes, old→new
mapping, and weaknesses, see `determination-rationale.md`. For operational definitions (signals,
examples, boundaries), see `.spec/references/work-categories.md`.

---

## Precedence chain

```
math_proof > security_review > debugging > quality_review > architecture >
agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical >
prompt_engineering > vulnerability_research > molecular_biology > ml_accelerator_design
```

Composite-inferred tiles 11:14 (`prompt_engineering`, `vulnerability_research`, `molecular_biology`,
`ml_accelerator_design`) extend the chain after `mechanical`; see `composite-inferred-tiles.md`.

`fallback_default` @ 99 : off-spine no-match catch-all; never one of the 14 spine tiles; never
overrides a gate.

---

## 1. `math_proof` : precedence 1

**Rationale.** Distinct verification mode (deductive/symbolic validity : a fluent-but-invalid
derivation is worse than none) shared by no other tile. The densest reasoning-benchmark family in
the field. Generic (pure math, formal methods, algorithm-correctness) but not vague (deliverable
is a proof-object).

**Benchmarks.** FrontierMath · miniF2F · PutnamBench · ProofNet · FIMO (proof-assistant-checked,
the tile's exact verification mode); MathArena (anti-contamination); AIME/HMMT/OlympiadBench/Omni-MATH.
**Findability: STRONG.**

## 2. `security_review` : precedence 2

**Rationale.** Flagship measured leg is object-distinct offensive exploitation verified by
adversarial goal-achievement : benchmark family disjoint from critic/review. Folding into
`quality_review` would average two competencies and blind the profiler to the security axis.
Dual treatment (category + `G_SEC` modifier) mirrors `math_proof`.

**Benchmarks.** Cybench · AIRTBench · NYU CTF Bench · 3CB (offensive/CTF, non-saturated);
CyberSecEval 1/2/3; SecCodePLT · SVEN · PrimeVul · DiverseVul (secure-coding/vuln-verdict leg).
**Findability: STRONG (offensive) / MODERATE (secure-code leg).**

## 3. `debugging` : precedence 3

**Rationale.** Observed-failure precondition is a sharp, decision-relevant signal: the
hypothesis→localize→repair competency is distinct from greenfield construction. Best-measured
shape in the set. Verification is reproduction-based (failing check goes green). Precedence raised
from 5 to 3 so an observed-failure prompt is never claimed by `quality_review` or `architecture`.

**Benchmarks.** SWE-bench Verified (shared with `coding`; discriminator = failure precondition);
SWT-bench; DebugBench; Defects4J · BugsInPy · QuixBugs (legacy).
**Findability: STRONG.**

## 4. `quality_review` : precedence 4

**Rationale.** Verdict-on-existing-candidate (no observed failure) is distinct from producing the
artifact or diagnosing a failure. Independence from the producer is the defining property. Hosts
the mandatory pre-commit contradiction-check gate (`G_COMMIT`).

**Benchmarks.** RewardBench / RewardBench 2 · JudgeBench · JudgeLM (verdict-vs-gold accuracy);
CriticBench · LLMBar · MT-Bench; CodeReviewBench/CRBench; HaluEval.
**Findability: STRONG.**

## 5. `architecture` : precedence 5

**Rationale.** Re-anchored from unmeasurable ADR-prose-quality framing to constraint-satisfying
plan-validity. Verification mode (constraint-satisfaction over a to-be-built design) is distinct
from synthesis's (faithfulness over existing sources). Retained over synthesis merger: applying
"proxy ⇒ kill" consistently would equally kill the `mechanical` floor : the exception must be
granted symmetrically.

**Benchmarks.** PlanBench · ACPBench/ACPBench-Hard (plan-validity, non-saturated on hard columns);
AutoPlanBench · TravelPlanner; NATURAL-PLAN (dated); SWE-bench-Pro/DevBench-codegen (proxy only).
**Findability: PROXY-leaning / MODERATE on plan core : WEAKEST tile, first-to-displace.**

## 6. `agentic_execution` : precedence 6

**Rationale.** Closed-loop env-mutating control (plan-while-acting, error recovery) is a distinct
competency verified by environment end-state. Kept as one narrowed tile : the candidate 3-way split
would manufacture two fuzzy internal seams (data and interactive children re-overlap on the
agentic-data-science case). Absorbs function-calling/BFCL as its single-step floor. MLE-bench
iterate-to-harness-submission stays here (scored by harness end-state).

**Benchmarks.** Terminal-Bench · τ-bench/τ²-bench · OSWorld · WebArena/VisualWebArena · GAIA
(live, non-saturated); BFCL (single-call floor, versioned); MLE-bench; AgentBench · Mind2Web · GDPval.
**Findability: STRONG (densest, most-current family).**

## 7. `data_analysis` : precedence 7 (net-new tile)

**Rationale.** Previously the single most-homeless high-volume shape : smeared across
`agentic_execution`, `knowledge_synthesis`, and `coding`. Quantitative/analytical reasoning over a
dataset selects a different competency than terminal-loop execution or bounded coding. Locked
boundary vs. `agentic_execution`: measured-target (dataset finding) ≠ execution-mechanism (env
end-state). MLE-bench (harness-scored) stays in `agentic_execution`; DABstep (factoid-scored
over a fixed dataset) stays here.

**Benchmarks.** Spider 2.0 · BIRD-SQL (text-to-SQL, enterprise-scale); DABstep (multi-step
analysis, factoid-scored); TableBench · WikiTableQuestions · FinQA/TAT-QA; DS-1000; InfiAgent-DABench.
**Findability: STRONG.**

## 8. `coding` : precedence 8

**Rationale.** Bounded design-decided construction is the highest-volume production catch and the
densest benchmark family. Definition kept tight (verifiable by compile/test, file-scoped) so the
`knowledge_synthesis` precedence demotion (7→9) does not cause "write/document"-keyword prose to
be mis-caught here.

**Benchmarks.** LiveCodeBench (time-windowed, contamination-free); BigCodeBench · Aider polyglot;
SWE-bench Verified (shared with `debugging`); MultiPL-E · CRUXEval · Mercury; HumanEval+/MBPP+/APPS (legacy).
**Findability: STRONG.**

## 9. `knowledge_synthesis` : precedence 9

**Rationale.** Novel-prose-over-sources is a distinct deliverable verified by faithfulness/coherence
(no test oracle). Sits near the precedence floor because it is the broadest reason-into-prose shape
and must be claimed only after every narrower object has missed. Also the floor for general
single-pass language generation (translation, summarization, drafting, creative writing).

**Benchmarks.** RULER · LongBench v2 · HELMET · InfiniteBench · NoCha (long-context substrate);
FActScore · FaithBench · RAGTruth · Vectara HHEM (faithfulness/grounding); FRAMES (multi-doc);
DeepResearch Bench; GPQA/HLE/MMLU-Pro (complex-reasoning proxy).
**Findability: MODERATE → PROXY-leaning (flagged soft).**

## 10. `mechanical` : precedence 10

**Rationale.** Zero-reasoning deterministic floor; verification is exact-match/schema-validation.
Absorbs deterministic single-pass extraction (measurable via structured-output benches). Function-
calling/BFCL relocated out to `agentic_execution`'s floor, so this tile reports a coherent
low-spread floor rather than a bimodal profile.

**Benchmarks.** StructEval · structured-output/JSON-mode evals · IFEval (extraction leg);
BFCL-AST (shared with `agentic_execution` floor : resolved by invocation-vs-transform axis).
Pure-transform leaf (rename/grep/format) is irreducibly proxy : no benchmark scores "rename this variable."
**Findability: MODERATE (extraction leg) / PROXY-ONLY (transform leaf : flagged floor exception).**
