## 11. Seed-corpus corroboration status (interview Q8 — HYPOTHESIS only)

| [SEED] claim (Blackburn 2026) | Status vs docs/benchmarks |
|---|---|
| Opus = planning/architecture/synthesis/nuance | **Corroborated** (GDPval +144 Elo vs GPT-5.2; Super-Agent; ARC-AGI-2 gap) → `architecture`, `knowledge_synthesis` |
| Sonnet = balanced debug/review/reasoning | **Corroborated** (79.6% SWE-bench; verification thoroughness) → `debugging`, `coding` |
| Haiku = fast coding/file ops | **Corroborated** (73.3% SWE-bench; Claude Code auto-routes leaf work) → `mechanical` |
| GPT-5.5 = closed-loop/extraction/proofs/terminal/boilerplate | **Corroborated** (Terminal-Bench ~82–83%; ~40% fewer tokens) → `extraction_terminal`, `math_proof`, `coding` |
| GPT-5.5 risks: confident hallucination + security bugs | **Corroborated** (CWE-732 misses; hallucinated `pathlib` arg; AISI cyber eval) → G3 |
| Opus risks: caution/stall + verbosity | **Corroborated** (official low-effort "scopes to what was asked" implies prior over-extension) → Pattern 4b |
| +5 other-provider slots; separable work; split by domain; no duplicate tasks | **Adopted as design constraint** for fan-out (Patterns 2/6); duplicate-task = anti-pattern A |

Where seed and data could conflict (e.g., "Haiku for ALL coding"), **data wins per Q8**: Haiku is `mechanical`-only; multi-file/semantic coding is Sonnet/Codex. Math routing is the one place a *mandate* (Q10) overrides a benchmark (Sonnet's 89% math) — flagged as a decision, not an inference.

---

## References (APA — original sources only)

Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort
Anthropic. (2026). *Adaptive thinking — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview
Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing
Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits
Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8
Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5
Anthropic. (2026, February 17). *Claude Sonnet 4.6*. https://www.anthropic.com/claude/sonnet
OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/
OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model
OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models
OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive
OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions
OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing
OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance
AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities
Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide
CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results
Endor Labs. (2026). *GPT-5.5 sets a new code security record*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league
OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis
Sonar. (2026). *OpenAI GPT-5.5: an evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation
Yang, C. et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.
Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal document]. [SEED — treated as hypothesis only per Phase 1.5 Q8.]

---

*End of Phase 2 Core Synthesis #3. Most impactful content (routing contract + machine-consumable schema) front-loaded per mandate. Eight deterministic categories, gate-first routing, one worked schema record per category. All [SEED]/[INFERRED]/[ASSUMPTION] labeled inline.*
