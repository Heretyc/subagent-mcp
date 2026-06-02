# cost-model.md — Pricing, Tokenizer Inflation & Cost Economics

**Load when:** calculating call cost; comparing model economics; evaluating effort-tier spend; applying the 1.4× Opus 4.7/4.8 tokenizer inflation correction; assessing the >272K GPT-5.5 price cliff; ranking cost levers.
**Do not load when:** you need routing actions (→ [routing-table.md](./routing-table.md)); gate thresholds (→ [hard-gates.md](./hard-gates.md)); model benchmarks/capabilities (→ [model-profiles.md](./model-profiles.md)).

**One-screen summary:** All $ rates live here. Key surprises: (1) Opus 4.7/4.8 effective cost is ~1.4× nominal due to tokenizer inflation — recalibrate all 4.6→4.7/4.8 budgets. (2) GPT-5.5 >272K input is a hard price cliff (2× in / 1.5× out — full session). (3) Three-tier discipline cuts session cost significantly (planning estimate ~40–60% [ASSUMPTION — source AUGMENT-2026 unrecovered, see §5]). (4) Output tokens are the expensive side (5–6× input rate).

Sources: `ANTH-PRICING` (Anthropic pricing); `OAI-PRICING` (OpenAI pricing, 272K cliff); `OPENROUTER-2026` (tokenizer inflation 1.4×); `AUGMENT-2026` [UNVERIFIED — 404]; `ANTH-HAIKU45`/`ANTH-SONNET46` (Haiku/Sonnet rates); `OAI-REASON` (hidden reasoning tokens); `OAI-CACHE` (cache pricing). See [source-ledger.md](./source-ledger.md).

---

## 1. Nominal Per-MTok Pricing (standard tier, USD)

| Model | Input | Cached-in | Output | Batch in/out | Fast / Priority | Notes |
|---|---:|---:|---:|---|---|---|
| `claude-opus-4-8` / `claude-opus-4-7` / `claude-opus-4-6` | $5 | $0.50 hit | $25 | $2.50 / $12.50 | **4.8 fast** $10/$50; **4.6/4.7 fast** $30/$150 | Cache write: 5-min $6.25; 1-hr $10 |
| `claude-sonnet-4-6` | $3 | $0.30 hit | $15 | $1.50 / $7.50 | — | 1M context at standard price |
| `claude-haiku-4-5` | $1 | $0.10 hit | $5 | $0.50 / $2.50 | — | Fleet cost floor; 200K ctx |
| `gpt-5.5` (≤272K input) | $5 | $0.50 | $30 | $2.50 / $15 | Priority: $12.50 in / $1.25 cached / $75 out | Output = 6× input rate |
| `gpt-5.5` (>272K input) | **$10** | $1.00 | **$45** | — | — | **Full-session price cliff — see §2** |
| `gpt-5.5-pro` (≤272K) | $30 | — | $180 | — | — | Capability-limited cases only |
| `gpt-5.5-pro` (>272K) | $60 | — | $270 | — | — | Extremely high cost + latency |

US-only / data-residency inference: ~10% premium (eligible endpoints, both providers).

---

## 2. GPT-5.5 >272K Price Cliff [CRITICAL]

> When input exceeds the cliff threshold AND cost_sensitive is set, gate `G_CTX_272` (see [hard-gates.md](./hard-gates.md)) mandates routing away from GPT-5.5. The routing action and threshold number are owned by hard-gates.md.

The cliff applies to the **full session**, not just the overflow tokens. Above the cliff: input doubles ($5→$10/MTok), output rises 1.5× ($30→$45/MTok). At a 300K input + 20K output session with no cache:

| Tier | Approx cost |
|---|---:|
| GPT-5.5 ≤272K session | ~$2.10 |
| GPT-5.5 >272K session | ~$3.90 (+86%) |
| Sonnet 4.6 (no cliff) | ~$1.20 |

Route to `claude-opus-4-8` / `claude-sonnet-4-6` (1M, no long-context premium) instead.

---

## 3. Tokenizer Inflation — Opus 4.7 / 4.8 [CRITICAL — Silent Migration Surprise]

> **[ASSUMPTION, Interview Q7; INFERRED from OpenRouter 2026 + Anthropic docs]**
> The Opus 4.7/4.8 tokenizer produces **~32–45% more tokens** than Opus 4.6/Sonnet for equivalent text. Despite identical per-token sticker pricing, **effective Opus 4.7/4.8 cost is ~1.4× nominal.**

| Sticker | Effective (1.4× applied) | Practical equivalent |
|---|---|---|
| $5/MTok input | ~$7/MTok per content-MTok | 40% more tokens billed for same text |
| $25/MTok output | ~$35/MTok per content-MTok | |

**Consequence:** The Sonnet-vs-Opus *effective* cost gap is **~6–7×**, not the ~5× sticker prices imply.
**Migration action:** Recalibrate ALL token budgets on any 4.6→4.7/4.8 migration. The inflation is content-dependent; 1.4× is a planning constant, not a per-text guarantee.
Opus 4.6 uses the **old tokenizer** — no inflation.

---

## 4. Effective-Cost Reference Table

Per 100K input + 20K visible output, excluding cache/tools. Hidden-output (reasoning tokens) multipliers: none=0, low=0.1×, med=0.25×, high=0.75×, xhigh=1.5×, max=2.5×.

| Model | none / fixed | low | medium | high | xhigh | max |
|---|---:|---:|---:|---:|---:|---:|
| `claude-haiku-4-5` | **$0.20** | — | — | — | — | — |
| `claude-sonnet-4-6` | — | $0.63 | $0.68 | $0.83 | — | $1.05 |
| `claude-opus-4-6` | — | $1.05 | $1.13 | $1.38 | — | $1.75 |
| `claude-opus-4-8` / `claude-opus-4-7` (1.4× adjusted) | — | $1.47 | $1.58 | $1.93 | $2.45 | $3.15 |
| `gpt-5.5` (≤272K) | $1.10 | $1.16 | $1.25 | $1.55 | $2.00 | — |
| `gpt-5.5` (>272K) | $1.90 | $1.99 | $2.13 | $2.58 | $3.25 | — |

---

## 5. Three-Tier Cost Discipline (40–60% Saving)

[ASSUMPTION — dependent on AUGMENT-2026 source (URL 404, unverified); figures are planning estimates pending source recovery. See source-ledger.md AUGMENT-2026.]

> Orchestrator (~5% of tokens, Opus/Sonnet) + Implementor (~45%, Sonnet/Codex) + Worker (~50%, Haiku) cuts session cost **40–60%** vs uniform Opus.

Example: 104K-in / 60K-out session → **$0.98** three-tier vs **$2.02** uniform Opus [ASSUMPTION — AUGMENT-2026 source unverified].

The taxonomy operationalizes this: `mechanical`→Haiku and `agentic_execution`/`coding`→Codex/Sonnet keep ~95% of tokens off Opus.

---

## 6. Cost Levers (Ranked)

| rank | lever | mechanism | note |
|---:|---|---|---|
| 1 | Downshift effort after evals | Hidden reasoning tokens bill at output rate | E.g., `medium` instead of `high` if quality holds |
| 2 | Cache stable prefix | Up to 90% input savings / 80% latency on hit | Order: policy → static examples → tool schema → dynamic last |
| 3 | Batch/flex for async | 50% off | Not for interactive blockers |
| 4 | Strict output contracts | Output is expensive side: 5× input (Claude), 6× input (GPT-5.5) | JSON/table contracts; line budgets |
| 5 | Summarize-and-restart | Context >60–70% and active evidence <50% → compact | Prevents 1M-context degradation cost spiral |
| — | Reserve fast/priority | Only when wall-clock latency has business value > multiplier | Production incident, blocking human; never background/batch |

---

## 7. Effort Economics

Effort multipliers apply via hidden reasoning tokens billed at the **output rate**. The routing-table effort defaults are task-class baselines [Anthropic 2026 effort docs; OpenAI 2026 reasoning/Codex docs]; tune *down* after evals show no quality loss, never *up* speculatively. Effort is set by the category, not the model (Interview Q5 [ASSUMPTION]).

| category | default effort | cost implication |
|---|---|---|
| `mechanical` | fixed low (null) | Haiku flat; no reasoning overhead |
| `coding` | Sonnet medium | Moderate; balanced default |
| `debugging` / `security_review` / `quality_review` | high | Correctness-critical; deeper reasoning required |
| `agentic_execution` | GPT-5.5 medium | OpenAI balanced Codex default |
| `architecture` | Opus xhigh | Premium justified by cascade-error avoidance; 1.4× inflation applies |
| `knowledge_synthesis` | Opus high (max if >10 src) | max only when evals show headroom |
| `math_proof` | GPT-5.5 high | Mandated; xhigh for adversarial proofs |

Opus 4.8 at `xhigh`/`max` has a `max_tokens` requirement before reasoning will complete — threshold number and gate action owned by `G_OPUS_LOCK` in [hard-gates.md](./hard-gates.md).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
