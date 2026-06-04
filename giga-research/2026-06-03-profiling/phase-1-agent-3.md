# Phase 1 Agent 3 — Benchmark Capture Index

**Run:** 2026-06-03 Full-mode re-profile
**Agent scope:** architecture · agentic_execution · data_analysis · coding
**Model universe:** claude-opus-4-8 · claude-opus-4-7 · claude-sonnet-4-6 · claude-haiku-4-5 · gpt-5.5 · gpt-5.4-mini · gpt-5.5-pro

## Sub-files

| File | Category | Benchmarks covered |
|---|---|---|
| [01-coding.md](phase-1-agent-3/01-coding.md) | coding | SWE-bench Verified · Aider Polyglot · LiveCodeBench · SWE-bench Pro |
| [02-agentic_execution.md](phase-1-agent-3/02-agentic_execution.md) | agentic_execution | Terminal-Bench · OSWorld · GAIA · BFCL · GDPval · tau-bench |
| [03-data_analysis.md](phase-1-agent-3/03-data_analysis.md) | data_analysis | Spider 2.0 · BIRD-SQL · DABstep |
| [04-architecture.md](phase-1-agent-3/04-architecture.md) | architecture | SWE-bench Pro (proxy) · PlanBench · NATURAL-PLAN · ACPBench |

## Key Gaps (no current-gen scores found)

- **LiveCodeBench:** claude-opus-4-8 and gpt-5.5 not yet on official leaderboard (as of 2026-06-03)
- **BFCL V4:** Latest evaluated Claude is opus-4-5; no claude-opus-4-8 or gpt-5.5 entries
- **tau-bench:** No Claude or GPT-5.5 entries on current leaderboard
- **PlanBench / NATURAL-PLAN / ACPBench:** Only pre-2026 scores available; all current-gen gaps
- **DABstep:** No per-model scores; only aggregate best-agent figure
- **Aider polyglot:** No claude-opus-4-8 or claude-haiku-4-5 entries yet; gpt-5 ≠ confirmed gpt-5.5
- **Architecture tile:** Weakest findability confirmed — proxy-only via SWE-bench Pro

## Source Tier Legend

- **[SEED]** Direct fetch from official leaderboard (Tier 3)
- **[INFERRED]** Corroborated across Tier 2 aggregator + multiple secondary sources
- **[ASSUMPTION]** Single press/secondary source; not independently verified via leaderboard
- **[UNVERIFIED]** Vendor-only claim; no independent leaderboard corroboration

## Notes

- SWE-bench Verified is a shared anchor between `coding` and `debugging` (see benchmark-sources.md)
- OpenAI stopped self-reporting SWE-bench Verified in early 2026; recommends SWE-bench Pro
- "gpt-5" on Aider polyglot leaderboard is not confirmed identical to gpt-5.5 API ID
- GDPval uses a point scale (not %) — do not normalize with percentage benchmarks
