# Phase 2 Synthesis 1 — Canonical Work-Category Taxonomy + Cross-Provider Routing

**Purpose:** Machine-consumable knowledge base for a `subagent-mcp` routing feature. An agent submits `{prompt, work_category}`; the MCP routes to a provider/model/effort using the predefined categories below. Local fleet only: **Claude Code + Codex CLI**, temp-file IPC (Anthropic Managed Agents API is out of scope). Date: 2026-05-29.

**Label key:** [SEED] Blackburn (2026) hypothesis (corroboration noted) · [INFERRED] extrapolated · [ASSUMPTION] mandated. Unlabeled = official docs / verified benchmark.

---

## 1. CANONICAL WORK-CATEGORY TAXONOMY (classify each prompt into exactly ONE)

Categories are ordered by classification precedence: **first match wins, top to bottom.** Gates (Section 3) run BEFORE category routing and can override the provider. Effort is fixed per category (interview decision 6), not per model.

| # | Category | Crisp definition (the ONE thing it is) | Classification signals / keywords | Boundary / anti-example |
|---|----------|----------------------------------------|-----------------------------------|--------------------------|
| 1 | **mechanical** | Deterministic, pattern-matched work with no reasoning: locate/read/list, grep, symbol/import trace, format check, single-label classify, literal extraction, scaffold/boilerplate from a clear template. | "find", "list", "read", "grep", "where is", "rename", "reformat", "scaffold", "CRUD stub", "classify into N labels". Answer is verifiable without judgment. | Choosing *which* refactor pattern → that is `architecture`. "Extract fields IF schema has conditional branches" → `extraction` (reasoning needed). |
| 2 | **coding** | Write or change application logic to satisfy a known objective: implement a feature, edit functions across a bounded set of files, generate non-trivial code with semantic coherence. Excludes broad design decisions. | "implement", "add feature", "write function", "wire up", "build endpoint", "make X do Y". Objective is known; design is already decided. | If the change crosses module boundaries / alters public API / picks an abstraction → `architecture`. If it is template-only → `mechanical`. |
| 3 | **debugging** | Diagnose and fix incorrect behavior: reproduce, localize root cause, apply minimal fix, re-verify. The defining feature is an *observed failure* to explain. | "fix bug", "failing test", "why does X crash", "intermittent", "regression", "stack trace", "root cause". | A clean rewrite with no failure to diagnose → `coding`. A concurrency/threading defect still classifies here but triggers the **concurrency gate** (Section 3). |
| 4 | **terminal_exec** | Closed-loop autonomous execution in a shell/sandbox: run commands, transform data via CLI, iterate edit→run→observe until checks pass, produce a diff. The loop *is* the deliverable. | "run", "execute", "in the sandbox", "iterate until tests pass", `codex exec`, pipelines, "migration inventory from git log", "build and verify". | Deciding the migration *strategy* → `architecture`. Reading a file without running anything → `mechanical`. |
| 5 | **extraction_proof** | Turn artifacts into structured/verifiable output: schema-bound extraction, citation/fact mining with locators, **and all mathematical/formal proof or derivation**. | "extract to JSON", "schema", "cite file:line", "prove", "derive", "formal", "FrontierMath", "structured output". | Free-text summary with no schema → `knowledge`. Single-label tagging → `mechanical`. |
| 6 | **security_review** | Assess code for vulnerabilities, permissions, secrets, injection, auth/crypto correctness; produce a vuln/triage verdict. | "security review", "vulnerability", "auth", "permissions", "crypto", "deserialization", "secret handling", "threat model", "CWE". | Writing the auth code → `coding` (then routes here for review). General correctness review → `quality_review`. |
| 7 | **quality_review** | Judge a candidate artifact (diff, plan, two competing outputs) for correctness, contract adherence, contradictions; tie-break; **contradiction-check before commit**. Non-security. | "review this diff", "is this correct", "compare A vs B", "tie-break", "contradiction check", "does this violate the spec", "PR review". | If the artifact is security-sensitive → `security_review`. Producing the artifact → `coding`/`coding`. |
| 8 | **deep_reasoning** | High-ambiguity / high-blast-radius judgment with no closed-form check: strategy, architecture & refactor integrity, gray-area policy/legal/financial tradeoffs, long-context synthesis, multi-source knowledge work, orchestration planning. | "design", "architecture", "should we", "tradeoff", "strategy", "policy", "synthesize N sources", "plan the system", "decide between approaches". | Bounded implementation of an already-chosen design → `coding`. Single-file cleanup → `mechanical`. |

**Why these tile SWE work with minimal overlap:** the eight split along two crisp axes — (a) *reasoning load* (mechanical → deep_reasoning) and (b) *deliverable type* (produce code / run a loop / judge an artifact / synthesize). Every agentic SWE prompt lands in exactly one because the precedence order resolves the only real overlaps (template vs logic = 1 vs 2; bounded change vs design = 2 vs 8; produce vs judge = 2 vs 7; security vs general judgment = 6 vs 7).

**Deterministic classification rule (for the MCP's classifier sub-agent):**
1. Run gates first (Section 3) — they can pin the provider regardless of category.
2. Walk categories 1→8; assign the first whose signals match.
3. If two match, the *lower-numbered* (lower-reasoning) category loses to the higher only when a higher-precedence signal is explicitly present (design choice, observed failure, security surface, judging an artifact). When genuinely uncertain between adjacent tiers, escalate one tier up (cost of under-powering > cost of a few extra tokens for verifiable work).

---

## 2. ROUTING PER CATEGORY (primary → fallback → cross-provider validation)

Fixed effort per category. "Validation" = the mandatory or recommended second pass.

| Category | Primary model + effort | Fallback chain | Cross-provider validation / synergy | Hard gates that apply |
|----------|------------------------|----------------|-------------------------------------|------------------------|
| mechanical | **Haiku 4.5** (no effort param) | Sonnet 4.6 @ low | none (verifiable by inspection) | Context >200K → Sonnet 4.6 (Haiku 200K cap) |
| coding | **Sonnet 4.6 @ medium** | Opus 4.8 @ high → GPT-5.5 @ low (Codex) | If auth/permission/crypto/concurrency code produced → mandatory `security_review` + Claude cross-review before commit | Context gate; commit-gate |
| debugging | **Sonnet 4.6 @ high** | Opus 4.8 @ high (cross-subsystem) → Haiku (shallow only) | Concurrency/threading bug → **Opus 4.8 @ high cross-review mandatory** (GPT-5.5 weak here) | concurrency gate; commit-gate |
| terminal_exec | **GPT-5.5 @ medium (Codex CLI)** | Opus 4.8 @ xhigh (Dynamic Workflows) → Opus 4.7 @ xhigh | **Pattern 1 (highest-ROI):** Codex executes loop → Opus 4.8 reviews diff for correctness/security before commit | sandbox gate; commit-gate; bypass only in hardened runner |
| extraction_proof | **GPT-5.5 @ medium (Codex)**; `low` if bounded | Sonnet 4.6 @ medium (JSON only) → Opus 4.8 @ high (proof verify) | Math/proof: all → GPT-5.5 (decision 10). Cross-check proofs with Opus 4.8 when blast radius high | Context gate (>272K cost-sensitive → off GPT-5.5) |
| security_review | **GPT-5.5 @ high** (initial pass only) | Opus 4.8 @ high (full review) → Sonnet 4.6 @ high (surface) | **Conditional (decision 4):** GPT-5.5 first pass, then **mandatory Claude (Opus/Sonnet) cross-review for concurrent/auth/permission-critical code before commit** | concurrency gate; commit-gate |
| quality_review | **Opus 4.8 @ high** | Opus 4.7 @ high → Opus 4.6 @ max | **Cross-provider, never same-family** (Anti-Pattern D): if generator was Claude, a Codex/GPT-5.5 reviewer adds distributional independence, and vice-versa. Never average conflicts — pick per spec | commit-gate (this IS the contradiction-checker) |
| deep_reasoning | **Opus 4.8 @ xhigh** (`max` for >10-source synthesis / frontier) | Opus 4.7 @ xhigh → Opus 4.6 @ high → Sonnet 4.6 @ max | If stalled (no writes in N min) → GPT-5.5 decisiveness injection produces concrete anchor → Opus resumes as corrector (Pattern 4b) | Context gate; stall detection |

**Effort rationale (task-class defaults):** mechanical = none/low equivalent (Haiku fixed-low) — reasoning gap doesn't matter. coding = Sonnet `medium` (official balanced default). debugging/security_review = `high` (correctness depends on deeper reasoning). terminal_exec = GPT-5.5 `medium` (OpenAI balanced default for Codex). deep_reasoning = Opus `xhigh` (official Opus agentic starting point), `max` only when evals show headroom. [Anthropic 2026b; OpenAI 2026d/2026g]

---

## 3. HARD GATES (evaluated BEFORE category routing — they can override the provider)

These are non-negotiable and pin the route regardless of the work category.

- **G1 Context size (decision 9):** input >200K tokens → **prefer Claude** (Sonnet 4.6 or Opus 4.8, both 1M); Haiku (200K) and Sonnet 4.5 (200K) excluded. Input **>272K tokens AND cost-sensitive → mandatory redirect OFF GPT-5.5** (GPT-5.5 charges 2× input / 1.5× output for the full session above 272K). Output >64K tokens → **Opus 4.8 only** (128K output; others 64K).
- **G2 Concurrency / threading (decision 4):** any concurrent/async/threading code, whether generated or reviewed by GPT-5.5, → **Opus 4.8 @ high cross-review mandatory** before commit. GPT-5.5's documented weakness (≈170 threading bugs/mLOC). [Phase-1 benchmark data]
- **G3 Commit gate (AGENTS.md L60-65):** before ANY commit that changes executable/source code, dispatch a separate **contradiction-checker** sub-agent using the strongest explicitly selectable model + reasoning (Opus 4.8 @ max). If unavailable → **halt and tell the owner**. If it reports `blocked`/`needs_user` → no writes; surface the blocker. Never self-validate (Anti-Pattern D).
- **G4 Sandbox / bypass:** Codex defaults to read-only; use `--sandbox workspace-write` for edits; `--dangerously-bypass-approvals-and-sandbox` ONLY in an externally hardened runner (disposable VM/container, clean checkout, no ambient secrets, network controls). Never set `OPENAI_API_KEY`/`CODEX_API_KEY` as job-level env in workflows that run repo-controlled code. [OpenAI 2026i/2026k]
- **G5 Data boundary:** never route secrets/credentials/regulated/owner-private data to a provider, tool, or cache mode outside the approved boundary. Halt on secret exposure or data-boundary breach. [OpenAI 2026c; Anthropic 2026c]

---

## 4. CONDENSED PROVIDER / MODEL CAPABILITY + RISK PROFILES

| Model | API id | Ctx in/out | $/MTok in/out (nominal) | Effort | Decisive strength | Decisive risk |
|-------|--------|-----------|--------------------------|--------|-------------------|---------------|
| **Opus 4.8** | claude-opus-4-8 | 1M / 128K | $5 / $25 (**~1.4× effective**, see §5) | low/med/high/xhigh/max | Long-horizon agentic, architecture, honesty (4× less likely to miss code flaws vs 4.7), computer use, orchestration, gray-area judgment | Verbosity/over-caution at high effort; tokenizer inflation; locked temp/top_p |
| **Opus 4.7** | claude-opus-4-7 | 1M / 128K | $5 / $25 (~1.4× eff.) | low/med/high/xhigh/max | Near-4.8; strict instruction following | Over-caution; same tokenizer inflation |
| **Opus 4.6** | claude-opus-4-6 | 1M / 128K | $5 / $25 | low/med/high/max | Legacy synthesis/writing; softer instructions | Stall/verbosity (most documented); migrate |
| **Sonnet 4.6** | claude-sonnet-4-6 | 1M / 64K | $3 / $15 | low/med/high/max | Coding sweet-spot (79.6% SWE-bench, 1.2pp off Opus 4.6), verification, math 89%, cheap | Loses coherence on long-horizon vs Opus; set effort explicitly to avoid latency |
| **Haiku 4.5** | claude-haiku-4-5 | 200K / 64K | $1 / $5 | — (fixed low) | Fastest, 73.3% SWE-bench, ideal leaf worker | 200K cap; degrades on multi-step reasoning; Feb-2025 knowledge |
| **GPT-5.5** | gpt-5.5 (Codex) | 1M API / 400K Codex | $5 / $30 (272K cliff: 2×/1.5×) | none/min/low/med/high/xhigh | Terminal/closed-loop SOTA (Terminal-Bench ~82%), fast-to-patch, 40% fewer tokens, deterministic extraction, math/proof, security first-pass | Confident hallucination; security/concurrency bugs; commits to wrong file before full repo exploration; literal instruction following |
| **GPT-5.4-mini** | gpt-5.4-mini | — | lower | — | Cheap subagent, literal extraction | Not an authority for security/governance/architecture |

**Opus 4.8 capability framing [ASSUMPTION, decision 2, de-hyperbolized]:** clear leader on **agentic / long-horizon** tasks (SWE-bench Pro 69.2% vs GPT-5.5 58.6%; Super-Agent all-pass; GDPval-AA 1890 vs 1769); **roughly equal on isolated coding** (SWE-bench Verified 88.6% vs GPT-5.5 88.7% — within noise). Route by task-split, not blanket superiority.

---

## 5. COST MODEL, FAILURE MODES, GOVERNANCE

**Cost (decision 7 — flag prominently):** Opus 4.7/4.8 share a new tokenizer producing **32–45% more tokens** than Opus 4.6/Sonnet for equivalent text. Despite identical per-token pricing, **effective cost is ~1.4× nominal** when migrating from 4.6. Treat every Opus 4.7/4.8 estimate as **$5→~$7 / $25→~$35 effective**; recalibrate all token budgets post-migration. [THIRD-PARTY: openrouter.ai, findskill.ai] Three-tier routing (Opus orchestrates 5% · Sonnet implements 45% · Haiku workers 50%) cuts session cost **40–60%** vs uniform Opus [Augment Code 2026]. GPT-5.5 output is 6× its input; Claude output is 5× input — output contracts are direct budget controls. Batch/flex halves both providers; reserve fast mode (Opus 4.8 $10/$50, GPT-5.5 2.5× credits) for latency-critical only.

**Top failure modes → mitigation:** confident hallucination (GPT-5.5) → require file:line locators, run commands not memory, cross-provider review · security/concurrency bugs (GPT-5.5) → G2 + Claude review · over-caution/stall (Opus) → re-scope + GPT-5.5 decisiveness injection (Pattern 4b) · verbosity (Opus) → strict JSON contract, low verbosity · turn-limit truncation → split scope, resume from locators · silent skip → require `skipped=[]` field · agentic overconfidence (GPT-5.5 predicts 73% success vs 35% true) → never trust self-reported success; verify against independent test [arxiv 2602.06948].

**Governance / halt rules:** (1) No model output commits itself — orchestrator/checker audits scope, evidence, contradictions first. (2) Commit-gate G3 is mandatory and non-bypassable. (3) Cross-provider validation, **never same-family self-validation** (shared blind spots; confirmation bias [arxiv 2601.14691]). (4) **Surface conflicts, never average them** — on code/spec correctness one output is right; escalate to contradiction-checker, pick per authoritative spec. (5) Hub-and-spoke only; no peer-to-peer agent mesh (cascade prevention drops 0.89→0.32). (6) **Halt** on: secret exposure, destructive-action ambiguity, identity/authorization uncertainty, conflicting instructions, missing mandated checker, provider unavailable when mandated, or evidence the pipeline is compounding errors.

---

## 6. MACHINE-CONSUMABLE VIEW (MCP loads this)

```json
{
  "schema_version": "1.0",
  "fleet": ["claude_code", "codex_cli"],
  "ipc": "temp_file_json",
  "gates_eval_first": {
    "context": {"input_gt_200k": "prefer_claude", "input_gt_272k_cost_sensitive": "no_gpt55", "output_gt_64k": "opus_4_8_only"},
    "concurrency_code": "opus_4_8@high_crossreview_mandatory",
    "commit_executable_code": "contradiction_checker=opus_4_8@max; if_unavailable=halt_owner; if_blocked=no_writes",
    "sandbox": {"default": "read_only", "edits": "workspace_write", "bypass": "hardened_runner_only"},
    "data_boundary": "no_secrets_or_regulated_outside_approved_boundary"
  },
  "categories": {
    "mechanical":       {"primary": "haiku_4_5",   "effort": null,     "fallback": ["sonnet_4_6@low"],                       "validation": null},
    "coding":           {"primary": "sonnet_4_6",  "effort": "medium", "fallback": ["opus_4_8@high","gpt_5_5@low"],          "validation": "security_review_if_auth_perm_crypto_concurrency"},
    "debugging":        {"primary": "sonnet_4_6",  "effort": "high",   "fallback": ["opus_4_8@high","haiku_4_5"],            "validation": "opus_4_8@high_if_concurrency"},
    "terminal_exec":    {"primary": "gpt_5_5",     "effort": "medium", "fallback": ["opus_4_8@xhigh","opus_4_7@xhigh"],      "validation": "opus_4_8_review_diff_before_commit"},
    "extraction_proof": {"primary": "gpt_5_5",     "effort": "medium", "fallback": ["sonnet_4_6@medium","opus_4_8@high"],    "validation": "opus_4_8@high_if_high_blast_radius", "note": "all_math_proof_to_gpt_5_5"},
    "security_review":  {"primary": "gpt_5_5",     "effort": "high",   "fallback": ["opus_4_8@high","sonnet_4_6@high"],      "validation": "claude_crossreview_mandatory_concurrent_auth_permission"},
    "quality_review":   {"primary": "opus_4_8",    "effort": "high",   "fallback": ["opus_4_7@high","opus_4_6@max"],         "validation": "cross_provider_reviewer_never_same_family"},
    "deep_reasoning":   {"primary": "opus_4_8",    "effort": "xhigh",  "fallback": ["opus_4_7@xhigh","sonnet_4_6@max"],      "validation": "gpt_5_5_decisiveness_injection_on_stall", "effort_max_if": "synthesis_gt_10_sources_or_frontier"}
  },
  "classification_rule": "run_gates_first; walk_categories_1_to_8_first_match_wins; on_adjacent_tie_escalate_one_tier_up",
  "anti_patterns": ["duplicate_task_across_providers","average_conflicting_outputs","same_family_self_validation","peer_to_peer_mesh","over_delegate_trivial_work"]
}
```

**Category id order (precedence):** `mechanical → coding → debugging → terminal_exec → extraction_proof → security_review → quality_review → deep_reasoning`.

---

## 7. SEED CORPUS STATUS (decision 8 — hypothesis only; docs/benchmarks override)

| [SEED] claim (Blackburn 2026) | Status |
|-------------------------------|--------|
| Opus = planning/architecture/synthesis/nuance | CORROBORATED (GDPval-AA, Super-Agent, ARC-AGI-2 gap) |
| Sonnet = balanced debug/review/reasoning | CORROBORATED (79.6% SWE-bench; dev preference) |
| Haiku = fast coding/file ops | CORROBORATED (73.3% SWE-bench; Claude Code auto-routes) |
| GPT-5.5 = closed-loop/extraction/proofs | CORROBORATED (Terminal-Bench ~82%; 20-hr task) |
| GPT-5.5 = confident hallucination + security bugs | CORROBORATED (endorlabs CWE-732; Sonar; AISI) |
| Opus = caution/stall + verbosity | CORROBORATED (official effort docs; twinstrata) |
| +5 other-provider slots, separable/domain-split, no duplicate tasks | ADOPTED as capacity model (≤4-5 workers + 1 coordinator) |
| Opus 4.8 ≫ 4.7 on all tasks | OVERRIDDEN → task-split: leads on agentic, ~equal isolated coding (decision 2) |

---

## References (APA — original sources only)

Anthropic. (2026). *Models overview*. https://platform.claude.com/docs/en/about-claude/models/overview
Anthropic. (2026). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort
Anthropic. (2026). *Pricing*. https://platform.claude.com/docs/en/about-claude/pricing
Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8
Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5
Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide
CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results
Endor Labs. (2026). *GPT-5.5 sets a new code security record*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league
OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/
OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model
OpenAI. (2026). *Models — Codex*. https://developers.openai.com/codex/models
OpenAI. (2026). *Non-interactive mode — Codex*. https://developers.openai.com/codex/noninteractive
OpenAI. (2026). *Permissions — Codex*. https://developers.openai.com/codex/permissions
OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing
OpenRouter. (2026). *Opus 4.7's new tokenizer: what it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis
VentureBeat. (2026, May 28). *Anthropic's Claude Opus 4.8 is here*. https://venturebeat.com/technology/anthropics-claude-opus-4-8-is-here-with-3x-cheaper-fast-mode-and-near-mythos-level-alignment
Yang, C. et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration*. arXiv:2602.16873.
