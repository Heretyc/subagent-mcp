## 3. HARD GATES — Evaluated Before Category Routing

Gates are deterministic filters applied to every task **before** the category's primary route. A gate can override a category route but never relaxes a mandatory validation. Order: evaluate all; the most restrictive applicable route wins.

| Gate | Condition | Action | Source |
|---|---|---|---|
| **G1 Context (Claude-only)** | input > 200K tokens | Exclude Haiku 4.5 and Sonnet 4.5 (200K limit). Allowed: Opus 4.8 / Sonnet 4.6 (1M). | Decision 9; Anthropic, 2026a |
| **G2 Context (off GPT-5.5)** | input > 272K tokens AND task flagged cost-sensitive | Mandatory redirect off GPT-5.5 (2× input / 1.5× output session multiplier kicks in above 272K). Route to Opus 4.8 / Sonnet 4.6. | Decision 9; OpenAI, 2026a |
| **G2b Context (Codex cap)** | input > 400K tokens | Off Codex harness entirely (400K cap) → Claude 1M-context model. | OpenAI, 2026a |
| **G3 Output size** | required output > 64K tokens | Opus 4.8 only (128K output; all others cap at 64K). | Anthropic, 2026a |
| **G4 Math/proof** | task is math or formal-proof in nature | Route to GPT-5.5 regardless of declared category. (Subject to G2 if >272K & cost-sensitive.) | Decision 10 |
| **G5 Effort floor at xhigh/max** | model is Opus 4.7/4.8 at xhigh/max | Set `max_tokens ≥ 64K` or reasoning truncates. | Anthropic, 2026; Decision E6 |
| **G6 Opus sampling lock** | model is Opus 4.7/4.8 | Do **not** set temperature/top_p/top_k or `budget_tokens` (400 error). Use adaptive thinking + effort. | Anthropic, 2026 |

**Gate interaction example:** a `synthesis_knowledge` task with 300K context, cost-sensitive → G1 excludes Haiku; G2 pushes off GPT-5.5 (irrelevant, primary is Opus); primary Opus 4.8 @ high stands. A `extraction_proof` math task with 300K context, cost-sensitive → G4 says GPT-5.5, but G2 overrides → Opus 4.8 @ high (note: Opus is not the strongest at proofs, so surface this as a known degradation and require verification).

---

## 4. COST MODEL (inflation-adjusted) — Section D.1

**Cost formula (per call):**
`cost = in_tok·in_rate + cached_in·cached_rate + visible_out·out_rate + hidden_reasoning·out_rate + tool/schema_tokens + region/priority/fast multipliers`

Hidden reasoning/thinking tokens are billed at the **output** rate on both providers and occupy context — high effort literally buys extra output tokens whether or not they're shown. [OpenAI, 2026k; Anthropic, 2026g]

**Nominal per-MTok pricing (standard tier):**

| Model | Input | Output | Cached-in | Batch in/out | Notes |
|---|---|---|---|---|---|
| Opus 4.8 / 4.7 / 4.6 | $5 | $25 | $0.50 hit | $2.50 / $12.50 | Fast mode (4.8): $10/$50 |
| Sonnet 4.6 | $3 | $15 | $0.30 hit | $1.50 / $7.50 | — |
| Haiku 4.5 | $1 | $5 | $0.10 hit | $0.50 / $2.50 | — |
| GPT-5.5 (≤272K) | $5 | $30 | $0.50 | $2.50 / $15 | Output = 6× input |
| GPT-5.5 (>272K) | $10 | $45 | $1.00 | — | Long-context cliff |
| GPT-5.5-pro | $30 | $180 | — | — | Capability-limited cases only |

[Anthropic, 2026d; OpenAI, 2026a, 2026d]

**Inflation adjustment (Decision 7 — apply in ALL Opus 4.7/4.8 comparisons):** the Opus 4.7/4.8 tokenizer produces ~32–45% more tokens than Opus 4.6/Sonnet for equivalent text. Despite identical per-token pricing, **effective Opus 4.7/4.8 cost is ~1.4× nominal**. Practical consequence: the Sonnet-vs-Opus *effective* cost gap is ~6–7×, not the ~5× the sticker prices imply. Flag this prominently on any 4.6→4.7/4.8 migration — it is a silent budget surprise, not a pricing change. [OpenRouter, 2026; findskill.ai, 2026]

**Three-tier cost discipline** (validated by Augment Code, 2026): Orchestrator (~5% of tokens, Opus/Sonnet) + Implementor (~45%, Sonnet) + Worker (~50%, Haiku) reduces session cost 40–60% vs uniform Opus. Worked example: a 104K-in/60K-out session ≈ $0.98 three-tier vs $2.02 uniform Opus.

**Cost levers (ranked):** (1) downshift category default effort after evals; (2) cache stable prefix (policy/system → static examples → tool schema → dynamic last; up to 90% input savings / 80% latency on cache hit); (3) batch/flex for async (50% off); (4) strict output contracts (output is the expensive side); (5) summarize-and-restart when context >60–70% and active evidence <50%. Fast/priority tiers only when latency has business value exceeding the multiplier. [OpenAI, 2026g; Anthropic, 2026d]
