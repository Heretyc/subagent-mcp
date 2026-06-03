## 7. Decision Rules — Pick THIS Claude Model + Effort When…

These rules are operationally ordered: first match wins. More specific rules take priority over general ones.

### 7.1 Model Selection Rules

**RULE C1 — Opus 4.8, xhigh/max effort:**
Use when the task is: unattended autonomous engineering (long-horizon), codebase-scale migration, multi-hour Claude Code session, multi-agent orchestration requiring the orchestrator to be maximally capable, computer use / browser automation at production quality, legal/financial domain work requiring certified accuracy. Cost: premium (but fast mode at 2.5× speed available for latency-sensitive versions of these tasks).

**RULE C2 — Opus 4.8, medium/low effort:**
Use when: you need Opus 4.8-quality judgment for individual routing or classification decisions within a larger agentic workflow, but don't need deep per-step reasoning. Dramatically cheaper than high/xhigh. Example: an orchestrator deciding which subagent to route a task to, where the routing decision is high-stakes.

**RULE C3 — Sonnet 4.6, medium effort:**
Default rule for: [agentic mention removed] tasks, debug and review, complex analysis with tools, RAG pipelines, multi-step content generation, production coding assistants. The cost-quality sweet spot for the vast majority of developer workflows. Math, code review, architecture feedback at 5× cheaper than Opus 4.8 with minimal capability loss.

**RULE C4 — Sonnet 4.6, high/max effort:**
Use when: complex reasoning task where quality matters and moderate latency is acceptable, context-heavy code review requiring deep analysis, or when `medium` effort evaluations show a meaningful quality gap on your specific workload.

**RULE C5 — Sonnet 4.6, low effort:**
Use when: high-volume or latency-sensitive tasks where Haiku 4.5 lacks the 1M context window needed (e.g., full-codebase search requiring >200k context but fast turnaround).

**RULE C6 — Haiku 4.5:**
Use when: the task is classification, extraction, formatting, routing decisions, simple file reads/writes, boilerplate generation, straight-line refactors, customer service chat, inline completions. Haiku 4.5 matches Sonnet quality on tasks that don't exercise the reasoning gap. Cost: 5× cheaper than Sonnet 4.6, 25× cheaper than Opus 4.8.

**RULE C7 — Haiku 4.5 with extended thinking (manual):**
Use when: a high-volume task occasionally requires deeper reasoning (e.g., a Haiku subagent that usually does simple extraction but sometimes encounters complex multi-step problems). Set `budget_tokens` to a reasonable cap. Haiku 4.5 is the only current model requiring manual `budget_tokens`.

**RULE C8 — Opus 4.6 (legacy only):**
Use when: you have existing prompts written for Opus 4.6's softer instruction-following that would break on 4.7/4.8's stricter mode, AND the cost of rewriting prompts exceeds the performance benefit of migrating. Otherwise migrate to Opus 4.8. [INFERRED]

**RULE C9 — Sonnet 4.5 (legacy only):**
Use only if: 200k context is sufficient AND you have unresolved prompt compatibility issues with Sonnet 4.6. Otherwise migrate. [INFERRED]

### 7.2 Effort Selection Rules (Given a Model Choice)

**RULE E1 — Use `xhigh` as your starting point for all agentic/coding on Opus 4.7/4.8.**
This is the official Anthropic recommendation. Step up to `max` only when evals show measurable headroom. Step down to `high` for tasks where you've measured `xhigh` adds cost without quality gain. [OFFICIAL]

**RULE E2 — Use `medium` as your starting point for Sonnet 4.6 in production.**
The official Anthropic recommendation. Only move to `high` after measuring that `medium` underperforms on your task. [OFFICIAL]

**RULE E3 — Use `low` for any step in an agentic pipeline that is read-only or deterministically scoped.**
File reads, database lookups, simple reformatting, routing decisions. The capability reduction at `low` does not matter for these tasks. [OFFICIAL]

**RULE E4 — Use `max` only when you have benchmark evidence that `xhigh`/`high` falls short.**
On structured-output tasks, `max` can cause overthinking, degrading quality. Only justified for frontier-level reasoning problems. [OFFICIAL]

**RULE E5 — Enable adaptive thinking (`thinking: {type: "adaptive"}`) for any multi-step reasoning or agentic task on Opus 4.8/4.7/4.6/Sonnet 4.6.**
Without adaptive thinking, these models behave as standard completion models — no internal reasoning, no interleaved thinking between tool calls. The gains on bimodal workloads (some easy, some hard steps) are particularly large with adaptive vs fixed `budget_tokens`. [OFFICIAL]

**RULE E6 — Set `max_tokens` to at least 64k when using Opus 4.7/4.8 at `xhigh` or `max`.**
The model needs room to think and act across subagents and tool calls. Hitting `stop_reason: "max_tokens"` during a reasoning trace truncates reasoning quality. Starting at 64k and tuning down is safer than starting low. [OFFICIAL]

**RULE E7 — Do NOT set temperature, top_p, or top_k on Opus 4.7/4.8.**
These return 400 errors. Port any stochasticity controls to prompting techniques instead. [OFFICIAL]

### 7.3 Fast Mode Rules (Opus 4.8 Only)

**RULE F1 — Use fast mode when:** streaming to end-users who perceive latency as a quality signal, real-time computer use / browser agent tasks, high-stakes agentic workflows where wall-clock time matters more than cost premium.
Pricing: $10/$50 MTok (2× standard cost, but 2.5× throughput speed).

**RULE F2 — Do NOT use fast mode for:** batch/async workloads (use Message Batches API at 50% discount instead), cost-sensitive pipelines, offline analysis tasks.

### 7.4 Context Window Rules

**RULE W1 — Tasks requiring >200k tokens:** Must use Opus 4.8/4.7/4.6 or Sonnet 4.6 (all 1M context). Haiku 4.5 and Sonnet 4.5 have 200k hard limit.

**RULE W2 — Tasks fitting comfortably in 200k:** Haiku 4.5 or Sonnet 4.5 are viable. Cost savings are significant.

**RULE W3 — Microsoft Foundry deployments:** Opus 4.8 has only 200k context on Foundry. Must account for this in architecture. [OFFICIAL]
