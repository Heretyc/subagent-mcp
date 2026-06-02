# model-profiles.md — Per-Model Capability, Risk & Benchmark Profiles

**One-screen summary:** Canonical capability/risk/api-id table for all 8 models in the local fleet.
Owns every benchmark figure, effort ladder, and per-model risk flag. Routes and costs live in
`./routing-table.md` and `./cost-model.md` respectively; gates that reference model constraints
live in `./hard-gates.md`.

**Load when:** selecting a model; reading benchmark claims; sizing effort; hitting a 400-error on
Opus sampling; evaluating fallback model adequacy.
**Do not load when:** routing logic (load `./routing-table.md`); pricing (load `./cost-model.md`);
gate thresholds (load `./hard-gates.md`).

---

## Model Table

| Model | API id | Ctx in / out | Effort levels | Decisive strength | Decisive risk | Best categories |
|-------|--------|-------------|---------------|-------------------|---------------|-----------------|
| **Opus 4.8** | `claude-opus-4-8` | 1M / 128K | low · med · high · xhigh · max | Agentic / long-horizon leader; honesty (~4× fewer unremarked code flaws vs 4.7); final arbiter; knowledge work; web computer-use (~84% Mind2Web) | Cost + tokenizer-inflation risk (see [cost-model.md](./cost-model.md)); residual stall on ambiguity; verbosity at max; locked sampling; MS Foundry caps context | `architecture`, `security_review`, `quality_review`, `knowledge_synthesis` |
| **Opus 4.7** | `claude-opus-4-7` | 1M / 128K | low · med · high · xhigh · max | Near-4.8; introduced `xhigh`; strict instruction following; high-res vision | Tool-skipping (fixed in 4.8); same tokenizer inflation; over-caution | Opus-category fallback |
| **Opus 4.6** | `claude-opus-4-6` | 1M / 128K | low · med · high · max | Legacy flagship; old tokenizer (no inflation); strong knowledge work | Most-documented stall/verbosity; no `xhigh` effort level | legacy/compat fallback |
| **Sonnet 4.6** | `claude-sonnet-4-6` | 1M / 64K | low · med · high · max | Coding sweet-spot (79.6% SWE-bench Verified); debug throughput; math 89%; 1M context at standard price | Coherence degrades before Opus on long autonomous chains; set effort explicitly (`high` default can surprise latency) | `coding`, `debugging`, routine review/synthesis |
| **Haiku 4.5** | `claude-haiku-4-5` | 200K / 64K | fixed low (none) | Fastest + cheapest ($1/$5 MTok, ~25× cheaper than Opus/token); 73.3% SWE-bench Verified; near-Sonnet on non-reasoning tasks | 200K ceiling (G_CTX_200 forces fallback); shallow multi-step reasoning; no adaptive thinking; knowledge cutoff Feb 2025 | `mechanical`, fan-out / map leaves |
| **GPT-5.5** | `gpt-5.5` | **1.05M API** / **400K Codex harness** / 128K out; 272K price cliff | none · min · low · med · high · xhigh | Closed-loop terminal SOTA (Terminal-Bench ~82–83%); deterministic extraction; math/proof; fast-to-patch; ~40% fewer output tokens/task; security initial pass (≈71.4% expert cyber) | Confident hallucination; concurrency bugs (~170/mLOC); commits to wrong file before full exploration; CWE-732 file-permission miss patterns; hallucinated API signatures | `math_proof`, `agentic_execution`, `coding` (closed-loop), security initial pass |
| **GPT-5.4-mini** | `gpt-5.4-mini` | — | light | Cheap/fast light coding + Codex leaf work | Not an authority for security/governance/architecture | cheap Codex leaf (mechanical fallback) |
| **GPT-5.5-pro** | `gpt-5.5-pro` | — | pro | Capability-limited hard proofs/reviews after GPT-5.5 high/xhigh fails | Very high cost ($30/$180 MTok) and latency | proof/review escalation only |

> Pricing figures are owned by `./cost-model.md`. Gate threshold numbers (272K, 400K, 64K) are
> owned by `./hard-gates.md`. This file does not restate those.

---

## Opus 4.8 Benchmark Framing [ASSUMPTION — Interview Q2, de-hyperbolized]

Route by **task-split**, not blanket superiority.

| Benchmark | Opus 4.8 | Comparator | Delta | Interpretation | Source id(s) |
|-----------|----------|------------|-------|----------------|-------------|
| SWE-bench Verified | 88.6% | GPT-5.5 88.7% | ~0 | **Tied within noise** — isolated coding parity | `CONTRA-2026` |
| SWE-bench Pro | 69.2% | GPT-5.5 58.6% | **Opus +10.6pp** | Agentic / multi-step leader | `CONTRA-2026` |
| Terminal-Bench 2.1 | 74.6% | Opus 4.7 66.1% | **Opus 4.8 +8.5pp** | CLI/closed-loop leader over prior gen | `DECODER-2026` [PRESS/ASSUMPTION] |
| GDPval-AA knowledge score | 1890 | GPT-5.5 1769 | Opus +121 | Knowledge-work leader | `VENTUREBEAT-2026` [PRESS/ASSUMPTION] |
| GDPval-AA knowledge score | 1890 | Opus 4.7 1753 | Opus 4.8 +137 | Generational gain on synthesis | `VENTUREBEAT-2026` [PRESS/ASSUMPTION] |
| Legal Agent Benchmark | all-pass | — | only model to clear | Nuance / policy leader | `ANTH-OPUS48` |
| Haiku 4.5 SWE-bench Verified | 73.3% | — | — | Near-Sonnet on non-reasoning | `ANTH-HAIKU45`, `DATACAMP-H45` |
| Sonnet 4.6 SWE-bench Verified | 79.6% | — | — | Coding sweet-spot | `ANTH-SONNET46`, `DATACAMP-S46` |
| Sonnet 4.6 math | 89% | — | — | Arithmetic mandate context (see decision-rationale.md CR-2) | `DATACAMP-S46` |
| Opus 4.6 GDPval vs GPT-5.2 | +144 Elo | GPT-5.2 | +144 Elo | Separate comparison — not Opus 4.8 | `DATACAMP-OPUS46` |
| GPT-5.5 SWE-bench Verified | 88.7% | — | — | Parity coding | `CODERABBIT-2026`, `CONTRA-2026` |
| GPT-5.5 expert-cyber pass | ≈71.4% | — | — | Security initial pass; Claude verdicts | `AISI-2026` |

**Note:** Opus 4.8 was released ~2026-05-29 (same date as this research). Magnitude claims above
are [ASSUMPTION] with these benchmark figures as best-available corroboration; independent
replication pending. The "+144 Elo" figure is a *separate* comparison: Opus 4.6 vs GPT-5.2 on
GDPval (DataCamp) — not interchangeable with the Opus 4.8 figures above. See [decision-rationale.md](./decision-rationale.md)
§CR-5 for conflict reconciliation.

---

## Opus Sampling Constraints (G_OPUS_LOCK)

Applies whenever `claude-opus-4-7` or `claude-opus-4-8` is selected:

- **Forbidden params:** `temperature`, `top_p`, `top_k`, `budget_tokens` → 400 error if set.
- **At `xhigh`/`max`:** set `max_tokens ≥ 64K` or reasoning will truncate silently.
- Use adaptive thinking + effort controls instead of raw sampling params.

Full gate definition owned by `./hard-gates.md` (G_OPUS_LOCK).

---

## GPT-5.5 Context: API vs Codex Harness (Conflict CR-3)

| Scope | Limit |
|-------|-------|
| GPT-5.5 API context | 1,050,000 tokens |
| Codex harness context cap | **400,000 tokens** ← operative limit for local fleet |
| Price-cliff threshold | see `G_CTX_272` in [hard-gates.md](./hard-gates.md) |
| Max output (both) | 128,000 tokens |

The 400K limit is a **harness cap**, not a model cap. Gate threshold numbers are owned by
[hard-gates.md](./hard-gates.md) (G_CTX_200 / G_CTX_272 / G_CTX_400).

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
