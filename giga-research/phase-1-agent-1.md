# Phase 1 — Claude Model Family Research
**Cross-Provider Sub-Agent Routing Knowledge Base**
**Agent:** Phase 1 Research Agent 1 (Claude Model Family + Effort/Reasoning)
**Date:** 2026-05-29
**Status:** Complete

---

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

---

## 3. Master Specification Matrix

### 3.1 Current Models (Active / Recommended)

| Specification | Claude Opus 4.8 | Claude Sonnet 4.6 | Claude Haiku 4.5 |
|---------------|-----------------|-------------------|------------------|
| **API ID** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5-20251001 |
| **API alias** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5 |
| **Context window** | 1M tokens (~555k words) | 1M tokens (~750k words) | 200k tokens (~150k words) |
| **Max output (sync)** | 128k tokens | 64k tokens | 64k tokens |
| **Max output (batch)** | 300k tokens* | 300k tokens* | 64k tokens |
| **Input pricing** | $5 / MTok | $3 / MTok | $1 / MTok |
| **Output pricing** | $25 / MTok | $15 / MTok | $5 / MTok |
| **Fast mode input** | $10 / MTok | N/A | N/A |
| **Fast mode output** | $50 / MTok | N/A | N/A |
| **Comparative latency** | Moderate | Fast | Fastest |
| **Adaptive thinking** | Yes (only mode) | Yes | No |
| **Extended thinking (manual)** | No (400 error) | Deprecated (still functional) | Yes (manual only) |
| **Effort parameter** | Yes (low/medium/high/xhigh/max) | Yes (low/medium/high/max) | No |
| **temperature/top_p/top_k** | Locked (400 error) | Settable | Settable |
| **Reliable knowledge cutoff** | Jan 2026 | Aug 2025 | Feb 2025 |
| **Training data cutoff** | Jan 2026 | Jan 2026 | Jul 2025 |
| **Tokenizer** | New (4.8/4.7 tokenizer) | Standard | Standard |
| **Prompt cache min length** | 1,024 tokens | [INFERRED] standard | [INFERRED] standard |
| **Microsoft Foundry context** | 200k tokens only | 1M tokens | 200k tokens |

*Batch 300k output requires `output-300k-2026-03-24` beta header. [OFFICIAL]

### 3.2 Legacy Models (Available, Migration Recommended)

| Specification | Claude Opus 4.7 | Claude Opus 4.6 | Claude Sonnet 4.5 |
|---------------|-----------------|-----------------|-------------------|
| **API ID** | claude-opus-4-7 | claude-opus-4-6 | claude-sonnet-4-5-20250929 |
| **Context window** | 1M tokens (~555k words) | 1M tokens (~750k words) | 200k tokens |
| **Max output** | 128k (sync), 300k (batch) | 128k (sync), 300k (batch) | 64k (sync), 300k (batch) |
| **Input pricing** | $5 / MTok | $5 / MTok | $3 / MTok |
| **Output pricing** | $25 / MTok | $25 / MTok | $15 / MTok |
| **Adaptive thinking** | Yes (only mode) | Yes | No |
| **Extended thinking (manual)** | No (400 error) | Deprecated, functional | Yes (required) |
| **Effort levels** | low/medium/high/xhigh/max | low/medium/high/max | low/medium/high/max |
| **Tokenizer** | New (~30-45% more tokens vs Opus 4.6 for equivalent input) | Standard | Standard |
| **Reliable knowledge cutoff** | Jan 2026 | May 2025 | Jan 2025 |

**Tokenizer warning for Opus 4.7 and 4.8:** The new tokenizer introduced in Opus 4.7 produces 32–34% more tokens than Opus 4.6 for the same large (10k+) prompts, and 42–45% more for smaller prompts. Despite identical per-token pricing, effective cost is ~40% higher when migrating from 4.6 to 4.7/4.8 at equivalent prompt sizes. [THIRD-PARTY] Source: openrouter.ai/announcements/opus-47-tokenizer-analysis, findskill.ai/blog/claude-opus-4-7-tokenizer-cost-math

### 3.3 Deprecated (DO NOT USE for new work)

- `claude-sonnet-4-20250514` (Claude Sonnet 4) — Retirement: June 15, 2026 [OFFICIAL]
- `claude-opus-4-20250514` (Claude Opus 4) — Retirement: June 15, 2026 [OFFICIAL]

---

## 4. Per-Model Profiles

### 4.1 Claude Opus 4.8 — Current Flagship

**Release date:** 2026-05-28 [PRESS]
**Position:** Anthropic's most capable generally available model [OFFICIAL]

**Core strengths:**

1. **Long-horizon agentic coding.** Specifically improved for multi-step, unattended coding workflows. Benchmark gains: SWE-bench Pro 64.3% → 69.2% (+4.9pp vs Opus 4.7). Terminal-Bench 2.1 66.1% → 74.6% (+8.5pp vs Opus 4.7). [PRESS] Best model for autonomous engineering sessions, codebase-scale migrations, and multi-hour Claude Code runs.

2. **Honesty and self-correction.** Approximately 4x less likely than Opus 4.7 to allow code flaws to pass unremarked. [PRESS/OFFICIAL] This is a qualitative safety property as much as a capability — the model proactively flags uncertainties and avoids unsupported claims.

3. **Computer use and browser automation.** 84% on Online-Mind2Web (OSWorld-Verified), a meaningful jump over Opus 4.7 and GPT-5.5 on the same benchmark. [PRESS] Best-in-class for autonomous GUI agents, browser-driven workflows, and multi-service reasoning.

4. **Multi-agent orchestration.** Only model to complete every case end-to-end on the Super-Agent benchmark. Ships with Dynamic Workflows (research preview in Claude Code) enabling hundreds of parallel subagents with output verification. [PRESS/OFFICIAL]

5. **Knowledge work.** Knowledge-work score: 1890 (vs 1753 for Opus 4.7). [PRESS] Legal and financial domain work specifically improved: first model to exceed 10% on the Legal Agent Benchmark all-pass standard. Databricks reported 61% cheaper token cost on multimodal PDF/diagram workflows vs Opus 4.7 due to better token efficiency. [THIRD-PARTY]

6. **Adaptive thinking calibration.** Triggers reasoning only when the turn requires it (vs Opus 4.7 which would think even on trivial steps). Reduces wasted thinking tokens on bimodal workloads. [OFFICIAL]

**Effort system specifics (Opus 4.8):**

| Effort Level | Behavior | Recommended Use |
|-------------|----------|-----------------|
| `low` | Minimal token spend, may skip thinking entirely | Simple subagent steps, file reads, routing decisions |
| `medium` | Moderate token savings, balanced | Cost-sensitive agentic tasks |
| `high` | Default. Almost always thinks. | Complex reasoning, difficult coding, nuanced analysis |
| `xhigh` | Always thinks deeply, extended exploration | Starting point for agentic coding, long-running workflows |
| `max` | No token constraints, deepest possible reasoning | Frontier problems, max capability evaluation |

**API constraints (breaking vs Opus 4.6):**
- `temperature`, `top_p`, `top_k` → 400 error if set to non-default [OFFICIAL]
- `thinking: {type: "enabled", budget_tokens: N}` → 400 error [OFFICIAL]
- Must use `thinking: {type: "adaptive"}` to enable thinking [OFFICIAL]
- `thinking.display` defaults to `"omitted"` (not `"summarized"` like older models) — must set `display: "summarized"` explicitly to receive thinking text [OFFICIAL]
- Minimum cacheable prompt: 1,024 tokens (lower than Opus 4.7) [OFFICIAL]

**Fast mode (research preview):**
- `speed: "fast"` on API → up to 2.5× higher output tokens/second
- Fast mode pricing: $10/MTok input, $50/MTok output (3× cheaper than fast mode on prior models in absolute terms) [PRESS/OFFICIAL]
- Standard pricing: $5/$25 (unchanged from Opus 4.7) [OFFICIAL]

**Failure modes and risks:**
[ASSUMPTION] Inherits some Opus-class verbosity risk from seed corpus — known tendency toward over-explanation when brevity is appropriate. Mitigated at `low`/`medium` effort.
[SEED] Caution/stall risk: Opus models can over-hedge or request unnecessary clarification on tasks with gray areas. Opus 4.8's improved honesty partially addresses this by flagging uncertainty rather than stalling.
[THIRD-PARTY] The new tokenizer (shared with Opus 4.7) means any comparison against Opus 4.6 token budgets requires recalibration.
[OFFICIAL] Temperature/top_p are locked — cannot prompt-engineer stochasticity out; must rely on effort and thinking controls.

---

### 4.2 Claude Opus 4.7 — Recent Legacy Flagship

**Release date:** ~2026 Q1 [INFERRED from search results referencing April 2026 analysis]
**Position:** Direct predecessor to Opus 4.8; still supported, migration recommended [OFFICIAL]

**Core strengths:**
- All Opus 4.8 strengths at slightly lower benchmark levels [OFFICIAL comparison]
- Introduced `xhigh` effort level (the first model to have it) [OFFICIAL]
- High-resolution vision: up to 3.75 megapixels [THIRD-PARTY]
- Adaptive thinking (only mode, same as 4.8)
- 13% lift on coding benchmarks over Opus 4.6 [THIRD-PARTY]
- 3× more production tasks resolved vs Opus 4.6 [THIRD-PARTY]

**Key difference from Opus 4.6:**
Instruction following became strict enough that prompts written for Opus 4.6 may break. [THIRD-PARTY] Source: labellerr.com, devtoolpicks.com. At lower effort levels, Opus 4.7 "scopes its work to what was asked rather than going above and beyond" — a behavioral shift from Opus 4.6. [OFFICIAL]

**Effort system specifics:**
Identical to Opus 4.8 (low/medium/high/xhigh/max). Official guidance: **start with `xhigh` for coding and agentic use cases.** [OFFICIAL]

**Failure modes and risks:**
- Tokenizer inflation: same 30–45% cost surprise as Opus 4.8 when migrating from Opus 4.6 [THIRD-PARTY]
- Some developers reported regression on structured-output tasks and specific prompts that relied on Opus 4.6's softer instruction following [THIRD-PARTY] Source: devtoolpicks.com
- At `max` effort, can overthink structured-output or less intelligence-sensitive tasks [OFFICIAL]
- Tool-skipping issue: some users reported cases where Opus 4.7 skipped required tool calls; Opus 4.8 explicitly fixes this [OFFICIAL]

---

### 4.3 Claude Opus 4.6 — Older Flagship

**Position:** Legacy flagship; highest of the "old tokenizer" generation; migration to 4.7/4.8 recommended [OFFICIAL]

**Core strengths:**
[SEED] Strategic planning and architecture/refactor integrity — cited as Opus 4.6's strongest differentiator in the seed corpus. [SEED] Holistic long-context synthesis, nuanced/gray-area reasoning.

From independent benchmarks and announcements:
- GDPval-AA (economically valuable knowledge work in finance, legal): outperforms GPT-5.2 by ~144 Elo points; outperforms Opus 4.5 by 190 Elo points [THIRD-PARTY] Source: datacamp.com/blog/claude-opus-4-6
- 1M context window at standard pricing (same per-token rate regardless of context length) [OFFICIAL]
- Supports both adaptive thinking AND deprecated manual `budget_tokens` thinking [OFFICIAL]
- Interleaved thinking NOT available in manual mode; must use adaptive mode for thinking between tool calls [OFFICIAL]

**Effort system specifics:**
`low`, `medium`, `high`, `max` (no `xhigh`). At `high` and `max`, almost always thinks. [OFFICIAL]

**Thinking API for Opus 4.6:**
- `thinking: {type: "adaptive"}` — recommended [OFFICIAL]
- `thinking: {type: "enabled", budget_tokens: N}` — still functional but deprecated [OFFICIAL]
- Interleaved thinking: only via adaptive mode [OFFICIAL]
- `thinking.display` defaults to `"summarized"` (different from 4.7/4.8 default of `"omitted"`) [OFFICIAL]

**Failure modes and risks:**
[SEED] Caution/stall risk: most explicitly documented for Opus 4.6. Tendency to pause on ambiguous tasks, request excessive clarification, or hedge excessively.
[SEED] Verbosity: over-explains, adds unnecessary caveats, writes longer outputs than needed.
[THIRD-PARTY] On prompt-sensitive behaviors: migrating prompts from 4.6 to 4.7 can break due to stricter instruction following in 4.7 — meaning 4.6's softer behavior was sometimes relied upon intentionally.
[OFFICIAL] Prompt cache minimum is higher than Opus 4.8 (exact value not published; Opus 4.8 reduced it to 1,024 as a new feature).

---

### 4.4 Claude Sonnet 4.6 — Current Mid-Tier

**Release date:** 2026-02-17 [OFFICIAL, from search results]
**Position:** Best combination of speed and intelligence; recommended for majority of production workloads [OFFICIAL]

**Core strengths:**

1. **Coding — near-flagship quality at fraction of cost.** SWE-bench Verified: 79.6% — only 1.2pp below Opus 4.6, the smallest Sonnet-Opus gap in any Claude generation. [THIRD-PARTY] Source: nxcode.io. Developers preferred Sonnet 4.6 over prior flagship Opus 4.5 59% of the time. [THIRD-PARTY]

2. **Verification thoroughness.** Identified as surpassing Opus 4.6 in catching its own bugs — plans coding tasks, executes, then rigorously checks for errors. [THIRD-PARTY] Source: rootly.com

3. **Mathematical reasoning.** Math performance improved from 62% to 89% — from occasionally unreliable on quantitative tasks to handling complex calculations reliably. [THIRD-PARTY] Source: nxcode.io

4. **1M context window.** First Sonnet-class model to support 1M context. Comparable words capacity to Opus 4.6 (~750k words, slightly higher than Opus 4.7/4.8's ~555k words due to different tokenizers). [OFFICIAL]

5. **Adaptive thinking support.** Supports both adaptive thinking and deprecated manual extended thinking with interleaved mode. [OFFICIAL]

6. **Cost profile.** $3/$15 MTok — 5× cheaper than Opus tiers on a per-token basis. With 40% price-effective advantage over Opus 4.7/4.8 (due to tokenizer inflation), effective cost differential may be 6-7× in practice. [INFERRED from tokenizer analysis]

7. **Computer use and OSWorld.** OSWorld: 72.5% — strong for a mid-tier model. [THIRD-PARTY] Source: datacamp.com

**Effort system specifics:**
`low`, `medium`, `high`, `max` (no `xhigh`). Official recommendations:
- **Medium effort (recommended default):** Best balance for most applications. Suitable for agentic coding, tool-heavy workflows, code generation.
- **Low effort:** High-volume or latency-sensitive workloads. Chat, non-coding use cases.
- **High effort:** Complex reasoning, quality-over-speed tasks.
- **Max effort:** Absolute highest capability, no token constraints. [OFFICIAL]

**Thinking API for Sonnet 4.6:**
- Adaptive thinking: recommended (`thinking: {type: "adaptive"}`)
- Manual interleaved: functional via `interleaved-thinking-2025-05-14` beta header, but deprecated
- `budget_tokens`: still accepted, deprecated [OFFICIAL]

**Failure modes and risks:**
[INFERRED] Without extended thinking or adaptive thinking enabled at medium+ effort, complex multi-step reasoning may degrade — particularly important because the default `high` effort can be surprisingly costly for high-volume workloads.
[THIRD-PARTY] For long-running agentic tasks requiring sustained deep reasoning over many steps, Sonnet 4.6 may lose coherence before Opus-tier models do. [INFERRED from tier design]
[OFFICIAL] Explicitly set effort when using Sonnet 4.6 to "avoid unexpected latency" — the high default can be a surprise in production.

---

### 4.5 Claude Sonnet 4.5 — Legacy Mid-Tier

**Release date:** 2025-09-29 [OFFICIAL, from API ID]
**Position:** Available, still capable; Sonnet 4.6 preferred for new work [OFFICIAL]

**Core strengths:**
- Strong multi-step reasoning, agentic coding at reasonable cost [SEED, THIRD-PARTY]
- Comparative latency: Fast [OFFICIAL]
- Computer use: OSWorld comparable to prior generation
- Good debug, review, and simple planning [SEED]
- 200k token context window (vs 1M in Sonnet 4.6) — the main limitation

**Effort system:**
`low`, `medium`, `high`, `max` [OFFICIAL]

**Thinking API:**
Manual only (`thinking: {type: "enabled", budget_tokens: N}`). Does NOT support adaptive thinking. [OFFICIAL]

**Failure modes and risks:**
- 200k context window is the hard limit — cannot handle full-codebase or large-document tasks that Sonnet 4.6 handles with 1M context
- Math reasoning was a known weakness in this generation (62% math before the 4.6 improvement to 89%) [THIRD-PARTY]
- Does not support interleaved thinking [OFFICIAL]

---

### 4.6 Claude Haiku 4.5 — Current Fast Tier

**Release date:** 2025-10-15 [THIRD-PARTY] Source: anthropic.com/news/claude-haiku-4-5
**Position:** Fastest model with near-frontier intelligence; designed for high-volume, latency-sensitive work [OFFICIAL]

**Core strengths:**

1. **Speed and cost.** $1/$5 MTok — 5× cheaper than Sonnet 4.6, 25× cheaper than Opus tiers on a per-token basis. 2–3× faster than Sonnet 4.6. Responses under 200ms for small prompts. [THIRD-PARTY] Source: caylent.com

2. **Near-flagship coding.** SWE-bench Verified: 73.3% — essentially ties GPT-5 and matches Claude Sonnet 4, the previous generation's flagship. [THIRD-PARTY] Source: caylent.com. In Augment's agentic coding evaluation: 90% of Sonnet 4.5's performance. [THIRD-PARTY]

3. **Computer use.** OSWorld: 50.7% — notable for a fast-tier model; first Haiku to support computer-use skills. [THIRD-PARTY] Source: datacamp.com

4. **Extended thinking support (manual).** First Haiku to support extended thinking. Uses `budget_tokens` (not adaptive). [OFFICIAL]

5. **Multimodal.** Text + image input, up to 64k output, 200k context. [OFFICIAL]

6. **Claude Code routing.** Claude Code automatically routes simpler tasks to Haiku 4.5: file reads, quick edits, simple questions, boilerplate generation, straightforward refactors. [THIRD-PARTY] Source: caylent.com

7. **Ideal subagent model.** Official effort docs explicitly list "subagents" as a primary use case for `low` effort — and Haiku is the official Anthropic recommendation for subagent steps that don't require deep reasoning. [OFFICIAL]

**Effort system:**
No `effort` parameter support. [OFFICIAL] Must use `budget_tokens` in manual extended thinking to control reasoning depth.

**Failure modes and risks:**
- No adaptive thinking — cannot dynamically scale reasoning per turn complexity [OFFICIAL]
- 200k context hard ceiling — cannot match Sonnet 4.6/Opus for large-context tasks [OFFICIAL]
- Complex multi-step reasoning degrades — 5–10% accuracy gap vs Sonnet 4.6 widens on tasks that exercise reasoning capacity [THIRD-PARTY]
- For classification, extraction, formatting, and routing: quality parity with Sonnet (the reasoning gap doesn't matter) [THIRD-PARTY]
- Extended thinking is manual only; interleaved thinking not available [OFFICIAL]
- Training data cutoff Feb 2025 reliable knowledge vs Jan 2026 for Opus 4.8 — knowledge gap matters for domain-current tasks [OFFICIAL]

---

## 5. The Effort and Thinking System — Deep Dive

This is the most commonly misunderstood control surface in the Claude API. It evolved significantly across the 4.x generation.

### 5.1 Conceptual Framework

The effort/thinking system has two orthogonal controls:

| Control | What it does | API parameter |
|---------|-------------|---------------|
| **Effort** | Controls how eagerly Claude spends tokens (text, tool calls, thinking) | `output_config.effort` |
| **Thinking mode** | Controls whether/how extended reasoning blocks are generated | `thinking.type` |

These are independent but interact. You can have:
- High effort + no thinking (lots of detailed text output, many tool calls, no reasoning blocks)
- Low effort + adaptive thinking (Claude thinks briefly only when needed, terse output)
- xhigh effort + adaptive thinking (the recommended maximum for agentic coding)

### 5.2 Effort Levels — Complete Taxonomy

| Level | Available On | Token Behavior | Primary Use Case |
|-------|-------------|---------------|-----------------|
| `low` | Opus 4.8, 4.7, 4.6, Sonnet 4.6 | Significant savings; skips thinking for simple problems | Fast subagents, simple classification, high-volume routing |
| `medium` | Opus 4.8, 4.7, 4.6, Sonnet 4.6 | Moderate savings | Balanced agentic workflows, tool-heavy pipelines, code generation |
| `high` | All supported models | Default; deep reasoning; almost always thinks (on Opus/Sonnet 4.6) | Complex reasoning, difficult coding, nuanced analysis |
| `xhigh` | Opus 4.8, Opus 4.7 ONLY | Extended exploration; repeated tool calling; deep search | Agentic coding, long-running workflows (>30 min); recommended START for Opus |
| `max` | Opus 4.8, 4.7, 4.6, Sonnet 4.6, Mythos Preview | No constraints; frontier capability | Genuinely frontier problems; use only when evals show headroom vs xhigh |

[OFFICIAL] Source: platform.claude.com/docs/en/build-with-claude/effort

**Key behavioral note:** Effort is a behavioral signal, not a strict token budget. Claude may still think on difficult problems at `low` effort — it just thinks less. [OFFICIAL]

**Sonnet 4.6 specific:**  Official guidance says to **explicitly set effort** to avoid unexpected latency. The recommended default for Sonnet 4.6 in most production apps is `medium`. [OFFICIAL]

**Opus 4.7/4.8 specific:** Official guidance says to **start with `xhigh`** for coding and agentic use cases. [OFFICIAL] Set `max_tokens` to 64k+ when running at `xhigh` or `max`. [OFFICIAL]

### 5.3 Thinking Modes — Complete Taxonomy

| Mode | Config | Models | Notes |
|------|--------|--------|-------|
| **Adaptive** | `thinking: {type: "adaptive"}` | Mythos Preview (default), Opus 4.8 (only), Opus 4.7 (only), Opus 4.6, Sonnet 4.6 | Claude decides when and how much to think. Automatically enables interleaved thinking. Recommended for most new work. |
| **Manual** | `thinking: {type: "enabled", budget_tokens: N}` | Opus 4.5, Sonnet 4.5, Haiku 4.5. Deprecated on Opus 4.6 and Sonnet 4.6. **400 error on Opus 4.7 and 4.8.** | Precise control over max thinking tokens. Required for older models. |
| **Disabled** | Omit `thinking` (default) OR `{type: "disabled"}` | All except Mythos Preview | No reasoning blocks. Lowest latency. Mythos Preview rejects `{type: "disabled"}`. |

**Interleaved thinking** (thinking between tool calls):
- Adaptive mode: automatically enabled on Opus 4.8, 4.7, 4.6, Sonnet 4.6, Mythos Preview
- Manual mode on Sonnet 4.6: requires `interleaved-thinking-2025-05-14` beta header (deprecated)
- Manual mode on Opus 4.6: NOT available — must use adaptive mode [OFFICIAL]
- Older models: not available

### 5.4 Thinking Display Control

| Display Value | Default On | Behavior |
|--------------|-----------|----------|
| `"summarized"` | Opus 4.6, Sonnet 4.6, earlier models | Thinking blocks contain summarized thinking text in response |
| `"omitted"` | Opus 4.8, Opus 4.7, Mythos Preview | Thinking blocks returned with empty `thinking` field; signature still present for multi-turn continuity |

**Important:** `"omitted"` display reduces streaming latency (server skips sending thinking tokens), but you are still billed for full thinking tokens. [OFFICIAL]

**Summarized thinking billing note:** You are billed for the full internal thinking tokens, NOT the summary tokens visible in the response. The billed and visible token counts will not match. [OFFICIAL]

### 5.5 Adaptive Thinking — Promptability

The triggering behavior of adaptive thinking is promptable. If Claude thinks too much or too little, add guidance to system prompt:

```
Extended thinking adds latency and should only be used when it will
meaningfully improve answer quality — typically for problems that require
multi-step reasoning. When in doubt, respond directly.
```

[OFFICIAL] Warning: steering Claude to think less may reduce quality. Test on your workload before deploying prompt-based tuning. Consider testing lower effort levels first.

### 5.6 Budget Tokens Migration Path

[OFFICIAL] Migration path for Opus 4.6 / Sonnet 4.6 still using `budget_tokens`:
```python
# Before (deprecated)
thinking = {"type": "enabled", "budget_tokens": 32000}

# After (recommended)
thinking = {"type": "adaptive"}
output_config = {"effort": "high"}  # or xhigh/max as appropriate
```

For Opus 4.7/4.8: the migration is mandatory. `budget_tokens` returns 400. [OFFICIAL]

---

## 6. Benchmark Ledger

All numbers in this section are citable. Sources noted inline.

### 6.1 SWE-bench Verified (Agentic Coding)

| Model | Score | Source |
|-------|-------|--------|
| Claude Opus 4.8 | 88.6% | [PRESS] VentureBeat/MacRumors 2026-05-28 |
| Claude Opus 4.7 | 87.6% | [PRESS] VentureBeat/MacRumors 2026-05-28 |
| Claude Sonnet 4.6 | 79.6% | [THIRD-PARTY] nxcode.io 2026 |
| Claude Haiku 4.5 | 73.3% | [THIRD-PARTY] caylent.com 2025-10-15 |

### 6.2 SWE-bench Pro / Harder Coding Eval

| Model | Score | Source |
|-------|-------|--------|
| Claude Opus 4.8 | 69.2% | [PRESS] VentureBeat 2026-05-28 |
| Claude Opus 4.7 | 64.3% | [PRESS] VentureBeat 2026-05-28 |

### 6.3 Terminal-Bench 2.1

| Model | Score | Source |
|-------|-------|--------|
| Claude Opus 4.8 | 74.6% | [PRESS] VentureBeat 2026-05-28 |
| Claude Opus 4.7 | 66.1% | [PRESS] VentureBeat 2026-05-28 |
| GPT-5.5 (for reference) | 83.4% | [THIRD-PARTY] wavespeed.ai (Codex CLI harness) |

### 6.4 Computer Use — OSWorld / Online-Mind2Web

| Model | Score | Benchmark | Source |
|-------|-------|-----------|--------|
| Claude Opus 4.8 | 84% | Online-Mind2Web | [PRESS] VentureBeat 2026-05-28 |
| Claude Sonnet 4.6 | 72.5% | OSWorld | [THIRD-PARTY] datacamp.com 2026 |
| Claude Haiku 4.5 | 50.7% | OSWorld | [THIRD-PARTY] caylent.com 2025 |

### 6.5 Knowledge Work (GDPval-AA)

| Model | Score | vs. competitor | Source |
|-------|-------|---------------|--------|
| Claude Opus 4.6 | Baseline | +144 Elo over GPT-5.2 | [THIRD-PARTY] datacamp.com/blog/claude-opus-4-6 |
| Claude Opus 4.8 | 1890 knowledge-work score | vs 1753 (Opus 4.7) | [PRESS] VentureBeat 2026-05-28 |

### 6.6 Math Performance

| Model | Score | Source |
|-------|-------|--------|
| Claude Sonnet 4.6 | 89% | [THIRD-PARTY] nxcode.io 2026 |
| Claude Sonnet 4.5 (generation prior) | 62% | [THIRD-PARTY] nxcode.io 2026 (comparative) |

### 6.7 Alignment / Safety Metrics

| Model | Misalignment Behavior Score | Notes | Source |
|-------|---------------------------|-------|--------|
| Claude Opus 4.8 | 1.9 | Lower = better | [THIRD-PARTY] wavespeed.ai 2026 |
| Claude Opus 4.7 | 2.5 | Lower = better | [THIRD-PARTY] wavespeed.ai 2026 |

### 6.8 Legal Domain

| Model | Legal Agent Benchmark | Notes | Source |
|-------|----------------------|-------|--------|
| Claude Opus 4.8 | >10% (all-pass standard) | First model to exceed this threshold | [PRESS] VentureBeat 2026-05-28 |

### 6.9 Agentic Reliability

| Model | Super-Agent Benchmark | Notes | Source |
|-------|----------------------|-------|--------|
| Claude Opus 4.8 | All cases complete end-to-end | Only model to achieve this | [PRESS] VentureBeat 2026-05-28 |

---

## 7. Decision Rules — Pick THIS Claude Model + Effort When…

These rules are operationally ordered: first match wins. More specific rules take priority over general ones.

### 7.1 Model Selection Rules

**RULE C1 — Opus 4.8, xhigh/max effort:**
Use when the task is: unattended autonomous engineering (long-horizon), codebase-scale migration, multi-hour Claude Code session, multi-agent orchestration requiring the orchestrator to be maximally capable, computer use / browser automation at production quality, legal/financial domain work requiring certified accuracy. Cost: premium (but fast mode at 2.5× speed available for latency-sensitive versions of these tasks).

**RULE C2 — Opus 4.8, medium/low effort:**
Use when: you need Opus 4.8-quality judgment for individual routing or classification decisions within a larger agentic workflow, but don't need deep per-step reasoning. Dramatically cheaper than high/xhigh. Example: an orchestrator deciding which subagent to route a task to, where the routing decision is high-stakes.

**RULE C3 — Sonnet 4.6, medium effort:**
Default rule for: agentic coding tasks, debug and review, complex analysis with tools, RAG pipelines, multi-step content generation, production coding assistants. The cost-quality sweet spot for the vast majority of developer workflows. Math, code review, architecture feedback at 5× cheaper than Opus 4.8 with minimal capability loss.

**RULE C4 — Sonnet 4.6, high/max effort:**
Use when: complex reasoning task where quality matters and moderate latency is acceptable, context-heavy code review requiring deep analysis, or when `medium` effort evaluations show a meaningful quality gap on your specific workload.

**RULE C5 — Sonnet 4.6, low effort:**
Use when: high-volume or latency-sensitive tasks where Haiku 4.5 lacks the 1M context window needed (e.g., full-codebase search requiring >200k context but fast turnaround).

**RULE C6 — Haiku 4.5:**
Use when: the task is classification, extraction, formatting, routing decisions, simple file reads/writes, boilerplate generation, straight-line refactors, customer service chat, inline completions. Haiku 4.5 matches Sonnet quality on tasks that don't exercise the reasoning gap. Cost: 5× cheaper than Sonnet 4.6, 25× cheaper than Opus 4.8.

**RULE C7 — Haiku 4.5 with extended thinking (manual):**
Use when: a high-volume task occasionally requires deeper reasoning (e.g., a Haiku subagent that usually does simple extraction but sometimes encounters complex multi-step problems). Set `budget_tokens` to a reasonable cap. Haiku 4.5 is the only current model requiring manual `budget_tokens`.

**RULE C8 — Opus 4.6 (legacy only):**
Use when: you have existing prompts written for Opus 4.6's softer instruction-following that would break on 4.7/4.8's stricter mode, AND the cost of rewriting prompts exceeds the performance benefit of migrating. Otherwise migrate to Opus 4.8. [INFERRED]

**RULE C9 — Sonnet 4.5 (legacy only):**
Use only if: 200k context is sufficient AND you have unresolved prompt compatibility issues with Sonnet 4.6. Otherwise migrate. [INFERRED]

### 7.2 Effort Selection Rules (Given a Model Choice)

**RULE E1 — Use `xhigh` as your starting point for all agentic/coding on Opus 4.7/4.8.**
This is the official Anthropic recommendation. Step up to `max` only when evals show measurable headroom. Step down to `high` for tasks where you've measured `xhigh` adds cost without quality gain. [OFFICIAL]

**RULE E2 — Use `medium` as your starting point for Sonnet 4.6 in production.**
The official Anthropic recommendation. Only move to `high` after measuring that `medium` underperforms on your task. [OFFICIAL]

**RULE E3 — Use `low` for any step in an agentic pipeline that is read-only or deterministically scoped.**
File reads, database lookups, simple reformatting, routing decisions. The capability reduction at `low` does not matter for these tasks. [OFFICIAL]

**RULE E4 — Use `max` only when you have benchmark evidence that `xhigh`/`high` falls short.**
On structured-output tasks, `max` can cause overthinking, degrading quality. Only justified for frontier-level reasoning problems. [OFFICIAL]

**RULE E5 — Enable adaptive thinking (`thinking: {type: "adaptive"}`) for any multi-step reasoning or agentic task on Opus 4.8/4.7/4.6/Sonnet 4.6.**
Without adaptive thinking, these models behave as standard completion models — no internal reasoning, no interleaved thinking between tool calls. The gains on bimodal workloads (some easy, some hard steps) are particularly large with adaptive vs fixed `budget_tokens`. [OFFICIAL]

**RULE E6 — Set `max_tokens` to at least 64k when using Opus 4.7/4.8 at `xhigh` or `max`.**
The model needs room to think and act across subagents and tool calls. Hitting `stop_reason: "max_tokens"` during a reasoning trace truncates reasoning quality. Starting at 64k and tuning down is safer than starting low. [OFFICIAL]

**RULE E7 — Do NOT set temperature, top_p, or top_k on Opus 4.7/4.8.**
These return 400 errors. Port any stochasticity controls to prompting techniques instead. [OFFICIAL]

### 7.3 Fast Mode Rules (Opus 4.8 Only)

**RULE F1 — Use fast mode when:** streaming to end-users who perceive latency as a quality signal, real-time computer use / browser agent tasks, high-stakes agentic workflows where wall-clock time matters more than cost premium.
Pricing: $10/$50 MTok (2× standard cost, but 2.5× throughput speed).

**RULE F2 — Do NOT use fast mode for:** batch/async workloads (use Message Batches API at 50% discount instead), cost-sensitive pipelines, offline analysis tasks.

### 7.4 Context Window Rules

**RULE W1 — Tasks requiring >200k tokens:** Must use Opus 4.8/4.7/4.6 or Sonnet 4.6 (all 1M context). Haiku 4.5 and Sonnet 4.5 have 200k hard limit.

**RULE W2 — Tasks fitting comfortably in 200k:** Haiku 4.5 or Sonnet 4.5 are viable. Cost savings are significant.

**RULE W3 — Microsoft Foundry deployments:** Opus 4.8 has only 200k context on Foundry. Must account for this in architecture. [OFFICIAL]

---

## 8. Claude-Specific Glossary

**Adaptive thinking:** A thinking mode (`thinking: {type: "adaptive"}`) where Claude dynamically decides whether and how much to use extended reasoning per turn. Automatically enables interleaved thinking. Supported on Opus 4.8 (only mode), Opus 4.7 (only mode), Opus 4.6, Sonnet 4.6, and Mythos Preview. Not available on Haiku 4.5 or Sonnet 4.5.

**Budget tokens:** The `budget_tokens` parameter in manual extended thinking (`thinking: {type: "enabled"}`). Sets a soft cap on thinking tokens. Required for Haiku 4.5 and Sonnet 4.5. Deprecated on Opus 4.6 and Sonnet 4.6. Returns 400 on Opus 4.7 and 4.8.

**Dynamic Workflows:** A research preview feature in Claude Code (released with Opus 4.8) that orchestrates hundreds of parallel subagents, verifying outputs before reporting. [OFFICIAL]

**Effort parameter:** `output_config.effort` — a behavioral signal controlling how eagerly Claude spends tokens. Affects text output, tool calls, AND extended thinking. Values: `low`, `medium`, `high`, `xhigh` (Opus 4.7/4.8 only), `max`. Default is always `high`.

**Extended thinking:** The capability for Claude to generate internal reasoning blocks before responding, visible in the response as `type: "thinking"` content blocks. Improves quality on multi-step problems. Billed at output token rates.

**Fast mode:** A research preview feature on Opus 4.8 (`speed: "fast"`) providing up to 2.5× higher output throughput at 2× standard pricing. [OFFICIAL]

**Interleaved thinking:** The ability to think between tool calls (not just before the first response). Automatically enabled with adaptive thinking. In manual mode: only available on Sonnet 4.6 via beta header. NOT available in manual mode on Opus 4.6. [OFFICIAL]

**Message Batches API:** Asynchronous batch processing endpoint offering 50% discount on input and output tokens. Supports 300k max output via beta header. Useful for offline/batch workloads.

**Mid-conversation system messages:** New in Opus 4.8 — allows `role: "system"` entries in the `messages` array after a user turn. Enables instruction updates without breaking prompt cache on earlier turns. [OFFICIAL]

**New tokenizer:** Introduced in Opus 4.7. Produces 32–45% more tokens than the Opus 4.6/Sonnet tokenizer for equivalent text. Despite identical per-token pricing, effective costs are ~40% higher when migrating from Opus 4.6 to 4.7/4.8. [THIRD-PARTY]

**Opus tier:** The highest-capability Claude model tier. As of 2026-05-29: Opus 4.8 is current; Opus 4.7 and 4.6 are legacy.

**Priority Tier:** A service tier providing higher rate limits and throughput. Supported on all current models. [OFFICIAL]

**Prompt caching:** Mechanism to reuse input tokens from repeated system prompts, tool schemas, or stable conversation history. Cache reads at 10% of standard input price. Cache writes at a premium. Minimum cacheable prompt: 1,024 tokens on Opus 4.8 (lower than prior models). [OFFICIAL]

**Refusal stop details:** `stop_details` object on refusal responses (Opus 4.7+, public doc on Opus 4.8). Describes the category of refusal beyond just `stop_reason: "refusal"`. Useful for application-layer routing when the model declines. [OFFICIAL]

**Sonnet tier:** The mid-tier Claude model. As of 2026-05-29: Sonnet 4.6 is current; Sonnet 4.5 is legacy.

**Summarized thinking:** Default display mode on Opus 4.6/Sonnet 4.6 (`thinking.display: "summarized"`). Returns a summary of internal reasoning in the response body. Billing is for the full internal thinking tokens, not the summary. [OFFICIAL]

**Omitted thinking:** Default display mode on Opus 4.7/4.8/Mythos Preview (`thinking.display: "omitted"`). Returns empty `thinking` field in response but signature is preserved for multi-turn. Reduces streaming latency without reducing billing. [OFFICIAL]

**Ultracode mode:** A Claude Code UI mode pairing `xhigh` effort with standing permission for multi-agent workflows. Not a separate API effort level. [OFFICIAL]

**xhigh effort:** The fifth effort level, available only on Opus 4.7 and Opus 4.8. Sits between `high` and `max`. Recommended starting point for all agentic and coding use cases on Opus. [OFFICIAL]

---

## 9. Concrete Examples and Anti-Examples

### 9.1 Correct Usage Examples

**CORRECT — Large codebase migration:**
```
Model: claude-opus-4-8
Effort: xhigh
Thinking: adaptive
Max tokens: 128000
Use case: Migrating 300k lines from Python 2 to Python 3, unattended
Rationale: Long-horizon agentic coding (Rule C1), xhigh is Opus starting point (Rule E1)
```

**CORRECT — Production coding assistant (API):**
```
Model: claude-sonnet-4-6
Effort: medium
Use case: PR review, code generation, debug assistance at scale
Rationale: Cost-quality sweet spot (Rule C3, E2); 5× cheaper than Opus
```

**CORRECT — High-volume document classifier:**
```
Model: claude-haiku-4-5
No effort parameter (not supported)
Use case: Classifying 10 million documents into 20 categories
Rationale: Classification doesn't exercise reasoning gap (Rule C6); 25× cheaper than Opus
```

**CORRECT — Subagent doing file reads in an Opus orchestration:**
```
Model: claude-haiku-4-5 (or Sonnet 4.6 if context >200k needed)
Effort: N/A for Haiku; low for Sonnet 4.6 if used instead
Use case: A simple "read this file and extract the imports" step
Rationale: Rule C6, Rule E3
```

**CORRECT — One-off frontier reasoning task:**
```
Model: claude-opus-4-8
Effort: max
Thinking: adaptive
Use case: Novel architecture design requiring holistic synthesis across conflicting constraints
Rationale: Rule C1 (complex domain), Rule E4 (only use max after measuring xhigh falls short — in this case it's a one-off where cost is less important)
```

### 9.2 Anti-Examples (Common Mistakes)

**ANTI-EXAMPLE 1 — Setting temperature on Opus 4.8:**
```python
# WRONG — returns 400 error
client.messages.create(
    model="claude-opus-4-8",
    temperature=0.7,  # 400 error
    ...
)
```
Reason: Opus 4.7/4.8 lock sampling parameters. Use prompting to influence output diversity.

**ANTI-EXAMPLE 2 — Using budget_tokens on Opus 4.8:**
```python
# WRONG — returns 400 error
thinking = {"type": "enabled", "budget_tokens": 32000}
```
Reason: Manual thinking is rejected on Opus 4.7/4.8. Migrate to adaptive thinking + effort.

**ANTI-EXAMPLE 3 — Defaulting to max effort for all Sonnet tasks:**
```
Model: claude-sonnet-4-6
Effort: max (for a simple customer service chat)
```
Reason: Max effort causes Claude to over-think simple tasks, degrading structured-output quality and increasing latency/cost unnecessarily. [OFFICIAL] For Sonnet, medium is the recommended default.

**ANTI-EXAMPLE 4 — Using Haiku 4.5 for a 500k context task:**
```
Model: claude-haiku-4-5
Context: 500k tokens  # FAILS — 200k limit
```
Reason: Haiku 4.5 has a 200k hard limit. Use Sonnet 4.6 or Opus for large-context work.

**ANTI-EXAMPLE 5 — Using Opus 4.8 with fast mode for batch offline processing:**
```
Model: claude-opus-4-8, speed: "fast"
Use case: Overnight batch analysis of 1M documents
```
Reason: Fast mode is for latency-sensitive work. Batch workloads should use Message Batches API for 50% discount instead of fast mode's 2× premium.

**ANTI-EXAMPLE 6 — Assuming Opus 4.6 and Opus 4.7/4.8 token budgets are comparable:**
```
# Migrating from Opus 4.6 to Opus 4.8 with same max_tokens
# Result: 30-45% more tokens consumed for identical prompts
# Effective cost increase ~40%
```
Reason: New tokenizer in Opus 4.7/4.8 produces significantly more tokens. Recalibrate all token budgets and cost estimates after migration.

**ANTI-EXAMPLE 7 — Using Opus for every subagent in a multi-agent pipeline:**
```
# 10 subagents, all claude-opus-4-8
# Cost: 10 × $5/MTok = extreme cost for simple subtasks
```
Reason: Differentiate by task complexity. File reads, extractions, and routing decisions belong to Haiku 4.5. Only orchestrator and complex reasoning steps merit Opus.

**ANTI-EXAMPLE 8 — Expecting interleaved thinking in manual mode on Opus 4.6:**
```python
# WRONG — interleaved thinking not available in manual mode on Opus 4.6
thinking = {"type": "enabled", "budget_tokens": 32000}
# Tool calls will NOT have thinking between them on Opus 4.6 in manual mode
```
Reason: On Opus 4.6, interleaved thinking requires adaptive mode. [OFFICIAL]

**ANTI-EXAMPLE 9 — Not setting thinking.display on Opus 4.8 when you need the reasoning text:**
```python
# SILENT BUG — thinking.display defaults to "omitted" on Opus 4.8
# You receive thinking blocks with empty thinking fields
thinking = {"type": "adaptive"}  # missing display: "summarized"
# Fix:
thinking = {"type": "adaptive", "display": "summarized"}
```
Reason: Opus 4.8 default changed from "summarized" to "omitted" vs Opus 4.6. [OFFICIAL]

---

## 10. Seed Corpus Integration

The following claims from Blackburn, L. (2026) [SEED] are corroborated or extended by official/press sources:

| Seed Claim | Corroboration Status |
|-----------|---------------------|
| Opus 4.6: strategic planning, architecture/refactor integrity | [CORROBORATED] by GDPval-AA benchmark showing Opus 4.6 +144 Elo over GPT-5.2 on knowledge work |
| Opus 4.6: holistic long-context synthesis | [CORROBORATED] by 1M context window at standard pricing; adaptive thinking for tool-intensive synthesis |
| Opus 4.6: nuanced/gray-area reasoning | [CORROBORATED] by alignment scores and domain-expert evaluations |
| Opus 4.6: caution/stall risk, verbosity | [CORROBORATED] by official effort docs noting that at `low`/`medium`, Opus 4.7 "scopes to what was asked" — implying prior over-extension |
| Haiku: rapid efficient coding and file reads/search | [CORROBORATED] by 73.3% SWE-bench, 90% of Sonnet 4.5 performance, Claude Code auto-routing to Haiku |
| Sonnet: well-rounded debug, review, reasoning, simple planning | [CORROBORATED] by 79.6% SWE-bench, verification thoroughness, developer preference over Opus 4.5 |
| GPT-5.5: confident hallucination, possible security bugs | [NOT IN SCOPE — cross-provider; defer to Phase 1 Agent 2] |

**Seed corpus extension — Opus 4.8 [ASSUMPTION per mandate]:**
The seed corpus predates Opus 4.8. The following represents the [ASSUMPTION] that Opus 4.8 is materially stronger than Opus 4.6/4.7, extended with corroborating facts:
- Strategic planning: [ASSUMPTION strengthened] by Super-Agent benchmark (only model completing all cases end-to-end)
- Honesty: [CORROBORATED] 4× lower rate of letting code flaws pass unremarked vs 4.7
- Stall/caution risk: [PARTIALLY MITIGATED] improved honesty means it flags uncertainty proactively rather than stalling
- Verbosity: [PARTIALLY MITIGATED] better token efficiency at equivalent effort levels; adaptive thinking reduces wasted tokens

---

## 11. Official Sources Consulted

1. Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. Retrieved from https://www.anthropic.com/news/claude-opus-4-8
2. Anthropic. (2026). *Models overview — Claude API Docs*. Retrieved from https://platform.claude.com/docs/en/about-claude/models/overview
3. Anthropic. (2026). *Effort — Claude API Docs*. Retrieved from https://platform.claude.com/docs/en/build-with-claude/effort
4. Anthropic. (2026). *Adaptive thinking — Claude API Docs*. Retrieved from https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
5. Anthropic. (2026). *What's new in Claude Opus 4.8 — Claude API Docs*. Retrieved from https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8
6. Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5
7. Anthropic. (2026, February 17). *Claude Sonnet 4.6*. https://www.anthropic.com/claude/sonnet

### Supporting Press and Third-Party Sources

8. VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8 is here with 3X cheaper fast mode and near-Mythos level alignment*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment
9. MacRumors. (2026, May 28). *Anthropic Launches Claude Opus 4.8 With Gains in Coding and Honesty*. https://www.macrumors.com/2026/05/28/anthropic-claude-opus-4-8/
10. WaveSpeed Blog. (2026). *Claude Opus 4.8: Release Date, Pricing, Benchmarks, and Builder Notes*. https://wavespeed.ai/blog/posts/opus-4-8/
11. NxCode. (2026). *Claude Sonnet 4.6: 79.6% SWE-bench at $3/MTok — Complete Guide*. https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026
12. Caylent. (2025). *Claude Haiku 4.5 Deep Dive: Cost, Capabilities, and the Multi-Agent Opportunity*. https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity
13. OpenRouter. (2026). *Opus 4.7's New Tokenizer: What It Actually Costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis
14. DataCamp. (2026). *Claude Sonnet 4.6: Features, Access, Tests, and Benchmarks*. https://www.datacamp.com/blog/claude-sonnet-4-6
15. DataCamp. (2025). *Claude Haiku 4.5: Features, Testing Results, and Use Cases*. https://www.datacamp.com/blog/anthropic-claude-haiku-4-5
16. DataCamp. (2026). *Claude Opus 4.6: Features, Benchmarks, Tests, and More*. https://www.datacamp.com/blog/claude-opus-4-6

---

*End of Phase 1 Agent 1 report. Claims explicitly labeled [INFERRED], [ASSUMPTION], or [SEED] throughout. All benchmark numbers in Section 6 are sourced and citable.*
