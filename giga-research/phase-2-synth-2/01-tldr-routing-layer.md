## 0. TL;DR — The Routing Layer in One Screen

**The fleet has three actors and one rule each agent obeys:** cheap/fast does separable verifiable work; expensive/high-effort does work where one missed contradiction or unsafe write costs more than the tokens; nothing commits itself.

**Eight work categories** (an agent classifies each prompt into exactly one):

| # | Category | Primary route | Default effort | Mandatory validation? |
|---|---|---|---|---|
| 1 | `coding` | Claude Sonnet 4.6 | medium | Cross-review if security-adjacent |
| 2 | `agentic_execution` | GPT-5.5 @ Codex | medium | **Yes** — Claude review before commit |
| 3 | `planning_architecture` | Claude Opus 4.8 | xhigh | Contradiction-check if it produces a committed artifact |
| 4 | `reasoning_judgment` | Claude Opus 4.8 | high | No (Opus is the arbiter) |
| 5 | `mechanical` | Claude Haiku 4.5 | n/a (fixed) | No |
| 6 | `extraction_proof` | GPT-5.5 (proofs) / Sonnet 4.6 (JSON) | medium / low | Proof verification by Claude if committed |
| 7 | `security_review` | GPT-5.5 (initial pass) | high | **Yes** — Claude cross-review (mandatory for concurrent/auth/permission) |
| 8 | `synthesis_knowledge` | Claude Opus 4.8 | high→max | No |

**Four hard gates evaluated BEFORE the category route (gate wins):**

1. **Context > 200K input tokens → Claude only** (Haiku excluded; Opus 4.8 / Sonnet 4.6 only). [Decision 9]
2. **Context > 272K input tokens AND cost-sensitive → mandatory redirect OFF GPT-5.5** (GPT-5.5 applies a 2× input / 1.5× output session multiplier above 272K). [Decision 9; OpenAI, 2026a]
3. **Output > 64K tokens → Claude Opus 4.8 only** (Sonnet/Haiku cap at 64K; Opus 4.8 = 128K). [Anthropic, 2026a]
4. **Any math / formal-proof task → GPT-5.5** regardless of declared category. [Decision 10]

**Three halt-and-surface conditions (no writes):** missing mandated contradiction-checker; secret/credential exposure or destructive-action ambiguity; conflicting instructions or evidence the pipeline is compounding errors. [Anthropic AGENTS.md mandate; OpenAI, 2026i]
