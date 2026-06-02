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
