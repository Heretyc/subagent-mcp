## 4. Per-Model Profiles (continued)

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
- **Medium effort (recommended default):** Best balance for most applications. Suitable for [agentic mention removed], tool-heavy workflows, code generation.
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
- Strong multi-step reasoning, [agentic mention removed] at reasonable cost [SEED, THIRD-PARTY]
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

2. **Near-flagship coding.** SWE-bench Verified: 73.3% — essentially ties GPT-5 and matches Claude Sonnet 4, the previous generation's flagship. [THIRD-PARTY] Source: caylent.com. In Augment's [agentic mention removed] evaluation: 90% of Sonnet 4.5's performance. [THIRD-PARTY]

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
