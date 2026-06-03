# Phase 1 Agent 3 — Agentic Execution Category

**Category:** agentic_execution (precedence 6)
**Findability:** strong
**Benchmark families:** Terminal-Bench · tau-bench · OSWorld · WebArena · GAIA · BFCL · MLE-bench · GDPval

---

## Raw Scores Table

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| gpt-5.5 | default | agentic_execution | terminal-bench-2.1 | 82.7% | https://benchmarkingagents.com/terminal-bench/ | [ASSUMPTION] |
| claude-opus-4-8 | max | agentic_execution | terminal-bench-2.1 | 74.6% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-opus-4-7 | max | agentic_execution | terminal-bench-2.1 | 66.1% | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-sonnet-4-6 | default | agentic_execution | terminal-bench-2.1 | GAP | https://tbench.ai | [GAP] |
| claude-haiku-4-5 | default | agentic_execution | terminal-bench-2.1 | GAP | https://tbench.ai | [GAP] |
| gpt-5.5 | default | agentic_execution | osworld-verified | 78.7% | https://llm-stats.com/benchmarks/osworld-verified | [ASSUMPTION] |
| claude-opus-4-7 | default | agentic_execution | osworld-verified | 78.0% | https://llm-stats.com/benchmarks/osworld-verified | [ASSUMPTION] |
| claude-opus-4-8 | default | agentic_execution | osworld-verified | ~82-83% | https://www.digitalapplied.com/blog/claude-opus-4-8-release-dynamic-workflows-2026 | [ASSUMPTION] |
| claude-opus-4-6 | default | agentic_execution | osworld | 72.7% | https://llm-stats.com/benchmarks/osworld | [SEED] |
| claude-sonnet-4-6 | default | agentic_execution | osworld | 72.5% | https://llm-stats.com/benchmarks/osworld | [ASSUMPTION] |
| claude-haiku-4-5 | default | agentic_execution | osworld | GAP | https://llm-stats.com/benchmarks/osworld | [GAP] |
| claude-sonnet-4-5 | default | agentic_execution | gaia-l123-avg | 74.6% | https://hal.cs.princeton.edu/gaia | [INFERRED] |
| gpt-5.5 | default | agentic_execution | gaia-l123-avg | GAP | https://huggingface.co/spaces/gaia-benchmark/leaderboard | [GAP] |
| claude-opus-4-8 | default | agentic_execution | gaia-l123-avg | GAP | https://huggingface.co/spaces/gaia-benchmark/leaderboard | [GAP] |
| claude-sonnet-4-6 | default | agentic_execution | gaia-l123-avg | GAP | https://huggingface.co/spaces/gaia-benchmark/leaderboard | [GAP] |
| claude-opus-4-5 | default | agentic_execution | bfcl-v4-overall | 77.47% | https://gorilla.cs.berkeley.edu/leaderboard.html | [SEED] |
| claude-sonnet-4-5 | default | agentic_execution | bfcl-v4-overall | 73.24% | https://gorilla.cs.berkeley.edu/leaderboard.html | [SEED] |
| claude-opus-4-8 | default | agentic_execution | bfcl-v4-overall | GAP | https://gorilla.cs.berkeley.edu/leaderboard.html | [GAP] |
| claude-sonnet-4-6 | default | agentic_execution | bfcl-v4-overall | GAP | https://gorilla.cs.berkeley.edu/leaderboard.html | [GAP] |
| gpt-5.5 | default | agentic_execution | bfcl-v4-overall | GAP | https://gorilla.cs.berkeley.edu/leaderboard.html | [GAP] |
| claude-opus-4-8 | max | agentic_execution | gdpval-aa | 1890 pts | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| gpt-5.5 | default | agentic_execution | gdpval-aa | 1769 pts | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| claude-opus-4-7 | max | agentic_execution | gdpval-aa | 1753 pts | https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/ | [ASSUMPTION] |
| gpt-5.5 | default | agentic_execution | gdpval-pct | 84.9% | https://futureagi.com/blog/best-llms-may-2026/ | [ASSUMPTION] |
| claude-opus-4-8 | default | agentic_execution | tau-bench | GAP | https://llm-stats.com/benchmarks/tau-bench | [GAP] |
| gpt-5.5 | default | agentic_execution | tau-bench | GAP | https://llm-stats.com/benchmarks/tau-bench | [GAP] |
| claude-opus-4-8 | default | agentic_execution | mle-bench | GAP | https://arxiv.org/pdf/2410.07095 | [GAP] |
| gpt-5.5 | default | agentic_execution | mle-bench | GAP | https://arxiv.org/pdf/2410.07095 | [GAP] |

---

## Gaps

- **GAIA:** No claude-opus-4-8 or gpt-5.5 entries on public leaderboard (HAL + HF); latest is claude-sonnet-4-5
- **BFCL V4:** Latest entries are claude-opus-4-5 (Nov 2025) / claude-sonnet-4-5; no 4.6/4.8 or gpt-5.5
- **tau-bench:** Current leaderboard has only 6 models (Chinese LLMs + o3); no Claude or GPT-5.5
- **MLE-bench:** No current-gen score surfaced for scope models
- **OSWorld-Verified vs OSWorld:** Different subsets; scores not directly comparable

## Key Observations

- Terminal-Bench: gpt-5.5 (82.7%) > claude-opus-4-8 (74.6%) > claude-opus-4-7 (66.1%) — all [ASSUMPTION]
- OSWorld-Verified: claude-opus-4-8 (~82-83%) may lead; gpt-5.5 (78.7%) and opus-4-7 (78.0%) cluster
- GDPval-AA scale is points not percent; opus-4-8 (1890) > gpt-5.5 (1769) > opus-4-7 (1753) [ASSUMPTION]
- BFCL gap: No 2026-gen models evaluated yet — this metric is stale for current-gen profiling
- Note: gpt-5.5 Terminal-Bench 82.7% conflicts with OSWorld ranking; do not treat as same task type
