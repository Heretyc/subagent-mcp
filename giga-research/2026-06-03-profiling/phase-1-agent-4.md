# Phase 1 Agent 4 - Benchmark Capture

Retrieved: 2026-06-03T19:16:27Z.
Scope: `knowledge_synthesis`, `mechanical`, and cross-cutting modifier signals for current Claude and OpenAI/Codex families.
Protocol applied: leaderboard/Tier3, independent aggregator/Tier2, vendor card/Tier1, arXiv/Tier4. No normalization or ranking was performed.
Baseline diff: prior `giga-research/phase-1-agent-4*` covered synergy patterns; this run replaces that scope with benchmark capture.

Labels: `[UNVERIFIED]` means vendor-only or vendor-doc-only. `[INFERRED]` means category fit is an explicit mapping from the canonical benchmark map. `[GAP]` means no original current-model raw score was found in this pass.

## Knowledge Synthesis Rows

| model | effort | category-or-modifier | benchmark | raw score | source-url | label |
|---|---|---|---|---|---|---|
| Claude Opus 4.8 | adaptive thinking, max effort | knowledge_synthesis | GPQA Diamond | 93.6% avg over 25 trials | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.8 | max effort, no tools | knowledge_synthesis | HLE | 49.8% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.8 | max effort, tools | knowledge_synthesis | HLE | 57.9% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.8 | adaptive thinking, max effort, tools | knowledge_synthesis | BrowseComp single-agent | 84.3% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Opus 4.8 | max effort, multi-agent | knowledge_synthesis | BrowseComp multi-agent | 88.5% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Opus 4.8 | adaptive thinking, max effort, tools | knowledge_synthesis | DeepSearchQA F1 | 93.1%; fully correct 84.8%; fully incorrect 3.9%; excessive 4.3% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | adaptive thinking | knowledge_synthesis | GMMLU avg all languages | 90.4% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.7 | adaptive thinking, max effort | knowledge_synthesis | GPQA Diamond | 94.2% avg over 10 trials | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.7 | max effort, no tools | knowledge_synthesis | HLE | 46.9% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.7 | max effort, tools | knowledge_synthesis | HLE | 54.7% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.7 | thinking off, max effort, tools | knowledge_synthesis | BrowseComp single-agent | 79.3% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Opus 4.7 | adaptive thinking, max effort, tools | knowledge_synthesis | DeepSearchQA F1 | 89.1%; fully correct 80.7%; fully incorrect 7.0%; excessive 3.9% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.7 | adaptive thinking, max effort | knowledge_synthesis | MMMLU | 91.5% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.6 | adaptive thinking, max effort | knowledge_synthesis | GPQA Diamond | 91.31% avg over 5 trials | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.6 | adaptive thinking, max effort | knowledge_synthesis | MMMLU | 91.05% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.6 | max effort, no tools | knowledge_synthesis | HLE | 40.0% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.6 | max effort, tools | knowledge_synthesis | HLE | 53.0% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Opus 4.6 | thinking off, max effort, tools | knowledge_synthesis | BrowseComp single-agent | 83.73% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Opus 4.6 | max effort, multi-agent | knowledge_synthesis | BrowseComp multi-agent | 86.57% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Opus 4.6 | adaptive thinking, max effort, tools, 1M no compaction | knowledge_synthesis | DeepSearchQA F1 | 88.7%; fully correct 77.3%; fully incorrect 6.8%; excessive 5.7% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card][current rerun] |
| Claude Opus 4.6 | adaptive thinking, max effort, tools, 10M compaction | knowledge_synthesis | DeepSearchQA F1 | 91.3%; fully correct 80.6%; fully incorrect 5.0%; excessive 5.8% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card][older config] |
| Claude Sonnet 4.6 | adaptive thinking, max effort | knowledge_synthesis | GPQA Diamond | 89.9% avg over 10 trials | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Sonnet 4.6 | adaptive thinking, max effort | knowledge_synthesis | MMMLU | 89.3% | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Sonnet 4.6 | max effort, no tools | knowledge_synthesis | HLE | 33.2% | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Sonnet 4.6 | max effort, tools | knowledge_synthesis | HLE | 49.0% | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card][proxy] |
| Claude Sonnet 4.6 | thinking off, max effort, tools | knowledge_synthesis | BrowseComp single-agent | 64.69% at 1M; 69.67% at 3M; 74.01% at 10M | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Sonnet 4.6 | max effort, multi-agent | knowledge_synthesis | BrowseComp multi-agent | 82.07% | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| Claude Sonnet 4.6 | adaptive thinking, max effort, tools, 10M compaction | knowledge_synthesis | DeepSearchQA F1 | 90.5%; fully correct 79.8%; fully incorrect 5.1%; excessive 5.9% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card][vendor cross-card] |
| GPT-5.5 | xhigh research effort | knowledge_synthesis | GPQA Diamond | 93.6% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.4 | xhigh research effort | knowledge_synthesis | GPQA Diamond | 92.8% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.4 Pro | xhigh research effort | knowledge_synthesis | GPQA Diamond | 94.4% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.5 | xhigh research effort, no tools | knowledge_synthesis | HLE | 41.4% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.4 | xhigh research effort, no tools | knowledge_synthesis | HLE | 39.8% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.5 Pro | xhigh research effort, no tools | knowledge_synthesis | HLE | 43.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.4 Pro | xhigh research effort, no tools | knowledge_synthesis | HLE | 42.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.5 | xhigh research effort, tools | knowledge_synthesis | HLE | 52.2% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.4 | xhigh research effort, tools | knowledge_synthesis | HLE | 52.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.5 Pro | xhigh research effort, tools | knowledge_synthesis | HLE | 57.2% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.4 Pro | xhigh research effort, tools | knowledge_synthesis | HLE | 58.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][proxy] |
| GPT-5.5 | xhigh research effort, tools | knowledge_synthesis | BrowseComp | 84.4% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| GPT-5.4 | xhigh research effort, tools | knowledge_synthesis | BrowseComp | 82.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| GPT-5.5 Pro | xhigh research effort, tools | knowledge_synthesis | BrowseComp | 90.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |
| GPT-5.4 Pro | xhigh research effort, tools | knowledge_synthesis | BrowseComp | 89.3% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][INFERRED deep-research proxy] |

## Modifier Rows

| model | effort | category-or-modifier | benchmark | raw score | source-url | label |
|---|---|---|---|---|---|---|
| Claude Opus 4.8 | API/docs | context_size | model limit | 1M tokens context; 128k max output | https://platform.claude.com/docs/en/about-claude/models/overview | [UNVERIFIED][Tier1 vendor-doc] |
| Claude Sonnet 4.6 | API/docs | context_size | model limit | 1M tokens context; 64k max output | https://platform.claude.com/docs/en/about-claude/models/overview | [UNVERIFIED][Tier1 vendor-doc] |
| Claude Haiku 4.5 | API/docs | context_size | model limit | 200k tokens context; 64k max output | https://platform.claude.com/docs/en/about-claude/models/overview | [UNVERIFIED][Tier1 vendor-doc] |
| GPT-5.5 | API/docs | context_size | model limit | 1,050,000 context window; 128,000 max output tokens | https://developers.openai.com/api/docs/models/gpt-5.5/ | [UNVERIFIED][Tier1 vendor-doc] |
| GPT-5.5 Codex | Codex product | context_size | Codex limit | 400K context window | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card][output ceiling GAP] |
| Claude Opus 4.8 | max effort | context_size | GraphWalks BFS 256K F1 | 85.9% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort | context_size | GraphWalks BFS 1M F1 | 68.1% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort | context_size | GraphWalks parents 256K F1 | 99.3% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort | context_size | GraphWalks parents 1M F1 | 83.3% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | GraphWalks BFS 256K F1 | 73.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | GraphWalks BFS 1M F1 | 45.4% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | GraphWalks parents 256K F1 | 90.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | GraphWalks parents 1M F1 | 58.5% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | OpenAI MRCR v2 8-needle 128K-256K | 87.5% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | OpenAI MRCR v2 8-needle 256K-512K | 81.5% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | context_size | OpenAI MRCR v2 8-needle 512K-1M | 74.0% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort, no tools | perception_required | CharXiv reasoning | 80.5% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort, Python tools | perception_required | CharXiv reasoning | 89.9% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort, no tools | perception_required | ScreenSpot-Pro | 82.3% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort, Python tools | perception_required | ScreenSpot-Pro | 87.9% | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.7 | max effort, no tools | perception_required | CharXiv reasoning | 82.1% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.7 | max effort, Python tools | perception_required | CharXiv reasoning | 91.0% | https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.6 | max effort, no tools | perception_required | MMMU-Pro | 73.9% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.6 | max effort, image-cropping tool | perception_required | MMMU-Pro | 77.3% | https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Sonnet 4.6 | max effort, no tools | perception_required | MMMU-Pro | 74.5% | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card] |
| Claude Sonnet 4.6 | max effort, image-cropping tool | perception_required | MMMU-Pro | 75.6% | https://anthropic.com/claude-sonnet-4-6-system-card | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort, no tools | perception_required | MMMU Pro | 81.2% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort, with tools | perception_required | MMMU Pro | 83.2% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.4 | xhigh research effort, no tools | perception_required | MMMU Pro | 81.2% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.4 | xhigh research effort, with tools | perception_required | MMMU Pro | 82.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | max effort | long_horizon | Vending-Bench 2 final balance | $2,992.34 | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| Claude Opus 4.8 | high effort | long_horizon | Vending-Bench 2 final balance | $5,787.43 | https://cdn.sanity.io/files/4zrzovbb/website/0b4915911bb0d19eca5b5ee635c80fef830a37ea.pdf | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.5 | xhigh research effort | long_horizon | Terminal-Bench 2.0 | 82.7% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| GPT-5.4 | xhigh research effort | long_horizon | Terminal-Bench 2.0 | 75.1% | https://openai.com/index/introducing-gpt-5-5/ | [UNVERIFIED][Tier1 vendor-card] |
| Claude family | API/docs | data_sensitivity | ZDR/HIPAA feature eligibility | Messages API yes/yes; 1M context yes/yes; strict schema PHI restriction | https://platform.claude.com/docs/en/manage-claude/api-and-data-retention | [UNVERIFIED][Tier1 vendor-doc][support-only] |
| OpenAI business/API | policy/docs | data_sensitivity | enterprise/API data handling | business data not trained by default; API inputs/outputs retained up to 30 days except listed endpoints/features; ZDR available for eligible endpoints | https://openai.com/enterprise-privacy/ | [UNVERIFIED][Tier1 vendor-doc][support-only] |

## Mechanical And Gap Rows

| model | effort | category-or-modifier | benchmark | raw score | source-url | label |
|---|---|---|---|---|---|---|
| all scoped Claude/OpenAI models | all searched | mechanical | StructEval | [GAP] benchmark definition found, but no original current-generation raw score found | https://arxiv.org/abs/2505.20139 | [GAP][Tier4 source checked] |
| all scoped Claude/OpenAI models | all searched | mechanical | IFEval / IFBench | [GAP] benchmark definitions found, but no original current-generation raw score found; OpenAI launch extraction showed no IFEval raw row | https://arxiv.org/abs/2311.07911 | [GAP][Tier4 source checked] |
| all scoped Claude/OpenAI models | all searched | mechanical | BFCL-AST | [GAP] BFCL V4 page last updated 2026-04-12, but no scoped current-model rows were visible in fetched text | https://gorilla.cs.berkeley.edu/leaderboard | [GAP][Tier3 leaderboard checked] |
| all scoped Claude/OpenAI models | docs only | mechanical | structured-output evals | [GAP] feature support found, no raw benchmark score found | https://developers.openai.com/api/docs/models/gpt-5.5/ | [GAP][support-only] |
| Claude Haiku 4.5 | all searched | knowledge_synthesis | RULER/LongBench v2/HELMET/InfiniteBench/FActScore/FRAMES/DeepResearch/GPQA/HLE/MMLU-Pro | [GAP] no original public raw score found in Haiku 4.5 card | https://www-cdn.anthropic.com/7aad69bf12627d42234e01ee7c36305dc2f6a970.pdf | [GAP] |
| GPT-5.5 Instant / Codex / chat-latest | all searched | knowledge_synthesis | GPQA/HLE/MMLU-Pro/BrowseComp/DeepSearchQA | [GAP] no separate original score rows found beyond GPT-5.5 family launch rows | https://openai.com/index/introducing-gpt-5-5/ | [GAP] |
| scoped current models | all searched | context_size | LongBench v2 | [GAP] BenchLM current LongBench v2 leaderboard did not include scoped current GPT-5.5 or Claude Opus 4.8/Sonnet 4.6/Haiku 4.5 rows | https://benchlm.ai/benchmarks/longBenchV2 | [GAP][Tier2 aggregator checked] |
| scoped current models | all searched | knowledge_synthesis | FActScore / FRAMES / DeepResearch Bench | [GAP] no original current-model raw rows found in this pass | https://arxiv.org/abs/2506.11763 | [GAP][Tier4 source checked for benchmark definition] |

## Notes

- OpenAI launch-page evaluation rows state GPT evals used xhigh reasoning effort in a research environment; effort labels above follow that page.
- Claude Opus 4.6 DeepSearchQA has two raw rows because Anthropic reports an older 10M compaction setup and a newer 1M no-compaction rerun. They are not averaged.
- Vendor cards contain cross-family comparison values, but rows above use each vendor only for its own model family unless explicitly labeled as vendor cross-card.
- `mechanical` remains the largest evidence gap: public support for structured outputs/function calling exists, but raw StructEval/IFEval/BFCL-AST scores for the scoped current models were not found.
