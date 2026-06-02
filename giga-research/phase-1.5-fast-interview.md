# Phase 1.5 — Fast-mode Interview (10 questions)

Derived from the 5 Phase-1 reports. Answers are AUTHORITATIVE steering for Phase 2 synthesis and downstream KB design.

1. Work categories (Haiku scope) — Define a CLEAN, DETERMINISTIC, SMALL set of broad work categories an agent can classify a prompt into (one category = "coding"). Avoid fine-grained LOC thresholds; favor broad, agent-classifiable categories.
2. Opus 4.8 capability gain — Task-split framing: clear leader on agentic/long-horizon tasks, roughly equal on isolated coding. No hyperbole.
3. Cross-provider IPC vs Managed Agents — Anthropic Managed Agents API is OUT OF SCOPE / irrelevant to this project. Target = local Claude Code + Codex CLI fleet; temp-file IPC is valid there.
4. GPT-5.5 security recommendation — Conditional: initial security pass only; mandate Claude (Opus/Sonnet) cross-review for concurrent/auth/permission-critical code before commit.
5. Effort default — Task-class defaults: effort is determined by work category, not per-model.
6. KB scope / PURPOSE — The KB feeds a NEW subagent-mcp feature: an agent submits a prompt plus a broad work-category, and the MCP distributes work among providers (Claude/Codex) intelligently using the predefined categories this research defines. The taxonomy and routing MUST be machine-consumable.
7. Tokenizer-inflation cost — Use inflation-adjusted (~1.4x nominal effective cost) for Opus 4.7/4.8 in all cost comparisons; flag prominently as a migration surprise.
8. Seed corpus authority — Treat Blackburn (2026) seed directive as HYPOTHESIS / starting point only; official docs + verified benchmarks override on conflict; label seed-derived rules [SEED] with corroboration status.
9. GPT-5.5 context-size gate — HARD gate: input >200K tokens -> prefer Claude (Sonnet 4.6 / Opus 4.8); >272K and cost-sensitive -> mandatory redirect off GPT-5.5.
10. Math/proof routing — Route ALL math/proof tasks -> GPT-5.5.

Session date: 2026-05-29. Mechanism: Claude Code AskUserQuestion (3 batches: 4+4+2).
