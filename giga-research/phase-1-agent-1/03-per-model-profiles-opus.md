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
