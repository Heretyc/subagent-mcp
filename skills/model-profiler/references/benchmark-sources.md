# benchmark-sources.md — Canonical Benchmark Source List (check FIRST, run-to-run stability)

**Load when:** any Phase 1 agent is about to gather benchmark scores. Check this list **first** so
profiling stays reasonably stable between runs; only go beyond it for genuinely new entrants, and let
the emission step harvest any new source into `research-seed-sites.json` (the learned seed registry).
New sources are recorded in `src/routing-table-audit.json` `citations[]`; they are NOT written to any
`.spec` ledger.

This file (`benchmark-sources.md`, in the skill) is the **CURATED** seed — stable, hand-maintained.
`research-seed-sites.json` (repo root) is the **LEARNED/accumulating** seed, grown from each run's audit
citations. Phase-1 agents read **BOTH**: the curated list here plus the learned registry (if present).

**Provider-impartial by construction.** Vendor sources appear as a **symmetric set**; the profiler
reads every candidate's card under the *same* benchmark + same eval config, and never lets a
self-reported best-config number stand without independent corroboration. Benchmarks **measure** the
fixed categories; they NEVER endorse a model.

**Ordered check protocol (apply per category):** (1) per-bench official leaderboard (Tier 3) →
(2) independent / contamination-resistant aggregator to corroborate (Tier 2) → (3) each vendor's
model card for the specific self-reported number + config, read symmetrically (Tier 1) →
(4) arXiv / OpenReview for the bench's definition, currency, and new entrants (Tier 4) →
(5) preference aggregators for orientation only (Tier 5). Prefer held-out / windowed leaderboards for
the *live* number. **Rule:** never rank on vendor cards alone — they are the self-claim, corroborated
at Tier 2/3.

**Source count: 41 distinct sources/venues** (5 Tier-1 vendor families · 7 Tier-2 hubs · ~20 Tier-3
official boards across 10 category rows · 6 Tier-4 venues · 3 Tier-5 trackers).

---

## Per-category benchmark-family map (onto the FIXED 10)

Key each score to the category it is most diagnostic of. `findability` flags how directly the
category is measured (strong / moderate / proxy).

| Category (precedence) | Benchmark families | Findability |
|---|---|---|
| `math_proof` (1) | FrontierMath · miniF2F · PutnamBench · ProofNet · FIMO · MathArena · AIME/HMMT/OlympiadBench/Omni-MATH | strong |
| `security_review` (2) | Cybench · AIRTBench · NYU CTF Bench · 3CB · CyberSecEval 1/2/3 · SecCodePLT · PrimeVul · DiverseVul | strong (offensive) / moderate (verdict+secure-code) |
| `debugging` (3) | SWE-bench Verified · SWT-bench · SWE-bench Lite/Multimodal/Pro · DebugBench · Defects4J · BugsInPy · QuixBugs | strong |
| `quality_review` (4) | RewardBench · RewardBench 2 · JudgeBench · JudgeLM · CriticBench · LLMBar · MT-Bench · CodeReviewBench/CRBench · HaluEval | strong |
| `architecture` (5) | PlanBench · ACPBench/ACPBench-Hard · AutoPlanBench · TravelPlanner · NATURAL-PLAN · DevBench design-doc track · SWE-bench-Pro (proxy) | proxy (WEAKEST tile) |
| `agentic_execution` (6) | Terminal-Bench · tau-bench/tau2-bench · OSWorld · WebArena/VisualWebArena · GAIA · BFCL · MLE-bench · AgentBench · Mind2Web · GDPval | strong |
| `data_analysis` (7) | Spider 2.0 · BIRD-SQL · DABstep · TableBench · WikiTableQuestions · FinQA/TAT-QA · DS-1000 · InfiAgent-DABench | strong |
| `coding` (8) | LiveCodeBench · BigCodeBench · Aider polyglot · SWE-bench Verified · MultiPL-E · CRUXEval · HumanEval+/MBPP+ (legacy) | strong |
| `knowledge_synthesis` (9) | RULER · LongBench v2 · HELMET · InfiniteBench · NoCha · FActScore · FaithBench · RAGTruth · FRAMES · DeepResearch Bench · GPQA/HLE/MMLU-Pro (proxy) | moderate / proxy-leaning |
| `mechanical` (10) | StructEval · structured-output/JSON-mode evals · IFEval · BFCL-AST (shared w/ agentic floor) | moderate (extraction) / proxy (transform leaf) |

**Shared anchors (record, don't hide):** `debugging` and `coding` share SWE-bench Verified
(discriminator = observed-failure precondition); `mechanical`'s extraction leg and
`agentic_execution`'s floor both touch BFCL (resolved by the invocation-vs-transform axis). The
`perception_required` modifier draws on a multimodal family (MMMU/MMMU-Pro · ScreenSpot-Pro · CharXiv
· OCRBench · MathVista · Video-MME · BLINK) — a modifier re-rank input, not a category.

**Polarity (record when non-obvious):** a benchmark's direction may be stated explicitly per row via an optional `polarity` field (`higher_is_better` / `lower_is_better`); absent that, the builder infers it from the benchmark name (defaulting to higher-is-better) and records any name-inferred assumption in the audit's `polarity_inference_warnings`.

---

## Tier 1 — Official vendor model cards & docs (self-reported; symmetric; corroborate before trusting)

| Source | Authoritative for | Stability note |
|---|---|---|
| docs.anthropic.com · anthropic.com/news (system/model cards, RSP cyber evals) | that vendor's self-reported scores, methodology, safety/cyber evals | self-reported, best-config; upper-bound claims |
| openai.com (system cards, Preparedness evals) · platform.openai.com/docs | that vendor's self-reported scores + preparedness/cyber evals | same caveat |
| deepmind.google · ai.google.dev (Gemini tech reports, model cards, Frontier Safety) | that vendor's self-reported scores + frontier-safety evals | same caveat |
| ai.meta.com · llama.com (model cards; Purple Llama / CyberSecEval) | that vendor's scores + the CyberSecEval security suite | same caveat |
| docs.mistral.ai · x.ai/docs · DeepSeek & Qwen tech reports · Microsoft (Phi) cards | respective vendors' self-reported scores | read symmetrically |

## Tier 2 — Independent live leaderboards & standardized eval hubs (impartiality backbone)

| Source | Authoritative for | Stability note |
|---|---|---|
| paperswithcode.com/sota | locating current SOTA + the holding paper per bench | community-edited, can lag — index, then verify primary |
| crfm.stanford.edu/helm (HELM) | standardized, reproducible multi-metric eval | very stable methodology; model coverage lags latest |
| epoch.ai / epoch.ai/benchmarks | FrontierMath + independent re-runs | rigorous, current |
| scale.com/leaderboard (Scale SEAL, held-out) | contamination-resistant private-set rankings | held-out; best for a live capability number |
| artificialanalysis.ai | cross-model aggregate index + price/latency | live per-release; composite — interpret composition |
| lmarena.ai (Chatbot Arena Elo) | open-ended human-preference ranking | live; style/volume effects; orientation only |
| huggingface.co (datasets + per-task leaderboard spaces; OpenCompass) | hosting datasets + community leaderboards | Open LLM Leaderboard v2 archived — check freshness per space |

## Tier 3 — Per-benchmark official leaderboards (primary sources, by category)

| Category | Primary leaderboards (domain) | Stability note |
|---|---|---|
| coding | swebench.com · livecodebench.github.io · bigcode-bench.github.io · aider.chat/docs/leaderboards | report SWE-bench split + LiveCodeBench window |
| debugging | swebench.com (Verified) · DebugBench repo | shares SWE-bench with coding |
| agentic | tbench.ai · tau-bench repo (Sierra) · os-world.github.io · webarena.dev · HF GAIA · gorilla.cs.berkeley.edu (BFCL) | live; BFCL versioned |
| math | epoch.ai (FrontierMath) · matharena.ai · miniF2F/PutnamBench repos | live, anti-contamination (MathArena) |
| reasoning/knowledge | github idavidrein/gpqa · lastexam.ai (HLE) · HF MMLU-Pro · FRAMES | live |
| security | cybench.github.io · AIRTBench repo · NYU CTF Bench · Purple Llama/CyberSecEval | offensive leg non-saturated |
| data | spider2-sql.github.io · bird-bench.github.io · HF DABstep · DS-1000 repo | live |
| architecture/planning | PlanBench repo · ACPBench (IBM) · NATURAL-PLAN (Google) · TravelPlanner | PlanBench live; NATURAL-PLAN dated |
| multimodal (modifier) | mmmu-benchmark.github.io · ScreenSpot-Pro repo · CharXiv · OCRBench · MathVista · video-mme.github.io · BLINK | MMMU-Pro/ScreenSpot-Pro non-saturated |
| long-context | RULER (NVIDIA) · LongBench v2 (THUDM) · HELMET · InfiniteBench | live |

## Tier 4 — Publication venues (new / unindexed benches + tech reports)

| Source | Authoritative for | Stability note |
|---|---|---|
| arxiv.org (cs.CL/AI/LG/SE/CR) | new benchmark papers + model tech reports | preprint; check version — results get revised |
| openreview.net | peer-reviewed venue submissions (NeurIPS/ICLR D&B) | more stable; scores frozen at publication |
| aclanthology.org · NeurIPS D&B · ICML/ICLR · ICAPS (planning) · USENIX Security/IEEE S&P/CCS (security) | peer-reviewed bench definitions + methodology | stable methodology; cross-check a live board for current scores |

## Tier 5 — Trackers / orientation only (never the capability number)

| Source | Authoritative for | Stability note |
|---|---|---|
| Stanford HAI AI Index · llm-stats.com · vendor release-note blogs | landscape orientation, context-window/pricing trackers | resolve to a Tier 1–3 primary before using any figure |

---

*Provenance: derived from the ratified task-shape taxonomy consensus (§G canonical source list) +
the per-category benchmark families. Provider-impartial; symmetric vendor set; no model endorsed.*
