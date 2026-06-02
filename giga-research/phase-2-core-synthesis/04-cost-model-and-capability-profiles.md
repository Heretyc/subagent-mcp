## 4. COST MODEL (inflation-adjusted) — Interview Q7

**Cost formula (per call):**
`cost = in_tok·in_rate + cached_in·cached_rate + (visible_out + hidden_reasoning)·out_rate + tool/schema_tokens, then × {batch|flex|priority|fast|regional|long_context|tokenizer} multipliers.`
**Hidden reasoning/thinking tokens bill at the OUTPUT rate on both providers** and occupy context — high effort literally buys extra output tokens whether shown or not. Output contracts are therefore direct budget controls.

**Nominal per-MTok pricing (standard tier):**

| Model | Input | Output | Cached-in | Batch in/out | Fast / priority | Notes |
|-------|------:|-------:|----------:|--------------|-----------------|-------|
| Opus 4.8 / 4.7 / 4.6 | $5 | $25 | $0.50 hit | $2.50 / $12.50 | **4.8 fast** $10/$50; **4.6/4.7 fast** $30/$150 | 5-min cache write $6.25; 1-hr $10 |
| Sonnet 4.6 | $3 | $15 | $0.30 hit | $1.50 / $7.50 | — | 1M context at standard price |
| Haiku 4.5 | $1 | $5 | $0.10 hit | $0.50 / $2.50 | — | 200K context; fleet cost floor |
| GPT-5.5 (≤272K) | $5 | $30 | $0.50 | $2.50 / $15 | **priority** $12.50/$75 | output = 6× input |
| GPT-5.5 (>272K) | $10 | $45 | $1.00 | — | — | long-context price cliff (full session) |
| GPT-5.5-pro | $30 (≤272K) / $60 (>272K) | $180 / $270 | — | — | — | capability-limited cases only |

US-only / data-residency inference adds ~10% (eligible endpoints, both providers). [Anthropic 2026 pricing; OpenAI 2026 pricing; Phase-1 Agent 5]

**Inflation adjustment (apply in ALL Opus 4.7/4.8 comparisons — flag prominently).** The Opus 4.7/4.8 tokenizer produces **~32–45% more tokens** than Opus 4.6/Sonnet for equivalent text (Anthropic states up to ~35%; third-party analysis 32–45%). Despite identical per-token pricing, **effective Opus 4.7/4.8 cost is ~1.4× nominal**: $5/$25 sticker behaves like **~$7/$35 per content-MTok.** Practical consequence: the Sonnet-vs-Opus *effective* cost gap is **~6–7×**, not the ~5× sticker prices imply. This is a **silent migration surprise**, not a pricing change — recalibrate all token budgets on any 4.6→4.7/4.8 migration. Opus 4.6 keeps the old tokenizer (no inflation). [INFERRED from OpenRouter/findskill tokenizer analysis + Anthropic docs] [ASSUMPTION — 1.4× is the mandated modeling multiplier, Interview Q7]

**Effective-cost reference** (per 100K input + 20K visible output, excluding cache/tools; hidden-output assumption none=0, low=0.1×, med=0.25×, high=0.75×, xhigh=1.5×, max=2.5×):

| Model | none/fixed | low | medium | high | xhigh | max |
|-------|-----------:|----:|-------:|-----:|------:|----:|
| Haiku 4.5 | $0.20 | — | — | — | — | — |
| Sonnet 4.6 | — | $0.63 | $0.68 | $0.83 | — | $1.05 |
| Opus 4.6 | — | $1.05 | $1.13 | $1.38 | — | $1.75 |
| Opus 4.8/4.7 (1.4×-adjusted) | — | $1.47 | $1.58 | $1.93 | $2.45 | $3.15 |
| GPT-5.5 (≤272K) | $1.10 | $1.16 | $1.25 | $1.55 | $2.00 | — |
| GPT-5.5 (>272K) | $1.90 | $1.99 | $2.13 | $2.58 | $3.25 | — |

**Three-tier cost discipline** (validated, Augment Code 2026): Orchestrator (~5% of tokens, Opus/Sonnet) + Implementor (~45%, Sonnet/Codex) + Worker (~50%, Haiku) cuts session cost **40–60%** vs uniform Opus (e.g., $0.98 vs $2.02 on a 104K-in/60K-out session). The taxonomy operationalizes this: `mechanical`→Haiku and `agentic_execution`/`coding`→Codex/Sonnet keep ~95% of tokens off Opus.

**Cost levers (ranked):** (1) downshift category default effort after evals; (2) cache stable prefix (policy/system → static examples → tool schema → dynamic last; up to 90% input savings / 80% latency on hit); (3) batch/flex for async (50% off; not for interactive blockers); (4) strict output contracts (output is the expensive side: 5× input Claude, 6× input GPT-5.5); (5) summarize-and-restart when context >60–70% and active evidence <50%. Reserve fast/priority only when wall-clock latency has business value exceeding the multiplier (production incident, blocking human); never for background research or batch.

---

## 5. CONDENSED PROVIDER / MODEL CAPABILITY + RISK PROFILES

| Model | API id | Ctx in/out | Effort levels | Decisive strength | Decisive risk | Best categories |
|-------|--------|-----------|---------------|-------------------|---------------|-----------------|
| **Opus 4.8** | `claude-opus-4-8` | 1M / 128K | low/med/high/xhigh/max | Agentic/long-horizon leader; honesty (~4× fewer unremarked code flaws vs 4.7); final arbiter; knowledge work; web computer-use (~84% Mind2Web); nuance | Cost premium + ~1.4× tokenizer inflation; residual over-caution/stall on ambiguity; verbosity at max; locked sampling; Microsoft Foundry caps at 200K | architecture, security_review, quality_review, knowledge_synthesis |
| **Opus 4.7** | `claude-opus-4-7` | 1M / 128K | low/med/high/xhigh/max | Near-4.8; introduced `xhigh`; strict instruction following; high-res vision | Tool-skipping (fixed in 4.8); same tokenizer inflation; over-caution | Opus-category fallback |
| **Opus 4.6** | `claude-opus-4-6` | 1M / 128K | low/med/high/max | Legacy flagship; old tokenizer (no inflation); strong knowledge work (+144 Elo vs GPT-5.2 GDPval) | Most-documented stall/verbosity; no `xhigh`; stricter-4.7 prompts may differ | legacy/compat fallback |
| **Sonnet 4.6** | `claude-sonnet-4-6` | 1M / 64K | low/med/high/max | Coding sweet-spot (79.6% SWE-bench Verified, ~1.2pp < Opus 4.6 — smallest-ever gap); verification thoroughness; math 89%; 1M context | Loses coherence before Opus on long autonomous chains; `high` default can surprise latency — **set effort explicitly** | coding, debugging, routine review/synthesis |
| **Haiku 4.5** | `claude-haiku-4-5` | 200K / 64K | none (fixed low) | Fastest, cheapest ($1/$5, ~25× < Opus/token); 73.3% SWE-bench Verified; near-Sonnet on non-reasoning tasks | 200K ceiling; shallow on multi-step reasoning/nuance; no adaptive thinking; Feb-2025 knowledge | mechanical, fan-out/map leaves |
| **GPT-5.5** (Codex/API) | `gpt-5.5` | **1.05M API / 400K Codex** / 128K out; 272K price cliff | none/min/low/med/high/xhigh | Closed-loop terminal SOTA (Terminal-Bench ~82–83%); deterministic extraction; math/proof; fast-to-patch; ~40% fewer output tokens/task; security initial pass (≈71.4% expert cyber) | Confident hallucination; concurrency bugs (~170/mLOC); commits to wrong file before full exploration; literal instruction-following; CWE-732 miss patterns | math_proof, agentic_execution, coding (closed-loop), security initial pass |
| **GPT-5.4-mini** | `gpt-5.4-mini` | — | (light) | Cheap/fast light coding & Codex subagent leaves | Not an authority for security/governance/architecture | cheap Codex leaf |
| **GPT-5.5-pro** | `gpt-5.5-pro` | — | (pro) | Capability-limited hard proofs/reviews after GPT-5.5 high/xhigh fails | Very high cost ($30/$180) and latency | proof/review escalation only |

**Opus 4.8 capability framing [ASSUMPTION, Interview Q2, de-hyperbolized].** Clear leader on **agentic/long-horizon** work: SWE-bench Pro 69.2% vs GPT-5.5 58.6% (+10.6pp); Terminal-Bench 2.1 74.6% vs Opus 4.7 66.1% (+8.5pp); GDPval-AA knowledge-work score 1890 vs GPT-5.5 1769 (and vs Opus 4.7's 1753); only model to clear the Legal Agent Benchmark all-pass threshold. **Roughly equal on isolated coding:** SWE-bench Verified 88.6% vs GPT-5.5 88.7% (within noise). Route by **task-split**, not blanket superiority. (Opus 4.8 was released ~2026-05-29 — same day as this research — so 4.8-specific magnitude claims are [ASSUMPTION] with the benchmark numbers above as best available corroboration; see §11.)
