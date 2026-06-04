# Phase 1 Agent 2 - Benchmark Capture

Run: 2026-06-03 Full-mode re-profile. Domain: reasoning/correctness spine. Categories:
`math_proof`, `security_review`, `debugging`, `quality_review`.

## Scope And Protocol

- [ASSUMPTION] `opus` is treated as Claude Opus 4.6 because Phase 0 names `opus` separately from `opus-4-8`, and the diff baseline maps `claude-opus-4-6` as the non-4.8 Opus route. Opus 4.7 rows are retained only when a primary source reports them as comparators.
- [SEED] Ordered check protocol used per category: official leaderboard/Tier 3, independent aggregator/Tier 2, symmetric vendor cards/Tier 1, then paper/arXiv/OpenReview/Tier 4.
- [SEED] No normalization was performed. Values below are raw source values.
- [ASSUMPTION] `effort` is copied from the source when named; otherwise it is `unspecified`.
- [ASSUMPTION] I did not run `git` because the parent task explicitly forbade it, even though repo AGENTS.md normally asks for `git status` before edits.

## Raw Evidence Table

| model | effort | category | benchmark | raw score | source-url | label |
|---|---|---|---|---|---|---|
| GPT-5.5 | xhigh | math_proof | MathArena expected performance | 82.9% +/- 1.5%; rank #1; cost/problem $1.15 | https://matharena.ai/models/openai_gpt_55 | [SEED][T3] |
| GPT-5.5 | xhigh | math_proof | MathArena ArXivMath Overall | 72.67% +/- 4.92%; rank 1/9 | https://matharena.ai/models/openai_gpt_55 | [SEED][T3] |
| GPT-5.5 | xhigh | math_proof | MathArena AIME 2026 | 97.50% +/- 2.79%; rank 5/28 | https://matharena.ai/models/openai_gpt_55 | [SEED][T3] |
| GPT-5.5 | xhigh | math_proof | MathArena USAMO 2026 | 98.21% +/- 5.30%; rank 1/9 | https://matharena.ai/models/openai_gpt_55 | [SEED][T3] |
| GPT-5.5 | unspecified | math_proof | FrontierMath Tier 1-3 | 51.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.5 | unspecified | math_proof | FrontierMath Tier 4 | 35.4% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.5 Pro | unspecified | math_proof | FrontierMath Tier 1-3 | 52.4% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.5 Pro | unspecified | math_proof | FrontierMath Tier 4 | 39.6% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.4 | unspecified | math_proof | FrontierMath Tier 1-3 | 47.6% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.4 | unspecified | math_proof | FrontierMath Tier 4 | 27.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.4 Pro | unspecified | math_proof | FrontierMath Tier 1-3 | 50.0% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.4 Pro | unspecified | math_proof | FrontierMath Tier 4 | 38.0% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| Claude Opus 4.8 | max | math_proof | MathArena expected performance | 70.4% +/- 1.6%; rank #3; cost/problem $6.69 | https://matharena.ai/models/anthropic_opus_48_max | [SEED][T3] |
| Claude Opus 4.8 | max | math_proof | MathArena ArXivMath Overall | 65.38% +/- 4.79%; rank 2/9 | https://matharena.ai/models/anthropic_opus_48_max | [SEED][T3] |
| Claude Opus 4.8 | max | math_proof | MathArena AIME 2026 | 100.00% +/- 0.00%; rank 1/28 | https://matharena.ai/models/anthropic_opus_48_max | [SEED][T3] |
| Claude Opus 4.8 | high | math_proof | USAMO 2026 | 96.7%; average over 10 attempts/problem; batch API 300k token limit | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.6 | high | math_proof | MathArena expected performance | 55.9% +/- 1.2%; rank #11; cost/problem $2.90 | https://matharena.ai/models/anthropic_opus_46 | [SEED][T3] |
| Claude Opus 4.6 | high | math_proof | MathArena AIME 2026 | 96.67% +/- 3.21%; rank 5/27 | https://matharena.ai/models/anthropic_opus_46 | [SEED][T3] |
| Claude Opus 4.6 | high | math_proof | MathArena USAMO 2026 | 47.02% +/- 19.97%; rank 6/9 | https://matharena.ai/models/anthropic_opus_46 | [SEED][T3] |
| Claude Opus 4.6 | max | math_proof | AIME 2025 | 99.79% without tools; average over 5 trials | https://anthropic.com/claude-opus-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | max | math_proof | AIME 2025 | 95.6% without tools; average over 10 trials | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| GPT-5.5 | unspecified | security_review | CyberGym | 81.8% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.4 | unspecified | security_review | CyberGym | 79.0% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.5 | high token limits | security_review | UK AISI expert cyber tasks | pass@5 90.5% +/- 12.9%; pass@1 66.7% +/- 15.9%; lower-difficulty 100% | https://deploymentsafety.openai.com/gpt-5-5/gpt-5-5.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.8 | safeguards off | security_review | CyberGym targeted vulnerability reproduction | pass@1 78.8% on 1,507 tasks | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.8 | safeguards on | security_review | CyberGym targeted vulnerability reproduction | pass@1 1.0% on 1,507 tasks | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.8 | safeguards off | security_review | Firefox exploit eval | full exploit 8.8%; at least register control/full exploit 68.8% | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.6 | no thinking/default effort | security_review | CyberGym targeted vulnerability reproduction | pass@1 66.6% on 1,507 tasks | https://anthropic.com/claude-opus-4-6-system-card | [UNVERIFIED][T1] |
| Claude Opus 4.6 | unspecified | security_review | Cybench subset | average pass@1 0.93; pass@30 100% | https://anthropic.com/claude-opus-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | no thinking/default effort | security_review | CyberGym targeted vulnerability reproduction | pass@1 65.2% on 1,507 tasks | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | unspecified | security_review | Cybench subset | average pass@1 0.90; pass@30 100% | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| Claude Haiku 4.5 | pass@30 | security_review | Cybench 32-challenge subset | solved 15/32 challenges | https://www-cdn.anthropic.com/7aad69bf12627d42234e01ee7c36305dc2f6a970.pdf | [UNVERIFIED][T1] |
| GPT-5.5 | unspecified | debugging | SWE-Bench Pro Public | 58.6% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| GPT-5.4 | unspecified | debugging | SWE-Bench Pro Public | 57.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][T1] |
| Claude Opus 4.8 | standard config | debugging | SWE-bench Verified | 88.6% | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.8 | standard config | debugging | SWE-bench Pro | 69.2% | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.6 | max | debugging | SWE-bench Verified | 80.84%; average over 25 trials | https://anthropic.com/claude-opus-4-6-system-card | [UNVERIFIED][T1] |
| Claude Opus 4.6 | prompt modified | debugging | SWE-bench Verified | 81.4% | https://anthropic.com/claude-opus-4-6-system-card | [UNVERIFIED][T1] |
| Claude Opus 4.6 | default thinking | debugging | OpenRCA | 34.9% overall; 117/335 full root-cause identifications | https://anthropic.com/claude-opus-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | max | debugging | SWE-bench Verified | 79.6%; average over 10 trials | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | prompt modified | debugging | SWE-bench Verified | 80.2% | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | high | debugging | OpenRCA | 27.9% overall | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| Claude Sonnet 4.6 | max | debugging | OpenRCA | 26.4% overall | http://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][T1] |
| Claude Haiku 4.5 | no test-time compute; 128k thinking budget | debugging | SWE-bench Verified | 73.3%; average over 50 trials | https://www.anthropic.com/news/claude-haiku-4-5 | [UNVERIFIED][T1] |
| Claude Haiku 4.5 | pass@1 | debugging | SWE-bench Verified hard subset | 16.45/45 solved; 36.6% average | https://www-cdn.anthropic.com/7aad69bf12627d42234e01ee7c36305dc2f6a970.pdf | [UNVERIFIED][T1] |
| GPT-5.5 | unspecified | debugging | Internal Research Debugging Eval | median 50.5% on 41 real OpenAI research bugs plus 6 alignment-audit tasks | https://deploymentsafety.openai.com/gpt-5-5/gpt-5-5.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.8 | unspecified | quality_review | Uncritically reporting flawed results | perfect score; 0 false-number reports stated in text | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |
| Claude Opus 4.8 | unspecified | quality_review | Code summary honesty | failed to raise important events 3.7% of the time | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | [UNVERIFIED][T1] |

## Explicit Gaps For Phase 2 Interpolation

- [SEED] Official SWE-bench embedded leaderboard was fetched from `https://www.swebench.com/index.html`; it exposed methodology and embedded rows, but no rows for GPT-5.5, GPT-5.5 Pro, GPT-5.4, GPT-5.4 Pro, Claude Opus 4.8, Claude Opus 4.6, or Claude Sonnet 4.6 on the current Verified board. Vendor SWE-bench rows above must stay [UNVERIFIED].
- [SEED] No public SWT-bench or DebugBench rows were found for the scoped current-generation pairings; use gaps for those benchmark-family cells.
- [SEED] No official RewardBench 2, JudgeBench, or CriticBench rows were found for GPT-5.5, GPT-5.5 Pro, GPT-5.4-mini, Claude Opus 4.8, Claude Opus 4.6, Claude Sonnet 4.6, or Claude Haiku 4.5. Quality-review routing should not rank on vendor flawed-results/card honesty rows alone.
- [SEED] No public FrontierMath/Epoch row was found for Claude Opus 4.8, Claude Opus 4.6, Claude Sonnet 4.6, or Claude Haiku 4.5; math rows for those models come from MathArena or vendor cards, not FrontierMath.
- [SEED] No public math/security/debugging/quality rows were found for `gpt-5.4-mini`; all four category cells are gaps.
- [SEED] GPT-5.5 Pro appears in the OpenAI FrontierMath table but not in the OpenAI SWE-Bench Pro or CyberGym rows; debugging and security cells are gaps.

## Deltas Against Baseline

- [SEED] Baseline claimed GPT-5.5 SWE-bench Verified 88.7%; I did not find an original source row during this pass. Keep as gap unless a primary source is supplied.
- [SEED] Baseline claimed Opus 4.8 SWE-bench Verified 88.6% and SWE-bench Pro 69.2%; this pass found those values in Anthropic's Opus 4.8 system-card PDF only, so they remain [UNVERIFIED].
- [SEED] Baseline claimed Sonnet 4.6 SWE-bench Verified 79.6% and Haiku 4.5 73.3%; this pass found both in Anthropic sources only, so they remain [UNVERIFIED].
