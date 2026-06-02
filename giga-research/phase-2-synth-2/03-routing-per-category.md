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
