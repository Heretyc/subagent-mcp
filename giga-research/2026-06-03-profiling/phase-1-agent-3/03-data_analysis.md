# Phase 1 Agent 3 — Data Analysis Category

**Category:** data_analysis (precedence 7, NET-NEW tile)
**Findability:** strong
**Benchmark families:** Spider 2.0 · BIRD-SQL · DABstep · TableBench · DS-1000

---

## Raw Scores Table

### Spider 2.0 (enterprise SQL workflows)

Spider 2.0 has two splits: **Snow** (Snowflake) and **Lite** (cross-platform).
Success rate = task completion %, not just query accuracy.

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| gpt-5 (specialized agent) | high | data_analysis | spider2-snow | 65.63% | https://spider2-sql.github.io/ | [SEED] |
| claude-sonnet-4 (May 2025) | default | data_analysis | spider2-snow | 25.78% | https://spider2-sql.github.io/ | [SEED] |
| claude-3.7-sonnet (thinking) | default | data_analysis | spider2-lite | 28.52% | https://spider2-sql.github.io/ | [SEED] |
| claude-sonnet-4 (May 2025) | default | data_analysis | spider2-lite | 27.79% | https://spider2-sql.github.io/ | [SEED] |
| claude-3.7-sonnet | default | data_analysis | spider2-snow | 24.50% | https://spider2-sql.github.io/ | [SEED] |
| claude-3.7-sonnet | default | data_analysis | spider2-lite | 25.41% | https://spider2-sql.github.io/ | [SEED] |
| o1-preview | default | data_analysis | spider2-snow | 23.58% | https://spider2-sql.github.io/ | [SEED] |
| o3-mini | default | data_analysis | spider2-lite | 23.40% | https://spider2-sql.github.io/ | [SEED] |
| gpt-4o | default | data_analysis | spider2-snow | 12.98% | https://spider2-sql.github.io/ | [SEED] |
| gpt-4o | default | data_analysis | spider2-lite | 13.16% | https://spider2-sql.github.io/ | [SEED] |
| claude-opus-4-8 | default | data_analysis | spider2-snow | GAP | https://spider2-sql.github.io/ | [GAP] |
| gpt-5.5 | default | data_analysis | spider2-snow | GAP | https://spider2-sql.github.io/ | [GAP] |
| claude-haiku-4-5 | default | data_analysis | spider2-snow | GAP | https://spider2-sql.github.io/ | [GAP] |

**Note:** "claude-sonnet-4 (May 2025)" API ID = claude-sonnet-4-20250514; this is likely claude-sonnet-4-5 or 4.6 per Anthropic dating, not confirmed as claude-sonnet-4-6. "gpt-5 (specialized agent)" is a framework-wrapped GPT-5; not confirmed as gpt-5.5.

### BIRD-SQL (text-to-SQL, 12,751 Q&A pairs)

Metric = execution accuracy on development set.

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| gpt-5.5 | xhigh | data_analysis | bird-sql-dev-exec-acc | 72.55% | https://bird-bench.github.io/ | [SEED] |
| claude-opus-4-6 | default | data_analysis | bird-sql-dev-exec-acc | 70.15% | https://bird-bench.github.io/ | [SEED] |
| claude-sonnet-4-5 | default | data_analysis | bird-sql-dev-exec-acc | 66.85% | https://bird-bench.github.io/ | [SEED] |
| gpt-4o | default | data_analysis | bird-sql-dev-exec-acc | ~66-72% | https://bird-bench.github.io/ | [SEED] |
| gpt-4 | default | data_analysis | bird-sql-dev-exec-acc | 54.89% | https://bird-bench.github.io/ | [SEED] |
| claude-opus-4-8 | default | data_analysis | bird-sql-dev-exec-acc | GAP | https://bird-bench.github.io/ | [GAP] |
| claude-sonnet-4-6 | default | data_analysis | bird-sql-dev-exec-acc | GAP | https://bird-bench.github.io/ | [GAP] |
| claude-haiku-4-5 | default | data_analysis | bird-sql-dev-exec-acc | GAP | https://bird-bench.github.io/ | [GAP] |

**Note:** Best-performing system overall (AskData + GPT-4o) reaches 81.95% on BIRD; human baseline 92.96%.

### DABstep (multi-step data agent benchmark)

Metric = accuracy on hard tasks (450+ financial analytics challenges).

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| best-agent (unspecified) | default | data_analysis | dabstep-hard-acc | 14.55% | https://arxiv.org/html/2506.23719v1 | [SEED] |
| claude-opus-4-8 | default | data_analysis | dabstep-hard-acc | GAP | https://arxiv.org/html/2506.23719v1 | [GAP] |
| gpt-5.5 | default | data_analysis | dabstep-hard-acc | GAP | https://arxiv.org/html/2506.23719v1 | [GAP] |

### TableBench / DS-1000 / WikiTableQuestions

| model | effort | category | benchmark | raw_score | source_url | label |
|---|---|---|---|---|---|---|
| any scope model | default | data_analysis | tablebench | GAP | — | [GAP] |
| any scope model | default | data_analysis | ds-1000 | GAP | — | [GAP] |

---

## Gaps

- **Spider 2.0:** No claude-opus-4-8, gpt-5.5, or claude-haiku-4-5 entries on leaderboard
- **BIRD-SQL:** No claude-opus-4-8, claude-sonnet-4-6, or claude-haiku-4-5 entries
- **DABstep:** Per-model breakdown not surfaced; only aggregate best-agent figure
- **TableBench / DS-1000:** No current-gen scores surfaced

## Key Observations

- Spider 2.0 is dramatically harder than Spider 1.0: GPT-4o drops from ~86.6% (Spider 1.0) to ~13% (Spider 2.0)
- BIRD-SQL: gpt-5.5 (xhigh effort, 72.55%) edges claude-opus-4-6 (70.15%); agent frameworks add ~10pp above raw model
- DABstep is highly challenging: best agent only 14.55% on hard tasks; individual model scores likely <10%
- Data for current-gen claude-opus-4-8 and gpt-5.5 is sparse on data_analysis benchmarks; most recent entries are claude-opus-4-6 / claude-sonnet-4-5 vintage
