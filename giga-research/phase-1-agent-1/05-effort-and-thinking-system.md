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
