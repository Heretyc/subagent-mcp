## 9. Concrete Examples and Anti-Examples

### 9.1 Correct Usage Examples

**CORRECT — Large codebase migration:**
```
Model: claude-opus-4-8
Effort: xhigh
Thinking: adaptive
Max tokens: 128000
Use case: Migrating 300k lines from Python 2 to Python 3, unattended
Rationale: Long-horizon [agentic mention removed] (Rule C1), xhigh is Opus starting point (Rule E1)
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
