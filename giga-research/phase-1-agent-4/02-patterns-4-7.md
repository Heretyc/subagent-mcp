## 2. Cross-Provider Synergy Pattern Cards (continued)

### Pattern 4: Provider Blind-Spot Mitigation (Cross-Provider Catch Layer)

**Priority: HIGH** — Directly addresses GPT-5.5 hallucination and Opus stall risks from seed corpus.

#### 4a: Claude Catching GPT-5.5 Hallucination and Security Bugs

**Trigger:** GPT-5.5/Codex has completed an execution loop and produced code output. Output touches: authentication, filesystem permissions, cryptographic operations, API call schemas, or any path where hallucinated API signatures would be non-obvious.

**Evidence for this pattern:**
- Codex + GPT-5.5 hallucinated `opener` argument in `pathlib.Path.open` (does not exist), causing TypeError in tests (endorlabs.com, 2026).
- Codex + GPT-5.5 systematic miss patterns on CWE-732 (file permission handling), incomplete security class integration, NoneType type validation gaps (endorlabs.com, 2026).
- GPT-5.5 in 2025-era data: "confident hallucination, security bugs" (Blackburn, 2026).
- Harness effect: same GPT-5.5 model through Codex vs Cursor = 61.5% vs 87.2% functional correctness — harness shapes which vulnerabilities are caught (endorlabs.com, 2026).

**Topology:**
```
[Codex / GPT-5.5] → code output
     ↓
[Claude Opus or Sonnet] — hallucination and security review
  - Reads output against language stdlib docs (via tool) if available
  - Flags: non-existent API calls, permission misconfigurations, auth bypass vectors
  - Also catches: SSRF vectors, insecure deserialization, CWE-732 patterns
```

**Why it beats solo:** Claude (Anthropic models) consistently scores higher on tool integration correctness (MCP Atlas: 79.1% vs 75.3%) and handles ambiguous edge cases with adaptive reasoning rather than committing to a wrong path. Cross-provider review catches the harness-specific blind spots.

#### 4b: GPT-5.5 Decisiveness Breaking Opus Stall/Over-Caution

**Trigger:** Opus-led agent has been given a task with ambiguous requirements, is iterating without producing commits, has requested multiple clarifications without acting, or has been running for >2x expected duration without a concrete output.

**Evidence:**
- Opus 4.7/4.8: "safety-first design" prioritizes controlled, predictable outputs over aggressive execution (twinstrata.com, 2026).
- Opus 4.7: "over-caution, verbosity" are documented risks (Blackburn, 2026).
- GPT-5.5: "very fast to a first candidate patch and shines when the loop is command driven" (contracollective.com, 2026).
- GPT-5.5: Designed for autonomous multi-hour loops in Goal Mode (ofox.ai, 2026).

**Topology:**
```
[Opus 4.8] — stall condition detected
  (stall = no writes in N minutes, or repeated clarification loops)
     ↓  escalation trigger
[GPT-5.5 / Codex CLI] — decisiveness injection
  - Given: Opus's last reasoning output + task
  - Instruction: "Produce a concrete first attempt. Make explicit assumptions. Act."
  - Produces: initial patch/draft
     ↓
[Opus 4.8] — resumes as reviewer/corrector on GPT-5.5's concrete output
```

**Why it beats solo:** GPT-5.5's aggressive decisiveness produces a concrete anchor that Opus can then reason about and correct, rather than reasoning in a vacuum. A concrete wrong answer is easier for Opus to fix than an underspecified problem to solve from scratch.

**Failure mode it mitigates:** Opus stall/caution loop consuming tokens without producing outputs. Also the inverse: GPT-5.5 charging ahead with a wrong architecture — caught by Opus in correction mode.

**Anti-pattern:** Using GPT-5.5's output directly without Opus correction on ambiguous requirements. GPT-5.5 "commits to the wrong file before fully exploring the repository" and is "weaker on multi-file edits that span module boundaries" (contracollective.com, 2026).

---

### Pattern 5: Mixed-Provider Validation Tiers (Subagents Validating Subagents)

**Priority: HIGH** — Addresses the "subagents validating subagents" requirement and map-reduce synthesis.

**Trigger:** Any fan-out topology where multiple agents produce outputs that will be synthesized. High-stakes domains: security review, financial analysis, architecture decisions.

**Topology (three-tier validation):**
```
Tier 0 (Generation) — any model appropriate to task
  [Haiku × N] or [GPT-5.5 × N] → raw outputs

Tier 1 (Domain Validation) — specialized validators, same-or-different provider
  [Sonnet or GPT-5.5] — checks for factual consistency within each output
  Each validator sees only its assigned output (isolation)
  Emits: {output_id, issues: [...], confidence_score}

Tier 2 (Cross-Output Synthesis + Contradiction Detection) — strongest model
  [Opus 4.8] — reads all Tier 1 validator reports + original outputs
  Task: "Do these outputs contradict each other? Are aggregated claims defensible?"
  Produces: synthesized output with explicit conflict resolution
  Emits: {synthesis, unresolved_conflicts: [...], final_confidence}
```

**Why it beats solo:**
- Error amplification without coordination: independent agents amplify errors 17.2x; centralized validation contains this to 4.4x (sesamedisk.com, 2026).
- Multi-agent cross-validation improves accuracy by up to 40% on complex tasks vs. single-agent (collabnix.com, 2026).
- Tier separation prevents sycophancy cascades (where validators agree with generators simply because they were produced by the same model-family).

**Evidence for cross-provider contradiction detection value:** LLM Output Drift research (arxiv.org/html/2511.07585v1, 2025) shows RAG tasks drift 25-75% across providers at non-zero temperature. Cross-provider validation catches provider-specific artifacts before they propagate to synthesis.

**Failure mode it mitigates:** Hallucinated consensus — all N generators produce the same incorrect answer because they share training data distribution, and a same-model validator confirms it. A cross-provider validator (Claude checking GPT-5.5 outputs, or vice versa) has different distribution biases and is more likely to catch the error.

**Anti-pattern:** Using the same model family for both generation and validation. If GPT-5.5 generates and GPT-5.5 validates, shared failure modes go undetected. The value of cross-provider validation specifically comes from distributional independence.

---

### Pattern 6: Domain-Split Fan-Out with Cross-Provider Capacity

**Priority: MEDIUM-HIGH** — Core to the +5-slots capacity model.

**Trigger:** Task has multiple separable domain-specific subtasks (e.g., backend logic + frontend component + test suite + docs + security review). Each subtask is genuinely independent (no shared mutable state during execution).

**Topology:**
```
[Coordinator: Opus 4.8] — task decomposition
  Produces: domain-partitioned task specs with explicit interfaces
     ↓  fan-out across provider boundary
[Claude Haiku]      → subtask: search/extraction/file reads
[GPT-5.5 slot 1]   → subtask: backend implementation
[GPT-5.5 slot 2]   → subtask: test generation
[GPT-5.5 slot 3]   → subtask: boilerplate/scaffolding
[GPT-5.5 slot 4]   → subtask: documentation
     ↓  fan-in
[Coordinator: Opus 4.8] — aggregation + integration validation
```

**Capacity rationale (seed corpus):** The +5 other-provider slots from Blackburn (2026) are designed for exactly this pattern. The constraints are:
1. Separable work only — no subtask should depend on another's in-progress output.
2. Split by domain — each slot handles a different concern, not a variant of the same task.
3. No duplicate tasks — never assign the same task to multiple slots.
4. Allow other-provider agents more processing time — GPT-5.5 slots may take longer due to limited introspection; design fan-in to wait, not timeout-and-discard.

**IPC / handoff mechanics:** Use temp files with structured JSON schemas for agent-to-coordinator handoff. Schema example:
```json
{
  "agent_id": "gpt55-slot-2",
  "task_id": "test-generation",
  "status": "complete" | "partial" | "blocked",
  "outputs": [{"file": "tests/test_auth.py", "content": "..."}],
  "assumptions": ["AuthService interface is stable"],
  "blockers": []
}
```
Coordinator reads all outputs only after all slots report status, or after a defined timeout with partial results handling.

**Practical ceiling:** Current practical team size is 3-4 agents for optimal coordination (sesamedisk.com, 2026). Beyond 4-5, coordination overhead and context fragmentation erode gains. The +5-slot model maps well to this: 1 coordinator + 4-5 workers.

**Anti-pattern:** Letting fan-out agents communicate peer-to-peer. When N agents can all communicate with all others, coordination complexity is O(N²) and "cascade prevention" effectiveness drops from >0.89 to ~0.32 (niteagent.com, 2026). All communication must route through the coordinator.

---

### Pattern 7: Map-Reduce Synthesis

**Priority: MEDIUM** — Specialized variant of fan-out for broad search and analysis tasks.

**Trigger:** Tasks requiring exploration of many independent data sources, files, or domains where no single agent can hold all context simultaneously. Research, codebase-wide analysis, cross-repo audit.

**Topology (adapted from A-MapReduce, arxiv.org/pdf/2602.01331, 2026):**
```
MAP PHASE — lightweight sandboxed agents
  [Haiku × N] — each ingests ONE chunk (file, document, search result)
  Constraint: each emits constrained output (boolean, enum, short JSON)
  No cross-agent communication during map phase
  Isolation prevents malicious intermediate results from corrupting others

REDUCE PHASE — privileged synthesis agent
  [Opus 4.8 or Sonnet] — sees ONLY sanitized map outputs (not raw inputs)
  Uses deterministic aggregation (count, filter, majority-vote) first
  LLM synthesis only for final interpretation step
  Output: synthesized finding with confidence and source locators
```

**Security note:** Map agents see raw/untrusted data. Reduce agent sees only sanitized outputs. This prevents prompt injection in raw data from reaching the synthesis layer. The sanitization boundary is the key security invariant.

**Why it beats solo:** Single agents bottleneck on sequential reasoning and hit context limits on large corpora. A-MapReduce demonstrates parallelism advantage specifically when "problems require exploring multiple solution paths simultaneously" (arxiv.org/pdf/2602.01331, 2026).

**Anti-pattern:** Allowing map agents to produce unbounded outputs that the reduce agent must fully re-read. This recreates the context limit problem at the reduce layer. Map outputs must be constrained (enum, boolean, short JSON) to keep reduce-agent context manageable.
