# Phase 2 — Core Synthesis #2: Cross-Provider Work-Category Routing for subagent-mcp

**Role:** Phase 2 core synthesizer (independent synthesis #2 of 5).
**Date:** 2026-05-29.
**Purpose:** Define a clean, deterministic, machine-consumable work-category taxonomy and routing layer for a `subagent-mcp` feature. An agent submits `{prompt, work_category}`; the MCP distributes the work across a **local Claude Code + Codex CLI fleet** using the categories and routes defined here. Temp-file IPC is the valid handoff channel; the Anthropic Managed Agents API is out of scope.

**Authority order (on conflict):** Official vendor docs + verified benchmarks **override** the Blackburn (2026) seed directive. Seed-derived claims are labeled `[SEED]` with corroboration status. Inferences are `[INFERRED]`; mandated working premises are `[ASSUMPTION]`.

---

## 0. TL;DR — The Routing Layer in One Screen

**The fleet has three actors and one rule each agent obeys:** cheap/fast does separable verifiable work; expensive/high-effort does work where one missed contradiction or unsafe write costs more than the tokens; nothing commits itself.

**Eight work categories** (an agent classifies each prompt into exactly one):

| # | Category | Primary route | Default effort | Mandatory validation? |
|---|---|---|---|---|
| 1 | `coding` | Claude Sonnet 4.6 | medium | Cross-review if security-adjacent |
| 2 | `agentic_execution` | GPT-5.5 @ Codex | medium | **Yes** — Claude review before commit |
| 3 | `planning_architecture` | Claude Opus 4.8 | xhigh | Contradiction-check if it produces a committed artifact |
| 4 | `reasoning_judgment` | Claude Opus 4.8 | high | No (Opus is the arbiter) |
| 5 | `mechanical` | Claude Haiku 4.5 | n/a (fixed) | No |
| 6 | `extraction_proof` | GPT-5.5 (proofs) / Sonnet 4.6 (JSON) | medium / low | Proof verification by Claude if committed |
| 7 | `security_review` | GPT-5.5 (initial pass) | high | **Yes** — Claude cross-review (mandatory for concurrent/auth/permission) |
| 8 | `synthesis_knowledge` | Claude Opus 4.8 | high→max | No |

**Four hard gates evaluated BEFORE the category route (gate wins):**

1. **Context > 200K input tokens → Claude only** (Haiku excluded; Opus 4.8 / Sonnet 4.6 only). [Decision 9]
2. **Context > 272K input tokens AND cost-sensitive → mandatory redirect OFF GPT-5.5** (GPT-5.5 applies a 2× input / 1.5× output session multiplier above 272K). [Decision 9; OpenAI, 2026a]
3. **Output > 64K tokens → Claude Opus 4.8 only** (Sonnet/Haiku cap at 64K; Opus 4.8 = 128K). [Anthropic, 2026a]
4. **Any math / formal-proof task → GPT-5.5** regardless of declared category. [Decision 10]

**Three halt-and-surface conditions (no writes):** missing mandated contradiction-checker; secret/credential exposure or destructive-action ambiguity; conflicting instructions or evidence the pipeline is compounding errors. [Anthropic AGENTS.md mandate; OpenAI, 2026i]

---

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

---

## 2. ROUTING PER CATEGORY (Section B)

Each card gives: **primary** (provider + model + effort), **fallback chain**, **synergy/validation pattern**, and **hard gates** that can override. Effort is a **task-class default** (Decision 5), tunable down after evals show no quality loss. All cross-provider validation must be **distributionally independent** — never let the generating model family validate itself (Pattern D, §6).

### 2.1 `coding` → Sonnet 4.6 @ medium

- **Primary:** `claude-sonnet-4-6`, effort `medium`. Cost-quality sweet spot: SWE-bench Verified 79.6%, ~1.2pp below Opus 4.6, at ~5× lower nominal per-token cost and ~6–7× lower *effective* cost once Opus tokenizer inflation is counted (§4). [Anthropic, 2026a; NxCode, 2026]
- **Fallback chain:** Sonnet 4.6 @ `high` (quality-critical) → Opus 4.8 @ `high` (cross-module/architectural) → Opus 4.6 @ medium (legacy). Downshift to Haiku 4.5 only if the task is actually `mechanical`.
- **Synergy/validation:** none by default. If the diff touches a security surface, escalate the *review* to `security_review` (§2.7). For large decomposable builds, this category is the worker tier under a `planning_architecture` orchestrator (Pattern: Opus plans → workers implement → Sonnet integration-reviews; §6 Pattern 2).
- **Hard gates:** context >200K → stay on Sonnet/Opus (already satisfied); output >64K → Opus 4.8 only.

### 2.2 `agentic_execution` → GPT-5.5 @ Codex, medium

- **Primary:** `gpt-5.5` in the Codex CLI harness, `model_reasoning_effort="medium"`, `--sandbox workspace-write` (narrowest profile that completes the task). GPT-5.5 leads autonomous CLI work (Terminal-Bench 2.0 ~82.7%; closed a 20-hour engineering task in one run) and emits ~40% fewer output tokens on equivalent Codex tasks. [OpenAI, 2026a; CodeRabbit, 2026]
- **Effort ladder within category:** `low` for bounded fast-lane loops (inspect 2–5 files, surgical edit, run targeted test); `medium` default; `high` for ambiguous failures, cross-file invariants, concurrency bugs, migrations; `xhigh` only for hard asynchronous agents where a single error is expensive and evals justify it. [OpenAI, 2026d, 2026g]
- **Fallback chain:** GPT-5.5 unavailable → **Opus 4.8 @ xhigh** (Dynamic Workflows / Claude Code agentic loop). Opus 4.8 beats GPT-5.5 on SWE-bench Pro (69.2% vs 58.6%) and is the quality-priority alternative for multi-agent coordination. [The Decoder, 2026; contracollective, 2026] → Opus 4.7 @ xhigh. **Never Haiku** for multi-step autonomous execution.
- **Synergy/validation (MANDATORY before any commit):** **Pattern 1 — Codex executes → Claude reviews.** GPT-5.5 commits to the wrong file before fully exploring the repo, is weaker on multi-file edits spanning module boundaries, and hallucinates API signatures (e.g., a non-existent `opener` arg on `pathlib.Path.open`). Claude (Opus for architecture, Sonnet for routine) reads the diff + relevant specs and emits APPROVE/BLOCK. [MindStudio, 2026; Endor Labs, 2026]
- **Decisiveness injection (Pattern 4b):** if an Opus-led loop *stalls* (no writes in N minutes, repeated clarification loops), inject GPT-5.5 to produce a concrete first attempt, then return to Opus as corrector. A concrete wrong answer is easier for Opus to fix than an underspecified one. [Blackburn, 2026 [SEED], corroborated by twinstrata, contracollective 2026]
- **Hard gates:** context >272K & cost-sensitive → **off GPT-5.5**, redirect to Opus 4.8 @ xhigh; context >400K → off Codex (Codex caps at 400K) → Claude. Never set `OPENAI_API_KEY`/`CODEX_API_KEY` as job-level env in workflows that run repo-controlled code. [OpenAI, 2026i] `--dangerously-bypass-approvals-and-sandbox` only inside an externally hardened disposable runner.

### 2.3 `planning_architecture` → Opus 4.8 @ xhigh

- **Primary:** `claude-opus-4-8`, effort `xhigh` (the official Anthropic starting point for agentic/coding/planning). Opus 4.8 is the clear leader on long-horizon/agentic and design-integrity work: only model to complete all Super-Agent cases end-to-end; GDPval-AA 1,890 vs GPT-5.5 1,769 (~67% head-to-head on knowledge work). [VentureBeat, 2026; The Decoder, 2026] Per Decision 2, frame this as **task-split leadership** (agentic/long-horizon), not blanket superiority.
- **Fallback chain:** Opus 4.7 @ xhigh → Opus 4.6 @ high → Sonnet 4.6 @ max (single-module plans only).
- **Synergy/validation:** the plan *output* is a structured decomposition (JSON: `[{task_id, file, inputs, outputs, constraints}]`) consumed by worker agents. If the plan itself becomes a committed artifact (spec/ADR), run the contradiction-checker (§7) before commit. Orchestration role: Opus plans → Haiku/Codex workers implement in parallel (separable work only) → Sonnet integration-reviews (Pattern 2, §6).
- **Hard gates:** output >64K → Opus 4.8 only (already satisfied); set `max_tokens ≥ 64K` at xhigh/max. [Anthropic, 2026; Decision E6]

### 2.4 `reasoning_judgment` → Opus 4.8 @ high

- **Primary:** `claude-opus-4-8`, effort `high`. Opus holds the ARC-AGI-2 advantage (~8.4pp over Sonnet on novel abstract reasoning) that tie-breaking and gray-area work exercise; its ~4× lower rate of leaving code flaws unremarked makes it the preferred final arbiter. [DataCamp, 2026; VentureBeat, 2026] Escalate to `xhigh` when the tradeoff has no clear best answer.
- **Fallback chain:** Opus 4.7 @ high → Opus 4.6 @ high → Sonnet 4.6 @ max (only when the decision has <2 value-dimension tradeoffs). **Never Haiku** for gray-area.
- **Synergy/validation:** this *is* the validation/arbiter tier for the fleet. Do not also use the same Opus instance that generated a disputed artifact to judge it (avoid self-validation; §6 Pattern D). When arbitrating cross-provider conflicts, Opus reads both outputs + the authoritative spec and **picks one** — never averages (Sanity Rule 7; §6 Anti-Pattern B).
- **Hard gates:** none beyond the global gates; judgment tasks are rarely context- or output-bound.

### 2.5 `mechanical` → Haiku 4.5 (fixed profile)

- **Primary:** `claude-haiku-4-5`. No effort parameter — it runs at a fixed low-effort profile ideal for leaf nodes. SWE-bench Verified 73.3% (≈ prior-gen flagship); ~3–5× faster and ~5× cheaper than Sonnet; ~25× cheaper than Opus on a per-token basis. Quality parity with Sonnet on tasks that don't exercise the reasoning gap. [Caylent, 2025; DataCamp, 2025]
- **Fallback chain:** Haiku unavailable → Sonnet 4.6 @ `low` (3× cost, still correct). No upgrade to Opus is ever justified for mechanical work.
- **Synergy/validation:** none. In map-reduce, Haiku is the **map** tier producing constrained outputs (enum/boolean/short JSON); a stronger model reduces (§6 Pattern 7). Map outputs must be bounded so the reduce agent's context stays manageable.
- **Hard gates:** **context >200K → Haiku excluded** (200K hard ceiling) → Sonnet 4.6 @ low. Keep per-task context comfortably under the limit; for the largest monorepos, prefer Sonnet.

### 2.6 `extraction_proof` → GPT-5.5 (proofs) / Sonnet 4.6 @ medium (JSON)

- **Primary, split by sub-type:**
  - **Math / formal proof / multi-step derivation → GPT-5.5** (Decision 10 hard gate; FrontierMath leadership, structured extraction under tool constraints, 60% hallucination reduction vs GPT-5.4). Effort `medium`, `high` for hard derivations. [OpenAI, 2026a]
  - **Schema-bound JSON / evidence extraction → Sonnet 4.6 @ medium**, using `--output-schema` (Codex) or a strict JSON contract. Adequate and cheaper for known-schema extraction. Use `low` for simple, well-specified schemas. [Anthropic, 2026a]
- **Fallback chain:** Sonnet 4.6 @ high → Opus 4.8 @ high (for proof *verification* or semantic disambiguation of ambiguous fields). Never Haiku if the schema has conditional branches.
- **Synergy/validation:** for committed proofs, Claude verifies the GPT-5.5 derivation (cross-provider check). For extraction feeding automation, require `--output-schema` validation so malformed output fails loudly rather than silently.
- **Hard gates:** math/proof → GPT-5.5 (overrides the JSON-default Sonnet route); context >272K & cost-sensitive → off GPT-5.5 even for proofs → Claude.

### 2.7 `security_review` → GPT-5.5 initial pass + MANDATORY Claude cross-review

This is the most safety-loaded route. Decision 4 makes the cross-review **conditional but mandatory** for the high-risk classes.

- **Primary (initial pass):** `gpt-5.5`, effort `high`, with cyber/security framing. GPT-5.5 reaches ~71.4% on expert cybersecurity tasks (classified "High" capability by OpenAI; AISI-confirmed) and in agent-security trials finished with the fewest vulnerabilities. [OpenAI, 2026a; AISI, 2026; Endor Labs, 2026]
- **MANDATORY second pass (Claude cross-review) — required before commit when the code is concurrent, auth, or permission-critical:** route to **Opus 4.8 @ high**. Rationale and necessity:
  - GPT-5.5's documented Achilles heel is **concurrency/threading** bugs (≈170 threading bugs/mLOC dominate its bug profile); Opus 4.8 must cross-review any concurrent code GPT-5.5 flags or generates. [Phase-1 benchmark synthesis; Blackburn, 2026 [SEED], corroborated]
  - GPT-5.5 shows systematic miss patterns on CWE-732 (file-permission handling), incomplete security-class integration, and NoneType validation gaps; a cross-provider reviewer with different distributional biases catches these. [Endor Labs, 2026]
- **Fallback chain:** GPT-5.5 unavailable → Opus 4.8 @ high performs the **full** review (not just cross-check) → Sonnet 4.6 @ high (surface-level only). **Never Haiku** for security review.
- **Synergy/validation:** this is Pattern 4a (Claude catches GPT-5.5 security blind spots) made mandatory. Cross-provider independence is the whole point — do not let GPT-5.5 review its own security output (§6 Anti-Pattern D).
- **Hard gates:** context >272K & cost-sensitive → off GPT-5.5 → Opus 4.8 @ high for the full review; secret/credential paths must be denied in the sandbox; halt on any sandbox-bypass ambiguity.

### 2.8 `synthesis_knowledge` → Opus 4.8 @ high→max

- **Primary:** `claude-opus-4-8`, effort `high`, escalating to `max` when there are >10 sources or novel analytical output is required. GDPval-AA: Opus 4.8 @ max = 1,890 vs GPT-5.5 1,769; first model to exceed the Legal Agent Benchmark all-pass threshold; Databricks reported 61% cheaper token cost on multimodal PDF/diagram synthesis vs Opus 4.7. [VentureBeat, 2026]
- **Fallback chain:** Sonnet 4.6 @ high (routine synthesis, <10 sources) → Opus 4.7 → Opus 4.6.
- **Synergy/validation:** map-reduce for large corpora — Haiku/Codex map agents emit sanitized constrained outputs; Opus reduces over **sanitized** summaries only (prompt-injection containment: raw/untrusted data never reaches the synthesis layer). [§6 Pattern 7]
- **Hard gates:** `max` is the only effort that uncaps reasoning; reserve it (significant cost for small gains on structured tasks). Treat 1M context as a **ceiling, not a budget** — keep working context ≤750K to avoid edge-degradation on synthesis. [Phase-1 Agent 3]

---

## 3. HARD GATES — Evaluated Before Category Routing

Gates are deterministic filters applied to every task **before** the category's primary route. A gate can override a category route but never relaxes a mandatory validation. Order: evaluate all; the most restrictive applicable route wins.

| Gate | Condition | Action | Source |
|---|---|---|---|
| **G1 Context (Claude-only)** | input > 200K tokens | Exclude Haiku 4.5 and Sonnet 4.5 (200K limit). Allowed: Opus 4.8 / Sonnet 4.6 (1M). | Decision 9; Anthropic, 2026a |
| **G2 Context (off GPT-5.5)** | input > 272K tokens AND task flagged cost-sensitive | Mandatory redirect off GPT-5.5 (2× input / 1.5× output session multiplier kicks in above 272K). Route to Opus 4.8 / Sonnet 4.6. | Decision 9; OpenAI, 2026a |
| **G2b Context (Codex cap)** | input > 400K tokens | Off Codex harness entirely (400K cap) → Claude 1M-context model. | OpenAI, 2026a |
| **G3 Output size** | required output > 64K tokens | Opus 4.8 only (128K output; all others cap at 64K). | Anthropic, 2026a |
| **G4 Math/proof** | task is math or formal-proof in nature | Route to GPT-5.5 regardless of declared category. (Subject to G2 if >272K & cost-sensitive.) | Decision 10 |
| **G5 Effort floor at xhigh/max** | model is Opus 4.7/4.8 at xhigh/max | Set `max_tokens ≥ 64K` or reasoning truncates. | Anthropic, 2026; Decision E6 |
| **G6 Opus sampling lock** | model is Opus 4.7/4.8 | Do **not** set temperature/top_p/top_k or `budget_tokens` (400 error). Use adaptive thinking + effort. | Anthropic, 2026 |

**Gate interaction example:** a `synthesis_knowledge` task with 300K context, cost-sensitive → G1 excludes Haiku; G2 pushes off GPT-5.5 (irrelevant, primary is Opus); primary Opus 4.8 @ high stands. A `extraction_proof` math task with 300K context, cost-sensitive → G4 says GPT-5.5, but G2 overrides → Opus 4.8 @ high (note: Opus is not the strongest at proofs, so surface this as a known degradation and require verification).

---

## 4. COST MODEL (inflation-adjusted) — Section D.1

**Cost formula (per call):**
`cost = in_tok·in_rate + cached_in·cached_rate + visible_out·out_rate + hidden_reasoning·out_rate + tool/schema_tokens + region/priority/fast multipliers`

Hidden reasoning/thinking tokens are billed at the **output** rate on both providers and occupy context — high effort literally buys extra output tokens whether or not they're shown. [OpenAI, 2026k; Anthropic, 2026g]

**Nominal per-MTok pricing (standard tier):**

| Model | Input | Output | Cached-in | Batch in/out | Notes |
|---|---|---|---|---|---|
| Opus 4.8 / 4.7 / 4.6 | $5 | $25 | $0.50 hit | $2.50 / $12.50 | Fast mode (4.8): $10/$50 |
| Sonnet 4.6 | $3 | $15 | $0.30 hit | $1.50 / $7.50 | — |
| Haiku 4.5 | $1 | $5 | $0.10 hit | $0.50 / $2.50 | — |
| GPT-5.5 (≤272K) | $5 | $30 | $0.50 | $2.50 / $15 | Output = 6× input |
| GPT-5.5 (>272K) | $10 | $45 | $1.00 | — | Long-context cliff |
| GPT-5.5-pro | $30 | $180 | — | — | Capability-limited cases only |

[Anthropic, 2026d; OpenAI, 2026a, 2026d]

**Inflation adjustment (Decision 7 — apply in ALL Opus 4.7/4.8 comparisons):** the Opus 4.7/4.8 tokenizer produces ~32–45% more tokens than Opus 4.6/Sonnet for equivalent text. Despite identical per-token pricing, **effective Opus 4.7/4.8 cost is ~1.4× nominal**. Practical consequence: the Sonnet-vs-Opus *effective* cost gap is ~6–7×, not the ~5× the sticker prices imply. Flag this prominently on any 4.6→4.7/4.8 migration — it is a silent budget surprise, not a pricing change. [OpenRouter, 2026; findskill.ai, 2026]

**Three-tier cost discipline** (validated by Augment Code, 2026): Orchestrator (~5% of tokens, Opus/Sonnet) + Implementor (~45%, Sonnet) + Worker (~50%, Haiku) reduces session cost 40–60% vs uniform Opus. Worked example: a 104K-in/60K-out session ≈ $0.98 three-tier vs $2.02 uniform Opus.

**Cost levers (ranked):** (1) downshift category default effort after evals; (2) cache stable prefix (policy/system → static examples → tool schema → dynamic last; up to 90% input savings / 80% latency on cache hit); (3) batch/flex for async (50% off); (4) strict output contracts (output is the expensive side); (5) summarize-and-restart when context >60–70% and active evidence <50%. Fast/priority tiers only when latency has business value exceeding the multiplier. [OpenAI, 2026g; Anthropic, 2026d]

---

## 5. FAILURE MODES & MITIGATIONS — Section D.2

| Failure mode | Where | Detection | Mitigation |
|---|---|---|---|
| Confident hallucination | GPT-5.5 (esp. "be exhaustive") | require URLs / file:line; spot-check vs docs; run `rg`/tests not memory | reject unsupported claims; source-only re-prompt; structured citation fields; contradiction-check before commit |
| Security bug | GPT-5.5 (CWE-732, NoneType, broadened perms, command injection) | diff/security checklist; secret scan; side-effect declaration | least-privilege sandbox; deny `.env`/cred paths; **mandatory Claude cross-review** for auth/concurrency/permission code |
| Concurrency bug | GPT-5.5 (≈170/mLOC) | route all concurrent/async review to Opus 4.8 | Opus 4.8 @ high cross-checks any concurrent code GPT-5.5 touches |
| Over-effort regression | GPT-5.5 high/xhigh, Opus max | unnecessary edits; over-search; degraded structured output | define "done when"; cap touched files; prefer medium; step up one notch only after prompt/schema/test fixes |
| Caution/stall | Opus 4.6 (and 4.7/4.8 on ambiguity) [SEED, corroborated] | no writes in N min; repeated clarification loops | Opus 4.8 + xhigh + explicit continuation; **decisiveness injection** via GPT-5.5 (Pattern 4b) |
| Verbosity / overthinking | Opus at max | output exceeds contract | `max` only for frontier problems; xhigh as coding ceiling; JSON/table output contracts |
| Shallow reasoning | Haiku 4.5 on complex tasks | misses nuance on multi-layer context | never route gray-area, multi-step, or >200K to Haiku |
| Turn-limit truncation | any agentic loop | missing final JSON; trailing partial sentence; "tests" with no tests | split scope; resume from locators; lower output size |
| Silent skip | any operational subagent | compare output to acceptance checklist; require `skipped=[]` field | fail task; rerun only skipped items; machine-parseable status contract |
| Context degradation near 1M | Opus 4.8 | weak recall on huge prompts | treat 1M as ceiling; keep synthesis working context ≤750K; RAG/summarize |
| Agentic overconfidence | GPT-5.5 self-reported success (73% claimed vs 35% true on SWE-Bench Pro) | never trust self-report | verify against independent test/reviewer always |
| Cross-provider inconsistency | Claude vs Codex disagree | source-backed compare table | prefer primary source / command output; escalate only true ambiguity; never average |
| Prompt injection / context poisoning | untrusted files/web/tool output | treat all external text as data; quote locators | summarize content only; never adopt injected commands; map-reduce sanitization boundary |
| Commit of bad AI output | end of any code path | commit gate; contradiction-checker; CI | block on `blocked`/`needs_user`/test failures/unexplained generated changes |
| Excessive premium routing | Opus/pro/high on routine | cost dashboard by task class | default downshift; require justification for premium effort |

---

## 6. CROSS-PROVIDER SYNERGY PATTERNS (Section B, synergy detail)

Topology default is **hub-and-spoke**: a coordinator holds full context; workers return compressed schema-compliant summaries; **no peer-to-peer** worker communication (peer mesh drops cascade-prevention from >0.89 to ~0.32). All provider-boundary handoffs use **temp-file IPC with JSON schemas** (valid for the local fleet; Managed Agents API out of scope, Decision 3).

- **Pattern 1 — Codex executes → Claude reviews (HIGHEST ROI).** `agentic_execution` worker (GPT-5.5) produces `{diff, test_results, files_modified, task_description}` to a temp file; Claude (Opus arch / Sonnet routine) reviews against specs and emits APPROVE/BLOCK. Mitigates premature wrong-file commitment, hallucinated APIs, incomplete multi-file edits. **This is the repo's pre-commit contradiction mandate.**
- **Pattern 2 — Opus plans → parallel workers implement → Sonnet integration-reviews.** `planning_architecture` emits a decomposition; ≤5 separable workers (Haiku/GPT-5.5) each own one file/concern; Sonnet checks interface-contract adherence and duplicate logic on fan-in.
- **Pattern 4a — Claude catches GPT-5.5 security/hallucination blind spots** → formalized as the mandatory `security_review` second pass (§2.7).
- **Pattern 4b — GPT-5.5 decisiveness breaks Opus stall** → a concrete first attempt anchors Opus's correction (§2.2).
- **Pattern 5 — Mixed-provider validation tiers.** Generation (any) → per-output domain validation (isolation) → strongest-model cross-output synthesis + contradiction detection. Cross-provider independence prevents hallucinated consensus and sycophancy cascades; centralized validation contains error amplification (17.2× independent → 4.4× centralized).
- **Pattern 7 — Map-reduce with sanitization boundary.** `mechanical` map agents (constrained outputs) → `synthesis_knowledge` reduce agent sees only sanitized summaries. Security invariant: raw/untrusted data stays in the map layer.

**Anti-patterns (never do):** (A) duplicate the same task across providers and pick a winner — wastes 2× tokens, forces a 3rd reconciliation pass; route by category instead. (B) average conflicting outputs — on correctness/spec matters there is no middle ground; escalate to the arbiter and **pick one** (Sanity Rule 7). (C) over-delegate trivial work — a single Read/Grep beats a 2.9× multi-agent token overhead. (D) same-provider self-validation — shared training distribution hides shared blind spots; reviewer must be a different family (or at least a different tier as a weak fallback). (E) peer-to-peer agent mesh without a coordinator.

---

## 7. GOVERNANCE & HALT RULES — Section D.3

**Commit gate (mandatory):** before any commit that changes executable/source code, dispatch a **separate contradiction/security checker** using the strongest explicitly selectable model + highest reasoning settings. Input = `{proposed_diff, relevant_specs}`. Output = `{status: clear|blocked|needs_user, findings:[...]}`. Proceed only on `clear`; **block** on `blocked`/`needs_user`, unresolved test failures, missing diff review, or unexplained AI-generated changes. **If the strongest checker is unavailable, halt and tell the owner** — never degrade to a weaker checker (false confidence). [Anthropic AGENTS.md mandate; Agent-as-Judge, arXiv 2508.02994]

**Contradiction-checker must be cross-family** where possible (Anti-Pattern D). It must not be the same instance that produced the change.

**Write scoping:** agent writes name exact target files + expected diffs + validation. Orchestrator **rejects**: writes outside requested scope, unexplained formatting churn, AI-attribution metadata, edits to user-owned dirty files.

**Data boundary:** classify data (public / internal / confidential / secret / regulated / owner-private) **before** routing. Only public/internal-low-risk may cross providers freely. Never route secrets/credentials/regulated data to a provider, tool, or cache mode outside the approved boundary. Per-service unique keys in a secret manager; never in prompts/logs/comments. Retention is feature-specific (web search, files, code-exec, batch, regional each differ) — route on the exact feature path, not provider-wide.

**Halt-and-surface (stop, no writes):**
1. Mandated contradiction/security checker unavailable.
2. Secret/credential exposure, or destructive/irreversible/external-side-effect ambiguity.
3. Identity/authorization uncertainty, or instructions conflict (spec vs prompt vs policy).
4. Evidence the pipeline is compounding errors (e.g., retries obscuring state).
5. Sandbox-bypass requested in a non-hardened (mixed-trust) workspace.

**Telemetry (meter every agent):** run ID, parent task ID, provider/model, effort, prompt-hash/policy-version, files read/written, commands, URLs, input/output/cached/reasoning tokens, wall time, retries, failure class, validation result, unresolved risks. Without this, routing drifts toward premium-model overuse.

---

## 8. MACHINE-CONSUMABLE CATEGORY → ROUTE TABLE (Section E)

Pseudo-schema for the `subagent-mcp` router. Input: `{prompt, work_category, est_input_tokens, est_output_tokens, cost_sensitive, data_class, is_math_or_proof, security_subclass}`. The router applies **gates first**, then the category route, then attaches mandatory validation.

```jsonc
{
  "version": "phase-2-synth-2/2026-05-29",
  "classification_precedence": [
    "security_review", "planning_architecture", "reasoning_judgment",
    "agentic_execution", "synthesis_knowledge", "extraction_proof",
    "coding", "mechanical"
  ],
  "hard_gates": [
    { "id": "G1", "if": "est_input_tokens > 200000",
      "then": "exclude_models:[claude-haiku-4-5,claude-sonnet-4-5]" },
    { "id": "G2", "if": "est_input_tokens > 272000 && cost_sensitive",
      "then": "exclude_provider:openai_gpt-5.5; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G2b", "if": "est_input_tokens > 400000",
      "then": "exclude_harness:codex; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G3", "if": "est_output_tokens > 64000",
      "then": "route_to:[claude-opus-4-8]" },
    { "id": "G4", "if": "is_math_or_proof == true",
      "then": "route_to:[gpt-5.5]; note:'overrides category; still subject to G2'" },
    { "id": "G5", "if": "model in [claude-opus-4-7,claude-opus-4-8] && effort in [xhigh,max]",
      "then": "set:max_tokens>=64000" },
    { "id": "G6", "if": "model in [claude-opus-4-7,claude-opus-4-8]",
      "then": "forbid:[temperature,top_p,top_k,budget_tokens]; use:thinking=adaptive" }
  ],
  "routes": {
    "coding": {
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium" },
      "fallback": [
        { "model": "claude-sonnet-4-6", "effort": "high" },
        { "model": "claude-opus-4-8",  "effort": "high" }
      ],
      "validation": "cross_review_if:security_subclass!=none",
      "thinking": "adaptive"
    },
    "agentic_execution": {
      "primary":  { "provider": "openai", "model": "gpt-5.5", "harness": "codex",
                    "effort": "medium", "sandbox": "workspace-write" },
      "fallback": [
        { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "xhigh" },
        { "provider": "anthropic", "model": "claude-opus-4-7", "effort": "xhigh" }
      ],
      "validation": "MANDATORY_claude_review_before_commit (Pattern1)",
      "stall_recovery": "gpt-5.5_decisiveness_injection (Pattern4b)",
      "forbid_model": "claude-haiku-4-5"
    },
    "planning_architecture": {
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "xhigh",
                    "max_tokens": 65536, "thinking": "adaptive" },
      "fallback": [
        { "model": "claude-opus-4-7", "effort": "xhigh" },
        { "model": "claude-opus-4-6", "effort": "high" },
        { "model": "claude-sonnet-4-6", "effort": "max", "note": "single-module plans only" }
      ],
      "validation": "contradiction_check_if_committed_artifact",
      "emits": "decomposition_json:[{task_id,file,inputs,outputs,constraints}]"
    },
    "reasoning_judgment": {
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "escalate_to": "xhigh", "thinking": "adaptive" },
      "fallback": [
        { "model": "claude-opus-4-7", "effort": "high" },
        { "model": "claude-opus-4-6", "effort": "high" },
        { "model": "claude-sonnet-4-6", "effort": "max", "note": "<2 tradeoff dims only" }
      ],
      "validation": "none (this is the arbiter); forbid_self_validation",
      "forbid_model": "claude-haiku-4-5"
    },
    "mechanical": {
      "primary":  { "provider": "anthropic", "model": "claude-haiku-4-5", "effort": null },
      "fallback": [ { "model": "claude-sonnet-4-6", "effort": "low" } ],
      "validation": "none",
      "gate_note": "G1 forces fallback when est_input_tokens>200000"
    },
    "extraction_proof": {
      "primary_math":  { "provider": "openai", "model": "gpt-5.5", "effort": "medium" },
      "primary_json":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium",
                         "output_contract": "schema_validated" },
      "fallback": [
        { "model": "claude-sonnet-4-6", "effort": "high" },
        { "model": "claude-opus-4-8",  "effort": "high", "note": "proof verify / ambiguous fields" }
      ],
      "validation": "claude_verify_if:committed_proof"
    },
    "security_review": {
      "primary":  { "provider": "openai", "model": "gpt-5.5", "effort": "high",
                    "framing": "cyber" },
      "mandatory_second_pass": {
        "when": "security_subclass in [concurrent,auth,permission] || pre_commit",
        "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
        "reason": "GPT-5.5 concurrency/CWE-732 blind spots; cross-provider independence"
      },
      "fallback": [
        { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
          "note": "full review, not just cross-check" },
        { "model": "claude-sonnet-4-6", "effort": "high", "note": "surface-level only" }
      ],
      "forbid_model": "claude-haiku-4-5",
      "forbid": "gpt-5.5_self_review"
    },
    "synthesis_knowledge": {
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "escalate_to": "max", "escalate_if": "sources>10 || novel_analysis" },
      "fallback": [
        { "model": "claude-sonnet-4-6", "effort": "high", "note": "<10 sources, routine" },
        { "model": "claude-opus-4-7", "effort": "high" }
      ],
      "validation": "map_reduce_sanitization_boundary_for_large_corpora",
      "context_note": "treat 1M as ceiling; keep working context <=750K"
    }
  },
  "global_invariants": {
    "commit_gate": "strongest_available_checker; halt_if_unavailable",
    "cross_provider_validation": "reviewer_family != generator_family",
    "no_duplicate_tasks": true,
    "no_output_averaging": true,
    "ipc": "temp_file_json_schema",
    "topology": "hub_and_spoke; no_peer_to_peer",
    "telemetry_required": true
  }
}
```

---

## 9. CONDENSED PER-MODEL CAPABILITY & RISK PROFILES (Section C)

| Model | Decisive strength | Decisive risk | Context / Output | Effort support | Nominal cost (in/out) |
|---|---|---|---|---|---|
| **Opus 4.8** | Agentic/long-horizon leader; honesty (4× fewer missed flaws vs 4.7); arbiter; knowledge work; computer-use (web) | cost premium + ~1.4× tokenizer inflation; residual caution on ambiguity; verbosity at max | 1M / 128K | low/med/high/xhigh/max | $5 / $25 ($10/$50 fast) |
| **Opus 4.7** | Near-4.8; first `xhigh`; high-res vision | tool-skipping (fixed in 4.8); tokenizer inflation; over-caution | 1M / 128K | low/med/high/xhigh/max | $5 / $25 |
| **Opus 4.6** | Planning/architecture integrity [SEED, corroborated]; old-tokenizer (no inflation) | strongest documented stall/verbosity; stricter-4.7 prompts may differ | 1M / 128K | low/med/high/max | $5 / $25 |
| **Sonnet 4.6** | Coding sweet spot (79.6% SWE-bench, ~1.2pp < Opus); verification thoroughness; math 89%; 1M context | loses coherence before Opus on long agentic runs; set effort explicitly (high default surprises) | 1M / 64K | low/med/high/max | $3 / $15 |
| **Haiku 4.5** | Speed/cost (25× < Opus); mechanical parity with Sonnet; 73.3% SWE-bench | 200K ceiling; shallow on multi-step reasoning; no adaptive thinking | 200K / 64K | none (fixed) | $1 / $5 |
| **GPT-5.5 @ Codex** | Autonomous CLI leader (Terminal-Bench ~82.7%); fast-to-patch; 40% fewer tokens; math/proofs; security initial pass (71.4%) | confident hallucination; concurrency bugs (~170/mLOC); commits to wrong file early; literal instruction-following; security miss patterns (CWE-732) | 400K (Codex) / 1M (API) / 128K out | none/min/low/med/high/xhigh | $5 / $30 (≤272K) |

**Effort defaults are task-class, not per-model (Decision 5):** the category determines effort; the model determines the *available* effort ladder. Opus/coding-agentic → start `xhigh`; Sonnet production → start `medium`; GPT-5.5 Codex → start `medium`; mechanical → fixed low (Haiku) or `low` (Sonnet fallback). Step up exactly one notch only after evals show the lower level underperforms.

---

## 10. ASSUMPTION / INFERENCE / SEED LEDGER

- **[ASSUMPTION → refined]** Opus 4.8 ≫ Opus 4.7: data supports "materially better on agentic/long-horizon (SWE-Pro +10.6pp vs GPT-5.5, Super-Agent, GDPval-AA), roughly equal on isolated coding" — task-split framing per Decision 2; not blanket superiority.
- **[SEED, corroborated]** Opus = planning/architecture/synthesis/nuance; Haiku = fast file ops; Sonnet = balanced debug/review; GPT-5.5 = closed-loop/extraction/proofs/terminal; GPT-5.5 risks = confident hallucination + security bugs; Opus risk = caution/stall + verbosity. Each corroborated by official docs / third-party benchmarks cited inline. Treated as hypothesis; benchmarks confirmed.
- **[INFERRED]** Sonnet 4.6 effective-cost advantage over Opus is ~6–7× (not 5×) once 1.4× tokenizer inflation is applied to Opus 4.7/4.8.
- **[INFERRED]** The precedence order (§1.9) is a synthesis design choice (not vendor-specified) to make classification deterministic and safety-biased.
- **[ASSUMPTION per mandate]** "GPT-5.5 confident hallucination / security-bug" risk justifies the mandatory Claude cross-review for concurrent/auth/permission code (Decision 4), even though GPT-5.5's *absolute* hallucination rate is unpublished (60% *relative* reduction vs 5.4 is the only citable figure).

---

## 11. REFERENCES (APA — original sources only)

AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities

Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8

Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort

Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview

Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing

Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits

Anthropic. (2026). *Extended thinking tips — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips

Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5

Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide

Caylent. (2025). *Claude Haiku 4.5 deep dive: Cost, capabilities, and the multi-agent opportunity*. https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity

CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results

Contra Collective. (2026). *GPT-5.5 vs Claude Opus 4.8: Frontier coding and reasoning tested*. https://contracollective.com/blog/gpt-5-5-vs-claude-opus-4-8-2026

DataCamp. (2026). *Claude Opus 4.6: Features, benchmarks, tests, and more*. https://www.datacamp.com/blog/claude-opus-4-6

DataCamp. (2026). *Claude Sonnet 4.6: Features, access, tests, and benchmarks*. https://www.datacamp.com/blog/claude-sonnet-4-6

DataCamp. (2025). *Claude Haiku 4.5: Features, testing results, and use cases*. https://www.datacamp.com/blog/anthropic-claude-haiku-4-5

Endor Labs. (2026). *GPT-5.5 sets a new code security record (with Cursor, not Codex) in Agent Security League*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league

MindStudio. (2026). *GPT-5.5 vs Claude Opus 4.7 for agentic coding: Real-world differences*. https://www.mindstudio.ai/blog/gpt-5-5-vs-claude-opus-4-7-agentic-coding-2

NxCode. (2026). *Claude Sonnet 4.6: 79.6% SWE-bench at $3/MTok — Complete guide*. https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026

OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/

OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model

OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models

OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive

OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions

OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance

OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing

OpenAI. (2026). *Prompt caching*. https://developers.openai.com/api/docs/guides/prompt-caching

OpenAI. (2026). *Reasoning models*. https://developers.openai.com/api/docs/guides/reasoning

OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis

Sonar. (2026). *OpenAI GPT-5.5: An evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation

The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8 as a "modest but tangible improvement" that tops GPT-5.5 in most benchmarks*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/

VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8 is here with 3X cheaper fast mode and near-Mythos level alignment*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment

Yang, C., et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.

*Agent-as-Judge and multi-agent validation findings:* arXiv:2508.02994 (Agent-as-a-Judge); arXiv:2601.14691 (Gaming the Judge); arXiv:2602.06948 (Agentic overconfidence); arXiv:2602.01331 (A-MapReduce); arXiv:2511.07585 (LLM output drift).

---

*End of Phase 2 Core Synthesis #2. All routing decisions trace to the 10 authoritative interview decisions (2026-05-29). Hard gates, mandatory validations, and halt rules are emphasized at top (§0) and specified per-category (§2) and machine-consumably (§8).*
