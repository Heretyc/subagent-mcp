# Phase 2 — Core Synthesis #3: Deterministic Work-Category Routing for subagent-mcp

**Role:** Independent flagship synthesis #3 of 5. **Date:** 2026-05-29.
**Purpose:** Define a clean, deterministic, machine-consumable work-category taxonomy and category→route table that the `subagent-mcp` router loads to distribute a (prompt + category) across a local **Claude Code + Codex CLI** fleet. Managed Agents API is out of scope; temp-file IPC is the assumed transport.
**Label key:** `[SEED]` = Blackburn (2026) hypothesis; `[INFERRED]` = extrapolation from cited facts; `[ASSUMPTION]` = mandated premise accepted without re-litigation. Unlabeled claims trace to official docs / verified benchmarks (see References).

---

## 0. TL;DR — The Routing Contract in One Screen

The router does three deterministic things, in order, for every request:

1. **Apply HARD GATES first** (they override category defaults — see §3). Context size and math/proof routing are gates, not preferences.
2. **Map `category` → primary {provider, model, effort}** from the table in §4 / §6.
3. **Attach the synergy/validation pattern and fallback** so the orchestrator knows what to do on failure or before commit.

Eight categories. One is `coding`. All are agent-classifiable from the prompt without LOC counting:

| id | one-line definition | primary route | effort |
|----|--------------------|---------------|--------|
| `coding` | Write/modify code in a scoped, verifiable loop (edit→run→test) | Codex `gpt-5.5` (closed-loop) or Sonnet 4.6 | medium |
| `architecture` | Cross-cutting design, refactor integrity, multi-file structural change | Claude Opus 4.8 | xhigh |
| `debugging` | Localize and fix a defect from a symptom | Claude Sonnet 4.6 | high |
| `review_validation` | Judge an artifact: code review, contradiction-check, security, correctness gate | Claude Opus 4.8 (cross-provider on Codex output) | high |
| `extraction_terminal` | Closed-loop terminal work, deterministic extraction, structured output from local artifacts | Codex `gpt-5.5` | low |
| `math_proof` | Mathematical reasoning, formal/symbolic proof, multi-step derivation | Codex `gpt-5.5` | high |
| `knowledge_synthesis` | Long-context synthesis, research, nuanced/gray-area judgment, planning | Claude Opus 4.8 | high→max |
| `mechanical` | Low-reasoning leaf work: file read/search, classification, format, boilerplate | Claude Haiku 4.5 | n/a |

> The two most load-bearing rules: (a) **security/auth/concurrency/permission-critical code that Codex produced gets a mandatory Claude cross-review before commit** (§3 G3); (b) **input >200K tokens forces Claude; >272K + cost-sensitive forces *off* GPT-5.5** (§3 G1). Everything else is a default that evals may tune.

---

## 1. Why these eight categories (design rationale)

The taxonomy is engineered against four constraints from the authoritative interview (Phase 1.5):

- **Deterministic & agent-classifiable.** A classifier (Haiku-class, `low` effort) reads the prompt and emits exactly one `category` id. No numeric thresholds inside the classification step — size is handled separately as a *gate* (§3), not a category boundary. This keeps classification a pure-language task that even the cheapest model does reliably. [INFERRED from Agent 3 §4.5 "classification doesn't exercise the reasoning gap"]
- **Small (8).** Below the 6–10 target ceiling, low enough to memorize, broad enough to cover the Phase-1 task matrix. The 20 fine-grained task types in Agent 3's matrix collapse cleanly into these 8 (mapping in §5).
- **One category is `coding`** per mandate, kept narrow (scoped, verifiable code changes) so that the genuinely different work — *designing* code (`architecture`), *fixing* code (`debugging`), and *judging* code (`review_validation`) — routes to its correct specialist instead of being averaged into one bucket.
- **Provider-discriminating.** Each category's primary route reflects a real, benchmark-backed capability split, not vibes: Opus leads agentic/long-horizon/nuance; Codex/GPT-5.5 leads closed-loop terminal + deterministic extraction + math; Sonnet is the cost-quality default for ordinary code work; Haiku owns leaf/mechanical work.

The split between `coding`, `architecture`, `debugging`, and `review_validation` is the single most important design choice: collapsing them into one "coding" bucket is exactly the anti-pattern Agent 4 warns against (averaging conflicting specialist strengths).

---

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

---

## 3. HARD GATES (B, applied BEFORE category routing)

Gates are deterministic preconditions evaluated first. They **override** the category's primary route. Order matters: G1 → G2 → G3 → then category default.

**G1 — Context-size gate (HARD).**
- Input >200K tokens → **must** use Claude (Sonnet 4.6 or Opus 4.8); Haiku (200K) and Sonnet 4.5 (200K) excluded.
- Input >272K tokens **and** task is cost-sensitive → **mandatory redirect off GPT-5.5** (GPT-5.5 charges 2× input / 1.5× output for the *entire session* above 272K input — a price cliff; Agent 5). Route to Opus 4.8 / Sonnet 4.6 (1M context, no long-context premium).
- Output >64K tokens required → **Opus 4.8 only** (128K output; Sonnet/Haiku cap at 64K).
- Source: Anthropic models overview; OpenAI GPT-5.5 model/pricing. Interview Q9.

**G2 — Math/proof gate (HARD).** Any request classified `math_proof` → **GPT-5.5** regardless of other signals (interview Q10). Effort `high` default; `xhigh` for adversarial/long derivations. This is an authoritative routing mandate that overrides the Sonnet-math benchmark.

**G3 — Security cross-review gate (HARD, pre-commit).** If code that touches **authentication, authorization/permissions, cryptography, concurrency/threading, deserialization, filesystem, shell, or network** was produced by **Codex/GPT-5.5**, a **Claude (Opus 4.8 preferred, Sonnet 4.6 minimum) cross-review is mandatory before commit.** Rationale: GPT-5.5's documented systematic misses (CWE-732 file-permission handling, hallucinated API signatures, concurrency as its "Achilles heel" at ~170 threading bugs/mLOC; Agents 2–4). Initial security *triage* may run on GPT-5.5 (71.4% expert cyber pass rate), but the **verdict** is Claude's. Interview Q4. This subsumes the AGENTS.md pre-commit contradiction-checker mandate.

**G4 — Commit/write trust boundary (always).** No agent output self-commits. Writes must name exact target files + expected diff; orchestrator rejects out-of-scope writes, unexplained formatting churn, and edits to pre-existing user-owned dirty files. Secrets/credentials/regulated data must not be routed to a provider outside the approved data boundary, and never set `OPENAI_API_KEY`/`CODEX_API_KEY` as job-level env vars where repo-controlled code runs (OpenAI non-interactive docs; Agent 5).

**G5 — Sandbox gate (Codex).** Codex runs least-privilege: `--sandbox read-only` for inspection, `workspace-write` for edits, `danger-full-access`/`--dangerously-bypass-approvals-and-sandbox` **only** in externally hardened, disposable, secret-free runners — never a mixed-trust home directory (Agent 2).

---

## 4. Routing per Category (B) — primary, fallback, synergy, gates

Notation: effort applies to Opus/Sonnet/GPT-5.5; **Haiku has no effort param**. "Codex `gpt-5.5`" = GPT-5.5 in the Codex CLI harness via `codex exec`.

| Category | Primary {provider · model · effort} | Fallback chain | Synergy / validation pattern | Triggered gates |
|----------|-------------------------------------|----------------|------------------------------|-----------------|
| `coding` | Codex · `gpt-5.5` · low–medium (closed-loop), **or** Claude · Sonnet 4.6 · medium | Sonnet 4.6 medium → Opus 4.8 high | If Codex-authored: Claude review on handoff (Pattern 1). If security-adjacent: G3. | G1, G3 |
| `architecture` | Claude · Opus 4.8 · xhigh | Opus 4.7 xhigh → Opus 4.6 high → Sonnet 4.6 max | Opus plans → fan-out implement (Haiku/Codex) → Sonnet integration review (Pattern 2). | G1 |
| `debugging` | Claude · Sonnet 4.6 · high | Opus 4.8 high (cross-subsystem) → Opus 4.6 high → Haiku (shallow only) | Edit→test loop; escalate to Opus if root cause spans subsystems. Concurrency bug → G3 Claude verify. | G1, G3 |
| `review_validation` | Claude · Opus 4.8 · high | Opus 4.7 high → Sonnet 4.6 high (surface only) | **Cross-provider**: reviewer ≠ generator's family (Pattern 3/4). Opus arbitrates conflicts; never average (§7). | G3, G4 |
| `extraction_terminal` | Codex · `gpt-5.5` · low (medium if multi-command) | Sonnet 4.6 medium → Opus 4.8 high | Use `--json` / `--output-schema` for machine-readable output; map-reduce for large corpora (Pattern 7). | G1, G5 |
| `math_proof` | Codex · `gpt-5.5` · high | `gpt-5.5` xhigh → Opus 4.8 high (proof *verification* only) | GPT-5.5 derives; Opus 4.8 may verify the proof as a `review_validation` step. | G2 |
| `knowledge_synthesis` | Claude · Opus 4.8 · high→max | Opus 4.7 high → Sonnet 4.6 high | >10 sources / novel output → Opus max. Sonnet high for ≤10 sources, routine. Decisiveness injection if stalled (Pattern 4b). | G1 |
| `mechanical` | Claude · Haiku 4.5 · (n/a) | Sonnet 4.6 low → Opus 4.6 low | Leaf node in fan-out/map-reduce; constrained (enum/bool/short-JSON) outputs only. | G1 |

**Effort defaults are task-class, not per-model** (interview Q5): the category sets effort; if the fallback model lacks the level (e.g., `xhigh` only on Opus 4.7/4.8), step to the nearest supported level (Opus 4.6/Sonnet `high`; Haiku none).

**Escalation ladder (within Claude, do not switch providers to escalate):** Haiku → Sonnet 4.6 medium → Opus 4.8 high → Opus 4.8 xhigh → max. Provider switches are for *capability fit* (a category's primary), not for retry. [INFERRED from Agent 3 §4.3]

---

## 5. Mapping Agent-3's 20 task types → 8 categories (traceability)

| Agent-3 task type | Category | Note |
|---|---|---|
| Strategic planning, Knowledge work/research synthesis, Nuanced/gray-area, Tie-breaking & oversight | `knowledge_synthesis` (tie-breaking → `review_validation`) | Opus xhigh/high/max |
| Architecture & refactor integrity, Multi-agent orchestration | `architecture` | Opus xhigh |
| Debugging | `debugging` | Sonnet high |
| Code review, Security review | `review_validation` | Opus/cross-provider; G3 |
| Long-context synthesis | `knowledge_synthesis` | G1 output/context gates |
| Rapid coding/codegen, Test authoring, Documentation, Data extraction (structured) | `coding` (docstrings/scaffold → `mechanical`) | Sonnet medium / Haiku |
| File read/search, Functional boilerplate, Classification/routing | `mechanical` | Haiku |
| Deterministic extraction/proofs, Terminal/closed-loop execution | `extraction_terminal` (formal proof → `math_proof`) | Codex |
| Computer use / browser agent | `architecture`-adjacent → route Opus 4.8 high (web) / Codex (CLI) | Opus leads web (84% Mind2Web), GPT-5.5 leads CLI |

This shows the 8-bucket set loses no coverage from the detailed matrix; it only removes LOC thresholds (now handled by gates) and collapses specialist-equivalent rows.

---

## 6. MACHINE-CONSUMABLE SCHEMA (E) — the router's data contract

This is the emphasis deliverable. The MCP loads a single declarative file (YAML shown; JSON-equivalent trivially). The router does **no model reasoning** to route — it executes gates then a table lookup. The only model call in the routing step is the optional category classifier (Haiku, `low`).

### 6.1 Schema definition (field contract)

```yaml
# routing_table.schema — one document the MCP parses at startup
version: "2026-05-29"
defaults:
  classifier: { provider: claude, model: claude-haiku-4-5, effort: null }  # emits one category id
  ipc: tempfile_json            # local Claude Code + Codex CLI; Managed Agents API out of scope
  handoff_schema_required: true # every cross-provider handoff is structured JSON

# Gates are evaluated in array order BEFORE category lookup. First match that
# sets a constraint wins; later gates may further constrain but not relax.
gates:
  - id: G1_context
    when: { input_tokens_gt: 200000 }
    force: { provider_in: [claude], model_in: [claude-sonnet-4-6, claude-opus-4-8] }
  - id: G1_context_cliff
    when: { input_tokens_gt: 272000, cost_sensitive: true }
    forbid: { provider_in: [openai] }            # GPT-5.5 272K price cliff
  - id: G1_output
    when: { output_tokens_gt: 64000 }
    force: { model_in: [claude-opus-4-8] }
  - id: G2_math
    when: { category: math_proof }
    force: { provider: openai, model: gpt-5.5, effort: high }
  - id: G3_security_xreview
    when: { category_in: [coding, debugging, review_validation],
            touches_any: [auth, authz, crypto, concurrency, deserialization, filesystem, shell, network],
            author_family: openai }
    require_review: { provider: claude, model: claude-opus-4-8,
                      min_model: claude-sonnet-4-6, before: commit }
  - id: G4_commit_boundary
    when: { action: commit }
    require: { self_commit: false, scoped_diff: true, contradiction_checker: strongest_available }
  - id: G5_sandbox
    when: { provider: openai }
    default_sandbox: workspace-write             # never danger-full-access in mixed-trust dir

# fields per category record:
#   id                : stable enum, the classifier's output label
#   definition        : human/classifier-facing one-liner
#   classify_signals  : list of lexical/structural cues (for prompt-time classification)
#   primary           : { provider, model, effort }   effort=null when unsupported (Haiku)
#   fallback          : ordered list of { provider, model, effort }
#   gates             : gate ids that commonly fire for this category (advisory; gates run globally)
#   synergy_pattern   : named cross-model pattern id + trigger
#   cost_note         : routing-relevant cost caveat (inflation-adjusted where Opus)
categories: [ ... see 6.2 ... ]
```

### 6.2 One worked record per category (8 records)

```yaml
categories:

  - id: coding
    definition: "Write/modify code to a bounded objective, verifiable by compile/test/lint."
    classify_signals: ["implement", "add function/endpoint/flag", "make test pass", "write code that"]
    primary:  { provider: openai, model: gpt-5.5, effort: medium }   # closed-loop in Codex
    fallback: [ { provider: claude, model: claude-sonnet-4-6, effort: medium },
                { provider: claude, model: claude-opus-4-8,  effort: high } ]
    gates: [ G1_context, G3_security_xreview, G5_sandbox ]
    synergy_pattern: { id: codex_execute_then_claude_review, trigger: "codex-authored diff before commit" }
    cost_note: "Codex closed-loop fast/cheap; if Claude path, Sonnet $3/$15 vs Opus ~1.4x-inflated $5/$25."

  - id: architecture
    definition: "Cross-cutting design / refactor integrity / multi-file structural change."
    classify_signals: ["design", "refactor across", "interface change", "migrate module", "public API affected"]
    primary:  { provider: claude, model: claude-opus-4-8, effort: xhigh }
    fallback: [ { provider: claude, model: claude-opus-4-7, effort: xhigh },
                { provider: claude, model: claude-opus-4-6, effort: high },
                { provider: claude, model: claude-sonnet-4-6, effort: max } ]
    gates: [ G1_context ]
    synergy_pattern: { id: opus_plan_fanout_implement_sonnet_review, trigger: ">3 separable subtasks" }
    cost_note: "Opus xhigh is premium; effective ~1.4x nominal from 4.7/4.8 tokenizer inflation. Justified by cascade-error cost."

  - id: debugging
    definition: "Localize root cause from a symptom and apply a minimal verified fix."
    classify_signals: ["fix the bug", "why does X fail", "intermittent/flaky", "regression", "stack trace"]
    primary:  { provider: claude, model: claude-sonnet-4-6, effort: high }
    fallback: [ { provider: claude, model: claude-opus-4-8, effort: high },
                { provider: claude, model: claude-haiku-4-5, effort: null } ]   # shallow bugs only
    gates: [ G1_context, G3_security_xreview ]
    synergy_pattern: { id: escalate_to_opus_if_cross_subsystem, trigger: "root cause spans >1 subsystem; concurrency->Claude verify" }
    cost_note: "Sonnet 2x faster, ~5x cheaper/token than Opus; debug loops are latency-sensitive."

  - id: review_validation
    definition: "Judge an artifact: code/security review, pre-commit contradiction-check, tie-break."
    classify_signals: ["review", "check for", "is this correct/safe", "validate against spec", "which is right", "before commit"]
    primary:  { provider: claude, model: claude-opus-4-8, effort: high }
    fallback: [ { provider: claude, model: claude-opus-4-7, effort: high },
                { provider: claude, model: claude-sonnet-4-6, effort: high } ]
    gates: [ G3_security_xreview, G4_commit_boundary ]
    synergy_pattern: { id: cross_provider_reviewer, trigger: "reviewer family != generator family; NEVER self-review or average" }
    cost_note: "Reviewer cost is small vs blast radius of a missed flaw; Opus 4.8 ~4x less likely to leave flaws unremarked vs 4.7."

  - id: extraction_terminal
    definition: "Closed-loop terminal work + deterministic structured output from local artifacts."
    classify_signals: ["find every place", "extract/parse", "run and summarize", "emit JSON", "cite file:line", "from git log"]
    primary:  { provider: openai, model: gpt-5.5, effort: low }
    fallback: [ { provider: claude, model: claude-sonnet-4-6, effort: medium },
                { provider: claude, model: claude-opus-4-8,  effort: high } ]
    gates: [ G1_context, G5_sandbox ]
    synergy_pattern: { id: map_reduce_sanitized, trigger: "large corpus; raw data stays in map layer, reduce sees sanitized only" }
    cost_note: "GPT-5.5 ~40% fewer output tokens on Codex tasks; use --output-schema to avoid retries."

  - id: math_proof
    definition: "Mathematical reasoning, formal/symbolic proof, multi-step derivation."
    classify_signals: ["prove", "derive", "show that", "theorem/lemma", "formal notation"]
    primary:  { provider: openai, model: gpt-5.5, effort: high }      # G2 forces this
    fallback: [ { provider: openai, model: gpt-5.5, effort: xhigh },
                { provider: claude, model: claude-opus-4-8, effort: high } ]  # verification only
    gates: [ G2_math ]
    synergy_pattern: { id: gpt_derive_opus_verify, trigger: "high-stakes proof: Opus 4.8 verifies as review_validation" }
    cost_note: "Mandated route (interview Q10) overrides Sonnet's 89% arithmetic benchmark; FrontierMath leadership cited for GPT-5.5."

  - id: knowledge_synthesis
    definition: "Long-context/multi-source synthesis, planning, nuanced/gray-area & knowledge-work judgment."
    classify_signals: ["synthesize", "plan the approach", "weigh tradeoffs", "across N sources", "policy/legal/financial", ">3 branches"]
    primary:  { provider: claude, model: claude-opus-4-8, effort: high }
    fallback: [ { provider: claude, model: claude-opus-4-8, effort: max },     # >10 sources / novel
                { provider: claude, model: claude-sonnet-4-6, effort: high } ] # <=10 sources, routine
    gates: [ G1_context ]
    synergy_pattern: { id: decisiveness_injection_if_stalled, trigger: "Opus no-write stall -> GPT-5.5 first concrete attempt -> Opus corrects" }
    cost_note: "Opus max only when >10 sources or novel output; max ~2x xhigh cost for small gains on structured tasks."

  - id: mechanical
    definition: "Leaf work: file read/search, classification, format, pattern boilerplate."
    classify_signals: ["list/grep/find file", "classify into N labels", "format", "boilerplate from template", "extract imports"]
    primary:  { provider: claude, model: claude-haiku-4-5, effort: null }
    fallback: [ { provider: claude, model: claude-sonnet-4-6, effort: low },
                { provider: claude, model: claude-opus-4-6,  effort: low } ]
    gates: [ G1_context ]   # Haiku 200K ceiling -> escalate on overflow
    synergy_pattern: { id: constrained_leaf_in_fanout, trigger: "fan-out/map-reduce; outputs limited to enum/bool/short-JSON" }
    cost_note: "Haiku $1/$5 (~5x cheaper than Sonnet, ~25x cheaper than Opus/token); the cost floor of the fleet."
```

### 6.3 Router algorithm (deterministic pseudocode)

```
route(prompt, category?, ctx):                 # ctx = {input_tokens, output_tokens, cost_sensitive, action, touches[], author_family}
  category = category or classify(prompt)       # Haiku low-effort; pure-language label
  route    = lookup(categories[category].primary)
  for gate in gates (in array order):           # gates override category default
      if gate.when matches (category, ctx):
          route = apply(gate.force / gate.forbid / gate.default_sandbox, route)
          if gate.require_review: attach_review_step(gate)   # e.g. G3 Claude cross-review
          if gate.require:        enforce_commit_boundary()  # G4
  if route now infeasible (gate forbids primary): route = first feasible categories[category].fallback
  attach(synergy_pattern, fallback_chain)
  return route                                  # {provider, model, effort, review_step?, sandbox?, pattern}
```

Properties that make it safe to act on: (1) gates are total and ordered → same input always yields same route; (2) classification is the only model call and it is the cheapest, lowest-variance task; (3) a forbidden primary deterministically falls through to the declared fallback rather than failing open.

---

## 7. Synergy patterns & anti-patterns the table references (C-support)

**Patterns (cited in `synergy_pattern`):**
- **`codex_execute_then_claude_review` (Pattern 1, highest ROI):** Codex runs the autonomous edit→test loop; Claude (Opus 4.8) reviews the diff for cross-file correctness + security on a temp-file handoff `{diff, test_results, files_modified, task_description}`. Mitigates Codex's premature wrong-file commitment and hallucinated APIs.
- **`opus_plan_fanout_implement_sonnet_review` (Pattern 2):** Opus emits a JSON decomposition with interface contracts → ≤5 Haiku/Codex workers implement in parallel → Sonnet integration review. Up to ~75% wall-clock reduction on separable work.
- **`cross_provider_reviewer` (Patterns 3/4):** Reviewer is a *different family* than the generator (distributional independence catches shared blind spots). Subsumes the AGENTS.md pre-commit contradiction-checker; uses strongest available model.
- **`decisiveness_injection_if_stalled` (Pattern 4b):** On Opus no-write stall, GPT-5.5 produces a concrete first attempt; Opus resumes as corrector. A concrete wrong answer is easier to fix than an underspecified one.
- **`map_reduce_sanitized` (Pattern 7):** Map agents (Haiku) see raw/untrusted data and emit constrained outputs; reduce agent (Opus/Sonnet) sees only sanitized summaries — prompt-injection containment boundary.

**Anti-patterns the router must refuse (Agent 4 §3; CLAUDE.md Rule 7):**
- **Task duplication across providers** (same task to Claude+Codex to pick a winner) — burns 2× tokens, then needs a 3rd reconciliation pass.
- **Averaging conflicting outputs** — on code correctness / spec compliance there is no middle ground; escalate to `review_validation` to pick the right one. Surface conflicts, don't blend.
- **Same-provider self-validation** — shared training distribution hides shared blind spots; reviewer must differ from generator (falls to a different *tier* if cross-provider unavailable).
- **Over-delegating trivial work** — a grep/read is the Read/Grep tool, not a subagent; 3-agent topology ~2.9× token overhead before useful work.
- **Peer-to-peer agent mesh** — all comms route through the coordinator (hub-and-spoke); free peer comms drop cascade-prevention from ~0.89 to ~0.32.

---

## 8. Per-provider/model capability + risk profiles (C, condensed)

| Model | API id | Context (in/out) | Effort levels | Decisive strength | Decisive risk | Best categories |
|---|---|---|---|---|---|---|
| **Opus 4.8** | `claude-opus-4-8` | 1M / 128K | low/med/high/xhigh/max | Agentic/long-horizon, honesty (~4× fewer unremarked flaws vs 4.7), web computer-use (84% Mind2Web), nuance, planning | Verbosity/over-hedge at high effort; locked temp/top_p; tokenizer inflation ~1.4×; Foundry only 200K | architecture, review_validation, knowledge_synthesis |
| **Opus 4.7** | `claude-opus-4-7` | 1M / 128K | low/med/high/xhigh/max | Near-4.8; introduced `xhigh` | Stricter instruction-following can break 4.6 prompts; tool-skip cases (fixed in 4.8) | fallback for Opus categories |
| **Opus 4.6** | `claude-opus-4-6` | 1M / 128K | low/med/high/max | Old-tokenizer flagship; strong knowledge work (+144 Elo vs GPT-5.2 GDPval) | Stall/caution, verbosity (most documented here); no `xhigh`; no interleaved thinking in manual mode | legacy fallback |
| **Sonnet 4.6** | `claude-sonnet-4-6` | 1M / 64K | low/med/high/max | Cost-quality sweet spot (79.6% SWE-bench, ~1.2pp below Opus 4.6); verification thoroughness; 89% math | Loses coherence before Opus on very long agentic chains; `high` default can surprise latency — set effort explicitly | coding, debugging, review (surface) |
| **Haiku 4.5** | `claude-haiku-4-5` | 200K / 64K | none (manual budget_tokens only) | Fastest, cheapest ($1/$5); 73.3% SWE-bench; near-Sonnet on non-reasoning tasks | 200K ceiling; degrades on multi-step reasoning/nuance; no adaptive thinking | mechanical, fan-out leaves |
| **GPT-5.5 (Codex)** | `gpt-5.5` | 1M API / 400K Codex; 272K price cliff | none/minimal/low/med/high/xhigh | Closed-loop terminal (Terminal-Bench ~82–83%), deterministic extraction, math, fast-to-patch, ~40% fewer tokens/task | Confident hallucination; security bugs (CWE-732); concurrency weakness; commits to wrong file before full exploration; literal instruction-following | extraction_terminal, math_proof, coding (closed-loop) |
| `gpt-5.4-mini` | `gpt-5.4-mini` | — | — | Cheaper/faster light coding & subagents | Not for security/architecture authority | cheap Codex subagent leaves |

> **Benchmark reconciliation (across the 5 inputs):** SWE-bench Verified is effectively tied — Opus 4.8 88.6% vs GPT-5.5 88.7% (within noise; Agents 1, 3). The real split is **SWE-bench Pro**: Opus 4.8 69.2% vs GPT-5.5 58.6% (~+10.6pp Opus) — i.e., parity on isolated coding, Opus leads on harder multi-step agentic work. This is exactly the interview's task-split framing (Q2) and why `architecture`/`knowledge_synthesis` go to Opus while `coding`/`extraction_terminal` can sit on Codex. [ASSUMPTION on Opus 4.8 magnitude, per mandate — "materially better on agentic, ~equal on isolated coding," not "≫".]

---

## 9. Cost model (D, inflation-adjusted Opus)

**Nominal per-MTok (standard tier):** Opus 4.8/4.7/4.6 $5 in / $25 out · Sonnet 4.6 $3 / $15 · Haiku 4.5 $1 / $5 · GPT-5.5 $5 / $30 (≤272K), $10 / $45 (>272K) · GPT-5.5-pro $30 / $180.

**Tokenizer-inflation adjustment (interview Q7 — flag prominently):** Opus 4.7/4.8 use a new tokenizer producing ~32–45% more tokens than Opus 4.6/Sonnet for equivalent text. At identical per-token pricing, **effective Opus 4.7/4.8 cost is ~1.4× nominal** for the same content. All cost comparisons here apply the 1.4× multiplier to Opus 4.7/4.8. Practical effect: Sonnet 4.6's per-content advantage over Opus 4.8 is closer to **6–7×**, not the 5× implied by sticker price. [INFERRED from openrouter/findskill tokenizer analysis.]

**Discount/premium tiers:** Batch halves token prices (both providers); GPT-5.5 Flex = batch rate + caching, async only; Priority = 2.5× (GPT-5.5) ; Opus 4.8 fast mode $10/$50 (2× std, 2.5× throughput) — latency-critical Opus work only, never batch. Prompt caching: cache reads ~10% of input price (Anthropic $0.50/MTok Opus hit); stable prefix first, dynamic content last.

**Three-tier cost shape (validated, Agent 3):** orchestrator ~5% tokens (Opus/Sonnet) · implementor ~45% (Sonnet/Codex) · worker ~50% (Haiku) → **40–60% session-cost reduction vs uniform Opus** (e.g., $0.98 vs $2.02 on a 104K/60K session). The taxonomy operationalizes this: `mechanical`→Haiku and `extraction_terminal`/`coding`→Codex/Sonnet keep ~95% of tokens off Opus.

**Cost rules of thumb (deterministic, for the router):** output tokens cost 5× (Claude) / 6× (GPT-5.5) input → strict output contracts are budget controls; reasoning/thinking tokens bill as output even when hidden → treat high effort as buying output tokens; long context is a last resort (GPT-5.5 272K cliff; G1).

---

## 10. Failure modes + mitigations, governance (D)

**Top failure modes (router-relevant):**
| Failure | Detection | Mitigation in routing terms |
|---|---|---|
| Confident hallucination (GPT-5.5) | Require file:line/URL locators; run `rg`/tests | `review_validation` cross-check; structured `--output-schema`; reject unsupported claims |
| Security bug (GPT-5.5) | Diff + security checklist; secret scan | **G3** mandatory Claude cross-review; least-privilege sandbox (G5) |
| Concurrency bug (GPT-5.5) | Concurrency code touched | Route the *review* to Opus 4.8 (G3) — GPT-5.5's known weakness |
| Stall/over-caution (Opus) | No writes in N min; repeated clarifications | Pattern 4b decisiveness injection; lower effort; re-scope to one artifact |
| Verbosity (Opus) | Output exceeds contract | Lower effort; JSON/section budgets; `low`/`medium` for non-synthesis |
| Turn-limit truncation | Missing final JSON/sentinel | Split scope; resume from locators; reduce output size |
| Silent skip | Output vs acceptance checklist | Require `skipped=[]` field; rerun only skipped items |
| Quota 429 | `retry-after`, quota headers | Backoff; lower model/effort; batch/flex async; subdivide |
| Agentic overconfidence | Self-reported success | Never trust self-report (GPT-5.5 predicts 73% vs 35% true on SWE-Pro); verify with independent test/reviewer |
| Cross-provider inconsistency | Source-backed compare | Prefer primary source/command output; escalate only true ambiguity — don't average |

**Governance (G4/G5 + Agent 5):** data classification before routing (only public/internal-low-risk freely cross-provider); per-service API keys in a secret manager, never in prompts/env where repo code runs; OpenAI abuse logs ≤30d, Anthropic auto-delete ≤30d default, ZDR not universal; commit gate requires the strongest-available contradiction/security checker and blocks on `blocked`/`needs_user`; every run emits an audit record (run id, parent, model, effort, files r/w, commands, URLs, token/cost, validation result, unresolved risks). Sub-agent output contract: machine-parseable `{status, summary, source_locators, risks, writes_requested}` — no bare prose.

---

## 11. Seed-corpus corroboration status (interview Q8 — HYPOTHESIS only)

| [SEED] claim (Blackburn 2026) | Status vs docs/benchmarks |
|---|---|
| Opus = planning/architecture/synthesis/nuance | **Corroborated** (GDPval +144 Elo vs GPT-5.2; Super-Agent; ARC-AGI-2 gap) → `architecture`, `knowledge_synthesis` |
| Sonnet = balanced debug/review/reasoning | **Corroborated** (79.6% SWE-bench; verification thoroughness) → `debugging`, `coding` |
| Haiku = fast coding/file ops | **Corroborated** (73.3% SWE-bench; Claude Code auto-routes leaf work) → `mechanical` |
| GPT-5.5 = closed-loop/extraction/proofs/terminal/boilerplate | **Corroborated** (Terminal-Bench ~82–83%; ~40% fewer tokens) → `extraction_terminal`, `math_proof`, `coding` |
| GPT-5.5 risks: confident hallucination + security bugs | **Corroborated** (CWE-732 misses; hallucinated `pathlib` arg; AISI cyber eval) → G3 |
| Opus risks: caution/stall + verbosity | **Corroborated** (official low-effort "scopes to what was asked" implies prior over-extension) → Pattern 4b |
| +5 other-provider slots; separable work; split by domain; no duplicate tasks | **Adopted as design constraint** for fan-out (Patterns 2/6); duplicate-task = anti-pattern A |

Where seed and data could conflict (e.g., "Haiku for ALL coding"), **data wins per Q8**: Haiku is `mechanical`-only; multi-file/semantic coding is Sonnet/Codex. Math routing is the one place a *mandate* (Q10) overrides a benchmark (Sonnet's 89% math) — flagged as a decision, not an inference.

---

## References (APA — original sources only)

Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort
Anthropic. (2026). *Adaptive thinking — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
Anthropic. (2026). *Models overview — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview
Anthropic. (2026). *Pricing — Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing
Anthropic. (2026). *Rate limits — Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits
Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8
Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5
Anthropic. (2026, February 17). *Claude Sonnet 4.6*. https://www.anthropic.com/claude/sonnet
OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/
OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model
OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models
OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive
OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions
OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing
OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance
AI Safety Institute (UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities
Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide
CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results
Endor Labs. (2026). *GPT-5.5 sets a new code security record*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league
OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis
Sonar. (2026). *OpenAI GPT-5.5: an evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation
Yang, C. et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.
Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal document]. [SEED — treated as hypothesis only per Phase 1.5 Q8.]

---

*End of Phase 2 Core Synthesis #3. Most impactful content (routing contract + machine-consumable schema) front-loaded per mandate. Eight deterministic categories, gate-first routing, one worked schema record per category. All [SEED]/[INFERRED]/[ASSUMPTION] labeled inline.*
