# Phase 2 — Core Synthesis (CANONICAL MERGE): Cross-Provider Work-Category Routing for subagent-mcp

**Status:** Master pre-decomposition document. Reconciles five independent flagship syntheses (`phase-2-synth-1..5`) into ONE canonical core, steered by the authoritative Phase 1.5 interview. This document will be DECOMPOSED into a `.spec/references` RAG knowledge base and feeds a new `subagent-mcp` routing feature.

**Date:** 2026-05-29.
**Scope:** Local fleet only — **Claude Code + Codex CLI**. Sub-agent handoff is **temp-file JSON IPC**. The Anthropic Managed Agents API is **out of scope** (Interview Q3).
**Purpose (Interview Q6):** An agent submits `{prompt, work_category}`; the MCP applies hard gates, classifies into exactly one work category, then routes to a `{provider, model, effort}` with a fallback chain, a cross-provider validation pattern, and applicable gates. The taxonomy and routing are **machine-consumable** (§9).

**Label key (Interview Q8):** `[SEED]` = Blackburn (2026) hypothesis (corroboration noted); `[INFERRED]` = extrapolated from cited facts; `[ASSUMPTION]` = mandated working premise. **Unlabeled = official vendor docs / verified benchmark.** On conflict, official docs + verified benchmarks **override** the seed directive.

**Authority chain applied throughout:** (1) Phase 1.5 interview decisions are binding steering. (2) Official vendor docs + verified benchmarks override seed. (3) Conflicts between the five syntheses are resolved by **best-sourced evidence, not blind averaging** (§11), tracing to Phase-1 agent reports where needed.

---

## 0. TL;DR — The Routing Contract in One Screen (most load-bearing)

The router does three deterministic things, in order, for every request:

1. **Apply GLOBAL HARD GATES first** (§3). Gates override category defaults. Context size, output size, math/proof routing, and security cross-review are gates, not preferences.
2. **Classify the prompt into exactly ONE work category** (§1) using first-match precedence (§1.10). If nothing matches, use the **`fallback_default`** route.
3. **Emit `{provider, model, effort}` + fallback chain + validation pattern** (§2) so the orchestrator knows what to do on failure and before commit.

**The two most load-bearing rules:**

- **(A) Security cross-review gate (G_SEC):** code touching auth, authorization/permissions, crypto, concurrency/threading, deserialization, secrets, filesystem, shell, network, or CI/CD that was **produced by GPT-5.5** gets a **mandatory Claude (Opus 4.8 preferred, Sonnet 4.6 minimum) cross-review before commit.** GPT-5.5 may do the *initial* security pass; the **verdict on high-risk code is Claude's** (Interview Q4).
- **(B) Context gates (G_CTX):** input **>200K tokens → Claude only** (Haiku/Sonnet 4.5 excluded); input **>272K AND cost-sensitive → mandatory OFF GPT-5.5** (price cliff); output **>64K → Opus 4.8 only** (Interview Q9).

**Eight canonical work categories** (one is `coding`) + an explicit fallback. Effort is a **task-class default** (Interview Q5), not a per-model default:

| precedence | id | one-line definition | primary route | effort |
|---:|----|--------------------|---------------|--------|
| 1 | `math_proof` | Mathematical / formal / symbolic proof or multi-step derivation | **GPT-5.5** (Codex) | high |
| 2 | `security_review` | Vulnerability / auth / permission / crypto / threat-model assessment + verdict | **Opus 4.8** (GPT-5.5 may do initial pass) | high |
| 3 | `architecture` | Cross-cutting design, refactor integrity, decomposition, orchestration | **Opus 4.8** | xhigh |
| 4 | `quality_review` | Judge a non-security artifact; tie-break; pre-commit contradiction-check | **Opus 4.8** | high |
| 5 | `debugging` | Diagnose + fix an *observed failure* | **Sonnet 4.6** | high |
| 6 | `agentic_execution` | Closed-loop terminal/CLI work + deterministic structured extraction | **GPT-5.5** (Codex) | medium |
| 7 | `knowledge_synthesis` | Long-context / multi-source synthesis, nuanced gray-area judgment | **Opus 4.8** | high→max |
| 8 | `coding` | Write/modify code to a bounded, verifiable objective | **Sonnet 4.6** | medium |
| 9 | `mechanical` | Low-reasoning leaf work: read/search/classify/format/boilerplate | **Haiku 4.5** | n/a (fixed) |
| — | `fallback_default` | Under-specified / unclassifiable / unsupported | **Sonnet 4.6** read-only, or ask for narrower category | medium |

**Three halt-and-surface conditions (no writes):** missing mandated contradiction/security checker (or mandated provider unavailable); secret/credential exposure or destructive-action ambiguity; conflicting instructions, identity/authorization uncertainty, or evidence the pipeline is compounding errors.

**Opus 4.8 framing (Interview Q2, de-hyperbolized):** clear leader on **agentic / long-horizon / nuance** work; **roughly equal on isolated coding**. Route by task-split, not blanket superiority. (SWE-bench Verified 88.6% vs GPT-5.5 88.7% = tied within noise; SWE-bench Pro 69.2% vs 58.6% = Opus +10.6pp.)

---

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

---

## 2. ROUTING PER CATEGORY

Each row: **primary {provider · model · effort} → fallback chain → cross-provider synergy/validation → applicable hard gates.** Effort is a **task-class default** (Interview Q5), tunable *down* after evals show no quality loss. The category sets effort; the model determines the *available* ladder — if a fallback model lacks a level (e.g., `xhigh` exists only on Opus 4.7/4.8), step to the nearest supported level. **Escalate within a provider for retry; switch providers only for capability fit** (a category's primary), never as a retry mechanism. [INFERRED — Phase-1 Agent 3 §4.3]

| Category | Primary {provider · model · effort} | Fallback chain | Cross-provider synergy / validation | Hard gates |
|----------|-------------------------------------|----------------|-------------------------------------|------------|
| `math_proof` | **GPT-5.5** (Codex) · `high` (`xhigh` for hard/adversarial proofs) | GPT-5.5 `xhigh` → GPT-5.5-pro (capability-limited only) → Opus 4.8 `high` (**verification only**) | GPT-5.5 derives; Opus 4.8 may verify assumptions/exposition when the result affects architecture/security (as a `quality_review` step). | G_MATH; G_CTX (>272K cost-sensitive → reduce with Claude first; if irreducible → `needs_user`) |
| `security_review` | **Opus 4.8** · `high` (or GPT-5.5 `high` initial cyber/static pass **then** Opus 4.8 `high`) | Opus 4.8 `high` full review → Sonnet 4.6 `high` (surface only) → Opus 4.7 `high` | **MANDATORY cross-review (G_SEC):** if generator was GPT-5.5 and code touches auth/permission/crypto/concurrency/etc., Claude reviews before commit. **Never** GPT-5.5 self-review. Reviewer family ≠ generator family. | G_SEC; G_COMMIT; G_DATA |
| `architecture` | **Opus 4.8** · `xhigh` (`high` if scope is bounded) | Opus 4.7 `xhigh` → Opus 4.6 `high` → Sonnet 4.6 `max` (single-module plans only) | **Pattern 2:** Opus emits JSON decomposition `[{task_id,file,inputs,outputs,constraints}]` → ≤5 separable workers (Haiku/Codex/Sonnet) implement → Sonnet integration-reviews fan-in. If the plan becomes a committed artifact → contradiction-check first. | G_CTX (output >64K → Opus 4.8; set `max_tokens ≥ 64K` at xhigh/max) |
| `quality_review` | **Opus 4.8** · `high` | Opus 4.7 `high` → Sonnet 4.6 `high` (surface only) → Opus 4.6 `max` | **Cross-provider, never same-family** (Anti-Pattern D): if generator was Claude, a GPT-5.5 reviewer adds distributional independence, and vice-versa. Opus arbitrates conflicts and **picks one — never averages** (Sanity Rule 7). | G_COMMIT (this IS the contradiction-checker); G_DATA |
| `debugging` | **Sonnet 4.6** · `high` (`medium` for bounded failures) | Opus 4.8 `high` (cross-subsystem / system-level root cause) → GPT-5.5 `medium`–`high` (CLI-heavy repro) → Haiku 4.5 (shallow only) | Reproduce→patch→rerun loop. Escalate to Opus if root cause spans subsystems. **Concurrency/threading bug → G_SEC Opus 4.8 cross-review mandatory** (GPT-5.5 weak here). | G_CTX; G_SEC (if security-sensitive); G_COMMIT |
| `agentic_execution` | **GPT-5.5** (Codex) · `medium` (`low` for bounded fast-lane loops; `high` for ambiguous/cross-file/concurrency/migrations; `xhigh` only when one error is expensive and evals justify it) | GPT-5.5 unavailable → **Opus 4.8 `xhigh`** (Dynamic Workflows / Claude Code loop) → Opus 4.7 `xhigh` → Sonnet 4.6 `medium` (simple ops). **Never Haiku** for multi-step autonomous execution. | **Pattern 1 (highest ROI), MANDATORY before any commit:** Codex executes loop → produces `{diff, test_results, files_modified, task_description}` to temp file → **Claude reviews** (Opus arch / Sonnet routine) → APPROVE/BLOCK. Mitigates premature wrong-file commit, hallucinated APIs, incomplete multi-file edits. Use `--output-schema` for machine-readable output; map-reduce + sanitization for large corpora (Pattern 7). | G_CTX (>272K cost-sensitive → off GPT-5.5; >400K → off Codex harness → Claude); G_SANDBOX; G_COMMIT; G_DATA |
| `knowledge_synthesis` | **Opus 4.8** · `high` (`max` only for frontier or >10-source novel synthesis) | Sonnet 4.6 `high` (routine, ≤10 sources) → Opus 4.7 `high` → GPT-5.5 `medium` (source-grounded extraction pass) | **Pattern 7 (map-reduce + sanitization):** Haiku/Codex/Sonnet map agents emit constrained sanitized JSON; Opus reduces over **sanitized summaries only** (prompt-injection containment — raw/untrusted data never reaches the synthesis layer). **Pattern 4b (decisiveness injection):** on Opus stall, GPT-5.5 produces a concrete first attempt → Opus resumes as corrector. | G_CTX (treat 1M as a ceiling; keep working context ≤750K) |
| `coding` | **Sonnet 4.6** · `medium` (or GPT-5.5 `low`–`medium` when a terminal loop dominates) | Sonnet 4.6 `high` (quality-critical) → GPT-5.5 `medium` → Opus 4.8 `high` (cross-module / high-blast-radius). Downshift to Haiku only if the task is actually `mechanical`. | None by default. **If the diff touches a security surface → escalate review to `security_review` (G_SEC).** If Codex-authored → Pattern 1 Claude review on handoff. Worker tier under an `architecture` orchestrator (Pattern 2). | G_CTX; G_SEC (if security-adjacent); G_COMMIT; G_SANDBOX |
| `mechanical` | **Haiku 4.5** · n/a (fixed low profile) | Sonnet 4.6 `low` (3× cost, still correct) → Opus 4.6 `low` → GPT-5.4-mini `low` (cheap Codex leaf). **No upgrade to Opus is ever justified for mechanical work.** | None (verifiable by inspection / deterministic command / schema). In map-reduce, Haiku is the **map** tier emitting constrained outputs (enum/bool/short-JSON) so the reduce agent's context stays bounded. | G_CTX (input >200K → Haiku excluded → Sonnet 4.6 `low`) |
| `fallback_default` | **Sonnet 4.6** · `medium`, read-only | GPT-5.5 `low` (local deterministic inspection) → Opus 4.8 `high` (high-risk ambiguity) | Ask the orchestrator for a narrower category if writes/side-effects are implied. | Unsupported provider/model, unclear destructive scope, or conflicting hard gates → `needs_user` |

**Effort rationale (task-class defaults).** `mechanical` = fixed low (Haiku) — the reasoning gap doesn't matter. `coding` = Sonnet `medium` (official balanced default). `debugging`/`security_review`/`quality_review` = `high` (correctness depends on deeper reasoning). `agentic_execution` = GPT-5.5 `medium` (OpenAI's balanced Codex default). `architecture` = Opus `xhigh` (Anthropic's official agentic/planning starting point). `knowledge_synthesis` = Opus `high`, `max` only when evals show headroom (>10 sources / novel output). `math_proof` = GPT-5.5 `high`. [Anthropic 2026 effort docs; OpenAI 2026 reasoning/Codex docs]

---

## 3. GLOBAL HARD GATES (evaluated BEFORE category routing — they override the route)

Gates are deterministic preconditions evaluated first. A gate can override a category's primary route but **never relaxes** a mandatory validation. Order: evaluate all; the most restrictive applicable route wins.

**G_MATH — Math/proof routing (Interview Q10).** Any request classified `math_proof` (or any math/proof sub-case inside another category) → **GPT-5.5**, regardless of other signals. Effort `high` default; `xhigh` for adversarial/long derivations. This overrides Sonnet's math benchmark by mandate. (Subject to G_CTX if >272K & cost-sensitive.)

**G_CTX — Context-size gates (Interview Q9; Anthropic & OpenAI docs).**
- Input **>200K tokens → Claude only**: exclude Haiku 4.5 and Sonnet 4.5 (both 200K). Allowed: Opus 4.8 / Sonnet 4.6 (both 1M).
- Input **>272K tokens AND cost-sensitive → mandatory redirect OFF GPT-5.5.** GPT-5.5 charges **2× input / 1.5× output for the full session** above 272K input — a price cliff (§4). Route to Opus 4.8 / Sonnet 4.6 (1M, no long-context premium). If math/proof is irreducible below the cliff → reduce evidence with Claude first; if reduction would change validity → `needs_user`.
- Input **>400K tokens → off the Codex harness** (Codex caps at 400K; the GPT-5.5 *API* reaches 1.05M, but the local fleet uses Codex) → Claude 1M-context model.
- Input **>1M tokens → no single-route call**: split / retrieve / map-reduce before routing.
- Output **>64K tokens → Opus 4.8 only** (128K output; Sonnet/Haiku/Sonnet-4.5 cap at 64K).

**G_SEC — Security cross-review gate (Interview Q4; pre-commit, HARD).** If code touching **authentication, authorization/permissions, cryptography, concurrency/threading, deserialization, secrets, filesystem, shell, network, or CI/CD credentials** was produced or patched by **GPT-5.5**, a **Claude cross-review is mandatory before commit** (Opus 4.8 preferred, Sonnet 4.6 minimum). Initial security *triage* may run on GPT-5.5 (≈71.4% expert-cyber pass; AISI-confirmed "High" capability); the **verdict is Claude's.** Rationale: GPT-5.5's documented systematic misses — CWE-732 file-permission handling, hallucinated API signatures (e.g., a non-existent `opener` arg on `pathlib.Path.open`), and concurrency as its "Achilles heel" (≈170 threading bugs/mLOC). This subsumes the AGENTS.md pre-commit checker for security-sensitive code.

**G_COMMIT — Commit-time contradiction-checker (AGENTS.md mandate, always).** Before ANY commit that changes executable/source code, dispatch a **separate** contradiction/security checker using the **strongest explicitly selectable model + highest reasoning** (Opus 4.8 @ `max`). Input `{proposed_diff, relevant_specs}`; output `{status: clear|blocked|needs_user, findings:[...]}`. Proceed only on `clear`; **block** on `blocked`/`needs_user`, unresolved test failures, missing diff review, or unexplained [agentic mention removed] changes. **If the strongest checker is unavailable → HALT and tell the owner** — never degrade to a weaker checker (false confidence). The checker must be **cross-family** where possible and must not be the instance that produced the change (Anti-Pattern D).

**G_SANDBOX — Codex sandbox/bypass (OpenAI Codex permissions docs).** Codex runs least-privilege: `--sandbox read-only` for inspection, `workspace-write` for edits. `danger-full-access` / `--dangerously-bypass-approvals-and-sandbox` **only** inside an externally hardened, disposable, secret-free runner (clean checkout, network controls) — **never** a mixed-trust home directory. Halt on any sandbox-bypass ambiguity.

**G_DATA — Data boundary (OpenAI & Anthropic data-handling docs).** Classify data (public / internal / confidential / secret / regulated / owner-private) **before** routing. Only public/internal-low-risk may cross providers freely. **Never** route secrets/credentials/regulated/owner-private data to a provider, tool, or cache mode outside the approved boundary. **Never** set `OPENAI_API_KEY`/`CODEX_API_KEY` as job-level env in workflows that run repo-controlled code. Retention differs per feature path (web search, files, code-exec, batch, regional) — route on the exact feature path, not provider-wide. Halt on secret exposure or data-boundary breach.

**Opus sampling/effort constraints (apply whenever an Opus 4.7/4.8 route is selected):** do **not** set `temperature`/`top_p`/`top_k`/`budget_tokens` (400 error); use adaptive thinking + effort. At `xhigh`/`max`, set `max_tokens ≥ 64K` or reasoning truncates.

**Gate-interaction examples.** (1) `knowledge_synthesis`, 300K context, cost-sensitive → G_CTX excludes Haiku and pushes off GPT-5.5 (irrelevant; primary is Opus); Opus 4.8 `high` stands. (2) `math_proof`, 300K context, cost-sensitive → G_MATH says GPT-5.5, but G_CTX overrides → reduce with Claude then send the proof core to GPT-5.5; if irreducible → `needs_user` (surface that Opus is not the strongest at proofs and require verification).

---

## 4. COST MODEL (inflation-adjusted) — Interview Q7

**Cost formula (per call):**
`cost = in_tok·in_rate + cached_in·cached_rate + (visible_out + hidden_reasoning)·out_rate + tool/schema_tokens, then × {batch|flex|priority|fast|regional|long_context|tokenizer} multipliers.`
**Hidden reasoning/thinking tokens bill at the OUTPUT rate on both providers** and occupy context — high effort literally buys extra output tokens whether shown or not. Output contracts are therefore direct budget controls.

**Nominal per-MTok pricing (standard tier):**

| Model | Input | Output | Cached-in | Batch in/out | Fast / priority | Notes |
|-------|------:|-------:|----------:|--------------|-----------------|-------|
| Opus 4.8 / 4.7 / 4.6 | $5 | $25 | $0.50 hit | $2.50 / $12.50 | **4.8 fast** $10/$50; **4.6/4.7 fast** $30/$150 | 5-min cache write $6.25; 1-hr $10 |
| Sonnet 4.6 | $3 | $15 | $0.30 hit | $1.50 / $7.50 | — | 1M context at standard price |
| Haiku 4.5 | $1 | $5 | $0.10 hit | $0.50 / $2.50 | — | 200K context; fleet cost floor |
| GPT-5.5 (≤272K) | $5 | $30 | $0.50 | $2.50 / $15 | **priority** $12.50/$75 | output = 6× input |
| GPT-5.5 (>272K) | $10 | $45 | $1.00 | — | — | long-context price cliff (full session) |
| GPT-5.5-pro | $30 (≤272K) / $60 (>272K) | $180 / $270 | — | — | — | capability-limited cases only |

US-only / data-residency inference adds ~10% (eligible endpoints, both providers). [Anthropic 2026 pricing; OpenAI 2026 pricing; Phase-1 Agent 5]

**Inflation adjustment (apply in ALL Opus 4.7/4.8 comparisons — flag prominently).** The Opus 4.7/4.8 tokenizer produces **~32–45% more tokens** than Opus 4.6/Sonnet for equivalent text (Anthropic states up to ~35%; third-party analysis 32–45%). Despite identical per-token pricing, **effective Opus 4.7/4.8 cost is ~1.4× nominal**: $5/$25 sticker behaves like **~$7/$35 per content-MTok.** Practical consequence: the Sonnet-vs-Opus *effective* cost gap is **~6–7×**, not the ~5× sticker prices imply. This is a **silent migration surprise**, not a pricing change — recalibrate all token budgets on any 4.6→4.7/4.8 migration. Opus 4.6 keeps the old tokenizer (no inflation). [INFERRED from OpenRouter/findskill tokenizer analysis + Anthropic docs] [ASSUMPTION — 1.4× is the mandated modeling multiplier, Interview Q7]

**Effective-cost reference** (per 100K input + 20K visible output, excluding cache/tools; hidden-output assumption none=0, low=0.1×, med=0.25×, high=0.75×, xhigh=1.5×, max=2.5×):

| Model | none/fixed | low | medium | high | xhigh | max |
|-------|-----------:|----:|-------:|-----:|------:|----:|
| Haiku 4.5 | $0.20 | — | — | — | — | — |
| Sonnet 4.6 | — | $0.63 | $0.68 | $0.83 | — | $1.05 |
| Opus 4.6 | — | $1.05 | $1.13 | $1.38 | — | $1.75 |
| Opus 4.8/4.7 (1.4×-adjusted) | — | $1.47 | $1.58 | $1.93 | $2.45 | $3.15 |
| GPT-5.5 (≤272K) | $1.10 | $1.16 | $1.25 | $1.55 | $2.00 | — |
| GPT-5.5 (>272K) | $1.90 | $1.99 | $2.13 | $2.58 | $3.25 | — |

**Three-tier cost discipline** (validated, Augment Code 2026): Orchestrator (~5% of tokens, Opus/Sonnet) + Implementor (~45%, Sonnet/Codex) + Worker (~50%, Haiku) cuts session cost **40–60%** vs uniform Opus (e.g., $0.98 vs $2.02 on a 104K-in/60K-out session). The taxonomy operationalizes this: `mechanical`→Haiku and `agentic_execution`/`coding`→Codex/Sonnet keep ~95% of tokens off Opus.

**Cost levers (ranked):** (1) downshift category default effort after evals; (2) cache stable prefix (policy/system → static examples → tool schema → dynamic last; up to 90% input savings / 80% latency on hit); (3) batch/flex for async (50% off; not for interactive blockers); (4) strict output contracts (output is the expensive side: 5× input Claude, 6× input GPT-5.5); (5) summarize-and-restart when context >60–70% and active evidence <50%. Reserve fast/priority only when wall-clock latency has business value exceeding the multiplier (production incident, blocking human); never for background research or batch.

---

## 5. CONDENSED PROVIDER / MODEL CAPABILITY + RISK PROFILES

| Model | API id | Ctx in/out | Effort levels | Decisive strength | Decisive risk | Best categories |
|-------|--------|-----------|---------------|-------------------|---------------|-----------------|
| **Opus 4.8** | `claude-opus-4-8` | 1M / 128K | low/med/high/xhigh/max | Agentic/long-horizon leader; honesty (~4× fewer unremarked code flaws vs 4.7); final arbiter; knowledge work; web computer-use (~84% Mind2Web); nuance | Cost premium + ~1.4× tokenizer inflation; residual over-caution/stall on ambiguity; verbosity at max; locked sampling; Microsoft Foundry caps at 200K | architecture, security_review, quality_review, knowledge_synthesis |
| **Opus 4.7** | `claude-opus-4-7` | 1M / 128K | low/med/high/xhigh/max | Near-4.8; introduced `xhigh`; strict instruction following; high-res vision | Tool-skipping (fixed in 4.8); same tokenizer inflation; over-caution | Opus-category fallback |
| **Opus 4.6** | `claude-opus-4-6` | 1M / 128K | low/med/high/max | Legacy flagship; old tokenizer (no inflation); strong knowledge work (+144 Elo vs GPT-5.2 GDPval) | Most-documented stall/verbosity; no `xhigh`; stricter-4.7 prompts may differ | legacy/compat fallback |
| **Sonnet 4.6** | `claude-sonnet-4-6` | 1M / 64K | low/med/high/max | Coding sweet-spot (79.6% SWE-bench Verified, ~1.2pp < Opus 4.6 — smallest-ever gap); verification thoroughness; math 89%; 1M context | Loses coherence before Opus on long autonomous chains; `high` default can surprise latency — **set effort explicitly** | coding, debugging, routine review/synthesis |
| **Haiku 4.5** | `claude-haiku-4-5` | 200K / 64K | none (fixed low) | Fastest, cheapest ($1/$5, ~25× < Opus/token); 73.3% SWE-bench Verified; near-Sonnet on non-reasoning tasks | 200K ceiling; shallow on multi-step reasoning/nuance; no adaptive thinking; Feb-2025 knowledge | mechanical, fan-out/map leaves |
| **GPT-5.5** (Codex/API) | `gpt-5.5` | **1.05M API / 400K Codex** / 128K out; 272K price cliff | none/min/low/med/high/xhigh | Closed-loop terminal SOTA (Terminal-Bench ~82–83%); deterministic extraction; math/proof; fast-to-patch; ~40% fewer output tokens/task; security initial pass (≈71.4% expert cyber) | Confident hallucination; concurrency bugs (~170/mLOC); commits to wrong file before full exploration; literal instruction-following; CWE-732 miss patterns | math_proof, agentic_execution, coding (closed-loop), security initial pass |
| **GPT-5.4-mini** | `gpt-5.4-mini` | — | (light) | Cheap/fast light coding & Codex subagent leaves | Not an authority for security/governance/architecture | cheap Codex leaf |
| **GPT-5.5-pro** | `gpt-5.5-pro` | — | (pro) | Capability-limited hard proofs/reviews after GPT-5.5 high/xhigh fails | Very high cost ($30/$180) and latency | proof/review escalation only |

**Opus 4.8 capability framing [ASSUMPTION, Interview Q2, de-hyperbolized].** Clear leader on **agentic/long-horizon** work: SWE-bench Pro 69.2% vs GPT-5.5 58.6% (+10.6pp); Terminal-Bench 2.1 74.6% vs Opus 4.7 66.1% (+8.5pp); GDPval-AA knowledge-work score 1890 vs GPT-5.5 1769 (and vs Opus 4.7's 1753); only model to clear the Legal Agent Benchmark all-pass threshold. **Roughly equal on isolated coding:** SWE-bench Verified 88.6% vs GPT-5.5 88.7% (within noise). Route by **task-split**, not blanket superiority. (Opus 4.8 was released ~2026-05-29 — same day as this research — so 4.8-specific magnitude claims are [ASSUMPTION] with the benchmark numbers above as best available corroboration; see §11.)

---

## 6. CROSS-PROVIDER SYNERGY PATTERNS

Topology default is **hub-and-spoke**: a coordinator holds full context; workers return compressed schema-compliant summaries; **no peer-to-peer** worker mesh (peer mesh drops cascade-prevention from ~0.89 to ~0.32). All provider-boundary handoffs use **temp-file IPC with JSON schemas** (valid for the local fleet; Managed Agents API out of scope).

- **Pattern 1 — Codex executes → Claude reviews (HIGHEST ROI).** `agentic_execution` worker (GPT-5.5) writes `{diff, test_results, files_modified, task_description}` to a temp file; Claude (Opus arch / Sonnet routine) reviews against specs and emits APPROVE/BLOCK. Mitigates premature wrong-file commitment, hallucinated APIs, incomplete multi-file edits. **This is the repo's pre-commit contradiction mandate for Codex-authored code.**
- **Pattern 2 — Opus plans → parallel workers implement → Sonnet integration-reviews.** `architecture` emits a JSON decomposition with interface contracts; ≤5 separable workers (Haiku/GPT-5.5/Sonnet) each own one file/concern; Sonnet checks interface-contract adherence and duplicate logic on fan-in. Up to ~75% wall-clock reduction on separable work.
- **Pattern 4a — Claude catches GPT-5.5 security/hallucination blind spots** → formalized as the mandatory `security_review` second pass (G_SEC). Cross-provider distributional independence is the whole point.
- **Pattern 4b — GPT-5.5 decisiveness breaks Opus stall.** On Opus no-write stall (no writes in N min, repeated clarification loops), inject GPT-5.5 to produce a concrete first attempt → Opus resumes as corrector. A concrete wrong answer is easier to fix than an underspecified one. [SEED — Blackburn 2026, corroborated]
- **Pattern 5 — Mixed-provider validation tiers.** Generation (any) → per-output domain validation (isolation) → strongest-model cross-output synthesis + contradiction detection. Centralized validation contains error amplification (17.2× independent → 4.4× centralized).
- **Pattern 7 — Map-reduce with sanitization boundary.** `mechanical` map agents (constrained outputs) → `knowledge_synthesis` reduce agent sees only sanitized summaries. Security invariant: raw/untrusted data stays in the map layer (prompt-injection containment).

**Anti-patterns (the router must refuse):** **(A)** duplicate the same task across providers and pick a winner — burns 2× tokens + a 3rd reconciliation pass; route by category instead. **(B)** average conflicting outputs — on correctness/spec matters there is no middle ground; escalate to the arbiter and **pick one** (Sanity Rule 7). **(C)** over-delegate trivial work — a single Read/Grep beats ~2.9× multi-agent token overhead. **(D)** same-provider/same-instance self-validation — shared training distribution hides shared blind spots; reviewer must be a different family (or at least a different tier as a weak fallback). **(E)** peer-to-peer agent mesh without a coordinator.

---

## 7. FAILURE MODES & MITIGATIONS

| Failure mode | Where | Detection | Mitigation (routing terms) |
|---|---|---|---|
| Confident hallucination | GPT-5.5 (esp. "be exhaustive") | require URLs / file:line; spot-check vs docs; run `rg`/tests not memory | reject unsupported claims; source-only re-prompt; structured citation fields; cross-review before commit |
| Security bug | GPT-5.5 (CWE-732, NoneType, broadened perms, command injection) | diff/security checklist; secret scan; side-effect declaration | least-privilege sandbox (G_SANDBOX); deny `.env`/cred paths; **mandatory Claude cross-review (G_SEC)** |
| Concurrency bug | GPT-5.5 (~170/mLOC) | route all concurrent/async review to Opus 4.8 | Opus 4.8 `high` cross-checks any concurrent code GPT-5.5 touches (G_SEC) |
| Over-effort regression | GPT-5.5 high/xhigh, Opus max | unnecessary edits; over-search; degraded structured output | define "done when"; cap touched files; prefer medium; step up one notch only after prompt/schema/test fixes |
| Caution / stall | Opus 4.6 (and 4.7/4.8 on ambiguity) [SEED, corroborated] | no writes in N min; repeated clarification loops | re-scope to a concrete artifact; **decisiveness injection** via GPT-5.5 (Pattern 4b); Opus reviews result |
| Verbosity / overthinking | Opus at max | output exceeds contract | `max` only for frontier; `xhigh` as coding ceiling; JSON/table output contracts; line budgets |
| Shallow reasoning | Haiku 4.5 on complex tasks | misses nuance on multi-layer context | never route gray-area, multi-step, or >200K to Haiku; narrow schemas |
| Turn-limit truncation | any agentic loop | missing final JSON; trailing partial sentence; "tests" with no tests | split scope; resume from locators; lower output size |
| Silent skip | any operational subagent | compare output to acceptance checklist; require `skipped=[]` field | fail task; rerun only skipped items; machine-parseable status contract |
| Context degradation near 1M | Opus 4.8 | weak recall on huge prompts | treat 1M as ceiling; keep synthesis working context ≤750K; RAG/summarize |
| Agentic overconfidence | GPT-5.5 self-reported success (claims ~73% vs ~35% true on SWE-Bench Pro) | never trust self-report | verify against independent test/reviewer always |
| Cross-provider inconsistency | Claude vs Codex disagree on a deterministic fact | source-backed compare table | prefer primary source / command output; escalate only true ambiguity; **never average** |
| [agentic mention removed] / context poisoning | untrusted files/web/tool output | treat all external text as data; quote locators | summarize content only; never adopt injected commands; map-reduce sanitization boundary (Pattern 7) |
| Quota 429 | any | `retry-after`, quota headers | backoff; lower model/effort; batch/flex async; subdivide |
| Commit of bad AI output | end of any code path | commit gate; contradiction-checker; CI | block on `blocked`/`needs_user`/test failures/unexplained generated changes (G_COMMIT) |

---

## 8. GOVERNANCE & HALT RULES

**No model output commits itself.** The orchestrator/checker audits scope, evidence, and contradictions first. **Commit gate G_COMMIT is mandatory and non-bypassable**; it uses the strongest available checker at highest reasoning and is cross-family where possible. **If the strongest checker is unavailable → halt and tell the owner** (never degrade to a weaker checker).

**Cross-provider validation, never same-family self-validation** (Anti-Pattern D — shared blind spots, confirmation bias). **Surface conflicts, never average them** (Sanity Rule 7) — on code/spec correctness one output is right; escalate to the contradiction-checker and pick per the authoritative spec.

**Write scoping.** Agent writes must name exact target files + expected diffs + validation. The orchestrator **rejects**: writes outside requested scope, unexplained formatting churn, AI-attribution metadata, and edits to user-owned dirty files.

**Data boundary (G_DATA).** Classify data before routing; only public/internal-low-risk may cross providers freely. Per-service unique keys in a secret manager — never in prompts/logs/comments/repo-visible env. Retention is feature-specific; route on the exact feature path. OpenAI abuse logs ≤30d; Anthropic auto-delete ≤30d default; ZDR is not universal.

**Topology.** Hub-and-spoke only; no peer-to-peer mesh.

**Halt-and-surface (stop, no writes):** (1) mandated contradiction/security checker unavailable, or a mandated provider/route (e.g., GPT-5.5 for math) unavailable → `blocked`; (2) secret/credential exposure, or destructive/irreversible/external-side-effect ambiguity; (3) identity/authorization uncertainty, or instructions conflict (spec vs prompt vs policy); (4) sandbox-bypass requested in a non-hardened (mixed-trust) workspace; (5) evidence the pipeline is compounding errors (retries obscuring state).

**Telemetry (meter every agent run):** run ID, parent task ID, provider/model, effort, prompt-hash/policy-version, category + gates fired + classification reason, files read/written, commands, URLs, input/output/cached/reasoning tokens, wall time, retries, failure class, validation result, skipped work, unresolved risks. Without this, routing drifts toward premium-model overuse.

**Sub-agent output contract (all operational subagents):** machine-parseable `{status, summary, source_locators, risks, writes_requested}` — no bare prose. Large payloads go to temp files; subagents return only compact status JSON.

---

## 9. MACHINE-CONSUMABLE CATEGORY → ROUTE TABLE (the MCP loads this)

The router does **no model reasoning** to route — it executes gates, then a table lookup. The only model call in the routing step is the optional category classifier (Haiku, `low`), which emits one category id. Input envelope: `{prompt, work_category?, est_input_tokens, est_output_tokens, cost_sensitive, data_class, is_math_or_proof, touches[], author_family, action}`.

```json
{
  "schema_version": "2.0.0",
  "provenance": "phase-2-core-synthesis/2026-05-29",
  "fleet": ["claude_code", "codex_cli"],
  "ipc": "temp_file_json_schema",
  "topology": "hub_and_spoke",
  "default_category": "fallback_default",
  "classification_precedence": [
    "math_proof", "security_review", "architecture", "quality_review",
    "debugging", "agentic_execution", "knowledge_synthesis", "coding", "mechanical"
  ],
  "classification_rule": "run_gates_first; walk_precedence_first_match_wins; on_adjacent_tie_escalate_one_tier_up; if_no_match -> fallback_default",
  "hard_gates": [
    { "id": "G_MATH",    "if": "category == 'math_proof' || is_math_or_proof",
      "then": "force:{provider:openai,model:gpt-5.5,effort:high}; note:'overrides category; subject to G_CTX'" },
    { "id": "G_CTX_200", "if": "est_input_tokens > 200000",
      "then": "exclude_models:[claude-haiku-4-5,claude-sonnet-4-5]; allow:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G_CTX_272", "if": "est_input_tokens > 272000 && cost_sensitive",
      "then": "exclude_provider:openai; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G_CTX_400", "if": "est_input_tokens > 400000",
      "then": "exclude_harness:codex; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G_CTX_1M",  "if": "est_input_tokens > 1000000",
      "then": "split_reduce_first; no_single_route_call" },
    { "id": "G_CTX_OUT", "if": "est_output_tokens > 64000",
      "then": "route_to:[claude-opus-4-8]" },
    { "id": "G_SEC",     "if": "author_family == 'openai' && touches_any:[auth,authz,crypto,concurrency,deserialization,secrets,filesystem,shell,network,ci_credentials]",
      "then": "require_review:{provider:anthropic,model:claude-opus-4-8,min_model:claude-sonnet-4-6,before:commit}; forbid:gpt-5.5_self_review" },
    { "id": "G_COMMIT",  "if": "action == 'commit' && changes_executable_or_source",
      "then": "require_checker:{model:strongest_available,reasoning:max,cross_family:true,not_self:true}; block_status:[blocked,needs_user]; if_checker_unavailable:halt_owner" },
    { "id": "G_SANDBOX", "if": "provider == 'openai'",
      "then": "default_sandbox:workspace-write; bypass_only:hardened_disposable_runner" },
    { "id": "G_DATA",    "if": "data_class in [secret,regulated,owner-private]",
      "then": "halt_unless_approved_boundary; never_key_as_repo_visible_env" },
    { "id": "G_OPUS_LOCK","if": "model in [claude-opus-4-7,claude-opus-4-8]",
      "then": "forbid:[temperature,top_p,top_k,budget_tokens]; if effort in [xhigh,max]:set max_tokens>=65536" }
  ],
  "categories": {
    "math_proof": {
      "definition": "Mathematical/formal/symbolic proof, derivation, or rigorous correctness argument.",
      "classify_signals": ["prove","derive","theorem","lemma","invariant","formal","counterexample","complexity bound","FrontierMath"],
      "precedence": 1,
      "primary":  { "provider": "openai", "model": "gpt-5.5", "effort": "high" },
      "fallback": [ { "provider":"openai","model":"gpt-5.5","effort":"xhigh" },
                    { "provider":"openai","model":"gpt-5.5-pro","note":"capability-limited only" },
                    { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"verification only" } ],
      "gates": ["G_MATH","G_CTX_272"],
      "synergy_pattern": { "id":"gpt_derive_opus_verify", "trigger":"high-stakes proof: Opus 4.8 verifies assumptions/exposition" },
      "cost_note": "Mandated route (Interview Q10) overrides Sonnet 89% arithmetic; GPT-5.5 FrontierMath leadership.",
      "risk_flags": ["proof_gap","high_reasoning_cost"]
    },
    "security_review": {
      "definition": "Assess code/design for vulns, auth/permission/crypto/threat-model correctness; emit verdict.",
      "classify_signals": ["security review","vulnerability","exploitable","auth","permissions","crypto","deserialization","secret handling","threat model","CWE"],
      "precedence": 2,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "initial_pass_optional": { "provider":"openai","model":"gpt-5.5","effort":"high","framing":"cyber" } },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"full review" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high","note":"surface only" } ],
      "gates": ["G_SEC","G_COMMIT","G_DATA"],
      "synergy_pattern": { "id":"cross_provider_mandatory", "trigger":"gpt-5.5-authored high-risk code; reviewer family != generator; NEVER self-review" },
      "cost_note": "Reviewer cost is small vs blast radius; Opus 4.8 ~4x less likely to leave flaws unremarked vs 4.7.",
      "risk_flags": ["same_family_blind_spot","gpt55_concurrency_cwe732_miss","blocked_means_halt"]
    },
    "architecture": {
      "definition": "Cross-cutting design / refactor integrity / decomposition / orchestration planning.",
      "classify_signals": ["design","architecture","refactor across","interface/contract change","migrate module","decompose","orchestrate","tradeoff",">2 files or public API"],
      "precedence": 3,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "xhigh", "max_tokens": 65536 },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-7","effort":"xhigh" },
                    { "provider":"anthropic","model":"claude-opus-4-6","effort":"high" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"max","note":"single-module plans only" } ],
      "gates": ["G_CTX_OUT","G_OPUS_LOCK"],
      "synergy_pattern": { "id":"opus_plan_fanout_implement_sonnet_review", "trigger":">3 separable subtasks" },
      "emits": "decomposition_json:[{task_id,file,inputs,outputs,constraints}]",
      "cost_note": "Opus xhigh premium; effective ~1.4x nominal from tokenizer inflation. Justified by cascade-error cost.",
      "risk_flags": ["stall","verbosity","over_delegation"]
    },
    "quality_review": {
      "definition": "Judge a non-security artifact; tie-break; pre-commit contradiction-check.",
      "classify_signals": ["review this diff","is this correct","compare A vs B","tie-break","contradiction check","validate against spec","before commit"],
      "precedence": 4,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high" },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-7","effort":"high" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high","note":"surface only" },
                    { "provider":"anthropic","model":"claude-opus-4-6","effort":"max" } ],
      "gates": ["G_COMMIT","G_DATA"],
      "synergy_pattern": { "id":"cross_provider_reviewer", "trigger":"reviewer family != generator; NEVER self-review or average" },
      "cost_note": "Reviewer cost small vs missed-flaw blast radius.",
      "risk_flags": ["same_family_blind_spot","no_averaging"]
    },
    "debugging": {
      "definition": "Localize root cause from an observed failure and apply a minimal verified fix.",
      "classify_signals": ["fix the bug","why does X fail","intermittent/flaky","regression","root cause","stack trace","CI failure"],
      "precedence": 5,
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "high" },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"cross-subsystem" },
                    { "provider":"openai","model":"gpt-5.5","effort":"medium","note":"CLI-heavy repro" },
                    { "provider":"anthropic","model":"claude-haiku-4-5","effort":null,"note":"shallow bugs only" } ],
      "gates": ["G_CTX_200","G_SEC","G_COMMIT"],
      "synergy_pattern": { "id":"escalate_to_opus_if_cross_subsystem", "trigger":"root cause spans >1 subsystem; concurrency->Opus verify (G_SEC)" },
      "cost_note": "Sonnet ~2x faster, ~5x cheaper/token than Opus; debug loops are latency-sensitive.",
      "risk_flags": ["flaky_repro","over_effort"]
    },
    "agentic_execution": {
      "definition": "Closed-loop terminal/CLI work + deterministic structured extraction from local artifacts.",
      "classify_signals": ["run","execute","in the sandbox","iterate until tests pass","codex exec","parse logs","emit JSON","cite file:line","from git log","inventory"],
      "precedence": 6,
      "primary":  { "provider": "openai", "model": "gpt-5.5", "harness": "codex", "effort": "medium", "sandbox": "workspace-write" },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-8","effort":"xhigh" },
                    { "provider":"anthropic","model":"claude-opus-4-7","effort":"xhigh" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"medium","note":"simple ops" } ],
      "gates": ["G_CTX_272","G_CTX_400","G_SANDBOX","G_COMMIT","G_DATA"],
      "synergy_pattern": { "id":"codex_execute_then_claude_review", "trigger":"MANDATORY before commit (Pattern 1)" },
      "stall_recovery": "gpt-5.5_decisiveness_injection (Pattern 4b)",
      "forbid_model": "claude-haiku-4-5",
      "cost_note": "GPT-5.5 ~40% fewer output tokens on Codex tasks; use --output-schema to avoid retries.",
      "risk_flags": ["hallucinated_locator","wrong_file_commit","sandbox_bypass","agentic_overconfidence"]
    },
    "knowledge_synthesis": {
      "definition": "Long-context/multi-source synthesis, research, nuanced gray-area/policy/legal/financial judgment.",
      "classify_signals": ["synthesize","research","compare sources","across N sources","policy/legal/financial","gray area",">10 sources"],
      "precedence": 7,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "escalate_to": "max", "escalate_if": "sources>10 || novel_analysis" },
      "fallback": [ { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high","note":"<=10 sources routine" },
                    { "provider":"anthropic","model":"claude-opus-4-7","effort":"high" },
                    { "provider":"openai","model":"gpt-5.5","effort":"medium","note":"source-grounded extraction pass" } ],
      "gates": ["G_CTX_200","G_CTX_272"],
      "synergy_pattern": { "id":"map_reduce_sanitized", "trigger":"large corpus; raw data stays in map layer, reduce sees sanitized only" },
      "stall_recovery": "gpt-5.5_decisiveness_injection (Pattern 4b)",
      "cost_note": "Opus max only when >10 sources or novel output; treat 1M as ceiling, keep working context <=750K.",
      "risk_flags": ["context_overload","source_drift","seed_hypothesis_not_authority"]
    },
    "coding": {
      "definition": "Write/modify code to a bounded objective, verifiable by compile/test/lint.",
      "classify_signals": ["implement","add function/endpoint/flag","make test pass","write code that","wire up","update config"],
      "precedence": 8,
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium" },
      "fallback": [ { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high" },
                    { "provider":"openai","model":"gpt-5.5","effort":"medium","note":"closed-loop in Codex" },
                    { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"cross-module/high-blast-radius" } ],
      "gates": ["G_CTX_200","G_SEC","G_COMMIT","G_SANDBOX"],
      "synergy_pattern": { "id":"security_review_if_sensitive_else_codex_review", "trigger":"security surface -> G_SEC; codex-authored -> Pattern 1" },
      "cost_note": "Sonnet $3/$15 default; Opus 4.8 effective ~1.4x sticker, reserve for blast radius.",
      "risk_flags": ["security_review_if_sensitive","commit_checker_required"]
    },
    "mechanical": {
      "definition": "Leaf work: file read/search, symbol resolution, classification, format, pattern boilerplate.",
      "classify_signals": ["list/grep/find","trace imports","classify into N labels","reformat","scaffold from template","extract imports"],
      "precedence": 9,
      "primary":  { "provider": "anthropic", "model": "claude-haiku-4-5", "effort": null },
      "fallback": [ { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"low" },
                    { "provider":"anthropic","model":"claude-opus-4-6","effort":"low" },
                    { "provider":"openai","model":"gpt-5.4-mini","effort":"low","note":"cheap Codex leaf" } ],
      "gates": ["G_CTX_200"],
      "synergy_pattern": { "id":"constrained_leaf_in_fanout", "trigger":"fan-out/map-reduce; outputs limited to enum/bool/short-JSON" },
      "cost_note": "Haiku $1/$5 fleet cost floor (~25x cheaper than Opus/token); G_CTX_200 forces Sonnet fallback on overflow.",
      "risk_flags": ["shallow_reasoning","context_200k_cap"]
    },
    "fallback_default": {
      "definition": "Under-specified, mixed-beyond-resolution, or unsupported prompts.",
      "classify_signals": ["no category reaches confidence","absent/invalid hint","tied signals"],
      "precedence": 99,
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium", "mode": "read_only" },
      "fallback": [ { "provider":"openai","model":"gpt-5.5","effort":"low","note":"local deterministic inspection" },
                    { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"high-risk ambiguity" } ],
      "gates": ["G_DATA"],
      "synergy_pattern": { "id":"ask_for_narrower_category", "trigger":"writes/side-effects implied" },
      "cost_note": "Read-only by default; never commits without a narrower category.",
      "risk_flags": ["ambiguous_scope","needs_user"]
    }
  },
  "global_invariants": {
    "commit_gate": "strongest_available_checker; cross_family; not_self; halt_if_unavailable",
    "cross_provider_validation": "reviewer_family != generator_family",
    "no_duplicate_tasks": true,
    "no_output_averaging": true,
    "no_peer_to_peer_mesh": true,
    "subagent_output_contract": "{status,summary,source_locators,risks,writes_requested}",
    "telemetry_required": true
  }
}
```

---

## 10. SEED CORPUS STATUS (Interview Q8 — hypothesis only; docs/benchmarks override)

| [SEED] claim (Blackburn 2026) | Status vs docs/benchmarks | Routed to |
|---|---|---|
| Opus = planning/architecture/synthesis/nuance | **Corroborated** (GDPval-AA 1890; Super-Agent; ARC-AGI-2 gap; +144 Elo Opus 4.6 vs GPT-5.2) | `architecture`, `knowledge_synthesis` |
| Sonnet = balanced debug/review/reasoning | **Corroborated** (79.6% SWE-bench; ~70% dev preference for daily coding) | `coding`, `debugging` |
| Haiku = fast coding/file ops | **Corroborated** (73.3% SWE-bench; Claude Code auto-routes leaf work) | `mechanical` |
| GPT-5.5 = closed-loop/extraction/proofs/terminal | **Corroborated** (Terminal-Bench ~82–83%; ~40% fewer tokens; 20-hr task) | `agentic_execution`, `math_proof`, `coding` (closed-loop) |
| GPT-5.5 = confident hallucination + security bugs | **Corroborated** (CWE-732 misses; hallucinated `pathlib` arg; AISI cyber eval; Sonar/Endor) | G_SEC |
| Opus = caution/stall + verbosity | **Corroborated** (official low-effort "scopes to what was asked" implies prior over-extension; twinstrata) | Pattern 4b |
| +5 other-provider slots; separable/domain-split; no duplicate tasks | **Adopted** as fan-out capacity model (≤4–5 workers + 1 coordinator; Patterns 2/6) | Anti-Pattern A |
| Opus 4.8 ≫ 4.7 on ALL tasks | **OVERRIDDEN** → task-split: leads on agentic/long-horizon, ~equal on isolated coding (Interview Q2) | §5 framing |
| Haiku for ALL coding | **OVERRIDDEN** → Haiku is `mechanical`-only; multi-file/semantic coding is Sonnet/Codex | §1.9 boundary |

**Where a mandate overrides a benchmark:** `math_proof` → GPT-5.5 (Interview Q10) overrides Sonnet's 89% arithmetic benchmark. This is flagged as a *decision*, not an inference.

---

## 11. CONFLICT RECONCILIATION (where the five syntheses disagreed)

Resolved by **best-sourced evidence**, not averaging. Each entry: the disagreement → resolution → residual uncertainty.

1. **Category count & names (8 vs 9; naming variants).** Synths 1/2/3/5 converged on **8**; synth 4 used **9** (added an explicit `fallback_default`). **Resolution:** adopt **8 canonical work categories + an explicit `fallback_default` route** — synth 4's fallback discipline without inflating the *classifiable* set (the classifier still emits one of 8; the router supplies the default when none match). Canonical names chosen for crispness and to keep the four code-work categories distinct: `math_proof`, `security_review`, `architecture`, `quality_review`, `debugging`, `agentic_execution`, `knowledge_synthesis`, `coding`, `mechanical`. The synths' `extraction_terminal`/`terminal_exec`/`agentic_operations` are **merged into `agentic_execution`** (same closed-loop-vs-evidence axis, identical Codex route); `reasoning_judgment`/`deep_reasoning` gray-area work folds into `knowledge_synthesis`, while pure tie-breaking sits in `quality_review`. *Residual uncertainty:* the `agentic_execution` ∩ `coding` boundary (one-shot edit vs run-observe loop) is the most likely real-world mis-class; the precedence order + adjacent-tie escalation handle it, but evals should monitor it.

2. **`coding` primary route (Sonnet vs Codex/GPT-5.5).** Synths 1/2/5 → **Sonnet 4.6 @ medium**; synths 3/4 → **Codex/GPT-5.5** (closed-loop framing). **Resolution:** **Sonnet 4.6 @ medium is primary** for `coding`; GPT-5.5/Codex is the route for closed-loop work, which is precisely what `agentic_execution` captures. Keeping `coding`→Sonnet preserves the cost-quality default (79.6% SWE-bench at $3/$15) and the clean split (loop work → `agentic_execution`; bounded authored change → `coding`). GPT-5.5 remains a `coding` fallback when a terminal loop dominates. *Residual uncertainty:* teams that run nearly all coding through Codex may prefer the synth-3/4 default; this is an eval-tunable policy, not a correctness issue.

3. **GPT-5.5 context window (400K vs 1M vs 1.05M).** Synth 2 said 400K; synths 3/4/5 cited ~1M/1.05M. **Resolution (best-sourced — Phase-1 Agent 5 citing OpenAI docs directly):** **GPT-5.5 = 1,050,000-token API context, 128K max output**; the **400K figure is the Codex *harness* cap**, not the model. Since the local fleet uses **Codex**, the operative limit is **400K** (gate G_CTX_400), with the 272K price cliff and the >200K Claude-preference gate both binding earlier. No residual uncertainty on the numbers; the only nuance is harness-vs-API, now made explicit.

4. **SWE-bench (tie vs gap).** **Resolution (unanimous across Phase-1 Agents 1/3):** SWE-bench **Verified is tied** — Opus 4.8 88.6% vs GPT-5.5 88.7% (within noise). The real split is **SWE-bench Pro**: Opus 4.8 69.2% vs GPT-5.5 58.6% (Opus +10.6pp). This *is* the interview's task-split framing (Q2): parity on isolated coding, Opus leads on harder multi-step agentic work. No residual uncertainty.

5. **GDPval / knowledge-work figures (1890 vs +144 Elo vs +121 points).** Synth 3 conflated three different comparisons. **Resolution (Phase-1 Agents 1/3):** Opus 4.8 GDPval-AA knowledge-work score = **1890** (vs GPT-5.5 **1769**; vs Opus 4.7 **1753**) at max effort. The **"+144 Elo"** figure is a *different* comparison — **Opus 4.6 vs GPT-5.2** on GDPval (DataCamp). The "+121 points" is the Opus-4.8-vs-GPT-5.5 GDPval-AA margin (1890−1769) rounded. All three are real but not interchangeable; cited distinctly in §5/§10. *Residual uncertainty:* Opus 4.8 released same-day as the research, so the 1890 figure is [PRESS]-sourced (VentureBeat), not yet independently replicated.

6. **GPT-5.5 priority/fast pricing ($12.50/$75 vs "credit multiplier").** Synth 4 stated $12.50 in / $75 out; synth 5 said "credit multiplier." **Resolution (best-sourced — Phase-1 Agent 5 citing OpenAI pricing):** **GPT-5.5 priority = $12.50/input, $1.25/cached, $75/output** (2.5× standard). Synth 4 is correct; "credit multiplier" was the vaguer paraphrase. No residual uncertainty.

7. **Opus 4.8 magnitude over 4.7.** Synths split between "significant jump" and "modest but tangible." **Resolution (Interview Q2 + Phase-1 Agent 4 caveat):** frame as **task-split leadership** (materially better on agentic/long-horizon — SWE-Pro +10.6pp vs GPT-5.5, Terminal-Bench +8.5pp vs Opus 4.7, GDPval 1890 vs 1753; roughly equal on isolated coding), **not** blanket superiority. [ASSUMPTION] — Opus 4.8 released ~2026-05-29 (same day as research); magnitude claims carry residual uncertainty pending independent replication, but the directional task-split is well-corroborated.

8. **Tokenizer inflation magnitude (32–45% vs ~35%).** **Resolution:** Anthropic states up to ~35%; third-party (OpenRouter/findskill) estimates 32–45%. The mandated modeling figure is **~1.4× effective cost** (Interview Q7), which the range supports. *Residual uncertainty:* exact inflation is content-dependent; 1.4× is a planning constant, not a per-text guarantee.

---

## 12. References (APA — original sources only; internal KB files never cited)

AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities

Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8

Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5

Anthropic. (2026, February 17). *Claude Sonnet 4.6*. https://www.anthropic.com/claude/sonnet

Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview

Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort

Anthropic. (2026). *Adaptive thinking — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking

Anthropic. (2026). *Extended thinking tips — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips

Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing

Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits

Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide

Caylent. (2025). *Claude Haiku 4.5 deep dive: Cost, capabilities, and the multi-agent opportunity*. https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity

CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results

Contra Collective. (2026). *GPT-5.5 vs Claude Opus 4.8: Frontier coding and reasoning tested*. https://contracollective.com/blog/gpt-5-5-vs-claude-opus-4-8-2026

DataCamp. (2026). *Claude Opus 4.6: Features, benchmarks, tests, and more*. https://www.datacamp.com/blog/claude-opus-4-6

DataCamp. (2026). *Claude Sonnet 4.6: Features, access, tests, and benchmarks*. https://www.datacamp.com/blog/claude-sonnet-4-6

DataCamp. (2025). *Claude Haiku 4.5: Features, testing results, and use cases*. https://www.datacamp.com/blog/anthropic-claude-haiku-4-5

Endor Labs. (2026). *GPT-5.5 sets a new code security record (with Cursor, not Codex) in Agent Security League*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league

MindStudio. (2026). *GPT-5.5 vs Claude Opus 4.7 for [agentic mention removed]: Real-world differences*. https://www.mindstudio.ai/blog/gpt-5-5-vs-claude-opus-4-7-agentic-coding-2

NxCode. (2026). *Claude Sonnet 4.6: 79.6% SWE-bench at $3/MTok — Complete guide*. https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026

OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/

OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model

OpenAI. (2026). *GPT-5.5 model*. https://developers.openai.com/api/docs/models/gpt-5.5

OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models

OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive

OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions

OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing

OpenAI. (2026). *Prompt caching*. https://developers.openai.com/api/docs/guides/prompt-caching

OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance

OpenAI. (2026). *Reasoning models*. https://developers.openai.com/api/docs/guides/reasoning

OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis

Sonar. (2026). *OpenAI GPT-5.5: An evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation

The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8 as a "modest but tangible improvement" that tops GPT-5.5 in most benchmarks*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/

VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8 is here with 3X cheaper fast mode and near-Mythos level alignment*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment

Yang, C., et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.

*Multi-agent validation / governance findings:* arXiv:2508.02994 (Agent-as-a-Judge); arXiv:2601.14691 (Gaming the Judge); arXiv:2602.06948 (Agentic overconfidence); arXiv:2602.01331 (A-MapReduce); arXiv:2511.07585 (LLM output drift).

Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal seed document]. [SEED — treated as hypothesis only per Interview Q8; never cited as authority.]

---

*End of Phase 2 Core Synthesis (canonical merge). Most load-bearing content (routing contract, hard gates, machine-consumable table) is front-loaded. Eight canonical work categories + explicit fallback, gate-first deterministic routing, one worked schema record per category. All [SEED]/[INFERRED]/[ASSUMPTION] labels preserved; all conflicts reconciled by best-sourced evidence in §11. Ready for decomposition into the `.spec/references` RAG KB.*
