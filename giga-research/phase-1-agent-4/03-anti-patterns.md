## 3. Anti-Patterns Reference

### Anti-Pattern A: Task Duplication Across Providers

**Description:** Sending the same task to both Claude and GPT-5.5 simultaneously, planning to use whichever returns first or whichever "seems better."

**Why it fails:**
- Violates the "no duplicate tasks" constraint (Blackburn, 2026).
- Wastes 2x tokens with no additive value.
- Creates a reconciliation problem: two complete outputs must be compared and merged, which requires a third agent pass (now 3x cost).
- "When a single agent achieves >45% accuracy, introducing additional agents often leads to diminishing or even negative returns" (sesamedisk.com, 2026).

**Correct pattern:** Route to the model best suited to the task type. If genuinely uncertain which model is better, run a lightweight classifier pass first to determine routing, not both models in parallel on the full task.

---

### Anti-Pattern B: Averaging Conflicting Outputs

**Description:** When two agents (or two providers) produce conflicting outputs, instructing a third agent to "find the middle ground" or "synthesize the best of both."

**Why it fails:**
- On factual or deterministic matters (code correctness, spec compliance), there is no middle ground — one output is right and one is wrong. Averaging produces a third output that may be wrong in a new way.
- LLM Output Drift research shows cross-provider inconsistency on RAG tasks ranges 25-75% (arxiv.org/html/2511.07585v1, 2025). Averaging within this drift band produces outputs with no deterministic anchor.
- Averaging conflicting patterns is Rule 7 violation (Sanity Rules, CLAUDE.md): "Surface conflicts, don't average them. If two patterns contradict, pick one (more recent / more tested). Explain why."

**Correct pattern:** When two outputs conflict, escalate to the contradiction-checker (Pattern 3) to determine which is correct per the authoritative spec. Do not blend.

---

### Anti-Pattern C: Over-Delegating Trivial Work

**Description:** Spawning a multi-agent topology for tasks a single agent can complete in one call — file reads, simple extraction, single-function implementation, grep-style search.

**Why it fails:**
- Three agents consume 29,000 tokens vs. 10,000 for a single-agent equivalent — a 2.9x overhead before any agent produces useful work (beam.ai, 2026).
- "Context accumulation exceeding token limits" is the top multi-agent anti-pattern (beam.ai, 2026).
- Coordination overhead alone can flip a profitable task into a net-negative one.

**The test:** Would a senior engineer say this task is overcomplicated? If a grep or single-file read can answer the question, use the Read/Grep tool, not a subagent.

**Correct pattern:** Establish a strong single-agent baseline before transitioning to agent teams (sesamedisk.com, 2026). Default to single agent; escalate to multi-agent only when the task is genuinely parallelizable or requires specialization that cannot fit in one context.

---

### Anti-Pattern D: Same-Provider Self-Validation

**Description:** Having a GPT-5.5 agent review its own GPT-5.5-generated code, or a Claude agent review its own Claude-generated output.

**Why it fails:**
- "The same reasoning that produced the change will tend to validate it" — confirmation bias documented in Gaming the Judge (arxiv.org/pdf/2601.14691, 2026).
- Shared training distribution means same-family models share the same blind spots.
- "LLM-as-judge should never be relied upon alone because it introduces additional stochasticity" (digitalapplied.com, 2026).

**Correct pattern:** Cross-provider validation where the reviewer is from a different model family than the generator. If cross-provider is unavailable, use a different model tier within the same provider (e.g., Haiku generates, Opus reviews) as a weaker but non-zero mitigation.

---

### Anti-Pattern E: Peer-to-Peer Agent Mesh Without Coordinator

**Description:** Allowing all agents to communicate with all other agents during task execution, with no central orchestrator.

**Why it fails:**
- N agents create N(N-1)/2 potential interaction channels — quadratic explosion (beam.ai, 2026).
- "Cascade prevention" effectiveness with free peer communication: ~0.32. With centralized coordinator: >0.89 (niteagent.com, 2026).
- Infinite handoff loops documented as a top failure mode (beam.ai, 2026).
- "All five major vendors converged on the hub-and-spoke (orchestration) pattern in 2026" (niteagent.com, 2026).

**Correct pattern:** All inter-agent communication routes through the coordinator. Peers do not communicate with each other during a task; they communicate only with the coordinator.
