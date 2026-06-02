## 2. Canonical Work-Category Taxonomy (A)

Each card: **definition · classify signals · examples · boundary/anti-example**. Boundaries are what stops two categories from overlapping.

### 2.1 `coding`
- **Definition:** Produce or modify code to satisfy a stated, bounded objective, with success checkable by running it (compile/test/lint). The objective is known; the work is implementation.
- **Classify signals:** "implement", "add a function/endpoint/flag", "write code that…", "make the test pass", framework conventions already visible, change is scoped to a known target.
- **Examples:** Add a `--dry-run` flag following the existing CLI parser; implement a DTO + serializer from a given schema; make a failing unit test pass with the smallest change.
- **Boundary / anti-example:** "Redesign the auth layer" is **not** `coding` — unbounded + cross-cutting → `architecture`. "Why does this crash intermittently?" is **not** `coding` → `debugging`. Pure CRUD/boilerplate from a clear template drops to `mechanical`.

### 2.2 `architecture`
- **Definition:** Decisions or changes with cascade effects across module boundaries, interfaces, or public API surface; refactor integrity; design that must hold many constraints simultaneously.
- **Classify signals:** "design", "refactor across", "interface/contract change", "migrate the module", ">2 files or public API affected", "how should we structure".
- **Examples:** 100K+ LOC migration; introduce an abstraction crossing three subsystems; choose a concurrency model for a service.
- **Boundary / anti-example:** A single-file cleanup is `mechanical` or `coding`, not `architecture`. Picking between two finished designs is `review_validation` (tie-breaking), not `architecture`.

### 2.3 `debugging`
- **Definition:** Given a symptom (failing test, crash, wrong output), find the root cause and apply a minimal fix, verifying by reproduction.
- **Classify signals:** "fix the bug", "why does X fail", "intermittent/flaky", "regression", stack trace or failing-test context present.
- **Examples:** Fix a failing pytest by reading impl + test; localize a regression to a commit; repair a flaky integration test.
- **Boundary / anti-example:** If the root cause spans multiple subsystems or demands a structural change, **escalate to `architecture`** (the symptom was architectural). Concurrency/threading bugs are a special case — see gate G3 (Claude verification). Authoring *new* tests is `coding`/`mechanical`, not `debugging`.

### 2.4 `review_validation`
- **Definition:** Evaluate an existing artifact and emit a verdict: code review, security review, the mandatory pre-commit contradiction-check, correctness/quality gating, tie-breaking between candidate outputs.
- **Classify signals:** "review", "check for", "is this correct/safe", "validate against spec", "which of these is right", "before commit".
- **Examples:** Review a diff against the spec; threat-model an auth change; arbitrate two subagents' conflicting outputs; the AGENTS.md pre-commit contradiction-checker.
- **Boundary / anti-example:** Generating the artifact is its own category; review only *judges* it. Self-review (same agent that wrote the code) is forbidden (§7 Anti-pattern D). Initial security *triage* may start on Codex, but the **verdict on concurrent/auth/permission-critical code must be Claude** (G3).

### 2.5 `extraction_terminal`
- **Definition:** Closed-loop terminal/CLI work and deterministic transformation of local artifacts into structured output: run commands, parse logs, trace references, emit JSON, generate release notes — answerable by code and evidence, not judgment.
- **Classify signals:** "find every place…", "extract/parse", "run and summarize", "emit JSON", "cite file:line", "from `git log`", schema-constrained output wanted.
- **Examples:** List risky untested modules as JSON with locators; parse a CI log into failing tests + owner files; trace all reads of a feature flag.
- **Boundary / anti-example:** If the question needs nuanced judgment or external truth (not in local artifacts), it is `knowledge_synthesis`, not extraction. "Find *all* security problems" without a threat model is an anti-example — overclaims; route the judgment part to `review_validation`.

### 2.6 `math_proof`
- **Definition:** Mathematical reasoning, formal or symbolic proof, multi-step derivation, quantitative correctness.
- **Classify signals:** "prove", "derive", "show that", formal notation, theorem/lemma, numeric/algebraic correctness is the deliverable.
- **Examples:** Prove a JSON schema field is never read by tracing all references; derive a complexity bound; produce a formal correctness argument.
- **Boundary / anti-example:** Per mandate (interview Q10) **all** math/proof goes to GPT-5.5 even though Sonnet 4.6 benchmarks well on arithmetic (89% math, Agent 1). This is a deliberate routing decision, not a benchmark inference — see G2. Applying a known formula in code is `coding`, not `math_proof`.

### 2.7 `knowledge_synthesis`
- **Definition:** Hold and integrate large or conflicting context into a coherent output: long-document/multi-source synthesis, research, strategic planning, nuanced/gray-area/ethical/policy reasoning, knowledge work (legal/financial).
- **Classify signals:** "synthesize", "plan the approach", "weigh the tradeoffs", "across these N sources/papers", "policy/legal/financial judgment", ">3 decision branches.
- **Examples:** Strategic multi-step plan with cross-module dependencies; synthesize 50+ papers into novel analysis; resolve an ambiguous-requirements tradeoff.
- **Boundary / anti-example:** Routine structured extraction from a known schema is `extraction_terminal`, not synthesis. Never route gray-area judgment to Haiku — it "misses nuances" (Agent 3). If sources are local artifacts and the output is mechanical, prefer `extraction_terminal`.

### 2.8 `mechanical`
- **Definition:** Leaf-node work that does not exercise reasoning: file read/search, symbol/import resolution, classification, format/lint checks, pattern-based boilerplate, simple deterministic transforms.
- **Classify signals:** "list/grep/find file", "classify into N labels", "format", "generate boilerplate from this template", "read and extract imports".
- **Examples:** Directory listing; import tracing; classify documents into 20 categories; scaffold a CRUD endpoint from a template.
- **Boundary / anti-example:** If the transform needs semantic disambiguation or conditional logic, escalate to `extraction_terminal` (Codex) or `coding` (Sonnet). Hard limit: **Haiku is 200K context** — anything larger leaves this category by gate G1.
