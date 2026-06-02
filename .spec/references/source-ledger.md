# Source Ledger — `.spec/references/` KB

APA citations to ORIGINAL external sources only. Internal `.spec/references/*.md` files are NEVER
cited as provenance. Each source id maps to the claims it supports and the leaf(ves) that depend on it.

> **Do not load for routing.** Load only when verifying claim lineage or checking citations.

---

## Citation Table

| id | APA Reference | Supports (claims / leaf-topics) |
|----|---------------|----------------------------------|
| AISI-2026 | AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities | GPT-5.5 ≈71.4% expert-cyber pass; "High" capability verdict; G_SEC rationale → `hard-gates.md`, `failure-modes.md` |
| ANTH-OPUS48 | Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8 | Opus 4.8 release; honesty (~4× fewer unremarked flaws vs 4.7); web computer-use ~84% Mind2Web; fast-mode pricing → `model-profiles.md` |
| ANTH-HAIKU45 | Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5 | Haiku 4.5 73.3% SWE-bench Verified; 200K context; $1/$5 pricing → `model-profiles.md`, `cost-model.md` |
| ANTH-SONNET46 | Anthropic. (2026, February 17). *Claude Sonnet 4.6*. https://www.anthropic.com/claude/sonnet | Sonnet 4.6 79.6% SWE-bench Verified; 1M context; $3/$15 pricing → `model-profiles.md`, `cost-model.md` |
| ANTH-MODELS | Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview | api-ids; ctx in/out; supported effort levels per model → `model-profiles.md` |
| ANTH-EFFORT | Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort | Effort ladder (low/med/high/xhigh/max); Opus xhigh/max as agentic/planning default → `routing-table.md`, `model-profiles.md` |
| ANTH-ADAPTIVE | Anthropic. (2026). *Adaptive thinking — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking | Locked sampling on Opus 4.7/4.8 (no temperature/top_p/top_k/budget_tokens); 400-error; G_OPUS_LOCK → `hard-gates.md` |
| ANTH-EXTTHINK | Anthropic. (2026). *Extended thinking tips — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips [NOTE: URL returned 308 redirect during check — may be stale; verify canonical URL if citation is challenged] | max_tokens ≥ 64K required at xhigh/max; output-truncation risk → `hard-gates.md`, `model-profiles.md` |
| ANTH-PRICING | Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing | All Anthropic per-MTok rates; cache-write prices; batch discount; 1M context no premium → `cost-model.md` |
| ANTH-LIMITS | Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits | 429 quota behavior; retry guidance → `failure-modes.md` |
| AUGMENT-2026 | Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. [URL returned 404 — source not accessible; original URL was https://www.augmentcode.com/guide/ai-model-routing-guide] [UNVERIFIED — URL dead; dependent claims in cost-model.md marked accordingly] | Three-tier 40–60% cost saving ($0.98 vs $2.02 on 104K/60K session); validated tiering discipline → `cost-model.md` |
| CAYLENT-2025 | Caylent. (2025). *Claude Haiku 4.5 deep dive*. https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity | Haiku 4.5 multi-agent map-tier use; near-Sonnet on non-reasoning; ~25× cheaper/token than Opus → `model-profiles.md`, `cost-model.md` |
| CODERABBIT-2026 | CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results | GPT-5.5 SWE-bench Verified 88.7%; Terminal-Bench ~82–83%; ~40% fewer output tokens → `model-profiles.md` |
| CONTRA-2026 | Contra Collective. (2026). *GPT-5.5 vs Claude Opus 4.8: Frontier coding and reasoning tested*. https://contracollective.com/blog/gpt-5-5-vs-claude-opus-4-8-2026 | SWE-bench Verified tie (88.6% vs 88.7%); SWE-bench Pro Opus +10.6pp (69.2% vs 58.6%) → `model-profiles.md`, `decision-rationale.md` |
| DATACAMP-OPUS46 | DataCamp. (2026). *Claude Opus 4.6: Features, benchmarks, tests, and more*. https://www.datacamp.com/blog/claude-opus-4-6 | Opus 4.6 +144 Elo vs GPT-5.2 on GDPval (DataCamp); old tokenizer (no inflation) → `model-profiles.md`, `decision-rationale.md` |
| DATACAMP-S46 | DataCamp. (2026). *Claude Sonnet 4.6: Features, access, tests, and benchmarks*. https://www.datacamp.com/blog/claude-sonnet-4-6 | Sonnet 4.6 79.6% SWE-bench; math 89%; ~70% dev preference daily coding → `model-profiles.md` |
| DATACAMP-H45 | DataCamp. (2025). *Claude Haiku 4.5: Features, testing results, and use cases*. https://www.datacamp.com/blog/anthropic-claude-haiku-4-5 | Haiku 4.5 73.3% SWE-bench; Feb-2025 knowledge cutoff → `model-profiles.md` |
| ENDOR-2026 | Endor Labs. (2026). *GPT-5.5 sets a new code security record*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league | GPT-5.5 CWE-732 miss patterns; security blind spots (with Cursor not Codex) → `failure-modes.md`, `hard-gates.md` |
| MINDSTUDIO-2026 | MindStudio. (2026). *GPT-5.5 vs Claude Opus 4.7 for [agentic mention removed]*. https://www.mindstudio.ai/blog/gpt-5-5-vs-claude-opus-4-7-agentic-coding-2 | Agentic loop comparison; wrong-file commit risk; GPT-5.5 literal instruction-following → `failure-modes.md`, `model-profiles.md` |
| NXCODE-2026 | NxCode. (2026). *Claude Sonnet 4.6: 79.6% SWE-bench at $3/MTok*. https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026 | Sonnet 4.6 SWE-bench detail; $3/$15 pricing → `model-profiles.md`, `cost-model.md` |
| OAI-GPT55 | OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/ | GPT-5.5 release; core capabilities; Terminal-Bench claims → `model-profiles.md` |
| OAI-USING55 | OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model | GPT-5.5 API context 1,050,000 tokens; 128K output; effort levels → `model-profiles.md`, `hard-gates.md` |
| OAI-MODEL55 | OpenAI. (2026). *GPT-5.5 model*. https://developers.openai.com/api/docs/models/gpt-5.5 | GPT-5.5 api-id; pricing; context details → `model-profiles.md`, `cost-model.md` |
| OAI-CODEX-M | OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models | Codex harness 400K context cap; GPT-5.4-mini availability → `hard-gates.md`, `model-profiles.md` |
| OAI-CODEX-N | OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive | `--output-schema`; machine-readable output; Codex loop patterns → `routing-table.md` |
| OAI-CODEX-P | OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions | Sandbox modes (read-only, workspace-write, danger-full-access); G_SANDBOX conditions → `hard-gates.md` |
| OAI-PRICING | OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing | GPT-5.5 per-MTok rates; 272K price cliff ($10/$45); priority 2.5× multiplier; GPT-5.5-pro rates → `cost-model.md` |
| OAI-CACHE | OpenAI. (2026). *Prompt caching*. https://developers.openai.com/api/docs/guides/prompt-caching | OpenAI cache hit rate; $0.50 cached-in; batch 50% discount → `cost-model.md` |
| OAI-PROMPT | OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance | Output contract design; avoiding over-effort; structured output patterns → `routing-table.md` |
| OAI-REASON | OpenAI. (2026). *Reasoning models*. https://developers.openai.com/api/docs/guides/reasoning | Effort ladder (none/min/low/med/high/xhigh); hidden reasoning tokens bill at output rate → `model-profiles.md`, `cost-model.md` |
| OPENROUTER-2026 | OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis | Tokenizer inflation 32–45% for Opus 4.7/4.8 vs 4.6/Sonnet; 1.4× effective cost multiplier [INFERRED] → `cost-model.md` |
| SONAR-2026 | Sonar. (2026). *OpenAI GPT-5.5: An evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation | GPT-5.5 hallucinated API signatures (non-existent `opener` arg on `pathlib.Path.open`); confident hallucination pattern → `failure-modes.md` |
| DECODER-2026 | The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ [PRESS — secondary reporting; not the benchmark runner. Terminal-Bench +8.5pp claim should be verified against original Anthropic or benchmark vendor release.] | Opus 4.8 "modest but tangible improvement"; Terminal-Bench 4.8 vs 4.7 (+8.5pp) [PRESS/ASSUMPTION] → `model-profiles.md`, `decision-rationale.md` |
| VENTUREBEAT-2026 | VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment | GDPval-AA 1890 [PRESS — not yet independently replicated; dependent claims remain labeled [PRESS]/[ASSUMPTION]]; fast-mode 3× cheaper → `model-profiles.md`, `decision-rationale.md` |
| ADAPTORCH | Yang, C., et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873 | Hub-and-spoke vs peer-mesh cascade probabilities (0.89/0.32; 17.2×/4.4×); ~75% wall-clock → `synergy-patterns.md` |
| ARXIV-2508-02994 | Zhuge, M., et al. (2025). *Agent-as-a-Judge: Evaluate agents with agents*. arXiv:2508.02994. https://arxiv.org/abs/2508.02994 | Agent-as-a-Judge validation limits → `failure-modes.md`, `governance-halts.md` |
| ARXIV-2601-14691 | (Authors TBD). (2026). *Gaming the Judge: Adversarial robustness of LLM-as-a-Judge*. arXiv:2601.14691. https://arxiv.org/abs/2601.14691 [UNVERIFIED — title/authors not confirmed; paper may not yet be indexed] | Agent-judge gaming limits → `failure-modes.md` |
| ARXIV-2602-06948 | (Authors TBD). (2026). *Agentic overconfidence: Self-reported vs verified task completion*. arXiv:2602.06948. https://arxiv.org/abs/2602.06948 [UNVERIFIED — title/authors not confirmed; paper may not yet be indexed] | Agentic overconfidence ~73% claimed vs ~35% verified on SWE-Bench Pro → `failure-modes.md` |
| ARXIV-2602-01331 | (Authors TBD). (2026). *A-MapReduce: Scalable multi-agent synthesis*. arXiv:2602.01331. https://arxiv.org/abs/2602.01331 [UNVERIFIED — title/authors not confirmed; paper may not yet be indexed] | Map-reduce sanitization pattern → `synergy-patterns.md` |
| ARXIV-2511-07585 | (Authors TBD). (2025). *LLM output drift in multi-agent pipelines*. arXiv:2511.07585. https://arxiv.org/abs/2511.07585 [UNVERIFIED — title/authors not confirmed; paper may not yet be indexed] | Output drift in multi-agent pipelines → `failure-modes.md`, `synergy-patterns.md` |
| BLACKBURN-2026 | Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal seed corpus — not an external APA source]. [SEED — hypothesis only, per §10. See `decision-rationale.md` for corroboration status. Not for use as external provenance; provenance metadata only.] | `decision-rationale.md` |

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
