## 4. Decision Table: When to Go Cross-Provider vs. Single-Model

| Scenario | Recommendation | Model Assignment | Rationale |
|---|---|---|---|
| Complex multi-file refactor, high correctness bar | Cross-provider: Codex execute → Opus review | Codex CLI → Opus 4.8 | Speed of Codex + correctness of Opus |
| Large decomposable implementation, >3 separable files | Cross-provider fan-out | Opus plans → Haiku/GPT-5.5 × N implement → Sonnet reviews | Parallelism cuts wall-clock; Opus planning prevents interface conflicts |
| Security-sensitive code (auth, crypto, permissions) | Cross-provider validation mandatory | GPT-5.5 generates → Claude (Opus/Sonnet) reviews | Claude catches GPT-5.5 systematic security miss patterns (CWE-732, etc.) |
| Opus stalled >N minutes on ambiguous task | Cross-provider decisiveness injection | GPT-5.5 produces first concrete attempt → Opus corrects | Breaks stall; gives Opus a concrete anchor to reason about |
| Pre-commit validation of any code change | Contradiction-checker sub-agent (strongest available) | Opus 4.8 + max reasoning | AGENTS.md mandate; cross-checks diff against specs |
| Simple extraction, single-file read, grep | Single agent, no delegation | Haiku or Sonnet | 2.9x token overhead of multi-agent is not justified |
| Same task, uncertain which provider is better | Single provider with routing classifier first | Classifier: Sonnet; then route to specialist | Never duplicate full task across providers |
| Broad research / corpus analysis | Map-reduce | Haiku × N map → Opus reduce | Context limit mitigation; parallelism |
| Sequential pipeline with clear stage dependencies | Sequential, single provider | Opus plans; Haiku or Sonnet per stage | Sequential interdependencies negate parallelism benefit |
| Output from GPT-5.5 that will be committed | Claude validation pass required | Sonnet minimum; Opus for architecture | Cross-provider catches distributional blind spots |
| Conflicting outputs from two agents | Contradiction-checker escalation | Opus 4.8 judges per spec | Never average; one is right per the authoritative spec |
| Regulated / compliance domain (healthcare, finance) | Cross-provider with audit trail | Deterministic core + Claude reasoning layer | LLM Output Drift research: structured outputs stable; RAG drifts 25-75% (arxiv, 2025) |
| Cloud-delegated parallel async tasks | Other-provider slots (≤5) | GPT-5.5 × up to 5, domain-split | Seed corpus capacity model; separable work only |

---

## 5. Topology Reference Summary

### Hub-and-Spoke (Production Default, 2026)
All five major agentic vendors (Anthropic, OpenAI, AutoGen, Cognition, LangChain) converged on this pattern in 2026 (niteagent.com, 2026). Coordinator maintains full context; subagents return compressed summaries; no peer-to-peer communication.

### Sequential Pipeline (Agent-Flow)
Best for: research → outline → write → review workflows. Highest observability; errors are localized. Failure mode: early errors cascade. Token cost: 29k for 3 agents vs. 10k solo (beam.ai, 2026).

### Fan-Out/Fan-In
Parallel execution on independent subtasks; 75% wall-clock reduction (beam.ai, 2026). Requires: (a) truly independent tasks, (b) coordinator aggregation, (c) token budget for N concurrent agents + aggregation pass.

### Map-Reduce
Variant of fan-out for large corpus exploration. Map agents constrained to short outputs; reduce agent sees sanitized summaries. Security invariant: raw/untrusted data stays in map layer.

### Bounded Collaboration (Controlled Peer Mesh)
Narrow high-stakes use (incident response, formal verification). Phase gates + shared workspace + final arbiter. "100% actionable recommendation rate" in incident-response trials vs. 1.7% for single-agent (niteagent.com, 2026). Token overhead only justified in high-stakes narrow domains.

---

## 6. Cross-Cutting Constraints

**Context isolation:** In Anthropic's Managed Agents API (`managed-agents-2026-04-01`), each agent runs in its own session thread with isolated conversation history. Tools, MCP servers, and context are not shared between agents (platform.claude.com, 2026). This is architecturally enforced, not just a best practice.

**Thread limits:** Maximum 25 concurrent threads per session (Anthropic); maximum 20 unique agents in a coordinator roster (platform.claude.com, 2026). The +5 other-provider slot model fits well within these limits.

**Output normalization:** All agents in a cross-provider topology must produce schema-compliant structured outputs. Free-text agent outputs cannot be reliably synthesized. Enforce Pydantic/JSON handoff contracts at every provider boundary (almcorp.com, 2026).

**Latency budget awareness:** When routing decisions include latency constraints, GPT-5.5's faster-to-first-patch behavior makes it preferable for real-time loops; Opus's extended thinking is best suited to background/async tasks where latency is less critical (ofox.ai, 2026).

**Stall detection:** Any automated orchestrator must implement stall detection for Opus-based agents: if no writes in N minutes and no explicit clarification request, escalate to GPT-5.5 decisiveness injection (Pattern 4b) or surface to the operator.

**Agentic overconfidence:** GPT-5.5-based post-execution agents predict 73% success against a true rate of 35% on SWE-Bench Pro (arxiv.org/pdf/2602.06948, 2026). Never accept an agent's self-reported success status as ground truth. Always verify outputs against an independent test or reviewer.
