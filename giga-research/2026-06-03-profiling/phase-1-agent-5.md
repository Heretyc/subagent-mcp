# Phase 1 Agent 5 — Ops / Cost / Failure Modes / Governance (INDEX)
*Run: 2026-06-03. Full-mode re-profile. Domain: pricing, rate limits, tokenizer, failure modes, gates.*

Scope: `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`
+ `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`. Cross-family.
Reference cost blend: 100K input + 20K output tokens (pre-inflation).

## Subfiles

| File | Contents |
|---|---|
| [01-claude-pricing-rates.md](phase-1-agent-5/01-claude-pricing-rates.md) | Claude nominal pricing, cache tiers, batch, fast mode, rate limits, 429 behavior |
| [02-openai-pricing-rates.md](phase-1-agent-5/02-openai-pricing-rates.md) | GPT-5.x family pricing, 272K cliff, rate limits, 429 behavior |
| [03-tokenizer-inflation.md](phase-1-agent-5/03-tokenizer-inflation.md) | Opus 4.7/4.8 tokenizer: delta vs baseline 1.4x constant, corrected cost table |
| [04-failure-modes.md](phase-1-agent-5/04-failure-modes.md) | GPT-5.5 code quality (Sonar), security posture (AISI, system card), Claude failure modes |
| [05-gate-mapping.md](phase-1-agent-5/05-gate-mapping.md) | G_COMMIT, G_DATA, G_SANDBOX, G_SEC per model+effort pairing |

## Key Deltas vs Baseline `cost-model.md` / `failure-modes.md`

1. **[DELTA] Tokenizer inflation constant overstated**: Baseline uses 1.4x [ASSUMPTION]. Official Anthropic docs (migration guide, pricing page): "up to 35% more" = 1.35x max. Recommend updating planning constant from 1.4x → 1.35x. See `03-tokenizer-inflation.md`.
2. **[NEW] GPT-5.x sibling models**: `gpt-5.4` ($2.50/$15), `gpt-5.4-mini` ($0.75/$4.50), `gpt-5.4-nano` ($0.20/$1.25) confirmed — missing from baseline entirely. See `02-openai-pricing-rates.md`.
3. **[NEW] GPT-5.5 rate limits confirmed**: T1–T5 structure (500–15,000 RPM, 500K–40M TPM). Baseline only noted "varies." See `02-openai-pricing-rates.md`.
4. **[NEW] Claude cache-aware ITPM**: Cache read tokens do NOT count toward ITPM for Opus/Sonnet/Haiku 4.5+ (only Haiku 3.5† counts them). Significantly higher effective throughput when caching. Not in baseline. See `01-claude-pricing-rates.md`.
5. **[CONFIRMED] GPT-5.5 272K cliff**: $10 in / $45 out above cliff, applies to full session. Confirmed in model docs.
6. **[CONFIRMED] Concurrency bugs 170/mLOC**: Sonar Java benchmark confirms. Unchanged from baseline.
7. **[NEW QUANT] Hallucination figures**: 60% drop vs GPT-5.4; 23% more factually correct; 3% fewer error-containing responses. Baseline was qualitative only. See `04-failure-modes.md`.
8. **[NEW] Vulnerability density confirmed**: 75/mLOC (0.075/kLOC). Top categories: cryptography 17, XXE 8, path traversal 7. See `04-failure-modes.md`.
9. **[NEW] GPT-5.5 cyber capability rating**: AISI "High" (below Critical). 71.4% expert cyber tasks. Live agentic restrictions. See `04-failure-modes.md`.
10. **[CONFIRMED] G_OPUS_LOCK breaking change**: `temperature`/`top_p`/`top_k` → 400 error on Opus 4.7+. Default effort=high on 4.8 (all surfaces). Confirmed in migration guide.

## Source Ledger

| ID | URL | Retrieved | Trust |
|---|---|---|---|
| ANTH-PRICING-2606 | https://platform.claude.com/docs/en/about-claude/pricing | 2026-06-03 | Tier 1 — vendor |
| ANTH-MODELS-2606 | https://platform.claude.com/docs/en/about-claude/models/overview | 2026-06-03 | Tier 1 — vendor |
| ANTH-RATELIMITS-2606 | https://platform.claude.com/docs/en/api/rate-limits | 2026-06-03 | Tier 1 — vendor |
| ANTH-MIGRATE-2606 | https://platform.claude.com/docs/en/about-claude/models/migration-guide | 2026-06-03 | Tier 1 — vendor |
| OAI-PRICING-2606 | https://developers.openai.com/api/docs/pricing | 2026-06-03 | Tier 1 — vendor |
| OAI-GPT55-2606 | https://developers.openai.com/api/docs/models/gpt-5.5 | 2026-06-03 | Tier 1 — vendor |
| OAI-SYSTEMCARD-2606 | https://deploymentsafety.openai.com/gpt-5-5 | 2026-06-03 | Tier 1 — vendor |
| SONAR-2606 | https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation | 2026-06-03 | Tier 2 — independent |
| AISI-2606 | https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities | 2026-06-03 | Tier 2 — independent gov |
