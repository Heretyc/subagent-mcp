# Phase 2 — Core Synthesis (CANONICAL MERGE): Cross-Provider Work-Category Routing for subagent-mcp

**Status:** Master pre-decomposition document. Reconciles five independent flagship syntheses (`phase-2-synth-1..5`) into ONE canonical core, steered by the authoritative Phase 1.5 interview. This document will be DECOMPOSED into a `.spec/references` RAG knowledge base and feeds a new `subagent-mcp` routing feature.

**Date:** 2026-05-29.
**Scope:** Local fleet only — **Claude Code + Codex CLI**. Sub-agent handoff is **temp-file JSON IPC**. The Anthropic Managed Agents API is **out of scope** (Interview Q3).
**Purpose (Interview Q6):** An agent submits `{prompt, work_category}`; the MCP applies hard gates, classifies into exactly one work category, then routes to a `{provider, model, effort}` with a fallback chain, a cross-provider validation pattern, and applicable gates. The taxonomy and routing are **machine-consumable** (§9).

**Label key (Interview Q8):** `[SEED]` = Blackburn (2026) hypothesis (corroboration noted); `[INFERRED]` = extrapolated from cited facts; `[ASSUMPTION]` = mandated working premise. **Unlabeled = official vendor docs / verified benchmark.** On conflict, official docs + verified benchmarks **override** the seed directive.

**Authority chain applied throughout:** (1) Phase 1.5 interview decisions are binding steering. (2) Official vendor docs + verified benchmarks override seed. (3) Conflicts between the five syntheses are resolved by **best-sourced evidence, not blind averaging** (§11), tracing to Phase-1 agent reports where needed.

---

**This file is an index.** Per the AGENTS.md <=200-line rule, the detailed sections live in the
same-named `phase-2-core-synthesis/` subdirectory. Read in order:

| § | Section | File |
|---|---------|------|
| 0 | TL;DR — The Routing Contract in One Screen (most load-bearing) | [phase-2-core-synthesis/01-tldr-routing-contract.md](phase-2-core-synthesis/01-tldr-routing-contract.md) |
| 1 | CANONICAL WORK-CATEGORY TAXONOMY (cards 1.1–1.9 + precedence 1.10) | [phase-2-core-synthesis/02-work-category-taxonomy.md](phase-2-core-synthesis/02-work-category-taxonomy.md) |
| 2–3 | ROUTING PER CATEGORY; GLOBAL HARD GATES | [phase-2-core-synthesis/03-routing-and-hard-gates.md](phase-2-core-synthesis/03-routing-and-hard-gates.md) |
| 4–5 | COST MODEL (inflation-adjusted); CONDENSED CAPABILITY + RISK PROFILES | [phase-2-core-synthesis/04-cost-model-and-capability-profiles.md](phase-2-core-synthesis/04-cost-model-and-capability-profiles.md) |
| 6–8 | CROSS-PROVIDER SYNERGY PATTERNS; FAILURE MODES & MITIGATIONS; GOVERNANCE & HALT RULES | [phase-2-core-synthesis/05-synergy-failures-governance.md](phase-2-core-synthesis/05-synergy-failures-governance.md) |
| 9 | MACHINE-CONSUMABLE CATEGORY → ROUTE TABLE (the MCP loads this) | [phase-2-core-synthesis/06-machine-consumable-route-table.md](phase-2-core-synthesis/06-machine-consumable-route-table.md) |
| 10–12 | SEED CORPUS STATUS; CONFLICT RECONCILIATION; References | [phase-2-core-synthesis/07-seed-status-reconciliation-references.md](phase-2-core-synthesis/07-seed-status-reconciliation-references.md) |
