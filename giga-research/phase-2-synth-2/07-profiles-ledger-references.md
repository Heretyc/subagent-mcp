## 9. CONDENSED PER-MODEL CAPABILITY & RISK PROFILES (Section C)

| Model | Decisive strength | Decisive risk | Context / Output | Effort support | Nominal cost (in/out) |
|---|---|---|---|---|---|
| **Opus 4.8** | Agentic/long-horizon leader; honesty (4× fewer missed flaws vs 4.7); arbiter; knowledge work; computer-use (web) | cost premium + ~1.4× tokenizer inflation; residual caution on ambiguity; verbosity at max | 1M / 128K | low/med/high/xhigh/max | $5 / $25 ($10/$50 fast) |
| **Opus 4.7** | Near-4.8; first `xhigh`; high-res vision | tool-skipping (fixed in 4.8); tokenizer inflation; over-caution | 1M / 128K | low/med/high/xhigh/max | $5 / $25 |
| **Opus 4.6** | Planning/architecture integrity [SEED, corroborated]; old-tokenizer (no inflation) | strongest documented stall/verbosity; stricter-4.7 prompts may differ | 1M / 128K | low/med/high/max | $5 / $25 |
| **Sonnet 4.6** | Coding sweet spot (79.6% SWE-bench, ~1.2pp < Opus); verification thoroughness; math 89%; 1M context | loses coherence before Opus on long agentic runs; set effort explicitly (high default surprises) | 1M / 64K | low/med/high/max | $3 / $15 |
| **Haiku 4.5** | Speed/cost (25× < Opus); mechanical parity with Sonnet; 73.3% SWE-bench | 200K ceiling; shallow on multi-step reasoning; no adaptive thinking | 200K / 64K | none (fixed) | $1 / $5 |
| **GPT-5.5 @ Codex** | Autonomous CLI leader (Terminal-Bench ~82.7%); fast-to-patch; 40% fewer tokens; math/proofs; security initial pass (71.4%) | confident hallucination; concurrency bugs (~170/mLOC); commits to wrong file early; literal instruction-following; security miss patterns (CWE-732) | 400K (Codex) / 1M (API) / 128K out | none/min/low/med/high/xhigh | $5 / $30 (≤272K) |

**Effort defaults are task-class, not per-model (Decision 5):** the category determines effort; the model determines the *available* effort ladder. Opus/coding-agentic → start `xhigh`; Sonnet production → start `medium`; GPT-5.5 Codex → start `medium`; mechanical → fixed low (Haiku) or `low` (Sonnet fallback). Step up exactly one notch only after evals show the lower level underperforms.

---

## 10. ASSUMPTION / INFERENCE / SEED LEDGER

- **[ASSUMPTION → refined]** Opus 4.8 ≫ Opus 4.7: data supports "materially better on agentic/long-horizon (SWE-Pro +10.6pp vs GPT-5.5, Super-Agent, GDPval-AA), roughly equal on isolated coding" — task-split framing per Decision 2; not blanket superiority.
- **[SEED, corroborated]** Opus = planning/architecture/synthesis/nuance; Haiku = fast file ops; Sonnet = balanced debug/review; GPT-5.5 = closed-loop/extraction/proofs/terminal; GPT-5.5 risks = confident hallucination + security bugs; Opus risk = caution/stall + verbosity. Each corroborated by official docs / third-party benchmarks cited inline. Treated as hypothesis; benchmarks confirmed.
- **[INFERRED]** Sonnet 4.6 effective-cost advantage over Opus is ~6–7× (not 5×) once 1.4× tokenizer inflation is applied to Opus 4.7/4.8.
- **[INFERRED]** The precedence order (§1.9) is a synthesis design choice (not vendor-specified) to make classification deterministic and safety-biased.
- **[ASSUMPTION per mandate]** "GPT-5.5 confident hallucination / security-bug" risk justifies the mandatory Claude cross-review for concurrent/auth/permission code (Decision 4), even though GPT-5.5's *absolute* hallucination rate is unpublished (60% *relative* reduction vs 5.4 is the only citable figure).

---

## 11. REFERENCES (APA — original sources only)

AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities

Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8

Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort

Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview

Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing

Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits

Anthropic. (2026). *Extended thinking tips — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips

Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5

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

OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models

OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive

OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions

OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance

OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing

OpenAI. (2026). *Prompt caching*. https://developers.openai.com/api/docs/guides/prompt-caching

OpenAI. (2026). *Reasoning models*. https://developers.openai.com/api/docs/guides/reasoning

OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis

Sonar. (2026). *OpenAI GPT-5.5: An evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation

The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8 as a "modest but tangible improvement" that tops GPT-5.5 in most benchmarks*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/

VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8 is here with 3X cheaper fast mode and near-Mythos level alignment*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment

Yang, C., et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.

*Agent-as-Judge and multi-agent validation findings:* arXiv:2508.02994 (Agent-as-a-Judge); arXiv:2601.14691 (Gaming the Judge); arXiv:2602.06948 (Agentic overconfidence); arXiv:2602.01331 (A-MapReduce); arXiv:2511.07585 (LLM output drift).

---

*End of Phase 2 Core Synthesis #2. All routing decisions trace to the 10 authoritative interview decisions (2026-05-29). Hard gates, mandatory validations, and halt rules are emphasized at top (§0) and specified per-category (§2) and machine-consumably (§8).*
