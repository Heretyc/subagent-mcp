## SECTION 3: EFFORT-LEVEL GUIDANCE (OFFICIAL ANTHROPIC DOCS, VERIFIED 2026-05-29)

Source: platform.claude.com/docs/en/build-with-claude/effort [fetched 2026-05-29]

| Level | Models | Typical Use | Token Profile |
|---|---|---|---|
| `max` | Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6 | Deepest reasoning, frontier problems, no token constraint | Highest; use sparingly |
| `xhigh` | Opus 4.8, Opus 4.7 | Long-horizon agentic work, repeated tool calling, coding >30 min | ~2x high; default for coding agents |
| `high` | All Opus/Sonnet | Default; complex reasoning, nuanced analysis, difficult code | Standard; API default |
| `medium` | All Opus/Sonnet | Balanced; agentic coding, tool-heavy, routine gen | Moderate savings |
| `low` | All Opus/Sonnet; "simpler tasks / subagents" | Classification, extraction, sub-agent leaves, high-volume | Maximum efficiency |

**Sonnet 4.6 effort guidance (official):**
- `medium` = recommended default for agentic coding and tool-heavy workflows.
- `low` = high-volume or latency-sensitive; suitable for chat/non-coding.
- `high` = complex reasoning where quality > speed.
- `max` = highest capability, no token constraint.

**Opus 4.8 / 4.7 effort guidance (official):**
- Start at `xhigh` for coding and agentic use cases.
- `high` = minimum for intelligence-sensitive workloads.
- `medium` = cost-sensitive only; confirm quality on evals first.
- `max` = reserve for genuinely frontier problems; "significant cost for relatively small quality gains" on most structured tasks.
- When using `xhigh` or `max`: set `max_tokens` ≥ 64K.

**Haiku 4.5:** No effort parameter. It is effectively always at a fixed "low-effort" profile appropriate for leaf-node tasks.

---

## SECTION 4: CROSS-CUTTING ROUTING PRINCIPLES

### 4.1 Three-Tier Baseline (Validated by Multiple Sources)

The three-tier pattern (Blackburn, 2026) is confirmed by independent routing research:
- **Tier 1 — Orchestrator (5% of tokens):** Opus 4.8 or Sonnet 4.6 for planning, decomposition, tie-breaking.
- **Tier 2 — Implementor (45% of tokens):** Sonnet 4.6 for code generation, debugging, review, test authoring.
- **Tier 3 — Worker (50% of tokens):** Haiku 4.5 for file read/search, classification, simple transforms, boilerplate sub-tasks.

Cost implication: Three-tier routing reduces session cost by 40–60% vs. uniform Opus (Augment Code, 2026). Example: 104K input / 60K output session = $0.98 (three-tier) vs. $2.02 (uniform Opus).

### 4.2 GPT-5.5 Slot Allocation (Cross-Provider Capacity)

The seed corpus notes "+5 slots from other provider; separable work only; split by domain; no duplicate tasks." Based on GPT-5.5's verified strengths:

Allocate GPT-5.5 slots to:
1. Terminal/closed-loop execution (Terminal-Bench 2.0: 82.7%)
2. Security review — initial pass (71.4% cybersecurity expert tasks)
3. Deterministic extraction and formal proofs (FrontierMath leadership)
4. High-volume structured output where cost-per-token + retry-savings math favors GPT-5.5 (60% hallucination reduction = fewer retries)
5. Code review for access-control / API behavior (CodeRabbit: 79.2% curated found-rate)

Do NOT allocate GPT-5.5 to: nuanced gray-area reasoning (Opus leads), concurrency code (GPT-5.5 weakness confirmed), multi-agent orchestration requiring long context (Opus leads on GDPval-AA), strategic planning (Opus leads by 121 points on GDPval-AA), or any task requiring 1M+ context window operation beyond Codex's 400K limit.

### 4.3 Confidence-Based Escalation

[INFERRED from routing literature; not directly benchmarked per source:]
If a model returns output flagged as low-confidence or reaches a decision branch it cannot resolve:
1. Haiku → Sonnet 4.6 @ medium
2. Sonnet → Opus 4.8 @ high
3. Opus 4.8 @ high → Opus 4.8 @ xhigh or @ max (do not switch providers for escalation; keep in Claude for consistency)

### 4.4 Context Window Decision Gate

Before routing any task, apply this gate:
- **Output tokens needed >64K** → Opus 4.8 only (128K output; others max at 64K)
- **Input context >200K tokens** → Opus 4.8 or Sonnet 4.6 only (Haiku hard limit: 200K)
- **Input context >1M tokens** → Opus 4.8 only (GPT-5.5 Codex: 400K; API: 1M but Opus 4.8 competitive)
- **Input context ≤200K + task is mechanical** → Haiku 4.5 always preferred

### 4.5 Topology Note

AdaptOrch (2026 arxiv benchmark) found topology-aware multi-agent orchestration achieves 12–23% improvement over static single-topology baselines using identical underlying models. Routing overhead: <50ms vs. 2–15s per LLM call — routing is essentially free. Implication: a dynamic router that classifies task type before each call is worth building; the classification cost is negligible.
