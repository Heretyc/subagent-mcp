# Phase 1 Agent 3 — Coding Category

**Category:** coding (precedence 8)
**Findability:** strong
**Benchmark families:** SWE-bench Verified · Aider Polyglot · LiveCodeBench · SWE-bench Pro
**Shared anchor note:** SWE-bench Verified overlaps `debugging` (discriminator = observed-failure precondition). Scores recorded here; also applicable to debugging tile.

---

## Raw Scores Table

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| claude-opus-4-8 | default | coding | swe-bench-verified | 88.6% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| gpt-5.5 | default | coding | swe-bench-verified | 88.7% | https://www.marc0.dev/en/leaderboard | [ASSUMPTION] |
| claude-opus-4-7 | default | coding | swe-bench-verified | 87.6% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| claude-sonnet-4-6 | default | coding | swe-bench-verified | 79.6% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| claude-haiku-4-5 | default | coding | swe-bench-verified | 73.3% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| gpt-5.2 | default | coding | swe-bench-verified | 80.0% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| gpt-5.1 | default | coding | swe-bench-verified | 76.3% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| gpt-5 | default | coding | swe-bench-verified | 74.9% | https://llm-stats.com/benchmarks/swe-bench-verified | [INFERRED] |
| gpt-5.5 | high | coding | aider-polyglot | GAP | https://aider.chat/docs/leaderboards/ | [GAP] |
| gpt-5 | high | coding | aider-polyglot | 88.0% | https://aider.chat/docs/leaderboards/ | [SEED] |
| gpt-5 | med | coding | aider-polyglot | 86.7% | https://aider.chat/docs/leaderboards/ | [SEED] |
| gpt-5 | low | coding | aider-polyglot | 81.3% | https://aider.chat/docs/leaderboards/ | [SEED] |
| claude-opus-4-7 | max (32k thinking) | coding | aider-polyglot | 72.0% | https://aider.chat/docs/leaderboards/ | [SEED] |
| claude-opus-4-7 | default (no thinking) | coding | aider-polyglot | 70.7% | https://aider.chat/docs/leaderboards/ | [SEED] |
| claude-sonnet-4-6 | max (32k thinking) | coding | aider-polyglot | 61.3% | https://aider.chat/docs/leaderboards/ | [SEED] |
| claude-sonnet-4-6 | default (no thinking) | coding | aider-polyglot | 56.4% | https://aider.chat/docs/leaderboards/ | [SEED] |
| claude-opus-4-8 | default | coding | aider-polyglot | GAP | https://aider.chat/docs/leaderboards/ | [GAP] |
| claude-haiku-4-5 | default | coding | aider-polyglot | GAP | https://aider.chat/docs/leaderboards/ | [GAP] |
| claude-opus-4-8 | default | coding | livecodebench | GAP | https://livecodebench.github.io/leaderboard.html | [GAP] |
| gpt-5.5 | default | coding | livecodebench | GAP | https://livecodebench.github.io/leaderboard.html | [GAP] |
| gpt-5.2 | default | coding | livecodebench | 89.4 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| gpt-5.4 | default | coding | livecodebench | 87.5 | https://benchlm.ai/coding | [INFERRED] |
| claude-opus-4-5 | max (thinking) | coding | livecodebench | 87.1 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| claude-opus-4-5 | default | coding | livecodebench | 73.8 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| claude-opus-4-6 | default | coding | livecodebench | 70.7 | https://benchlm.ai/coding | [INFERRED] |
| claude-sonnet-4-5 | max (thinking) | coding | livecodebench | 71.4 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| claude-sonnet-4-5 | default | coding | livecodebench | 59.0 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| claude-haiku-4-5 | max (thinking) | coding | livecodebench | 61.5 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| claude-haiku-4-5 | default | coding | livecodebench | 51.1 | https://pricepertoken.com/leaderboards/benchmark/livecodebench | [INFERRED] |
| claude-opus-4-8 | default | coding | swe-bench-pro | 69.2% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-opus-4-7 | default | coding | swe-bench-pro | 64.3% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| gpt-5.5 | default | coding | swe-bench-pro | 58.6% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-sonnet-4-6 | default | coding | swe-bench-pro | 60.7% | https://benchlm.ai/coding | [INFERRED] |
| claude-opus-4-6 | default | coding | swe-bench-pro | 53.4% | https://benchlm.ai/coding | [INFERRED] |

---

## Gaps

- **claude-opus-4-8 LiveCodeBench:** Not yet on official leaderboard (released 2026-05-29; leaderboard lags)
- **gpt-5.5 LiveCodeBench:** Not found on leaderboard
- **claude-opus-4-8 / claude-haiku-4-5 Aider polyglot:** No entries; most recent Claude is claude-opus-4-20250514 (≈Opus 4.7)
- **gpt-5.5 Aider polyglot:** Aider lists `gpt-5` (high/med/low) — model ID not confirmed == gpt-5.5; flagged [SEED] as gpt-5
- **BigCodeBench / MultiPL-E:** No 2026 current-gen scores surfaced

## Key Observations

- SWE-bench Verified: claude-opus-4-8 (88.6%) and gpt-5.5 (88.7%) are statistically tied within noise [ASSUMPTION on gpt-5.5]
- SWE-bench Pro reveals larger gap: claude-opus-4-8 +10.6pp over gpt-5.5 (69.2% vs 58.6%)
- Note: OpenAI deprecated self-reporting on SWE-bench Verified in 2026; gpt-5.5 88.7% is pre-deprecation claim
- LiveCodeBench top as of 2026-06-03: Gemini 3 Pro Preview 91.7, GPT-5.2 89.4 — neither is in scope
- Aider polyglot GPT-5 (high) 88.0% > Claude Opus 4.7 72.0% — significant gap on this bench
