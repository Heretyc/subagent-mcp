# Phase 1 — Agent 4: Cross-Model Synergy and Handoff Patterns

**Research Agent:** Phase 1, Scope 4  
**Date:** 2026-05-29  
**Focus:** Cross-provider synergy patterns — where pairing providers/models demonstrably beats any single-model approach

---

## 1. Foundational Model Capability Map

Before pattern cards, a grounding summary of the models in scope (primary sources: Blackburn, L. (2026); benchmarks sourced from beam.ai, mindstudio.ai, contracollective.com):

| Model | Decisive Strength | Decisive Weakness | Best Agentic Role |
|---|---|---|---|
| **GPT-5.5 / Codex CLI** | Terminal-Bench 2.1: 78.2%; command-driven loops; structured tool invocation; fast-to-patch; 60% fewer tokens/task | Commits to wrong file before full repo exploration; weaker on multi-file edits spanning module boundaries; hallucinated non-existent API args (e.g., `pathlib.Path.open` opener param) | Execution, automation, boilerplate, scripts, fast iteration |
| **Opus 4.8** [ASSUMPTION: released ~2026-05-29; sparse corroboration] | SWE-Bench Pro: 69.2% (vs GPT-5.5's 58.6%); surgical multi-file patches; multi-step planning coherence; Humanity's Last Exam: 49.8% | Deliberate/slow; safety-first design may refuse or stall on ambiguous actions; cost premium | Architecture, long-context reasoning, correctness-critical review |
| **Opus 4.7** | MCP Atlas tool integration: 79.1%; FinanceAgent: 64.4%; adaptive debugging when tools fail | Extended thinking adds latency; over-caution reported; verbose output | Complex reasoning, ambiguity resolution, agentic planning |
| **Sonnet (current)** | Balanced debug, review, reasoning; lower cost than Opus | Not frontier on hardest tasks | Mid-tier review, testing, incremental work |
| **Haiku** | Rapid file reads, search, boilerplate; low cost | Not suitable for complex reasoning or multi-file architecture | Search, extraction, fast coding subtasks |

*Note on Opus 4.8:* The working assumption that Opus 4.8 represents a significant capability jump over 4.7 is supported by benchmarks from contracollective.com (SWE-Bench Pro 69.2%) but this model was reportedly released ~2026-05-29, same day as this research. Mark all Opus 4.8-specific claims [ASSUMPTION].

---

## 2. Cross-Provider Synergy Pattern Cards

### Pattern 1: Codex Closed-Loop Execution → Opus Architecture/Correctness Review

**Priority: HIGHEST** — Most frequently cited, highest concrete ROI evidence.

**Trigger:** Task involves multi-step code changes, new features, or bug fixes where execution speed matters but architectural correctness is non-negotiable. Specifically: PRs that touch module boundaries, shared abstractions, or security-sensitive paths.

**Topology:**
```
[Task Input]
     ↓
[Codex CLI / GPT-5.5] — Goal Mode, autonomous loop
  - Explores repo, patches files, runs tests, iterates
  - Produces: diff + summary + passing test status
     ↓  (structured handoff: diff + context JSON via temp file or stdout)
[Opus 4.8 / Claude Code] — Architecture & correctness review
  - Reads diff + relevant spec docs
  - Checks: cross-file correctness, interface contracts, security patterns
  - Emits: APPROVE / BLOCK + rationale
     ↓
[Human or CI gate] — Merge/reject
```

**Why it beats solo:**
- Codex CLI Goal Mode is designed for unattended multi-hour execution; Terminal-Bench score (78.2%) confirms terminal-loop dominance. But it "commits to the wrong file before fully exploring the repository" (MindStudio, 2026).
- Opus's surgical, deliberate planning "holds up better when a fix requires touching three files in the right order" and its multi-step reasoning is superior (SWE-Bench Pro: +10.6 pp over GPT-5.5; contracollective.com, 2026).
- Combined: Codex provides execution velocity; Opus provides correctness assurance. Neither alone covers both.

**Failure mode it mitigates:** Codex's premature commitment to a wrong file/path, hallucinated API signatures, and incomplete multi-file edits.

**Handoff mechanics:** Codex outputs structured diff to shared temp file (e.g., `/tmp/patch-context.json`) with schema: `{diff, test_results, files_modified, task_description}`. Opus reads this plus relevant spec files. No circular re-delegation.

**This repo's enforcement (AGENTS.md, line 60–65):** "Before any repository commit that changes executable/source code, dispatch a separate contradiction-checker sub-agent using the strongest explicitly selectable model and reasoning settings available to check against relevant specs/docs." This is precisely Pattern 1.

**Anti-pattern:** Running Codex and Opus on the *same* task in parallel and averaging or reconciling their outputs. This is output-averaging (see Anti-Patterns section) and wastes both the speed advantage of Codex and the depth of Opus without leveraging either correctly.

---

### Pattern 2: Opus Strategic Plan → Haiku Parallel Implementation → Sonnet Review

**Priority: HIGH** — Maps directly to the seed corpus capacity note (+5 other-provider slots).

**Trigger:** Large decomposable implementation tasks: new module, multi-endpoint API, batch test suite, documentation generation across many files.

**Topology:**
```
[Opus 4.8] — Planning pass (single agent, ~1k tokens output)
  - Reads full context
  - Produces: explicit task decomposition with interface contracts
  - Output: JSON plan [{task_id, file, inputs, outputs, constraints}]
     ↓  fan-out
[Haiku × N] — Parallel implementation (N = separable subtasks, ≤5)
  - Each receives single task spec + relevant context
  - Each writes exactly one file or function block
  - Each returns: {file_path, content, assumptions_made}
     ↓  fan-in (coordinator aggregates)
[Sonnet] — Integration review
  - Reads all outputs against the original plan
  - Checks: interface contract adherence, no duplicate logic, import consistency
  - Emits: PASS or {task_id, issue, fix_required}
```

**Why it beats solo:**
- Fan-out cuts wall-clock time by up to 75% (beam.ai, 2026) for embarrassingly parallel subtasks.
- Haiku's low cost + speed for mechanical coding tasks avoids burning Opus tokens on boilerplate.
- Sonnet review is cheaper than Opus review and sufficient for integration-level checks.
- Opus's planning coherence prevents the primary failure mode of parallel agents: conflicting interfaces and duplicate logic.

**Failure mode it mitigated:** Without the Opus planning pass, parallel Haiku agents produce overlapping implementations with incompatible interfaces. Without the Sonnet review, integration gaps go undetected. Without decomposition to Haiku, using Opus for all subtasks wastes ~10x tokens on non-reasoning work.

**Capacity note (seed corpus):** The +5 other-provider slots are optimally used here: Opus (Claude) plans; 4-5 Haiku or GPT-5.5 slots (other-provider) run subtasks in parallel. This respects the "separable work only; split by domain; no duplicate tasks" constraint and the "allow other-provider agents more processing time (limited introspection)" note from Blackburn (2026).

**Anti-pattern:** Sending the same implementation task to all 5 other-provider slots without decomposition. This creates N identical attempts, none of which benefit from specialization, and requires expensive reconciliation.

---

### Pattern 3: Contradiction-Checker (Strongest Model Validates Before Commit)

**Priority: HIGH** — This is explicitly enforced in this repo's AGENTS.md.

**Trigger:** Any commit touching executable/source code, spec files, reusable prompts, or policy gates. Mandatory, not optional.

**Topology:**
```
[Primary Agent] — performs code/spec changes
     ↓
[Contradiction-Checker Sub-Agent]
  Model: strongest explicitly selectable + highest reasoning settings
  Input: (a) proposed diff, (b) relevant specs/docs
  Task: "Does this diff contradict any spec, introduce security risk,
         or violate documented interface contracts?"
  Output: {status: "clear" | "blocked" | "needs_user", findings: [...]}
     ↓
IF status == "clear": proceed to commit
IF status == "blocked" | "needs_user": halt; surface to owner; no writes
```

**Why it beats solo:** The primary agent may have introduced changes it believes are correct but which contradict a spec it did not re-read. The contradiction-checker uses the strongest available model with explicit reasoning, maximizing the probability it catches the inconsistency. This is the "agent-as-judge" pattern applied at the commit boundary (arxiv.org/pdf/2508.02994, 2026).

**Failure mode it mitigates:** Silent spec drift; changes that pass tests but violate architectural contracts; security regressions that functional tests don't catch.

**Critical implementation note (AGENTS.md):** "If unavailable, halt and tell the owner." The checker must not be bypassed when the strongest model is unavailable. Degrading to a weaker checker introduces false confidence.

**Anti-pattern:** Self-validation — having the primary agent also serve as its own contradiction checker. Confirmation bias in LLMs is well-documented; the same reasoning that produced the change will tend to validate it (Gaming the Judge, arxiv.org/pdf/2601.14691, 2026).

---

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

---

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

---

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

---

## 7. Sources

- Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal document]. [Authoritative seed corpus — cited for model capability assignments and capacity constraints only; not a web-accessible source]
- [GPT-5.5 vs Claude Opus 4.7: Which Model Wins for Agentic Work?](https://beam.ai/agentic-insights/gpt-55-vs-claude-opus-47-which-model-wins-for-agentic-work) — beam.ai, 2026
- [6 Multi-Agent Orchestration Patterns for Production (2026)](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production) — beam.ai, 2026
- [Multi-Model Orchestration in 2026: GPT-5.4, Claude Opus 4.7, and Gemini 3.1 Pro](https://almcorp.com/blog/multi-model-orchestration-gpt-5-4-claude-opus-4-7-gemini-3-1/) — ALM Corp, 2026
- [GPT 5.5 vs Claude Opus 4.8: Frontier Coding and Reasoning Tested](https://contracollective.com/blog/gpt-5-5-vs-claude-opus-4-8-2026) — Contra Collective, 2026
- [GPT-5.5 vs Claude Opus 4.7 for Agentic Coding: Real-World Differences](https://www.mindstudio.ai/blog/gpt-5-5-vs-claude-opus-4-7-agentic-coding-2) — MindStudio, 2026
- [Codex vs Claude Code: Which AI Coding Agent Should You Use in 2026?](https://www.mindstudio.ai/blog/codex-vs-claude-code-2026) — MindStudio, 2026
- [Agentic Coding in 2026: Claude Code vs Codex CLI vs Gemini CLI vs Cursor Agent](https://ofox.ai/blog/agentic-coding-claude-codex-gemini-cursor-2026/) — OFox, 2026
- [GPT-5.5 Sets a New Code Security Record](https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league) — Endor Labs, 2026
- [The Market Shift: Why Multi-agent LLM Coordination Matters in 2026](https://sesamedisk.com/multi-agent-llm-coordination-2026/) — Sesame Disk, 2026
- [Multi-Agent in Production 2026: 3 Patterns That Survived](https://niteagent.com/blog/multi-agent-production-2026/) — NiteAgent, 2026
- [Multiagent Sessions — Claude API Docs](https://platform.claude.com/docs/en/managed-agents/multi-agent) — Anthropic, 2026
- [Building Production-Ready AI Agents: Codex CLI Architecture](https://www.zenml.io/llmops-database/building-production-ready-ai-agents-openai-codex-cli-architecture-and-agent-loop-design) — ZenML, 2026
- [LLM Output Drift: Cross-Provider Validation & Mitigation for Financial Workflows](https://arxiv.org/html/2511.07585v1) — arxiv, 2025
- [A-MapReduce: Executing Wide Search via Agentic MapReduce](https://arxiv.org/pdf/2602.01331) — arxiv, 2026
- [AgentFixer: From Failure Detection to Fix Recommendations in LLM Agentic Systems](https://arxiv.org/pdf/2603.29848) — arxiv, 2026
- [Gaming the Judge: Unfaithful Chain-of-Thought Can Undermine Agent Evaluation](https://arxiv.org/pdf/2601.14691) — arxiv, 2026
- [Agentic Uncertainty Reveals Agentic Overconfidence](https://arxiv.org/pdf/2602.06948) — arxiv, 2026
- [When AIs Judge AIs: The Rise of Agent-as-a-Judge Evaluation for LLMs](https://arxiv.org/pdf/2508.02994) — arxiv, 2026
- [AI Agent Anti-Patterns (Part 1): Architectural Pitfalls](https://achan2013.medium.com/ai-agent-anti-patterns-part-1-architectural-pitfalls-that-break-enterprise-agents-before-they-32d211dded43) — Allen Chan / Medium, 2026
- [GPT-5.5 Is Out, Opus 4.8 Is Out, DeepSeek V4 Is Out](https://www.twinstrata.com/gpt-5-5-is-out-opus-4-8-is-out-deepseek-v4-is-out/) — TwinStrata, 2026

---

*[ASSUMPTION] marks: Opus 4.8 released ~2026-05-29; capability claims drawn from contracollective.com benchmark data but model is brand-new. Treat Opus 4.8-specific claims as provisionally correct pending broader corroboration.*
