# Phase 2 — Core Synthesis #3: Deterministic Work-Category Routing for subagent-mcp

**Role:** Independent flagship synthesis #3 of 5. **Date:** 2026-05-29.
**Purpose:** Define a clean, deterministic, machine-consumable work-category taxonomy and category→route table that the `subagent-mcp` router loads to distribute a (prompt + category) across a local **Claude Code + Codex CLI** fleet. Managed Agents API is out of scope; temp-file IPC is the assumed transport.
**Label key:** `[SEED]` = Blackburn (2026) hypothesis; `[INFERRED]` = extrapolation from cited facts; `[ASSUMPTION]` = mandated premise accepted without re-litigation. Unlabeled claims trace to official docs / verified benchmarks (see References).

---

**This file is an index.** Per the AGENTS.md <=200-line rule, the detailed sections live in the
same-named `phase-2-synth-3/` subdirectory. Read in order:

| § | Section | File |
|---|---------|------|
| 0–1 | TL;DR — The Routing Contract in One Screen; Why these eight categories (design rationale) | [phase-2-synth-3/01-tldr-and-design-rationale.md](phase-2-synth-3/01-tldr-and-design-rationale.md) |
| 2 | Canonical Work-Category Taxonomy (A) — cards 2.1–2.8 | [phase-2-synth-3/02-work-category-taxonomy.md](phase-2-synth-3/02-work-category-taxonomy.md) |
| 3–5 | HARD GATES (B); Routing per Category (B); Mapping Agent-3's 20 task types → 8 categories | [phase-2-synth-3/03-hard-gates-routing-mapping.md](phase-2-synth-3/03-hard-gates-routing-mapping.md) |
| 6 | MACHINE-CONSUMABLE SCHEMA (E) — schema, 8 worked records, router pseudocode | [phase-2-synth-3/04-machine-consumable-schema.md](phase-2-synth-3/04-machine-consumable-schema.md) |
| 7–8 | Synergy patterns & anti-patterns (C-support); Per-provider/model capability + risk profiles (C) | [phase-2-synth-3/05-patterns-and-profiles.md](phase-2-synth-3/05-patterns-and-profiles.md) |
| 9–10 | Cost model (D, inflation-adjusted); Failure modes + mitigations, governance (D) | [phase-2-synth-3/06-cost-model-failures-governance.md](phase-2-synth-3/06-cost-model-failures-governance.md) |
| 11 + Refs | Seed-corpus corroboration status (Q8); References | [phase-2-synth-3/07-seed-corroboration-references.md](phase-2-synth-3/07-seed-corroboration-references.md) |
