# Phase 2 — Core Synthesis #2: Cross-Provider Work-Category Routing for subagent-mcp

**Role:** Phase 2 core synthesizer (independent synthesis #2 of 5).
**Date:** 2026-05-29.
**Purpose:** Define a clean, deterministic, machine-consumable work-category taxonomy and routing layer for a `subagent-mcp` feature. An agent submits `{prompt, work_category}`; the MCP distributes the work across a **local Claude Code + Codex CLI fleet** using the categories and routes defined here. Temp-file IPC is the valid handoff channel; the Anthropic Managed Agents API is out of scope.

**Authority order (on conflict):** Official vendor docs + verified benchmarks **override** the Blackburn (2026) seed directive. Seed-derived claims are labeled `[SEED]` with corroboration status. Inferences are `[INFERRED]`; mandated working premises are `[ASSUMPTION]`.

---

**This file is an index.** Per the AGENTS.md <=200-line rule, the detailed sections live in the
same-named `phase-2-synth-2/` subdirectory. Read in order:

| § | Section | File |
|---|---------|------|
| 0 | TL;DR — The Routing Layer in One Screen | [phase-2-synth-2/01-tldr-routing-layer.md](phase-2-synth-2/01-tldr-routing-layer.md) |
| 1 | CANONICAL WORK-CATEGORY TAXONOMY (Section A, cards 1.1–1.9) | [phase-2-synth-2/02-work-category-taxonomy.md](phase-2-synth-2/02-work-category-taxonomy.md) |
| 2 | ROUTING PER CATEGORY (Section B, cards 2.1–2.8) | [phase-2-synth-2/03-routing-per-category.md](phase-2-synth-2/03-routing-per-category.md) |
| 3–4 | HARD GATES; COST MODEL (Section D.1) | [phase-2-synth-2/04-hard-gates-and-cost-model.md](phase-2-synth-2/04-hard-gates-and-cost-model.md) |
| 5–7 | FAILURE MODES (D.2); CROSS-PROVIDER SYNERGY PATTERNS; GOVERNANCE & HALT RULES (D.3) | [phase-2-synth-2/05-failures-synergy-governance.md](phase-2-synth-2/05-failures-synergy-governance.md) |
| 8 | MACHINE-CONSUMABLE CATEGORY → ROUTE TABLE (Section E) | [phase-2-synth-2/06-machine-consumable-route-table.md](phase-2-synth-2/06-machine-consumable-route-table.md) |
| 9–11 | CONDENSED CAPABILITY & RISK PROFILES (Section C); ASSUMPTION/INFERENCE/SEED LEDGER; REFERENCES | [phase-2-synth-2/07-profiles-ledger-references.md](phase-2-synth-2/07-profiles-ledger-references.md) |
