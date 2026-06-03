## 1. CANONICAL WORK-CATEGORY TAXONOMY

**Design constraints honored (Phase 1.5 Q1):** clean, deterministic, agent-classifiable, small (8 + fallback), **no LOC thresholds** (size is a *gate*, not a category boundary), minimal overlap, exactly one bucket per prompt. **Classification is a pure-language task** the cheapest model does reliably; numeric thresholds never enter the classification step. [INFERRED — classification doesn't exercise the reasoning gap; Phase-1 Agent 3 §4.5]

**Why these eight tile agentic SWE work with minimal overlap.** The set splits along two crisp axes: **(a) reasoning load** (mechanical → knowledge_synthesis) and **(b) deliverable type** (produce code / run a loop / judge an artifact / design / prove / synthesize). The single most important design choice is keeping `coding`, `architecture`, `debugging`, and the two review categories **separate** — collapsing them into one "coding" bucket is exactly the anti-pattern of averaging conflicting specialist strengths (§7). Every agentic SWE prompt lands in exactly one category because the precedence order (§1.10) resolves the only real overlaps: template-vs-logic (`mechanical` vs `coding`), bounded-change-vs-design (`coding` vs `architecture`), produce-vs-judge (`coding` vs `quality_review`), security-vs-general-judgment (`security_review` vs `quality_review`), and observed-failure-vs-fresh-code (`debugging` vs `coding`).

Each card: **definition · classify signals/keywords · examples · boundary/anti-example.**

### 1.1 `math_proof` — Mathematical / formal reasoning (precedence 1)
- **Definition:** Mathematical, statistical, algorithmic, or formal/symbolic proof, derivation, or rigorous correctness argument where the deliverable's correctness is symbolic or deductive.
- **Classify signals:** "prove", "derive", "theorem", "lemma", "invariant", "formal", "counterexample", "complexity bound", "FrontierMath", explicit mathematical notation.
- **Examples:** prove a recurrence/complexity bound; derive a Bayesian update; check a protocol invariant; produce a formal correctness argument.
- **Boundary / anti-example:** cost arithmetic, simple metrics, or applying a *known* formula inside code is **not** `math_proof` → `coding` or `mechanical`. Arithmetic embedded in a routine review does not reclassify unless the proof *is* the deliverable. **This is a hard-gate category (G_MATH): all math/proof → GPT-5.5 regardless of other signals** (Interview Q10), even though Sonnet 4.6 benchmarks well on arithmetic (89%). This is a deliberate routing mandate, not a benchmark inference (see §11).

### 1.2 `security_review` — Threat-model-sensitive assessment (precedence 2)
- **Definition:** Assess existing code or design for vulnerabilities, access-control/permission logic, auth/crypto/deserialization/filesystem/shell/network/CI-CD correctness, secret handling, or threat-model adherence; emit a vuln/triage verdict.
- **Classify signals:** "security review", "vulnerability", "is this exploitable", "audit the permissions", "auth flow", "crypto", "deserialization", "secret handling", "sandbox boundary", "threat model", CWE references.
- **Examples:** triage a vulnerability; validate a security patch; review access-control logic for a new endpoint; audit a sandbox-bypass request.
- **Boundary / anti-example:** *writing* the auth code → `coding` (then routes here for review). Routine correctness review with no security surface → `quality_review`. **Carries the mandatory cross-review gate (G_SEC, §3).** Initial triage may start on GPT-5.5 (≈71.4% expert-cyber pass); the **verdict on concurrent/auth/permission-critical code must be Claude's.**

### 1.3 `architecture` — Cross-cutting design & refactor integrity (precedence 3)
- **Definition:** Decisions or changes with cascade effects across module boundaries, interfaces, or public API surface; refactor integrity; decomposition; multi-agent orchestration planning; design holding many constraints simultaneously. Output is a structured plan/decomposition/design rationale — code need not be written.
- **Classify signals:** "design", "architecture", "refactor across", "interface/contract change", "migrate the module", "decompose into tasks", "orchestrate", "tradeoff", "roadmap", ">2 files or public API affected", ">3 decision branches".
- **Examples:** decompose a multi-endpoint API build into parallel subtasks with interface contracts; choose a refactor approach crossing three subsystems; author an ADR; design a multi-agent task split.
- **Boundary / anti-example:** single-file/single-module cleanup → `coding` or `mechanical`. Bounded implementation of an already-chosen design → `coding`. Choosing between two *already-produced* designs → `quality_review` (tie-break), not `architecture`.

### 1.4 `quality_review` — Non-security artifact judgment (precedence 4)
- **Definition:** Evaluate a candidate artifact (diff, plan, two competing outputs) for correctness, contract adherence, contradictions; tie-break; the **mandatory pre-commit contradiction-check**. Non-security.
- **Classify signals:** "review this diff", "is this correct", "compare A vs B", "tie-break", "contradiction check", "validate against spec", "which is right", "PR review", "before commit".
- **Examples:** review a diff against the spec; arbitrate two subagents' conflicting outputs; run the AGENTS.md pre-commit contradiction-checker; weigh a security-vs-latency tradeoff already framed.
- **Boundary / anti-example:** if the artifact is security-sensitive → `security_review`. *Producing* the artifact → `coding`/`architecture`. Self-review (same agent that wrote the code judging it) is forbidden (§7 Anti-Pattern D). A deterministic question code can answer → `mechanical` (do not spend a judgment model on it — Sanity Rule 5).

### 1.5 `debugging` — Fix an observed failure (precedence 5)
- **Definition:** Given a symptom (failing test, crash, wrong output, regression, flake), localize root cause and apply a minimal verified fix, confirming by reproduction. The defining feature is an *observed failure* to explain.
- **Classify signals:** "fix the bug", "why does X fail/crash", "intermittent/flaky", "regression", "root cause", "reproduce", "stack trace", "CI failure", "timeout".
- **Examples:** fix a failing pytest by reading impl + test; localize a regression to a commit; repair a flaky integration test.
- **Boundary / anti-example:** a clean rewrite with no failure to diagnose → `coding`. Authoring *new* tests → `coding`/`mechanical`. If the root cause spans multiple subsystems or demands a structural change → **escalate to `architecture`**. A concurrency/threading defect classifies here but triggers the security cross-review gate (G_SEC).

### 1.6 `agentic_execution` — Closed-loop terminal work + deterministic extraction (precedence 6)
- **Definition:** Multi-step closed-loop shell/CLI/sandbox work AND deterministic transformation of local artifacts into structured/evidence-cited output: run commands, edit→run→observe until checks pass, parse logs, trace references, emit schema-bound JSON with locators. The verified run or structured artifact *is* the deliverable; answerable by code + evidence, not judgment. (This category merges the synths' `extraction_terminal` / `terminal_exec` / `agentic_operations` — they are the same closed-loop-vs-evidence axis and route identically to Codex.)
- **Classify signals:** "run", "execute", "in the sandbox", "iterate until tests pass", `codex exec`, "parse logs", "extract to JSON", "cite file:line", "from git log", "inventory", "emit JSON matching this schema", schema-constrained output, terminal-heavy pipelines.
- **Examples:** fix a failing test via inspect→edit→run→report-diff; parse a CI log into `{failing_tests, commands, stack_roots, owner_files}`; trace all reads of a feature flag; build a migration inventory from `git log`.
- **Boundary / anti-example:** a one-shot edit with no run-observe loop → `coding`. Deciding the migration *strategy* → `architecture`. If the output is a mathematical proof → `math_proof` (G_MATH). If broad judgment / external truth dominates (not local artifacts) → `knowledge_synthesis`. "Find *all* security problems" without a threat model overclaims — route the judgment part to `security_review`.

### 1.7 `knowledge_synthesis` — Long-context synthesis & gray-area judgment (precedence 7)
- **Definition:** Hold and integrate large or conflicting context into coherent novel output: long-document / multi-source synthesis, research, strategic reasoning, nuanced/gray-area/ethical/policy/legal/financial judgment, repo-scale reasoning. (Merges the synths' `synthesis_knowledge` / `reasoning_judgment` / `deep_reasoning` gray-area work; pure *tie-breaking between candidates* lives in `quality_review`.)
- **Classify signals:** "synthesize", "research", "compare sources", "across N sources/papers", "policy/legal/financial judgment", "gray area", "weigh the tradeoffs" (open-ended), ">10 sources".
- **Examples:** synthesize 50+ papers into novel analysis; produce a governance/legal/financial assessment; resolve an ambiguous-requirements tradeoff into a defensible decision; reason across a full codebase to produce an audit narrative.
- **Boundary / anti-example:** deterministic structured extraction from a known schema → `agentic_execution`. Tie-breaking two finished outputs → `quality_review`. Map-reduce over a huge corpus uses this category only at the **reduce** step; the **map** step is `mechanical`. Never route gray-area judgment to Haiku — it misses nuance.

### 1.8 `coding` — Bounded code authoring & modification (precedence 8)
- **Definition:** Write or modify source/tests/configs/scripts/schemas to satisfy a **known, bounded** objective, scoped to a comprehensible set of files, where correctness is verifiable by reading the diff and running compile/test/lint. The default "do some code" category; design is already decided.
- **Classify signals:** "implement", "add a function/endpoint/flag", "write code that…", "wire up", "make the test pass", "update config", framework conventions already visible, scoped to a known target.
- **Examples:** add a `--dry-run` flag following the existing CLI parser; implement a DTO + serializer from a given schema; refactor a function for readability; make a failing unit test pass with the smallest change.
- **Boundary / anti-example:** "Redesign the auth layer" → **not** `coding` (unbounded + cross-cutting) → `architecture` first, then `security_review`. "Why does this crash intermittently?" → `debugging`. A grep-style "find every place X is read" → `mechanical` or `agentic_execution`. Pure CRUD/boilerplate from a clear template → `mechanical`. If the change crosses module boundaries / alters public API / picks an abstraction → `architecture`.

### 1.9 `mechanical` — Low-reasoning leaf work (precedence 9)
- **Definition:** Deterministic, pattern-matched leaf work with no reasoning: file read/search, symbol/import resolution, grep-equivalent, format/lint checks, single-label classification, deterministic transforms, boilerplate from a clear template.
- **Classify signals:** "find", "list", "grep", "where is", "trace imports", "rename", "reformat", "classify into N labels", "scaffold a CRUD/DTO/config from this template", short deterministic transforms.
- **Examples:** directory listing; resolve where a symbol is defined; classify documents into 20 fixed categories; generate config templates from a known pattern; summarize a <5K-line diff.
- **Boundary / anti-example:** extraction that must **cite evidence / file:line** or produce schema-validated structured output → `agentic_execution`. Classification with many *ambiguous* categories needing nuance → escalate to `coding`/`knowledge_synthesis`. Choosing *which* refactor pattern → `architecture`. **Hard limit: Haiku is 200K context** — larger inputs leave this category via G_CTX.

### 1.10 Precedence order (deterministic first-match tie-break) + default

When a prompt plausibly matches multiple categories, choose the **first** match in this order (top to bottom). Hard gates (§3) are evaluated **before** this order and can still override the resulting route.

```
math_proof  >  security_review  >  architecture  >  quality_review  >
debugging  >  agentic_execution  >  knowledge_synthesis  >  coding  >  mechanical
```

**Default / fallback:** if no category's signals match with confidence (under-specified, mixed beyond resolution, or unsupported), route to **`fallback_default`** — Sonnet 4.6 @ medium, read-only, and **ask the orchestrator for a narrower category** if any write/side-effect is implied. If a hard gate applies, do not fall back — route or halt per the gate.

**Rationale for the order:** the highest-blast-radius, hardest-to-reverse work sits first so it is never silently demoted. `math_proof` is first because it is an unconditional gate. `security_review` and `architecture` outrank everything else because a missed vuln or a wrong structural decision costs orders of magnitude more than the tokens. Deterministic/cheap categories (`coding`, `mechanical`) sit last so they are chosen only when nothing higher-stakes applies. [INFERRED — the precedence order is a synthesis design choice for determinism + safety bias, not vendor-specified.]

**Adjacent-tie escalation rule:** when genuinely uncertain between two *adjacent* tiers, escalate one tier up. The cost of under-powering verifiable work is a few extra tokens; the cost of under-powering high-blast-radius work is a cascade. [INFERRED]
