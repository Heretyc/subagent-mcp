# work-categories.md — Canonical Work-Category Taxonomy

**Load when:** classifying a prompt; verifying a category id; understanding classification signals,
definitions, or boundary cases.

**Do not load when:** you need routes/models (→ `./routing-table.md`), gate thresholds
(→ `./hard-gates.md`), or the routing evaluation order (→ `./routing-contract.md`).

---

## Precedence Order

```
math_proof > security_review > architecture > quality_review >
debugging > agentic_execution > knowledge_synthesis > coding > mechanical
```

First-match wins. On adjacent-tier ambiguity, escalate one tier up. See `./routing-contract.md §2`.

Classification is a pure-language task done by the cheapest model. No numeric thresholds enter
the classification step — context size is a gate, not a category boundary. [INFERRED]

---

## Category Cards

### `math_proof` — precedence 1

| Field | Content |
|---|---|
| **Definition** | Mathematical, statistical, algorithmic, or formal/symbolic proof, derivation, or rigorous correctness argument where the deliverable's correctness is symbolic or deductive. |
| **Classify signals** | prove · derive · theorem · lemma · invariant · formal · counterexample · complexity bound · FrontierMath · explicit mathematical notation |
| **Examples** | Prove a recurrence/complexity bound; derive a Bayesian update; check a protocol invariant; produce a formal correctness argument. |
| **Boundary / anti-example** | Cost arithmetic, simple metrics, or applying a *known* formula inside code → `coding` or `mechanical`. Math embedded in a routine review does not reclassify unless the proof *is* the deliverable. |

**Hard-gate note:** G_MATH routes all `math_proof` → GPT-5.5 regardless of benchmark performance
(mandate, Interview Q10). See `./hard-gates.md`.

---

### `security_review` — precedence 2

| Field | Content |
|---|---|
| **Definition** | Assess code or design for vulnerabilities, access-control/permission logic, auth/crypto/deserialization/filesystem/shell/network/CI-CD correctness, secret handling, or threat-model adherence; emit a vuln/triage verdict. |
| **Classify signals** | security review · vulnerability · exploitable · audit permissions · auth flow · crypto · deserialization · secret handling · sandbox boundary · threat model · CWE references |
| **Examples** | Triage a vulnerability; validate a security patch; review access-control logic; audit a sandbox-bypass request. |
| **Boundary / anti-example** | *Writing* the auth code → `coding` (then routes here for review). Routine correctness review with no security surface → `quality_review`. |

**Hard-gate note:** Carries mandatory cross-review gate G_SEC. Initial triage may start on GPT-5.5; **the verdict is Claude's**. Benchmark evidence and triage-pass rate → [model-profiles.md](./model-profiles.md). See [hard-gates.md](./hard-gates.md) for the full gate action.

---

### `architecture` — precedence 3

| Field | Content |
|---|---|
| **Definition** | Decisions or changes with cascade effects across module boundaries, interfaces, or public API surface; refactor integrity; decomposition; multi-agent orchestration planning; design holding many constraints. Output is a structured plan/design rationale. |
| **Classify signals** | design · architecture · refactor across · interface/contract change · migrate module · decompose into tasks · orchestrate · tradeoff · roadmap · >2 files or public API affected · >3 decision branches |
| **Examples** | Decompose a multi-endpoint API build into parallel subtasks with interface contracts; choose a refactor approach crossing three subsystems; author an ADR; design a multi-agent task split. |
| **Boundary / anti-example** | Single-file/single-module cleanup → `coding` or `mechanical`. Bounded implementation of an already-chosen design → `coding`. Choosing between two *already-produced* designs → `quality_review` (tie-break). |

---

### `quality_review` — precedence 4

| Field | Content |
|---|---|
| **Definition** | Evaluate a candidate artifact (diff, plan, two competing outputs) for correctness, contract adherence, contradictions; tie-break; the mandatory pre-commit contradiction-check. Non-security. |
| **Classify signals** | review this diff · review my PR · pull request review · is this correct · compare A vs B · tie-break · contradiction check · validate against spec · which is right · before commit |
| **Examples** | Review a diff against the spec; review a PR; arbitrate two subagents' conflicting outputs; run the pre-commit contradiction-checker; weigh a security-vs-latency tradeoff already framed. |
| **Boundary / anti-example** | Security-sensitive diff/PR (auth/authz/crypto/concurrency surface) → escalate to `security_review` before emitting `quality_review`. *Producing* the artifact → `coding` / `architecture`. Self-review (same agent that wrote the code) is forbidden (Anti-Pattern D). A deterministic question code can answer → `mechanical`. |

**Hard-gate note:** Carries G_COMMIT. This IS the contradiction-checker step. See `./hard-gates.md`.

---

### `debugging` — precedence 5

| Field | Content |
|---|---|
| **Definition** | Given a symptom (failing test, crash, wrong output, regression, flake), localize root cause and apply a minimal verified fix, confirming by reproduction. Defining feature: an *observed failure* to explain. |
| **Classify signals** | fix the bug · why does X fail · intermittent/flaky · regression · root cause · reproduce · stack trace · CI failure · timeout |
| **Examples** | Fix a failing pytest by reading impl + test; localize a regression to a commit; repair a flaky integration test. |
| **Boundary / anti-example** | Clean rewrite with no failure to diagnose → `coding`. Authoring *new* tests → `coding` / `mechanical`. Root cause spanning multiple subsystems → escalate to `architecture`. |

**Hard-gate note:** A concurrency/threading defect here triggers G_SEC (mandatory Opus cross-review).

---

### `agentic_execution` — precedence 6

| Field | Content |
|---|---|
| **Definition** | Multi-step closed-loop shell/CLI/sandbox work AND deterministic transformation of local artifacts into structured/evidence-cited output: run→observe→iterate until checks pass, parse logs, emit schema-bound JSON. The verified run or structured artifact *is* the deliverable. |
| **Classify signals** | run · execute · in the sandbox · iterate until tests pass · codex exec · parse logs · extract to JSON · cite file:line · from git log · inventory · emit JSON matching this schema · terminal-heavy pipeline |
| **Examples** | Fix a failing test via inspect→edit→run→report-diff; parse a CI log into structured JSON; trace all reads of a feature flag; build a migration inventory from git log. |
| **Boundary / anti-example** | One-shot edit with no run-observe loop → `coding`. Deciding migration *strategy* → `architecture`. Output is a math proof → `math_proof`. Broad gray-area judgment over external sources → `knowledge_synthesis`. |

---

### `knowledge_synthesis` — precedence 7

| Field | Content |
|---|---|
| **Definition** | Hold and integrate large or conflicting context into coherent novel output: long-document/multi-source synthesis, research, strategic reasoning, nuanced/gray-area/ethical/policy/legal/financial judgment, repo-scale reasoning. Also: explain/understand code when reasoning across the codebase is required and no artifact is produced. |
| **Classify signals** | synthesize · research · compare sources · across N sources/papers · policy/legal/financial judgment · gray area · weigh the tradeoffs (open-ended) · >10 sources · explain how this works (across multiple files/modules) · how does X work (codebase-wide) · walk me through the architecture · what does this system/codebase do |
| **Examples** | Synthesize 50+ papers into novel analysis; produce a governance/legal/financial assessment; resolve an ambiguous-requirements tradeoff; reason across a full codebase for an audit narrative; explain a module's design and tradeoffs with no deliverable artifact (only when reasoning across multiple files is required). |
| **Boundary / anti-example** | Deterministic structured extraction from a known schema → `agentic_execution`. Tie-breaking two finished outputs → `quality_review`. Map step in map-reduce → `mechanical`; only the **reduce** step is `knowledge_synthesis`. Literal symbol/definition lookup (no reasoning) → `mechanical`. Never route gray-area judgment to Haiku. **Single-symbol or single-file explanation ("what does this function do") → `mechanical` or `coding`** — only use `knowledge_synthesis` when the explanation requires reasoning across multiple files, sources, or a full codebase. |

---

### `coding` — precedence 8

| Field | Content |
|---|---|
| **Definition** | Write or modify source/tests/configs/scripts/schemas/documentation to satisfy a *known, bounded* objective, scoped to a comprehensible set of files, where correctness is verifiable by reading the diff and running compile/test/lint. Design is already decided. |
| **Classify signals** | implement · add a function/endpoint/flag · write code that... · wire up · make the test pass · update config · framework conventions already visible · scoped to a known target · document · write docs · README · docstring · add comments · add docstrings · changelog · API docs · write tests · add test coverage · optimize · make faster · reduce latency · reduce memory · port to · translate code · migrate to |
| **Examples** | Add a `--dry-run` flag; implement a DTO + serializer; refactor a function; make a failing unit test pass; write docstrings for a module; add a README for a known package; optimize a bounded function with a measurable goal; port a bounded unit to a target language. |
| **Boundary / anti-example** | "Redesign the auth layer" → `architecture` then `security_review`. "Why does this crash intermittently?" → `debugging`. Grep-style "find every place X is read" → `mechanical`/`agentic_execution`. Pure CRUD from a clear template → `mechanical`. Change crosses module boundaries/public API → `architecture`. Cross-cutting perf redesign → `architecture`. Perf regression from a known-good baseline → `debugging`. Port spanning module boundaries or re-picking abstractions → `architecture`. Template/parametrized test stubs → `mechanical`. |

**Performance-optimization boundary:** bounded target + measurable goal → `coding`; cross-cutting redesign → `architecture`; regression from known baseline → `debugging`.
**Documentation boundary:** writing/modifying docs, docstrings, comments, README, changelog for a known target → `coding`. Reasoned prose needing multi-source synthesis → `knowledge_synthesis`.
**Code-porting boundary:** 1:1 port of a bounded unit to a fixed target language/API → `coding`. Port crossing module boundaries or re-choosing abstractions → `architecture`.
**Test-authoring boundary:** new test for a known function/module → `coding`. Template/parametrized test stubs → `mechanical`.

---

### `mechanical` — precedence 9

| Field | Content |
|---|---|
| **Definition** | Deterministic, pattern-matched leaf work with no reasoning: file read/search, symbol/import resolution, grep-equivalent, format/lint checks, single-label classification, deterministic transforms, boilerplate from a clear template. |
| **Classify signals** | find · list · grep · where is · trace imports · rename · reformat · classify into N labels · scaffold a CRUD/DTO/config from template · short deterministic transforms |
| **Examples** | Directory listing; resolve where a symbol is defined; classify documents into 20 fixed categories; generate config templates from a known pattern; summarize a <5K-line diff. |
| **Boundary / anti-example** | Extraction that must *cite evidence / file:line* or produce schema-validated structured output → `agentic_execution`. Classification with many *ambiguous* categories needing nuance → `coding` / `knowledge_synthesis`. Hard limit: Haiku context limit — larger inputs leave via G_CTX (threshold owned by [hard-gates.md](./hard-gates.md)). |

---

### `fallback_default` — precedence 99 (no match)

| Field | Content |
|---|---|
| **Definition** | Under-specified, mixed-beyond-resolution, or unsupported prompts where no category's signals match with confidence. |
| **Classify signals** | No category reaches confidence · absent/invalid category hint · tied signals that don't resolve. **"Reaches confidence" = a single dominant signal-keyword family matches; if no single category's signals clearly match (or two categories tie without adjacent-tier resolution), emit `fallback_default`.** |
| **Route** | Sonnet 4.6 @ medium, read-only. Ask the orchestrator for a narrower category if any write/side-effect is implied. (Full route → `./routing-table.md`) |
| **Gate note** | If a hard gate applies, do not fall back — route or halt per the gate. |

---

*Cross-refs: `./routing-contract.md` · `./routing-table.md` · `./hard-gates.md` · `./synergy-patterns.md`*

---

Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026
