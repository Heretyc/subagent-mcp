# 03 — Tokenizer Inflation: Opus 4.7 / 4.8
*Source: ANTH-MIGRATE-2606, ANTH-PRICING-2606. Retrieved 2026-06-03.*

## Official Anthropic Statements

**Pricing page (ANTH-PRICING-2606):**
> "Opus 4.7 and later use a new tokenizer compared to previous models, contributing to their improved
> performance on a wide range of tasks. **This new tokenizer may use up to 35% more tokens for the
> same fixed text.**"

**Migration guide (ANTH-MIGRATE-2606):**
> "The new tokenizer may use roughly 1x to 1.35x as many tokens when processing text compared to
> previous models (up to ~35% more, varying by content)."

## Delta vs Baseline `cost-model.md`

Baseline `cost-model.md` states:
> "The Opus 4.7/4.8 tokenizer produces **~32-45% more tokens** ... **effective Opus 4.7/4.8 cost
> is ~1.4x nominal.**" [ASSUMPTION, INFERRED from OpenRouter 2026 + Anthropic docs]

| Dimension | Baseline | Official (2026-06-03) | Delta |
|---|---|---|---|
| Inflation range | 32–45% | 0–35% | Baseline upper bound (45%) exceeds vendor max (35%) |
| Planning constant | 1.4x | ≤1.35x | **Baseline overestimates by ~3.7% at upper end** |
| Source trust | [ASSUMPTION/INFERRED] | [Tier 1 vendor doc] | Official supersedes inferred constant |

**Recommended update**: Replace 1.4x planning constant with 1.35x (vendor-confirmed upper bound).
Range for modeling: 1.0x–1.35x depending on content type (code vs. prose vs. structured data).
Flag in cost-model.md: old 1.4x figure should be labeled [DEPRECATED — exceeds vendor-stated maximum].

## Why It Matters

At 100K input / 20K output reference blend, the difference:

| Effort | 1.4x (old baseline) | 1.35x (corrected) | Overcharge |
|---|---:|---:|---:|
| low | $1.47 | $1.418 | +$0.052 (+3.7%) |
| medium | $1.58 | $1.519 | +$0.061 (+4.0%) |
| high | $1.93 | $1.856 | +$0.074 (+4.0%) |
| xhigh | $2.45 | $2.363 | +$0.087 (+3.7%) |
| max | $3.15 | $3.038 | +$0.112 (+3.7%) |

At scale (1M calls/month at `high`), the 1.4x constant overestimates cost by ~$74K/month.

## Content-Dependence Note

"Varying by content" (migration guide). The 1.35x is the **maximum** for fixed text; real inflation
depends on content type. Expected ranges [INFERRED — no vendor breakdown by content type]:
- Code / structured data: inflation may be lower (tokenizer more efficient on code)
- Natural language prose: closer to the 1.35x upper bound
- Mixed content (agentic prompts with code + prose): intermediate

The 1.35x planning constant is still conservative for budget purposes; use 1.0x as the floor.

## G_OPUS_LOCK Interaction

Elevated/maximal effort on Opus 4.7/4.8 requires `max_tokens >= 65,536` to avoid reasoning
truncation. With 1.35x inflation, a `max_tokens=65536` budget represents effectively ~48,545
content-equivalent tokens (vs. ~46,811 at 1.4x). Headroom is slightly better than baseline assumed.

## Applies To

- **claude-opus-4-7**: New tokenizer (confirmed, introduced with 4.7)
- **claude-opus-4-8**: Same new tokenizer (inherits from 4.7)
- **claude-opus-4-6 and earlier**: Old tokenizer — **no inflation**
- **claude-sonnet-4-6, claude-haiku-4-5**: Old tokenizer — **no inflation** (not mentioned in guide)
