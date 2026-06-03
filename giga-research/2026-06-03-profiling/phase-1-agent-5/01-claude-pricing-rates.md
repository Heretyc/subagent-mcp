# 01 — Claude Pricing & Rate Limits
*Source: ANTH-PRICING-2606, ANTH-RATELIMITS-2606, ANTH-MODELS-2606. Retrieved 2026-06-03.*

## Nominal Pricing ($/MTok, USD)

| Model | Input | 5m Cache Write | 1h Cache Write | Cache Hit | Output | Batch In | Batch Out |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude-opus-4-8 | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | $2.50 | $12.50 |
| claude-opus-4-7 | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | $2.50 | $12.50 |
| claude-opus-4-6 | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | $2.50 | $12.50 |
| claude-sonnet-4-6 | $3.00 | $3.75 | $6.00 | $0.30 | $15.00 | $1.50 | $7.50 |
| claude-haiku-4-5 | $1.00 | $1.25 | $2.00 | $0.10 | $5.00 | $0.50 | $2.50 |

Cache hit = 10% of base input rate. 5-min cache write = 1.25x; 1-hr write = 2x base input.
Batch API: 50% discount on both in/out. Not available with fast mode.
Data residency (inference_geo=us): +10% (1.1x) multiplier on all tiers for Opus 4.6+, Sonnet 4.6+.

## Fast Mode Pricing (research preview — dedicated rate limits)

| Model(s) | Fast Input | Fast Output | Notes |
|---|---:|---:|---|
| claude-opus-4-6, claude-opus-4-7 | $30.00 | $150.00 | Separate rate-limit pool |
| claude-opus-4-8 | $10.00 | $50.00 | Faster than 4.6/4.7 fast at lower premium |

Fast mode unavailable on: Batch API, Claude Platform on AWS, Sonnet, Haiku.
Fast-mode rate limit exceeded → 429 with `retry-after`; `anthropic-fast-*` headers expose status.

## Model Specs

| Model | Context | Max Output | Effort Levels | Effort Default | Notes |
|---|---|---|---|---|---|
| claude-opus-4-8 | 1M | 128K | low/medium/high/xhigh/max | **high** (all surfaces) | Batch: up to 300K output (beta header) |
| claude-opus-4-7 | 1M | 128K | low/medium/high/xhigh/max | low (API) | Adaptive thinking; new tokenizer |
| claude-opus-4-6 | 1M | 128K | low/medium/high/xhigh/max | low (API) | Extended thinking supported |
| claude-sonnet-4-6 | 1M | 64K | low/medium/high/xhigh | low (API) | Extended thinking supported |
| claude-haiku-4-5 | 200K | 64K | none (no thinking) | — | Fastest; no adaptive thinking |

G_OPUS_LOCK: `temperature`, `top_p`, `top_k` → 400 error on Opus 4.7+. Set `max_tokens >= 65,536` at elevated effort.

## Rate Limits (Standard Tier, per-model-class pools)

Opus 4.x = combined pool across 4.8/4.7/4.6/4.5/4.1. Sonnet 4.x = combined across 4.6/4.5.

| Class | Tier | RPM | ITPM | OTPM |
|---|---|---:|---:|---:|
| Opus 4.x | T1 | 50 | 500,000 | 80,000 |
| Opus 4.x | T2 | 1,000 | 2,000,000 | 200,000 |
| Opus 4.x | T3 | 2,000 | 5,000,000 | 400,000 |
| Opus 4.x | T4 | 4,000 | 10,000,000 | 800,000 |
| Sonnet 4.x | T1 | 50 | 30,000 | 8,000 |
| Sonnet 4.x | T2 | 1,000 | 450,000 | 90,000 |
| Sonnet 4.x | T3 | 2,000 | 800,000 | 160,000 |
| Sonnet 4.x | T4 | 4,000 | 2,000,000 | 400,000 |
| Haiku 4.5 | T1 | 50 | 50,000 | 10,000 |
| Haiku 4.5 | T2 | 1,000 | 450,000 | 90,000 |
| Haiku 4.5 | T3 | 2,000 | 1,000,000 | 200,000 |
| Haiku 4.5 | T4 | 4,000 | 4,000,000 | 800,000 |

**Cache-aware ITPM [NEW, not in baseline]**: Cache read tokens (`cache_read_input_tokens`) do NOT count toward ITPM for Opus/Sonnet/Haiku 4.5+. Only uncached input + cache writes count. At 80% cache hit rate, effective throughput = 5x nominal ITPM.

Batch API limits: Separate pool; T1=100K queue, T2=200K, T3=300K, T4=500K. Max 100K requests/batch.

## 429 Behavior

- Algorithm: token bucket (continuous replenish, not fixed-window reset)
- Exceeded limit → 429 + `retry-after` header (seconds to wait)
- Short burst limits enforced (e.g., 60 RPM = ~1 req/sec burst cap)
- Acceleration limits: sharp usage ramps trigger 429 even within quota
- Response headers: `anthropic-ratelimit-requests-*`, `anthropic-ratelimit-input-tokens-*`, `anthropic-ratelimit-output-tokens-*`, `anthropic-priority-*` (Priority Tier only)

## Reference Cost Blend (100K input / 20K output, excl. cache/tools)

Hidden reasoning multipliers: none=0, low=0.1x, med=0.25x, high=0.75x, xhigh=1.5x, max=2.5x.
Opus 4.7/4.8 costs shown at 1.35x tokenizer inflation (corrected from baseline 1.4x — see 03-tokenizer-inflation.md).

| Model | none | low | medium | high | xhigh | max |
|---|---:|---:|---:|---:|---:|---:|
| claude-haiku-4-5 | **$0.200** | — | — | — | — | — |
| claude-sonnet-4-6 | — | $0.630 | $0.675 | $0.825 | — | $1.050 |
| claude-opus-4-6 | — | $1.050 | $1.125 | $1.375 | — | $1.750 |
| claude-opus-4-7 (1.35x) | — | $1.418 | $1.519 | $1.856 | $2.363 | $3.038 |
| claude-opus-4-8 (1.35x) | — | $1.418 | $1.519 | $1.856 | $2.363 | $3.038 |

[DELTA vs baseline]: Opus 4.7/4.8 costs here use 1.35x (official cap). Baseline cost-model.md used 1.4x → overestimates by ~3.7%. See `03-tokenizer-inflation.md`.
