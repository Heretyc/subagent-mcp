# Phase 1 Agent 3 — Architecture Category

**Category:** architecture (precedence 5)
**Findability:** PROXY — WEAKEST TILE
**Benchmark families:** PlanBench · ACPBench/ACPBench-Hard · NATURAL-PLAN · SWE-bench Pro (proxy)

**Critical note:** Architecture has no directly measured current-gen leaderboard. All classic planning benchmarks
(PlanBench, NATURAL-PLAN, ACPBench) have not been updated with Claude 4.x or GPT-5.5 entries as of 2026-06-03.
SWE-bench Pro is the only proxy with current-gen coverage — it measures multi-step [agentic mention removed], which
partially overlaps architectural planning but is NOT a pure architecture signal.

---

## Raw Scores Table

### SWE-bench Pro (proxy for architecture; also in coding tile)

SWE-bench Pro requires multi-file, multi-step planning unlike Verified's single-diff tasks.
This is why benchmark-sources.md lists it as an architecture proxy.

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| claude-opus-4-8 | default | architecture | swe-bench-pro | 69.2% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-opus-4-7 | default | architecture | swe-bench-pro | 64.3% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-sonnet-4-6 | default | architecture | swe-bench-pro | 60.7% | https://benchlm.ai/coding | [INFERRED] |
| gpt-5.5 | default | architecture | swe-bench-pro | 58.6% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-opus-4-6 | default | architecture | swe-bench-pro | 53.4% | https://benchlm.ai/coding | [INFERRED] |
| claude-haiku-4-5 | default | architecture | swe-bench-pro | GAP | — | [GAP] |

### PlanBench (classical planning — last updated 2024)

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| o1-preview | default | architecture | planbench-blocksworld | 97.8% | https://arxiv.org/pdf/2409.13373 | [SEED] |
| llama-3.1-405b | default | architecture | planbench-blocksworld | 62.6% | https://github.com/harshakokel/PlanBench | [SEED] |
| claude-3-opus | default | architecture | planbench-blocksworld | 59.3% | https://github.com/karthikv792/LLMs-Planning | [SEED] |
| gpt-4o | default | architecture | planbench-blocksworld | 35.5% | https://github.com/karthikv792/LLMs-Planning | [SEED] |
| gpt-4 | default | architecture | planbench-blocksworld | 34.6% | https://github.com/harshakokel/PlanBench | [SEED] |
| claude-opus-4-8 | default | architecture | planbench-blocksworld | GAP | https://github.com/harshakokel/PlanBench | [GAP] |
| gpt-5.5 | default | architecture | planbench-blocksworld | GAP | https://github.com/harshakokel/PlanBench | [GAP] |

### NATURAL-PLAN (natural language planning — last updated 2024)

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| gemini-1.5-pro | default | architecture | natural-plan-trip | 34.8% | https://arxiv.org/pdf/2406.04520 | [SEED] |
| gpt-4 | default | architecture | natural-plan-trip | 31.1% | https://arxiv.org/pdf/2406.04520 | [SEED] |
| gpt-3.5 | default | architecture | natural-plan-trip | 7.3% | https://arxiv.org/pdf/2406.04520 | [SEED] |
| claude-opus-4-8 | default | architecture | natural-plan-trip | GAP | https://arxiv.org/abs/2406.04520 | [GAP] |
| gpt-5.5 | default | architecture | natural-plan-trip | GAP | https://arxiv.org/abs/2406.04520 | [GAP] |

### ACPBench (action/change/planning reasoning — last updated 2024)

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| openai-o1 | default | architecture | acpbench-mc | significant-gain | https://arxiv.org/pdf/2410.05669 | [SEED] |
| openai-o1 | default | architecture | acpbench-boolean | no-notable-gain | https://arxiv.org/pdf/2410.05669 | [SEED] |
| claude-opus-4-8 | default | architecture | acpbench-mc | GAP | https://ibm.github.io/ACPBench/ | [GAP] |
| gpt-5.5 | default | architecture | acpbench-mc | GAP | https://ibm.github.io/ACPBench/ | [GAP] |

---

## Gaps (comprehensive)

- **PlanBench:** No current-gen (Claude 4.x, GPT-5.x) entries — leaderboard stale at 2024
- **NATURAL-PLAN:** No current-gen entries — benchmark paper from June 2024
- **ACPBench:** No current-gen entries — benchmark paper from Oct 2024
- **claude-haiku-4-5 SWE-bench Pro:** Gap — not surfaced
- **gpt-5.4-mini architecture:** No scores on any proxy

## Key Observations

- Architecture is the weakest tile by design: no dedicated, regularly-updated leaderboard for planning
- **SWE-bench Pro is the only current-gen proxy:** claude-opus-4-8 leads (69.2%) over gpt-5.5 (58.6%) — ~10pp gap [ASSUMPTION]
- Classic planning benchmarks (PlanBench, NATURAL-PLAN) show performance cliffs at high complexity: all models <5% on NATURAL-PLAN with 10 cities; o1 class reaches ~98% on Blocksworld but older models hover 30-60%
- Interpolation note: architecture scores for claude-opus-4-8 and gpt-5.5 must be inferred from SWE-bench Pro until a current-gen PlanBench run is published
- The SWE-bench Pro proxy signal favors claude-opus-4-8 for multi-step planning over gpt-5.5
