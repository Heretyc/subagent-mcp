## 1. CANONICAL WORK-CATEGORY TAXONOMY (Section A)

Design constraints honored: **clean, deterministic, small (8), agent-classifiable, no LOC thresholds, minimal overlap.** Each prompt maps to exactly one category; ties are broken by the **precedence order** in §1.9. Hard gates (§0, §3) are evaluated first and can override the category's primary route.

### 1.1 `coding` — Bounded code authoring & modification

- **Definition:** Write or modify source code with a known objective, scoped to a comprehensible set of files, where correctness is verifiable by reading the diff and running tests. This is the default "do some code" category.
- **Classification signals:** prompt names a feature/fix/refactor with a concrete target; "implement", "add", "fix", "refactor", "write a function/class/module"; framework conventions are already visible in the repo.
- **Examples:** add a `--dry-run` flag following the existing CLI parser style; fix a failing unit test; refactor a function for readability; generate a CRUD endpoint that matches existing patterns.
- **Boundary / anti-example:** "Rewrite the auth system" → **not** `coding` (no concrete scope, security-critical) → route to `planning_architecture` first, then `security_review`. A grep-style "find every place X is read" → **not** `coding` → `mechanical` or `extraction_proof`.

### 1.2 `agentic_execution` — Closed-loop, multi-step, tool-driven work

- **Definition:** A multi-step loop that inspects the repo, runs commands, edits files, observes results, and iterates until tests/checks pass. The unit of value is a **verified artifact produced over time**, not a single completion.
- **Classification signals:** "iterate until tests pass", "debug this intermittent failure using the logs", "run the suite and fix what breaks", long-horizon / unattended / "carry the change through the codebase"; terminal-heavy; benefits from a sandbox.
- **Examples:** fix a failing pytest by reading impl + tests, making the smallest change, running the targeted test, reporting the diff; complete a multi-command migration inventory; debug a flaky CI failure end-to-end.
- **Boundary / anti-example:** a one-shot code edit with no run-observe loop → `coding`. Multi-agent *coordination* (you are the orchestrator spawning workers) → `planning_architecture` (orchestration) + this category for each worker. Ambiguous-requirements debugging that spans subsystems still belongs here but escalates effort to `high`.

### 1.3 `planning_architecture` — Strategy, decomposition, design integrity

- **Definition:** Produce a plan, architecture, decomposition, or interface contract whose decisions have cascade effects across modules. No code is required to be written; the output is a structured plan or design rationale.
- **Classification signals:** ">3 decision branches", "cross-module dependencies", "design the system", "decompose into tasks", "interface contracts", "migration strategy", "ADR / design doc", refactor that crosses >2 files or changes a public API surface.
- **Examples:** decompose a multi-endpoint API build into parallel subtasks with explicit interface contracts; choose a refactor approach that touches three files in the right order; author an architecture decision record.
- **Boundary / anti-example:** single-module, single-file clean-up → `coding` or `mechanical`. Choosing between two already-produced solutions → `reasoning_judgment`.

### 1.4 `reasoning_judgment` — Gray-area, tie-breaking, oversight

- **Definition:** Weigh tradeoffs with no clear best answer; arbitrate between conflicting outputs; detect which of two plausible solutions is subtly wrong. Meta-reasoning and final-arbiter work.
- **Classification signals:** "which is better and why", "resolve this disagreement", "is this defensible", policy/legal/ethical tradeoff, ambiguous requirements needing a judgment call, "tie-break", "review the conflict".
- **Examples:** two subagents produced conflicting diffs — decide which is correct per the spec; weigh a security-vs-latency tradeoff; resolve ambiguous requirements into a defensible decision.
- **Boundary / anti-example:** a deterministic question code can answer → `mechanical`/`extraction_proof` (do **not** spend a judgment model on it — Sanity Rule 5). Producing the plan in the first place → `planning_architecture`.

### 1.5 `mechanical` — Deterministic, pattern-matching, low-reasoning

- **Definition:** Read/search/transform tasks that are pattern-matching rather than reasoning: file reads, symbol resolution, import tracing, grep-equivalent search, format checks, single-label classification, deterministic transforms, boilerplate from a clear template.
- **Classification signals:** "list", "find", "grep", "trace imports", "classify into N labels", "reformat", "scaffold a CRUD/DTO/config from this template", short deterministic transforms.
- **Examples:** list directory contents; resolve where a symbol is defined; classify 10M documents into 20 categories; generate config templates from a known pattern; summarize a <5K-line diff.
- **Boundary / anti-example:** extraction that must **cite evidence / file:line** or produce schema-validated structured output → `extraction_proof`. Classification with >5 ambiguous categories requiring nuanced judgment → escalate to `coding`/`reasoning_judgment`. Anything multi-step or semantically complex → not here.

### 1.6 `extraction_proof` — Evidence-bearing structured output & formal proofs

- **Definition:** Turn artifacts into structured, evidence-cited output (JSON against a schema, fact extraction with locators) **or** produce a formal/mathematical proof or multi-step derivation from local artifacts.
- **Classification signals:** "emit JSON matching this schema", "cite file:line", "extract failing tests + commands + owner files", "prove that field X is never read", "derive", "FrontierMath-style", any math/proof phrasing.
- **Examples:** parse a CI log into `{failing_tests, commands, stack_roots, owner_files}`; trace all references to prove a JSON field is dead; produce a formal proof from given premises.
- **Boundary / anti-example:** free-text summary with no schema and no evidence requirement → `mechanical`. **Hard gate:** any math/proof sub-case routes to GPT-5.5 even when the JSON-extraction sub-case would have gone to Sonnet (Decision 10).

### 1.7 `security_review` — Threat-model-sensitive review

- **Definition:** Review code or design for vulnerabilities, access-control logic, auth/crypto/deserialization/filesystem/shell/network/CI-CD/permission correctness, or threat-model adherence.
- **Classification signals:** "security review", "is this exploitable", "audit the permissions", "check the auth flow", "review the sandbox boundary", "find vulnerabilities", CWE references.
- **Examples:** triage a vulnerability; validate a patch; review access-control logic for a new endpoint; audit a sandbox-bypass request.
- **Boundary / anti-example:** routine correctness review with no security surface → `coding` (review) or `reasoning_judgment`. **This category carries a mandatory cross-review (§2.7).**

### 1.8 `synthesis_knowledge` — Long-context synthesis & knowledge work

- **Definition:** Synthesize many sources or a large corpus into novel analytical output; legal/financial/research knowledge work; long-document or repo-scale reasoning.
- **Classification signals:** ">10 sources", "synthesize the literature", "analyze this 50-paper corpus", "legal/financial analysis", "long-context synthesis", repo-scale reasoning, "produce a report".
- **Examples:** synthesize 50+ papers with novel analysis; produce a legal/financial domain assessment; reason across a full codebase to produce an audit narrative.
- **Boundary / anti-example:** routine synthesis of <10 sources → `synthesis_knowledge` at `high` is fine, but consider Sonnet 4.6 fallback. Pure extraction with locators (no synthesis) → `extraction_proof`. Map-reduce over a huge corpus uses this category only at the **reduce** step; the **map** step is `mechanical`.

### 1.9 Precedence order (deterministic tie-break)

When a prompt plausibly matches multiple categories, choose the **first** match in this order. This makes classification deterministic and biases toward safety/correctness:

```
security_review  >  planning_architecture  >  reasoning_judgment  >
agentic_execution  >  synthesis_knowledge  >  extraction_proof  >
coding  >  mechanical
```

Rationale: security and design decisions have the largest blast radius and must not be silently demoted to `coding`/`mechanical`; deterministic/cheap categories sit last so they are chosen only when nothing higher-stakes applies. Hard gates (§3) are evaluated **before** this order and can still override the resulting primary route (e.g., a `synthesis_knowledge` task at 300K context cannot land on a 200K-limited model).
