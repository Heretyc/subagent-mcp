## PRIORITY INDEX — Most Impactful Concepts First

1. **Decision Rules** — the routing table you use every day (Section 7)
2. **Effort/Thinking System** — the most-misunderstood lever, controls cost AND quality (Section 5)
3. **Model Comparison Matrix** — specs, pricing, context, latency at a glance (Section 3)
4. **Per-Model Profiles** — strengths, failure modes, ideal tasks (Section 4)
5. **Benchmark Ledger** — citable numbers only (Section 6)
6. **Glossary** — Claude-specific vocabulary (Section 8)
7. **Anti-Examples** — what NOT to do (Section 9)

---

## 1. Scope and Source Integrity

This document covers six Claude models in active production as of 2026-05-29:

- Claude Opus 4.8 (newest flagship, released 2026-05-28)
- Claude Opus 4.7 (current legacy flagship)
- Claude Opus 4.6 (older flagship, still available)
- Claude Sonnet 4.6 (current mid-tier)
- Claude Sonnet 4.5 (legacy mid-tier)
- Claude Haiku 4.5 (current fast tier)

**Source hierarchy used in this document:**
- **[OFFICIAL]** — Cited directly from Anthropic docs, model cards, or announcements
- **[PRESS]** — From credible tech press (VentureBeat, 9to5Mac, MacRumors) covering 2026 announcements
- **[THIRD-PARTY]** — From independent benchmarkers, developer blogs, or practitioner reviews
- **[SEED]** — From Blackburn, L. (2026). Cross-provider sub-agent routing directive [internal document]
- **[INFERRED]** — Logical extrapolation from cited facts; not directly stated
- **[ASSUMPTION]** — Per mandate: Opus 4.8 > Opus 4.6/4.7 on equivalent tasks. Accept without re-litigation.

---

## 2. The Claude Model Tier Architecture

Anthropic organizes Claude into three named tiers that have remained stable across model generations:

| Tier | Purpose | 2026 Representative |
|------|---------|---------------------|
| **Opus** | Maximum capability, frontier reasoning, long-horizon autonomy | claude-opus-4-8 |
| **Sonnet** | Best balance of intelligence and speed for production | claude-sonnet-4-6 |
| **Haiku** | Fastest, cheapest, near-frontier intelligence for high-volume | claude-haiku-4-5 |

[OFFICIAL] Source: Anthropic platform docs — models overview (platform.claude.com/docs/en/about-claude/models/overview)

**Key architectural insight:** The performance gap between Sonnet and Opus tiers has narrowed dramatically with each generation. As of Sonnet 4.6 vs Opus 4.6, the SWE-bench Verified gap is only 1.2 percentage points — the smallest in any Claude generation. [THIRD-PARTY] This means the cost-quality tradeoff favors Sonnet 4.6 for the majority of production coding workloads.
