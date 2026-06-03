## 10. SEED CORPUS STATUS (Interview Q8 — hypothesis only; docs/benchmarks override)

| [SEED] claim (Blackburn 2026) | Status vs docs/benchmarks | Routed to |
|---|---|---|
| Opus = planning/architecture/synthesis/nuance | **Corroborated** (GDPval-AA 1890; Super-Agent; ARC-AGI-2 gap; +144 Elo Opus 4.6 vs GPT-5.2) | `architecture`, `knowledge_synthesis` |
| Sonnet = balanced debug/review/reasoning | **Corroborated** (79.6% SWE-bench; ~70% dev preference for daily coding) | `coding`, `debugging` |
| Haiku = fast coding/file ops | **Corroborated** (73.3% SWE-bench; Claude Code auto-routes leaf work) | `mechanical` |
| GPT-5.5 = closed-loop/extraction/proofs/terminal | **Corroborated** (Terminal-Bench ~82–83%; ~40% fewer tokens; 20-hr task) | `agentic_execution`, `math_proof`, `coding` (closed-loop) |
| GPT-5.5 = confident hallucination + security bugs | **Corroborated** (CWE-732 misses; hallucinated `pathlib` arg; AISI cyber eval; Sonar/Endor) | G_SEC |
| Opus = caution/stall + verbosity | **Corroborated** (official low-effort "scopes to what was asked" implies prior over-extension; twinstrata) | Pattern 4b |
| +5 other-provider slots; separable/domain-split; no duplicate tasks | **Adopted** as fan-out capacity model (≤4–5 workers + 1 coordinator; Patterns 2/6) | Anti-Pattern A |
| Opus 4.8 ≫ 4.7 on ALL tasks | **OVERRIDDEN** → task-split: leads on agentic/long-horizon, ~equal on isolated coding (Interview Q2) | §5 framing |
| Haiku for ALL coding | **OVERRIDDEN** → Haiku is `mechanical`-only; multi-file/semantic coding is Sonnet/Codex | §1.9 boundary |

**Where a mandate overrides a benchmark:** `math_proof` → GPT-5.5 (Interview Q10) overrides Sonnet's 89% arithmetic benchmark. This is flagged as a *decision*, not an inference.

---

## 11. CONFLICT RECONCILIATION (where the five syntheses disagreed)

Resolved by **best-sourced evidence**, not averaging. Each entry: the disagreement → resolution → residual uncertainty.

1. **Category count & names (8 vs 9; naming variants).** Synths 1/2/3/5 converged on **8**; synth 4 used **9** (added an explicit `fallback_default`). **Resolution:** adopt **8 canonical work categories + an explicit `fallback_default` route** — synth 4's fallback discipline without inflating the *classifiable* set (the classifier still emits one of 8; the router supplies the default when none match). Canonical names chosen for crispness and to keep the four code-work categories distinct: `math_proof`, `security_review`, `architecture`, `quality_review`, `debugging`, `agentic_execution`, `knowledge_synthesis`, `coding`, `mechanical`. The synths' `extraction_terminal`/`terminal_exec`/`agentic_operations` are **merged into `agentic_execution`** (same closed-loop-vs-evidence axis, identical Codex route); `reasoning_judgment`/`deep_reasoning` gray-area work folds into `knowledge_synthesis`, while pure tie-breaking sits in `quality_review`. *Residual uncertainty:* the `agentic_execution` ∩ `coding` boundary (one-shot edit vs run-observe loop) is the most likely real-world mis-class; the precedence order + adjacent-tie escalation handle it, but evals should monitor it.

2. **`coding` primary route (Sonnet vs Codex/GPT-5.5).** Synths 1/2/5 → **Sonnet 4.6 @ medium**; synths 3/4 → **Codex/GPT-5.5** (closed-loop framing). **Resolution:** **Sonnet 4.6 @ medium is primary** for `coding`; GPT-5.5/Codex is the route for closed-loop work, which is precisely what `agentic_execution` captures. Keeping `coding`→Sonnet preserves the cost-quality default (79.6% SWE-bench at $3/$15) and the clean split (loop work → `agentic_execution`; bounded authored change → `coding`). GPT-5.5 remains a `coding` fallback when a terminal loop dominates. *Residual uncertainty:* teams that run nearly all coding through Codex may prefer the synth-3/4 default; this is an eval-tunable policy, not a correctness issue.

3. **GPT-5.5 context window (400K vs 1M vs 1.05M).** Synth 2 said 400K; synths 3/4/5 cited ~1M/1.05M. **Resolution (best-sourced — Phase-1 Agent 5 citing OpenAI docs directly):** **GPT-5.5 = 1,050,000-token API context, 128K max output**; the **400K figure is the Codex *harness* cap**, not the model. Since the local fleet uses **Codex**, the operative limit is **400K** (gate G_CTX_400), with the 272K price cliff and the >200K Claude-preference gate both binding earlier. No residual uncertainty on the numbers; the only nuance is harness-vs-API, now made explicit.

4. **SWE-bench (tie vs gap).** **Resolution (unanimous across Phase-1 Agents 1/3):** SWE-bench **Verified is tied** — Opus 4.8 88.6% vs GPT-5.5 88.7% (within noise). The real split is **SWE-bench Pro**: Opus 4.8 69.2% vs GPT-5.5 58.6% (Opus +10.6pp). This *is* the interview's task-split framing (Q2): parity on isolated coding, Opus leads on harder multi-step agentic work. No residual uncertainty.

5. **GDPval / knowledge-work figures (1890 vs +144 Elo vs +121 points).** Synth 3 conflated three different comparisons. **Resolution (Phase-1 Agents 1/3):** Opus 4.8 GDPval-AA knowledge-work score = **1890** (vs GPT-5.5 **1769**; vs Opus 4.7 **1753**) at max effort. The **"+144 Elo"** figure is a *different* comparison — **Opus 4.6 vs GPT-5.2** on GDPval (DataCamp). The "+121 points" is the Opus-4.8-vs-GPT-5.5 GDPval-AA margin (1890−1769) rounded. All three are real but not interchangeable; cited distinctly in §5/§10. *Residual uncertainty:* Opus 4.8 released same-day as the research, so the 1890 figure is [PRESS]-sourced (VentureBeat), not yet independently replicated.

6. **GPT-5.5 priority/fast pricing ($12.50/$75 vs "credit multiplier").** Synth 4 stated $12.50 in / $75 out; synth 5 said "credit multiplier." **Resolution (best-sourced — Phase-1 Agent 5 citing OpenAI pricing):** **GPT-5.5 priority = $12.50/input, $1.25/cached, $75/output** (2.5× standard). Synth 4 is correct; "credit multiplier" was the vaguer paraphrase. No residual uncertainty.

7. **Opus 4.8 magnitude over 4.7.** Synths split between "significant jump" and "modest but tangible." **Resolution (Interview Q2 + Phase-1 Agent 4 caveat):** frame as **task-split leadership** (materially better on agentic/long-horizon — SWE-Pro +10.6pp vs GPT-5.5, Terminal-Bench +8.5pp vs Opus 4.7, GDPval 1890 vs 1753; roughly equal on isolated coding), **not** blanket superiority. [ASSUMPTION] — Opus 4.8 released ~2026-05-29 (same day as research); magnitude claims carry residual uncertainty pending independent replication, but the directional task-split is well-corroborated.

8. **Tokenizer inflation magnitude (32–45% vs ~35%).** **Resolution:** Anthropic states up to ~35%; third-party (OpenRouter/findskill) estimates 32–45%. The mandated modeling figure is **~1.4× effective cost** (Interview Q7), which the range supports. *Residual uncertainty:* exact inflation is content-dependent; 1.4× is a planning constant, not a per-text guarantee.

---

## 12. References (APA — original sources only; internal KB files never cited)

AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities

Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8

Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5

Anthropic. (2026, February 17). *Claude Sonnet 4.6*. https://www.anthropic.com/claude/sonnet

Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview

Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort

Anthropic. (2026). *Adaptive thinking — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking

Anthropic. (2026). *Extended thinking tips — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips

Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing

Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits

Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide

Caylent. (2025). *Claude Haiku 4.5 deep dive: Cost, capabilities, and the multi-agent opportunity*. https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity

CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results

Contra Collective. (2026). *GPT-5.5 vs Claude Opus 4.8: Frontier coding and reasoning tested*. https://contracollective.com/blog/gpt-5-5-vs-claude-opus-4-8-2026

DataCamp. (2026). *Claude Opus 4.6: Features, benchmarks, tests, and more*. https://www.datacamp.com/blog/claude-opus-4-6

DataCamp. (2026). *Claude Sonnet 4.6: Features, access, tests, and benchmarks*. https://www.datacamp.com/blog/claude-sonnet-4-6

DataCamp. (2025). *Claude Haiku 4.5: Features, testing results, and use cases*. https://www.datacamp.com/blog/anthropic-claude-haiku-4-5

Endor Labs. (2026). *GPT-5.5 sets a new code security record (with Cursor, not Codex) in Agent Security League*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league

MindStudio. (2026). *GPT-5.5 vs Claude Opus 4.7 for [agentic mention removed]: Real-world differences*. https://www.mindstudio.ai/blog/gpt-5-5-vs-claude-opus-4-7-agentic-coding-2

NxCode. (2026). *Claude Sonnet 4.6: 79.6% SWE-bench at $3/MTok — Complete guide*. https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026

OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/

OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model

OpenAI. (2026). *GPT-5.5 model*. https://developers.openai.com/api/docs/models/gpt-5.5

OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models

OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive

OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions

OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing

OpenAI. (2026). *Prompt caching*. https://developers.openai.com/api/docs/guides/prompt-caching

OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance

OpenAI. (2026). *Reasoning models*. https://developers.openai.com/api/docs/guides/reasoning

OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis

Sonar. (2026). *OpenAI GPT-5.5: An evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation

The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8 as a "modest but tangible improvement" that tops GPT-5.5 in most benchmarks*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/

VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8 is here with 3X cheaper fast mode and near-Mythos level alignment*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment

Yang, C., et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.

*Multi-agent validation / governance findings:* arXiv:2508.02994 (Agent-as-a-Judge); arXiv:2601.14691 (Gaming the Judge); arXiv:2602.06948 (Agentic overconfidence); arXiv:2602.01331 (A-MapReduce); arXiv:2511.07585 (LLM output drift).

Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal seed document]. [SEED — treated as hypothesis only per Interview Q8; never cited as authority.]

---

*End of Phase 2 Core Synthesis (canonical merge). Most load-bearing content (routing contract, hard gates, machine-consumable table) is front-loaded. Eight canonical work categories + explicit fallback, gate-first deterministic routing, one worked schema record per category. All [SEED]/[INFERRED]/[ASSUMPTION] labels preserved; all conflicts reconciled by best-sourced evidence in §11. Ready for decomposition into the `.spec/references` RAG KB.*
