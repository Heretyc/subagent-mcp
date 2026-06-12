# work-categories.md — Canonical Work-Category Taxonomy

**Load when:** classifying a prompt; verifying a category id; understanding signals, definitions, or
boundary cases. Categories and modifiers are defined PURELY by task shape — *deliverable · cognitive
demand · verification mode.* No provider, model, effort, or route is named or implied in this file.

---

## Precedence Order

```
math_proof > security_review > debugging > quality_review > architecture >
agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical >
prompt_engineering > vulnerability_research > molecular_biology > ml_accelerator_design
```

Tiles 1–10 are the directly benchmarked parent categories. Tiles 11–14 (`prompt_engineering`,
`vulnerability_research`, `molecular_biology`, `ml_accelerator_design`) are **composite-inferred**:
no benchmark alias, never directly benchmarked — competency inferred downstream from parent tiles
(see **Composite-Inferred Tiles** below). 14 categories total. Then `fallback_default` @ precedence
99 — off-spine; fires only when no tile reaches confidence; never overrides a hard gate; **not one of
the 14 spine tiles.**

First-match wins (most-specific-signal-first). On genuine adjacent-tier ambiguity, escalate one tier
up. Classification is a pure task-shape language task — no numeric thresholds enter it (context size
is a gate, not a category boundary).

---

## Category Cards

### `math_proof` — precedence 1 · alias `formal_reasoning_proof`

| Field | Content |
|---|---|
| **Definition** | Deliverable is a deductive/symbolic derivation, proof, or formally-checkable result; cognitive demand is rigorous step-validity under axioms/constraints, no empirical data or execution. Verification = deductive/symbolic validity (each step entailed) via a proof-checker or symbolic oracle — not tests, sources, or compile/run. |
| **Classify signals** | prove · derive · theorem · lemma · invariant · formal · counterexample · complexity/asymptotic bound · satisfiability · explicit mathematical notation · "show that…" where the proof *is* the deliverable |
| **Examples** | "Prove every finite integral domain is a field." · "Derive and prove the bound for T(n)=2T(n/2)+n." · "Show this loop invariant proves the sort terminates and is correct." |
| **Boundary / anti-example** | Cost arithmetic or applying a *known* formula inside code → `coding`/`mechanical`. Math embedded in a routine task does not reclassify unless the proof *is* the deliverable (host tile then carries the `G_MATH` modifier). Empirical/statistical *estimate* over data → `data_analysis`. |

### `security_review` — precedence 2 · alias `security_assessment`

| Field | Content |
|---|---|
| **Definition** | Deliverable is a security verdict, threat assessment, or a demonstrated exploit/defense against a target; cognitive demand is adversarial reasoning over attack surface and exploitability. Verification = adversarial goal-achievement (exploit fires / threat demonstrated or refuted) or an exploitability-checked verdict. Hosts the embedded `G_SEC` modifier for the touched-sensitive-surface leg. |
| **Classify signals** | vulnerability · exploitable · privilege escalation · auth/authz flow · crypto misuse · deserialization · secret handling · sandbox boundary · threat model · attack surface · CTF · CWE references · supply-chain/dependency risk |
| **Examples** | "Find privilege-escalation paths in this auth middleware." · "Is this contract exploitable via reentrancy? Demonstrate or refute." · "Threat-model this upload endpoint and rank the risks." |
| **Boundary / anti-example** | *Writing* the auth code → `coding` (then routes here for review). Routine correctness review with no security surface → `quality_review`. A concurrency/threading defect surfaced while debugging fires the `G_SEC` modifier without reclassifying the host. |

### `debugging` — precedence 3 · alias `failure_diagnosis_repair`

| Field | Content |
|---|---|
| **Definition** | Work is **preconditioned by an observed failure/symptom** (error, crash, wrong output, red test, regression, flake); deliverable is a verified fix or root-cause diagnosis. Cognitive demand = hypothesis-driven fault localization from evidence. Verification = the symptom is resolved / the previously-failing check now passes. |
| **Classify signals** | fix the bug · why does X fail · intermittent/flaky · regression · root cause · reproduce · stack trace · CI failure · segfault · timeout · "started failing after…" |
| **Examples** | "This test started failing after my commit — find and fix the cause." · "The app segfaults on large inputs; diagnose and patch." · "Users report 500s on checkout; find root cause from these logs." |
| **Boundary / anti-example** | Clean rewrite with no failure to diagnose → `coding`. Authoring *new* tests → `coding`/`mechanical`. Unprompted assessment with no observed failure → `quality_review`. Root cause spanning multiple subsystems → stays `debugging` **+ `architecture_complexity` modifier** (does not reclassify to architecture). |

### `quality_review` — precedence 4 · alias `artifact_evaluation`

| Field | Content |
|---|---|
| **Definition** | Deliverable is an evaluative verdict on an existing **non-security** candidate (code, text, design, answer) with **no observed failure** prompting it; cognitive demand = critical judgment against correctness/quality/spec criteria, independent of the producer. Verification = candidate-vs-criteria/reference judgment. Hosts the `G_COMMIT` pre-finalize contradiction/regression gate. |
| **Classify signals** | review this diff/PR · is this correct · compare A vs B · tie-break · contradiction check · validate against spec · grade/rubric-score · which is right · before commit · acceptance review |
| **Examples** | "Review this 800-line PR for correctness & maintainability (tests are green)." · "Grade these three answers against the rubric and pick the best." · "Critique this API design for consistency before we ship." |
| **Boundary / anti-example** | Security-sensitive candidate (auth/crypto/concurrency surface) → `security_review`. An *observed failure* present → `debugging`. *Producing* the artifact → `coding`/`architecture`. Self-review (same agent that produced the artifact) is forbidden. A deterministic question code can answer → `mechanical`. |

### `architecture` — precedence 5 · (no benchmark-legible alias — the proxy-exception; absence is the honest signal)

| Field | Content |
|---|---|
| **Definition** | Deliverable is a cross-module design or plan — system structure, interface/contract decisions, migration strategy — with **no code artifact and no execution loop**; cognitive demand = integrating many interacting constraints into a coherent structure whose consequences cascade. Verification = plan-validity / constraint-satisfaction, judged by downstream cascade, not a compile/test oracle. |
| **Classify signals** | design · architecture · decompose into tasks/subtasks · interface/contract change · migrate/migration strategy · orchestrate · tradeoff design · >2 files or public API affected · capacity/scaling design · build-sequencing plan · ADR/RFC where the scored object is the plan's validity |
| **Examples** | "Design the service boundaries to split this monolith — plan only, no code." · "Propose a REST→event-driven migration preserving these 5 invariants." · "Lay out the module/interface structure for a plugin system meeting these constraints." |
| **Boundary / anti-example** | Single-file/single-module cleanup → `coding`/`mechanical`. Bounded implementation of an *already-chosen* design → `coding`. Choosing between two *already-produced* designs → `quality_review`. A cross-module *implementation* task carries the `architecture_complexity` modifier without becoming `architecture`. |

### `agentic_execution` — precedence 6 · alias `interactive_tool_execution`

| Field | Content |
|---|---|
| **Definition** | Deliverable is a **target end-state reached by iterating in a mutating environment** — select/invoke tools, act, observe, adapt in a closed loop; cognitive demand = plan-while-acting with tool selection and error recovery. Verification = harness end-state / task success, not a static artifact. **Single tool/function-call accuracy is this tile's floor; long multi-step loops its ceiling.** |
| **Classify signals** | run · execute · in the sandbox · iterate until tests pass · tool/function call · provision · deploy · browse/navigate · terminal-heavy pipeline · multi-step workflow to a target · autonomous ML-engineering / iterate-to-a-submission |
| **Examples** | "Provision staging, run migrations, deploy, confirm the health check is green." · "Use the browser to book the cheapest flight matching these constraints." · "Given these tools, complete the multi-step ticket end-to-end." |
| **Boundary / anti-example** | One-shot edit with no run-observe loop → `coding`. Deciding migration *strategy* (no acting) → `architecture`. Output is a math proof → `math_proof`. Finding about a fixed dataset (even if code executes) → `data_analysis` (iterate-to-submission stays here; finding-scored stays `data_analysis`). A pure deterministic transform with no invocation → `mechanical`. |

### `data_analysis` — precedence 7 · alias `data_analysis_query` · **NET-NEW TILE**

| Field | Content |
|---|---|
| **Definition** | Object of work is a **structured dataset**; deliverable is an empirical finding or analytical model **about that data** (a correctness-scored answer, statistic, or model) — even if code is executed to obtain it. Cognitive demand = quantitative/analytical reasoning over data. Verification = correctness of the finding about the dataset, distinct from reaching an environment end-state. |
| **Classify signals** | query/SQL/dataframe for an answer · table reasoning · statistical/exploratory analysis · compute a metric · fit/evaluate a model and report drivers · trend/feature extraction as insight · "from this dataset/table/log, what…" |
| **Examples** | "From this sales table, which regions grew over 20% QoQ?" · "Fit a churn model on this dataset and report the top drivers." · "Compute the 95th-percentile latency by endpoint from this log table." |
| **Boundary / anti-example** | Iterate-to-optimize-a-harness-submission → `agentic_execution`. Building a *reusable* data app/library → `coding`. Deterministic read/aggregate/lookup with no reasoning → `mechanical`. Deductive proof/derivation → `math_proof`. Prose synthesis over unstructured sources → `knowledge_synthesis`. |

### `coding` — precedence 8 · alias `code_implementation`

| Field | Content |
|---|---|
| **Definition** | Deliverable is a **bounded, runnable code artifact** authored largely in one pass — function, module, feature, script — where the work is the implementation itself (not preconditioned by a failure, not a cross-module design, not an environment loop). Cognitive demand = design-in-the-small + correct implementation. Verification = compiles / passes its tests / meets the spec (diff + compile/test/lint). |
| **Classify signals** | implement · add a function/endpoint/flag · write code that… · wire up · make the test pass · refactor (single-module) · write tests · optimize (bounded target + measurable goal) · port/translate code (bounded unit) · write docs/docstring/README for a known target |
| **Examples** | "Implement a token-bucket rate-limiter middleware with unit tests." · "Write a parser for this config grammar." · "Port this Python module to TypeScript, preserving behavior." |
| **Boundary / anti-example** | "Redesign the auth layer" → `architecture` then `security_review`. "Why does this crash intermittently?" → `debugging`. Grep-style "find every place X is read" → `mechanical`. Pure CRUD from a clear template → `mechanical`. Change crosses module boundaries/public API → `architecture`. Write-code-to-analyze-a-dataset (finding is the deliverable) → `data_analysis`. Reasoned multi-source prose → `knowledge_synthesis`. |

### `knowledge_synthesis` — precedence 9 · alias `complex_reasoning_synthesis`

| Field | Content |
|---|---|
| **Definition** | Deliverable is **novel integrated prose** produced over text/sources — synthesis, explanation, summary, translation, or generative writing — verified by **faithfulness/coherence**, not exact-match or a test oracle. Cognitive demand = integrating, reconciling, re-expressing information (often large or conflicting). **Also the floor for general single-pass language generation** (summarize, rewrite, translate, draft) whose criterion is adequacy/faithfulness. |
| **Classify signals** | synthesize · research · compare sources · across N papers/sources · policy/legal/financial judgment · gray area · weigh tradeoffs (open-ended) · explain how this works (across multiple files/modules) · summarize · translate · draft/write (prose) · open-ended QA needing an integrated explanation |
| **Examples** | "Synthesize these 40 papers into a literature review noting disagreements." · "Summarize this 200-page filing and flag contradictions with last year's." · "Translate and adapt this manual section for an English audience." |
| **Boundary / anti-example** | Deterministic structured extraction from a known schema → `mechanical`. Tie-breaking two finished outputs / a verdict → `quality_review`. Structured-dataset quantitative finding → `data_analysis`. A runnable code artifact → `coding`. Single-symbol or single-file explanation (no cross-file reasoning) → `mechanical`/`coding`. |

### `mechanical` — precedence 10 · alias `deterministic_leaf_and_extraction`

| Field | Content |
|---|---|
| **Definition** | Deliverable is the output of a **deterministic single-pass transform or leaf operation** whose correctness is checkable by **exact-match or an unambiguous rule** — no substantive reasoning, no environment invocation. Cognitive demand = minimal. Verification = exact-match / rule-conformance. **Absorbs single-pass schema-bound or cited extraction** (structured-output filling) as its measurable upper edge. |
| **Classify signals** | find · list · grep · where is · trace imports · rename · reformat/lint-fix · format-convert (CSV↔JSON, unit convert) · classify into N fixed labels · scaffold from a template · single-fact retrieval · extract to a fixed schema |
| **Examples** | "Convert this CSV to JSON and rename field 'amt' to 'amount'." · "Extract every email and phone number into this JSON schema." · "Rename all occurrences of getUserData to fetchUser across these files." |
| **Boundary / anti-example** | Extraction/disambiguation needing *substantive reasoning* → `coding` (reusable parser) or `data_analysis` (analytical disambiguation). Tool/function invocation (even a single call) → `agentic_execution` (its floor). Classification with many *ambiguous* categories needing nuance → `coding`/`knowledge_synthesis`. Map step of a map-reduce → `mechanical`; the reduce step → `knowledge_synthesis`. |

---

## Composite-Inferred Tiles

Tiles 11–14 carry **no benchmark alias** and are **never directly benchmarked** — no public benchmark
scores the whole shape. Routing competency is **inferred downstream** as a simple-mean of the parent
tiles each card's Definition names (see `docs/spec/task-taxonomy/composite-inferred-tiles.md`). They
still classify by signal, first-match after `mechanical`; a profiler never assigns them a direct score.

### `prompt_engineering` — precedence 11 · composite-inferred (no benchmark alias)

| Field | Content |
|---|---|
| **Definition** | Deliverable is a designed or optimized prompt, prompt-template, or prompt-system that steers an LLM/agent — authoring, refining, or systematically evaluating the instructions themselves. Composite shape: prose-craft (`knowledge_synthesis`) + template/scaffold construction (`coding`) + candidate-vs-criteria evaluation (`quality_review`). No dedicated benchmark; competency inferred from those parents. |
| **Classify signals** | prompt · system prompt · few-shot exemplars · chain-of-thought scaffold · prompt template · instruction phrasing · "optimize this prompt" · prompt eval / rubric for prompt outputs · reduce hallucinated fields via instructions · steer the model to… |
| **Examples** | "Design a system prompt that makes the agent self-classify task type reliably." · "Rewrite this extraction prompt to cut hallucinated fields." · "Build a rubric to compare three prompt variants and pick the best." |
| **Boundary / anti-example** | Producing the downstream artifact the prompt *asks for* → that artifact's tile. Plain prose with no model-steering intent → `knowledge_synthesis`. Building a reusable code library/framework around prompts → `coding`. Judging two finished non-prompt outputs → `quality_review`. |

### `vulnerability_research` — precedence 12 · composite-inferred (no benchmark alias)

| Field | Content |
|---|---|
| **Definition** | Deliverable is the discovery and characterization of a **novel** vulnerability in a target — locating an exploitable flaw, root-causing it, and often building a proof-of-concept. Composite shape: adversarial attack-surface reasoning (`security_review`) + failure localization (`debugging`) + exploit/PoC construction (`coding`). No dedicated benchmark; competency inferred from those parents. |
| **Classify signals** | find a vulnerability · fuzzing campaign · triage crashes for exploitability · reverse-engineer for bugs · memory-corruption primitive · write a PoC exploit · 0-day / vuln discovery · root-cause an exploitable crash |
| **Examples** | "Fuzz this parser, triage the crashes, and identify which are exploitable." · "Reverse this binary and find a memory-corruption primitive." · "Find and PoC an auth-bypass in this service." |
| **Boundary / anti-example** | Verdict/threat-model on a *given* surface with no novel-bug discovery → `security_review`. Fixing a *known* failing test/symptom → `debugging`. Authoring a feature with no adversarial discovery → `coding`. |

### `molecular_biology` — precedence 13 · composite-inferred (no benchmark alias)

| Field | Content |
|---|---|
| **Definition** | Deliverable is a reasoned result in molecular / computational biology — interpreting sequences, structures, pathways, or experimental data. Composite shape: literature/mechanism synthesis (`knowledge_synthesis`) + quantitative analysis over biological datasets (`data_analysis`) + formal/quantitative derivation (`math_proof`). No dedicated benchmark; competency inferred from those parents. |
| **Classify signals** | gene/protein sequence · pathway/mechanism · assay · structure or folding prediction · -omics dataset (RNA-seq, proteomics) · binding/affinity reasoning · experimental-design rationale · bioinformatics pipeline result |
| **Examples** | "Interpret this RNA-seq table and propose the upregulated pathways." · "Explain the likely folding impact of this point mutation." · "Design and justify a primer set for this target region." |
| **Boundary / anti-example** | Generic statistics over a *non-biological* dataset → `data_analysis`. Pure literature summary with no biological data or derivation → `knowledge_synthesis`. A formal proof with no biological object → `math_proof`. |

### `ml_accelerator_design` — precedence 14 · composite-inferred (no benchmark alias)

| Field | Content |
|---|---|
| **Definition** | Deliverable is a hardware/software design for ML acceleration — dataflow, memory hierarchy, kernel, or compiler-mapping decisions for an accelerator. Composite shape: system-structure design (`architecture`) + kernel/codegen implementation (`coding`) + quantitative/asymptotic modeling (`math_proof`). No dedicated benchmark; competency inferred from those parents. |
| **Classify signals** | systolic array · dataflow / tiling / scheduling · roofline model · kernel fusion · SRAM/HBM memory hierarchy · GEMM mapping · compiler lowering for an accelerator · utilization / TFLOP modeling |
| **Examples** | "Design the dataflow and tiling for a matmul on this systolic array." · "Model the roofline and pick a fusion strategy for this transformer block." · "Write and analyze a tiled GEMM kernel for this memory hierarchy." |
| **Boundary / anti-example** | Generic cross-module software design with no accelerator object → `architecture`. A bounded kernel implementing an *already-chosen* design → `coding`. A pure asymptotic proof with no hardware object → `math_proof`. |

### `fallback_default` — precedence 99 (no match)

| Field | Content |
|---|---|
| **Definition** | Under-specified, mixed-beyond-resolution, or unsupported prompts where no category's signals match with confidence. |
| **Classify signals** | No category reaches confidence · absent/invalid category hint · tied signals that don't resolve. **"Reaches confidence" = a single dominant signal-keyword family matches; if none clearly matches (or two adjacent tiers tie without resolution), emit `fallback_default`.** |
| **Route note** | Read-only. Ask the orchestrator for a narrower category if any write/side-effect is implied. If a hard gate applies, do not fall back — route or halt per the gate. |

## Cross-Cutting Modifiers

Modifiers are orthogonal to object-of-work: no tile slot or precedence rank — they fire *on top of* the
matched tile as impartial policy (a required step, eligibility-class restriction, or re-rank). None
names a model, provider, effort, or route.

| Modifier | Trigger | Policy it imposes (impartial) |
|---|---|---|
| `perception_required` | Input includes non-text (image, screenshot, chart, scan, GUI, diagram, audio/video frame). | Eligibility-restrict to perception-capable members; re-rank by perception/OCR/layout competency (re-orders members independently of text skill). **This is where multimodal lives.** |
| `architecture_complexity` | An implementation/host task carries cross-module/interface/API cascade (architectural blast radius). | Require a plan-before-build step **+** an independent cross-review of the plan. |
| `context_size` | Input materially exceeds an ordinary-context threshold (very large corpus/codebase/document set). | Eligibility-restrict to members whose context window suffices; require chunk-and-synthesize above each threshold; forbid any single-route call above the maximum. |
| `output_size` | Estimated output exceeds the standard output cap. | Eligibility-restrict to the member(s) offering the extended output ceiling. (Gate `G_CTX_OUT`.) |
| `long_horizon` | Task needs many sequential steps/iterations (high step-count / extended trajectory). | Require decomposition into checkpoints **+** intermediate progress verification (guards mid-trajectory drift). |
| `data_sensitivity` | Task handles regulated/personal/confidential data (PII, PHI, secrets, contractual-confidential). | Classify before routing; minimize/redact; no-exfiltration; eligibility-restrict to members meeting the required handling class; halt unless an approved boundary exists. (Gate `G_DATA`; **distinct from `G_SEC`** — privacy/compliance *handling*, not adversarial threat.) |
| `execution_sandbox` | A member executes via a local harness. | Default to a write-restricted workspace sandbox; full-access/approval-bypass only inside an externally hardened, disposable, secret-free runner; halt on any sandbox-bypass ambiguity. (Gate `G_SANDBOX`.) |

Category-coupled gate-modifiers `G_MATH` (→ `math_proof`), `G_SEC` (→ `security_review`), `G_COMMIT`
(→ `quality_review`) are hosted by their respective tiles.

**Considered and NOT minted (fail-loud):** latency/cost-sensitivity (route/effort — out of an
impartial taxonomy's scope); language/locale (eligibility nuance, too fine to be first-class);
determinism-required (already captured by `mechanical`'s exact-match verification).

---

Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026
