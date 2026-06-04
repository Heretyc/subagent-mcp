# 02 — OpenAI/Codex Pricing & Rate Limits
*Source: OAI-PRICING-2606, OAI-GPT55-2606. Retrieved 2026-06-03.*

## GPT-5.x Family — Nominal Pricing ($/MTok, USD)

| Model | Input | Cached In | Output | Batch In | Batch Out | Priority In | Priority Out |
|---|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5 (≤272K) | $5.00 | $0.50 | $30.00 | $2.50 | $15.00 | $12.50 | $75.00 |
| gpt-5.5 (>272K) | **$10.00** | $1.00 | **$45.00** | $5.00 | $22.50 | — | — |
| gpt-5.5-pro (≤272K) | $30.00 | — | $180.00 | — | — | — | — |
| gpt-5.5-pro (>272K) | $60.00 | — | $270.00 | — | — | — | — |
| gpt-5.4 | $2.50 | $0.25 | $15.00 | $1.25 | $7.50 | $5.00 | $30.00 |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 | $0.375 | $2.25 | — | — |
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 | — | — | — | — |

**[NEW vs baseline]**: gpt-5.4, gpt-5.4-mini, gpt-5.4-nano pricing not in prior baseline. Now confirmed.
Cached input: 90% reduction from standard. Batch: 50% discount. Priority: 2.5x standard.
Regional data residency: +10% (1.1x) for models released 2026-03-05+.

## 272K Input Price Cliff [CRITICAL — G_CTX_272 trigger]

When input_tokens > 272,000 the **full session** is billed at cliff rates:
- Input: $5.00 → $10.00/MTok (+100%)
- Output: $30.00 → $45.00/MTok (+50%)
- Applies to: standard, batch, flex APIs. Priority pricing separate.
- No tiered partial-session pricing — cliff flips the entire call.

Reference cost at 300K input + 20K output (no cache):

| Route | Approx cost |
|---|---:|
| gpt-5.5 ≤272K session | ~$2.10 |
| gpt-5.5 >272K session | ~$3.90 (+86%) |
| claude-sonnet-4-6 (no cliff) | ~$1.20 |

## Model Specs

| Model | Context | Max Output | Reasoning Efforts | Default Effort | Knowledge Cutoff |
|---|---|---|---|---|---|
| gpt-5.5 | 1,050,000 | 128,000 | none/low/medium/high/xhigh | medium | Dec 2025 |
| gpt-5.5-pro | 1,050,000 | 128,000 | none/low/medium/high/xhigh | medium | Dec 2025 |
| gpt-5.4 | 1,050,000 | 128,000 | none/low/medium/high/xhigh | medium | ~Oct 2025 [INFERRED] |
| gpt-5.4-mini | 128,000 | 32,000 | none/low/medium | medium | ~Oct 2025 [INFERRED] |
| gpt-5.4-nano | 32,000 | 8,000 | none | none | ~Oct 2025 [INFERRED] |

Note: gpt-5.4-mini/nano context and output specs are [INFERRED]; vendor docs for siblings not fetched directly.

## Rate Limits — GPT-5.5 (confirmed via OAI-GPT55-2606)

| Tier | RPM | TPM | Batch Queue |
|---|---:|---:|---:|
| T1 | 500 | 500,000 | 1,500,000 |
| T2 | 5,000 | 1,000,000 | 3,000,000 |
| T3 | 5,000 | 2,000,000 | 100,000,000 |
| T4 | 10,000 | 4,000,000 | 200,000,000 |
| T5 | 15,000 | 40,000,000 | 15,000,000,000 |

**[DELTA vs baseline]**: Baseline noted "varies by model/project." Now T1–T5 confirmed with specific figures.
Additional possible limits (not confirmed for gpt-5.5 specifically): RPD, TPD, IPM — check dashboard.
Long-context requests may have separate limits [INFERRED from rate limits guide].

## 429 Behavior

- Exceeded limit → 429 error
- Recovery: exponential backoff recommended
- Headers: `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests` (and token equivalents)
- Flex processing: async, batch-rate pricing, occasional unavailability acceptable (non-production workloads only)
- Priority tier: 5x price, higher precedence in queue, separate limit pool [INFERRED from docs structure]

## Reference Cost Blend (100K input / 20K output, ≤272K)

Hidden reasoning multipliers: none=0, low=0.1x, med=0.25x, high=0.75x, xhigh=1.5x.
Output rate = $30/MTok for gpt-5.5.

| Model | none | low | medium | high | xhigh |
|---|---:|---:|---:|---:|---:|
| gpt-5.5 (≤272K) | **$1.10** | $1.16 | $1.25 | $1.55 | $2.00 |
| gpt-5.5 (>272K) | $1.90 | $1.99 | $2.13 | $2.58 | $3.25 |
| gpt-5.5-pro (≤272K) | $6.60 | — | $7.50 | $9.60 | — |
| gpt-5.4 (≤272K) | $0.55 | $0.58 | $0.63 | $0.78 | $1.00 |
| gpt-5.4-mini (≤272K) | $0.165 | $0.174 | $0.188 | $0.233 | — |
| gpt-5.4-nano (≤272K) | $0.045 | — | — | — | — |

Costs confirmed for gpt-5.5; siblings [INFERRED from confirmed per-MTok rates].
gpt-5.5-pro output rate = $180/MTok; calculation: 100K*$30 + 20K*$180 = $3.00 + $3.60 = $6.60.
