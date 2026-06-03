## SECTION 7: TIER-SUBSTITUTION GUIDE

| If Primary Unavailable | Substitute | Notes |
|---|---|---|
| Opus 4.8 | Opus 4.7 @ xhigh | Near-identical on most tasks; Opus 4.8 leads mainly on agentic/honesty |
| Opus 4.7 | Opus 4.6 @ high | Effort scale differs; `high` on 4.6 ≈ `medium` on 4.7 |
| Sonnet 4.6 | Opus 4.6 @ medium | 40% cost increase; quality improves slightly |
| Haiku 4.5 | Sonnet 4.6 @ low | 3x cost increase; still the right choice if Haiku unavailable |
| GPT-5.5 (Codex) | Opus 4.8 @ xhigh (Dynamic Workflows) | Opus 4.8 beats GPT-5.5 on SWE-Pro; Dynamic Workflows is comparable for agentic tasks |
| GPT-5.5 (security) | Opus 4.8 @ high | Opus 4.8 is the best Claude-family alternative; Mythos Preview if invited |

---

## SECTION 8: ASSUMPTION / INFERENCE LOG

- [ASSUMPTION] Opus 4.8 ≫ Opus 4.7 for the same tasks: Partially confirmed by benchmarks (SWE-bench +1.0 pp, SWE-Pro +4.9 pp, BrowseComp +5.0 pp, MCP-Atlas +4.9 pp). Gap is real but "modest." The seed corpus assumption of "≫" is stronger than the data warrants; "materially better on agentic tasks, approximately equal on isolated coding" is more precise.
- [ASSUMPTION] GPT-5.5 "confident hallucination" risk: Partially confirmed by Sonar evaluation ("followed instructions too literally," weak on ambiguous prompts) and its general category classification. The 60% hallucination reduction vs. GPT-5.4 is real, but the absolute rate is not published; risk designation is appropriate.
- [INFERRED] Sonnet 4.6 adequate for baseline debug / review: Confirmed by SWE-bench Verified 79.6% and developer adoption data (70% of developers prefer Sonnet for daily coding).
- [INFERRED] Haiku 4.5 for ALL coding: The seed corpus overloads Haiku. Haiku 4.5 = Sonnet 4.0 on coding. For isolated, small-scope tasks this holds. For anything multi-file or semantically complex, Sonnet 4.6 @ medium is the correct default. This table refines the directive.
- [INFERRED] GPT-5.5 Codex slots for closed-loop: Supported by Terminal-Bench 2.0 score (82.7%) and independent 20-hour engineering task completion report.

---

## REFERENCES (APA, ORIGINAL SOURCES ONLY)

Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8

Anthropic. (2026, May 29). *Models overview*. https://platform.claude.com/docs/en/about-claude/models/overview

Anthropic. (2026, May 29). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort

Anthropic. (2026, May 29). *Choosing the right model — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/choosing-a-model

Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide

Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal document].

CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results

AISI (AI Safety Institute, UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities

Endor Labs. (2026). *GPT-5.5 sets a new code security record in Agent Security League*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league

OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/

Sonar. (2026). *OpenAI GPT-5.5: an evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation

The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8 as a "modest but tangible improvement" that tops GPT-5.5 in most benchmarks*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/

tokita.online. (2026). *Best LLM for each task (2026): Production benchmarks*. https://tokita.online/best-llm-for-each-task/

Yang, C. et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.
