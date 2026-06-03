# Phase 1.6 Agent B - Gap-Fill Research

Run: 2026-06-03 Full-mode re-profile. Retrieved at: 2026-06-03T13:24:18.4632704-07:00.

Scope: flagged gaps for `data_analysis`, `agentic_execution`, `architecture`, and `coding`. Binding policy applied: withdrawn vendor self-reports are discarded; thin/vendor-only rows do not move tiers unless they clear the Phase 1.5 policy band. Raw values below are not normalized.

## Findings

- [SEED] Data-analysis coverage remains sparse for scoped current generation. GPT-5.5 has a direct BIRD-SQL row; GPT-5 rows appear on Spider 2.0/TableBench but are not equivalent to GPT-5.5. No Claude Opus 4.8 row was found on Spider 2.0, BIRD-SQL, DABstep, or TableBench.
- [SEED] Terminal-Bench 2.1 favors GPT-5.5 on terminal/CLI agent execution. The current official board reports both product-native harness rows and apples-to-apples Terminus 2 rows.
- [SEED] GDPval-AA favors Claude Opus 4.8 on professional work-product tasks with web/shell access. This is an Artificial Analysis independent Elo board.
- [UNVERIFIED] OSWorld-Verified favors Claude Opus 4.8 on GUI/computer-use tasks, but the current Opus 4.8 row is available from Anthropic's system card/news rather than the OSWorld static page text.
- [SEED] Architecture/planning remains a direct-data gap for scoped models. PlanBench, NATURAL-PLAN, and ACPBench/ACPBench-Hard do not expose Claude Opus 4.8 or GPT-5.5 rows; SWE-bench Pro remains the low-confidence proxy.
- [SEED] Coding has independent current GPT-5.5 corroboration outside the withdrawn SWE-bench Verified self-report: DeepSWE, ProgramBench, Voratiq, and Scale SWE-bench Pro public all carry current GPT-5.x-family or GPT-5.5 coding rows. DeepSWE and ProgramBench are the cleanest GPT-5.5-specific held-out rows found in this pass.

## Raw Values

| category | benchmark | subtype / measurement | model | raw value | source label | source |
|---|---|---|---|---|---|---|
| data_analysis | Spider 2.0 Snow | enterprise text-to-SQL workflow success | Claude Opus 4.8 | GAP - no row found | [SEED] | https://spider2-sql.github.io/ |
| data_analysis | Spider 2.0 Snow | enterprise text-to-SQL workflow success | GPT-5.5 | GAP - no row found | [SEED] | https://spider2-sql.github.io/ |
| data_analysis | Spider 2.0 Snow | nearest current-family row, not GPT-5.5 | SSDAT + GPT-5 | 65.63 | [SEED] | https://spider2-sql.github.io/ |
| data_analysis | Spider 2.0 Snow | nearest Claude Opus current row, not Opus 4.8 | QUVI-3 + Claude-Opus-4.6 | 86.28 | [SEED] | https://spider2-sql.github.io/ |
| data_analysis | BIRD-SQL single trained model track | execution accuracy, test column | GPT-5.5-xhigh | 72.55 | [SEED] | https://bird-bench.github.io/ |
| data_analysis | BIRD-SQL single trained model track | execution accuracy, test column | Claude Opus 4.8 | GAP - no row found | [SEED] | https://bird-bench.github.io/ |
| data_analysis | BIRD-SQL single trained model track | nearest Opus row, not Opus 4.8 | Claude Opus 4.6 | New Dev 68.77; Test 70.15 | [SEED] | https://bird-bench.github.io/ |
| data_analysis | DABstep | hard-task accuracy | best agent, unspecified | 14.55% | [SEED] | https://arxiv.org/abs/2506.23719 |
| data_analysis | DABstep | per-model hard-task accuracy | GPT-5.5 | GAP - no per-model row found | [SEED] | https://arxiv.org/abs/2506.23719 |
| data_analysis | DABstep | per-model hard-task accuracy | Claude Opus 4.8 | GAP - no per-model row found | [SEED] | https://arxiv.org/abs/2506.23719 |
| data_analysis | TableBench | overall table QA score | GPT-5.5 | GAP - no row found | [SEED] | https://tablebench.github.io/ |
| data_analysis | TableBench | overall table QA score | Claude Opus 4.8 | GAP - no row found | [SEED] | https://tablebench.github.io/ |
| data_analysis | TableBench | nearest current-family row, not GPT-5.5 | GPT-5 + DP | Overall 59.94; FC 83.33; NR 82.37; DA 36.04; VIZ 58.0 | [SEED] | https://tablebench.github.io/ |
| agentic_execution | Terminal-Bench 2.1 | product-native harness, terminal/CLI tasks | GPT-5.5 via Codex CLI | 83.4% +/- 2.2 | [SEED] | https://www.tbench.ai/leaderboard/terminal-bench/2.1 |
| agentic_execution | Terminal-Bench 2.1 | product-native harness, terminal/CLI tasks | Claude Opus 4.8 via Claude Code | 78.9% +/- 2.5 | [SEED] | https://www.tbench.ai/leaderboard/terminal-bench/2.1 |
| agentic_execution | Terminal-Bench 2.1 | apples-to-apples public Terminus 2 harness | GPT-5.5 | 78.2% +/- 2.4 | [SEED] | https://www.tbench.ai/leaderboard/terminal-bench/2.1 |
| agentic_execution | Terminal-Bench 2.1 | apples-to-apples public Terminus 2 harness | Claude Opus 4.8 | 74.6% +/- 2.4 | [SEED] | https://www.tbench.ai/leaderboard/terminal-bench/2.1 |
| agentic_execution | OSWorld-Verified | GUI/computer-use, pass@1 over 361 tasks / five seeds | Claude Opus 4.8 | 83.4% | [UNVERIFIED] | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf |
| agentic_execution | OSWorld-Verified | GUI/computer-use | GPT-5.5 | 78.7% | [UNVERIFIED] | https://openai.com/index/introducing-gpt-5-5/ |
| agentic_execution | GDPval-AA | professional work-product Elo with web/shell agent loop | Claude Opus 4.8, adaptive reasoning max | 1890; CI -34/+35 | [SEED] | https://artificialanalysis.ai/evaluations/gdpval-aa |
| agentic_execution | GDPval-AA | professional work-product Elo with web/shell agent loop | GPT-5.5 xhigh | 1769; CI -32/+31 | [SEED] | https://artificialanalysis.ai/evaluations/gdpval-aa |
| architecture | PlanBench static test set | Blocksworld NL / Mystery variants | Claude Opus 4.8 | GAP - no row found | [SEED] | https://github.com/harshakokel/PlanBench |
| architecture | PlanBench static test set | Blocksworld NL / Mystery variants | GPT-5.5 | GAP - no row found | [SEED] | https://github.com/harshakokel/PlanBench |
| architecture | ACPBench / ACPBench-Hard | planning/action-change reasoning tasks | Claude Opus 4.8 | GAP - no row found | [SEED] | https://ibm.github.io/ACPBench/ |
| architecture | ACPBench / ACPBench-Hard | planning/action-change reasoning tasks | GPT-5.5 | GAP - no row found | [SEED] | https://ibm.github.io/ACPBench/ |
| architecture | NATURAL-PLAN | trip/meeting/calendar natural-language planning | Claude Opus 4.8 | GAP - no row found | [SEED] | https://arxiv.org/abs/2406.04520 |
| architecture | NATURAL-PLAN | trip/meeting/calendar natural-language planning | GPT-5.5 | GAP - no row found | [SEED] | https://arxiv.org/abs/2406.04520 |
| architecture | YC-Bench | long-term simulated-startup planning, not pure architecture | Claude Opus 4.6 | $1.27M average final funds | [SEED] | https://arxiv.org/abs/2604.01212 |
| architecture | SWE-bench Pro | low-confidence proxy for multi-file planning | Claude Opus 4.8 | 69.2% | [UNVERIFIED] | https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf |
| architecture | SWE-bench Pro | low-confidence proxy for multi-file planning | GPT-5.5 | 58.6% | [UNVERIFIED] | https://openai.com/index/introducing-gpt-5-5/ |
| coding | DeepSWE | novel long-horizon software engineering tasks | GPT-5.5 | 70% +/- 4% | [SEED] | https://deepswe.datacurve.ai/blog |
| coding | DeepSWE | novel long-horizon software engineering tasks | Claude Opus 4.7 | 54% | [SEED] | https://deepswe.datacurve.ai/blog |
| coding | ProgramBench | cleanroom program reconstruction, 200 tasks | GPT-5.5 xhigh | Resolved 0.5%; almost resolved 13.5% | [SEED] | https://programbench.com/ |
| coding | ProgramBench | cleanroom program reconstruction, 200 tasks | GPT-5.5 high | Resolved 0.5%; almost resolved 5.0% | [SEED] | https://programbench.com/ |
| coding | Scale SWE-bench Pro public | long-horizon software engineering public dataset | GPT-5.4 xHigh | 59.1 | [SEED] | https://labs.scale.com/api/pdf/leaderboard/swe_bench_pro_public |
| coding | Scale SWE-bench Pro public | long-horizon software engineering public dataset | Claude Opus 4.6 thinking | 51.9 | [SEED] | https://labs.scale.com/api/pdf/leaderboard/swe_bench_pro_public |
| coding | Voratiq agent leaderboard | coding-agent rating, duration, cost | GPT-5.5 xhigh | Rating 1996; interval 1958-2031; 12.7m; $4.80 | [SEED] | https://voratiq.com/leaderboard/ |

## Reconciliations

Terminal-Bench vs OSWorld/GDPval is a sub-type split, not a single-leader contradiction. Terminal-Bench 2.1 measures terminal and command-line environments; it favors GPT-5.5 in both product-native and Terminus 2 harness views. OSWorld-Verified measures GUI computer use through mouse/keyboard actions in a live Ubuntu VM; the current available Opus 4.8 figure favors Claude but is vendor-card sourced. GDPval-AA measures complete professional work products with web and shell access, scored by blind pairwise comparisons into Elo; the independent Artificial Analysis board favors Claude Opus 4.8 by 121 Elo over GPT-5.5 xhigh.

Architecture remains a proxy-only tile for the scoped versions. PlanBench has o1/DeepSeek R1-era rows, NATURAL-PLAN is still anchored in 2024 GPT-4/Gemini 1.5 Pro-era results, and ACPBench/ACPBench-Hard has no scoped current-gen rows. YC-Bench is a 2026 long-term planning benchmark, but it reports Opus 4.6 rather than Opus 4.8/GPT-5.5 and is closer to long-horizon agentic execution than pure architecture planning.

Coding no longer depends on the withdrawn GPT-5.5 SWE-bench Verified self-report. DeepSWE and ProgramBench provide current GPT-5.5-specific held-out coding numbers; Scale SWE-bench Pro public provides a current independent long-horizon coding board but does not yet carry GPT-5.5 in the fetched PDF.

## Remaining Gaps

- No direct Claude Opus 4.8 data-analysis row found on Spider 2.0, BIRD-SQL, DABstep, or TableBench.
- No direct GPT-5.5 row found on Spider 2.0, DABstep, or TableBench; GPT-5 rows are not substituted.
- No independent OSWorld-Verified public static row for Opus 4.8 was visible in fetched OSWorld page text; current Opus 4.8 value remains vendor-card sourced.
- No current-gen direct planning rows found for Opus 4.8 or GPT-5.5 on PlanBench, ACPBench/ACPBench-Hard, or NATURAL-PLAN.
- No DeepSWE row for Claude Opus 4.8 found in the fetched original page; closest row is Opus 4.7.
- No Scale SWE-bench Pro public row for GPT-5.5 or Opus 4.8 in the fetched PDF; closest rows are GPT-5.4 xHigh and Opus 4.6 thinking.

## Source Locators

| url | retrieved_at | annotation | label |
|---|---|---|---|
| https://spider2-sql.github.io/ | 2026-06-03T13:24:18.4632704-07:00 | Official Spider 2.0 leaderboard; shows GPT-5 and Opus 4.6-era rows but no GPT-5.5 or Opus 4.8 rows. | [SEED] |
| https://bird-bench.github.io/ | 2026-06-03T13:24:18.4632704-07:00 | Official BIRD-SQL leaderboard; contains GPT-5.5-xhigh 72.55 and Opus 4.6 70.15 but no Opus 4.8. | [SEED] |
| https://arxiv.org/abs/2506.23719 | 2026-06-03T13:24:18.4632704-07:00 | DABstep benchmark paper; reports best-agent 14.55% hard-task accuracy without scoped per-model rows. | [SEED] |
| https://tablebench.github.io/ | 2026-06-03T13:24:18.4632704-07:00 | Official TableBench leaderboard; shows GPT-5 + DP but no GPT-5.5 or Opus 4.8 rows. | [SEED] |
| https://www.tbench.ai/leaderboard/terminal-bench/2.1 | 2026-06-03T13:24:18.4632704-07:00 | Official Terminal-Bench 2.1 board; current GPT-5.5 and Opus 4.8 terminal/CLI rows. | [SEED] |
| https://os-world.github.io/ | 2026-06-03T13:24:18.4632704-07:00 | Official OSWorld page defines OSWorld-Verified and public-evaluation process; dynamic current rows were not visible in fetched text. | [SEED] |
| https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf | 2026-06-03T13:24:18.4632704-07:00 | Anthropic Opus 4.8 system card; source for Opus 4.8 OSWorld, SWE-bench Pro, Terminal-Bench, and cross-family table. | [UNVERIFIED] |
| https://openai.com/index/introducing-gpt-5-5/ | 2026-06-03T13:24:18.4632704-07:00 | OpenAI GPT-5.5 launch page; source for GPT-5.5 OSWorld, Terminal-Bench 2.0, and SWE-bench Pro self-report rows. | [UNVERIFIED] |
| https://artificialanalysis.ai/evaluations/gdpval-aa | 2026-06-03T13:24:18.4632704-07:00 | Independent GDPval-AA leaderboard with Opus 4.8 1890 and GPT-5.5 xhigh 1769 Elo rows. | [SEED] |
| https://github.com/harshakokel/PlanBench | 2026-06-03T13:24:18.4632704-07:00 | PlanBench static leaderboard; no scoped current-gen Opus 4.8 or GPT-5.5 planning rows. | [SEED] |
| https://ibm.github.io/ACPBench/ | 2026-06-03T13:24:18.4632704-07:00 | ACPBench/ACPBench-Hard project page; no scoped current-gen rows found. | [SEED] |
| https://arxiv.org/abs/2406.04520 | 2026-06-03T13:24:18.4632704-07:00 | NATURAL-PLAN paper; 2024 planning benchmark with GPT-4/Gemini 1.5-era rows only. | [SEED] |
| https://arxiv.org/abs/2604.01212 | 2026-06-03T13:24:18.4632704-07:00 | YC-Bench 2026 long-term planning paper; useful context but not scoped Opus 4.8/GPT-5.5 architecture data. | [SEED] |
| https://deepswe.datacurve.ai/blog | 2026-06-03T13:24:18.4632704-07:00 | DeepSWE official page; independent current GPT-5.5 held-out coding row and task-design details. | [SEED] |
| https://programbench.com/ | 2026-06-03T13:24:18.4632704-07:00 | ProgramBench official leaderboard; current cleanroom GPT-5.5 coding rows. | [SEED] |
| https://labs.scale.com/api/pdf/leaderboard/swe_bench_pro_public | 2026-06-03T13:24:18.4632704-07:00 | Scale SWE-bench Pro public PDF; current independent long-horizon coding board with GPT-5.4 and Opus 4.6 rows. | [SEED] |
| https://voratiq.com/leaderboard/ | 2026-06-03T13:24:18.4632704-07:00 | Voratiq coding-agent leaderboard; current GPT-5.5 xhigh rating row. | [SEED] |
