# Phase 1 Agent 3 — Task-Type → Model & Effort Routing Matrix
## Cross-Provider Sub-Agent Routing: Authoritative Reference (2026-05-29)

**Scope:** SWE task-type → best model + effort → runner-up → rationale → decision rule.
**Key models in scope:** Claude Opus 4.8 [released 2026-05-29], Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5, GPT-5.5 [released 2026-04-23].
**Baseline routing directive:** Blackburn, L. (2026). Cross-provider sub-agent routing directive [internal document].

---

## SECTION 1: CURRENT MODEL LANDSCAPE (WEB-VERIFIED, 2026-05-29)

### Claude Family — Confirmed Specifications

| Model | API ID | Context In/Out | Pricing ($/MTok) | Effort Support | Latency |
|---|---|---|---|---|---|
| **Opus 4.8** [NEW] | claude-opus-4-8 | 1M / 128k | $5 / $25 | low/med/high/xhigh/max | Moderate |
| Opus 4.7 | claude-opus-4-7 | 1M / 128k | $5 / $25 | low/med/high/xhigh/max | Moderate |
| Opus 4.6 | claude-opus-4-6 | 1M / 128k | $5 / $25 | low/med/high/max | Moderate |
| **Sonnet 4.6** | claude-sonnet-4-6 | 1M / 64k | $3 / $15 | low/med/high/max | Fast |
| **Haiku 4.5** | claude-haiku-4-5 | 200k / 64k | $1 / $5 | — | Fastest |

**Opus 4.8 key facts (web-verified):**
- Released May 28–29, 2026; pricing parity with Opus 4.7 ($5/$25 per MTok).
- SWE-bench Verified: 88.6% (vs. 87.6% Opus 4.7; vs. 88.7% GPT-5.5). [INFERRED: margin within noise; task-specific routing matters more than top-line rank.]
- SWE-bench Pro (harder variant): 69.2% vs. GPT-5.5's 58.6% — Opus 4.8 leads by ~10.6 pp.
- GDPval-AA (real knowledge work, max effort): 1,890 pts vs. GPT-5.5's 1,769 pts (~67% head-to-head win rate).
- Super-Agent benchmark: only model to complete all cases end-to-end.
- ~4x less likely than Opus 4.7 to leave code flaws unremarked (honesty improvement).
- Dynamic Workflows (research preview): parallel sub-agent orchestration within a single session.
- Effort default is `high` on all surfaces; use `xhigh` for coding/agentic; `max` for frontier reasoning only.
- Adaptive thinking (not extended thinking); `thinking: {type: "adaptive"}` required to enable.
- Knowledge cutoff: Jan 2026 (reliable); training data cutoff: Jan 2026.

**GPT-5.5 key facts (web-verified):**
- Released April 23, 2026; first fully retrained OpenAI base model since GPT-4.5.
- Terminal-Bench 2.0: 82.7% (Codex CLI + GPT-5.5: 82.0%) — state-of-the-art for autonomous CLI.
- SWE-bench Verified: 88.7% (±noise vs. Opus 4.8's 88.6%).
- SWE-bench Pro: 58.6% — substantially behind Opus 4.8's 69.2%.
- GDPval (knowledge work): 84.9; OSWorld-Verified (computer use): 78.7.
- 60% hallucination reduction vs. GPT-5.4; 40% fewer output tokens on same Codex tasks.
- CyberGym / security: 71.4% pass rate on expert cybersecurity tasks (classified "High" capability).
- Weakness: concurrency bugs (170/mLOC threading issues dominate bug profile); "follows instructions too literally" when prompts lack clarity.
- 1M token context (API); 400K (Codex).

**Claude Sonnet 4.6:**
- SWE-bench Verified: 79.6% (vs. Opus 4.6's 80.8% — 1.2 pp gap).
- 40% cheaper than Opus; ~2x faster; 70% more token-efficient in real-world coding tests.
- Extended thinking + adaptive thinking supported.
- Recommended effort for most use: `medium` ([agentic mention removed], tool-heavy workflows); `high` for quality-critical; `low` for high-volume/latency-sensitive.

**Claude Haiku 4.5:**
- SWE-bench Verified: 73.3% (vs. Sonnet 4.6's 79.6% — 6.3 pp gap).
- 3–5x faster than Sonnet; $1/$5 per MTok (3x cheaper than Sonnet on output).
- Context window 200K (vs. 1M for Sonnet/Opus) — a hard constraint for long-document tasks.
- No effort parameter support.
- Extended thinking supported (but not recommended for sub-agent leaf nodes).
- Optimal for: file nav, symbol resolution, import tracing, format checks, classification, extraction, simple codegen, sub-agent leaf nodes.
- Limitation: multi-step reasoning chains, nuanced judgment, synthesis of very long documents.

---

## SECTION 2: MASTER ROUTING TABLE

> Legend: ★ = Primary recommendation | ✦ = Runner-up | ↓ = Tier-substitution if primary unavailable
> Effort notation: Opus/Sonnet only (Haiku has no effort parameter)
> "GPT-5.5@Codex" = GPT-5.5 running in the Codex agentic harness

---

### TABLE 2.1 — SWE TASK TYPE → MODEL → EFFORT → RATIONALE

| # | Task Type | ★ Primary Model + Effort | ✦ Runner-Up | Rationale | Decision Rule | Tier-Sub if Primary Down |
|---|---|---|---|---|---|---|
| 1 | **Strategic planning** | Opus 4.8 @ xhigh | Opus 4.6 @ high | Requires sustained multi-step decomposition, cross-cutting dependency awareness, and holistic constraint-balancing. Opus 4.8 leads on Super-Agent and GDPval-AA; 67% head-to-head win rate vs. GPT-5.5 on knowledge work. xhigh enables adaptive thinking for discovery-phase planning. | Use Opus 4.8 when plan has >3 decision branches or cross-module dependencies. Drop to Sonnet 4.6 @ high only if plan is single-module. | Opus 4.7 @ xhigh → Opus 4.6 @ high → Sonnet 4.6 @ max |
| 2 | **Architecture & refactor integrity** | Opus 4.8 @ xhigh | Sonnet 4.6 @ max | Architecture decisions have cascade effects; the ARC-AGI-2 gap (8.4 pp in Opus's favor over Sonnet) shows up on novel abstract reasoning, which refactor integrity requires. Opus 4.8 handles 100K+ LOC migrations (early-tester reports). MCP-Atlas score: 82.2% vs. prior Sonnet-based baselines. | Route to Opus 4.8 when: refactor crosses >2 files OR introduces interface changes OR affects public API surface. Single-file clean-up → Haiku 4.5. | Opus 4.7 @ xhigh → Opus 4.6 @ high → Sonnet 4.6 @ high |
| 3 | **Debugging** | Sonnet 4.6 @ high | Opus 4.8 @ high | Sonnet 4.6 is 99% of Opus on SWE-bench Verified (79.6% vs. 80.8%), 2x faster, and 40% cheaper. Debug loops are latency-sensitive (fast edit-test-rerun cycles). Upgrade to Opus only when root cause spans multiple subsystems or requires architectural insight. | If bug is reproducible in a single file: Sonnet 4.6 @ medium. If bug is cross-module or system-level: Opus 4.8 @ high. | Opus 4.6 @ high → Haiku 4.5 (shallow/straightforward bugs only) |
| 4 | **Code review** | Sonnet 4.6 @ high | GPT-5.5 @ standard | CodeRabbit benchmark: GPT-5.5 found expected issues at 65% (curated: 79.2%) with better precision. However, GPT-5.5 "followed instructions too literally" and hallucinated on ambiguous prompts. Sonnet 4.6 is the safer default for routine review; GPT-5.5 is the upgrade for security-adjacent or API behavior review where exhaustive tool use matters. | Default: Sonnet 4.6. Escalate to GPT-5.5 for: security review, access-control logic, async/concurrency code. | Opus 4.6 @ high → Haiku 4.5 (linting/format only) |
| 5 | **Long-context synthesis** | Opus 4.8 @ high | Sonnet 4.6 @ high | Opus 4.8 has 1M token context + 128K output; Haiku is limited to 200K — a hard constraint for repo-scale or doc-bundle synthesis. "Long-context subset shows usual degradation at the window edge" — treat 1M as ceiling, not working budget. For 50+ paper synthesis requiring novel analysis, Haiku "miss[es] important nuances." | Context <200K tokens: any model. 200K–1M: Opus/Sonnet only. Output >64K (e.g., large codegen): Opus 4.8 only (128K output). | Sonnet 4.6 @ high (up to 1M in) → Opus 4.7 → Opus 4.6 |
| 6 | **Nuanced / gray-area reasoning** | Opus 4.8 @ high | Sonnet 4.6 @ high | ARC-AGI-2 shows 8.4 pp gap favoring Opus over Sonnet on novel abstract reasoning. Haiku "misses important nuances" on multi-layered context. Opus 4.8 is ~4x less likely to leave ethical/correctness issues unremarked (honesty improvement). | Gray-area = policies, legal, security tradeoffs, ambiguous requirements. Always Opus. Never Haiku for gray-area. Sonnet acceptable only when decision has <2 value-dimension tradeoffs. | Opus 4.7 @ high → Opus 4.6 @ high → Sonnet 4.6 @ max (with explicit reasoning prompt) |
| 7 | **Rapid coding / codegen** | Haiku 4.5 | Sonnet 4.6 @ medium | Haiku 4.5 matches Sonnet 4.0 on coding; 73.3% SWE-bench Verified; 3–5x faster; 3x cheaper output than Sonnet. Optimal for sub-agent leaf nodes doing isolated function generation or boilerplate. Sonnet 4.6 is the upgrade if the task is multi-file or requires semantic coherence across >1 module. | <50 LOC isolated function or class: Haiku 4.5. >50 LOC or cross-file: Sonnet 4.6 @ medium. Complex system codegen: Sonnet @ high. | Sonnet 4.6 @ medium → Opus 4.6 @ medium |
| 8 | **File read / search** | Haiku 4.5 | Haiku 4.5 (no upgrade needed) | Directory listings, symbol resolution, import tracing, grep-equivalent tasks are pattern-matching, not reasoning. Routing guide confirms 80% cost reduction vs. Opus with no measurable quality loss. 200K context sufficient for all but the largest monorepos at this operation type. | Always Haiku 4.5 for: ls, grep-equivalent, symbol lookup, import tracing, file diff summaries <5K lines. | Sonnet 4.6 @ low |
| 9 | **Deterministic extraction / proofs** | GPT-5.5 @ standard | Sonnet 4.6 @ medium | GPT-5.5 Terminal-Bench 2.0: 82.7% — built for structured extraction under tool-use constraints. 40% fewer output tokens on same tasks; 60% hallucination reduction vs. prior model. For math proofs, GPT-5.5 leads on FrontierMath. Sonnet 4.6 is adequate for structured JSON extraction within LLM capabilities. | JSON/structured extraction from known schema → Sonnet 4.6 @ medium. Mathematical proof generation or multi-step formal derivation → GPT-5.5. | Sonnet 4.6 @ high → Opus 4.8 @ high (for proof verification) |
| 10 | **Functional boilerplate** | Haiku 4.5 | Sonnet 4.6 @ low | CRUD endpoints, DTO/model scaffolding, config templates: deterministic, pattern-based, low-reasoning. Haiku 4.5 handles these at 5x lower cost than Sonnet. The limiting factor is context size — stay within 50K tokens per task to use Haiku safely. | <50K token context + pattern-based template: Haiku 4.5. Needs domain logic integration: Sonnet 4.6 @ low. | Sonnet 4.6 @ low → no upgrade to Opus justified for boilerplate |
| 11 | **Terminal / closed-loop execution** | GPT-5.5 @ Codex | Opus 4.8 @ xhigh (Dynamic Workflows) | GPT-5.5 is the clear leader for autonomous CLI: Terminal-Bench 2.0 82.7%, closed a 20-hour engineering task in a single run. Codex harness provides persistent sandbox, multi-tool coordination, screen-reading. Risk: confident hallucination; security bugs in generated scripts. Mitigation: always run in isolated sandbox; never trust GPT-5.5 output for privileged operations without human review. Opus 4.8's Dynamic Workflows is a viable alternative for complex multi-agent tasks where honesty and code-quality matters more than raw speed. | Default closed-loop: GPT-5.5@Codex. Multi-agent coordination with output quality priority: Opus 4.8 Dynamic Workflows. Never use Haiku for multi-step autonomous execution. | Opus 4.8 @ xhigh (Dynamic Workflows) → Opus 4.7 @ xhigh |
| 12 | **Tie-breaking & oversight** | Opus 4.8 @ high | Opus 4.7 @ high | Tie-breaking requires meta-reasoning: evaluating two plausible solutions, detecting which is subtly wrong, or choosing a path with incomplete information. This is squarely in Opus's ARC-AGI-2 advantage zone. Opus 4.8 honesty improvement (4x less likely to miss code flaws) makes it the preferred final arbiter. | Any time two sub-agents disagree or produce conflicting outputs: Opus 4.8 @ high as arbiter. Any time a decision requires weighing tradeoffs with no clear best answer: Opus 4.8 @ xhigh. | Opus 4.7 @ high → Opus 4.6 @ max |
| 13 | **Test authoring** | Sonnet 4.6 @ medium | Haiku 4.5 (unit tests only) | Test authoring requires understanding the intent of the code under test — not just syntax matching. Sonnet 4.6 at 79.6% SWE-bench Verified generates tests that encode behavioral intent. Haiku 4.5 is adequate for unit tests with explicit specs but will produce shallow coverage for integration/property tests. GPT-5.5 is the alternative for security-sensitive test suites (exploit/fuzz scenarios). | Unit test from explicit spec: Haiku 4.5. Integration test / behavior-intent test: Sonnet 4.6 @ medium. Security / adversarial test: GPT-5.5. | Opus 4.6 @ medium → Opus 4.8 @ high for cross-cutting test suites |
| 14 | **Documentation** | Sonnet 4.6 @ medium | Opus 4.8 @ high (architecture docs) | "Claude Opus 4.6 is the best LLM for writing in 2026 for long-form content" [tokita.online, 2026]. GPT-5.4 cited for structured analytical/technical documentation. Sonnet 4.6 is the cost-effective default for code-level docs (docstrings, READMEs, API references). Upgrade to Opus 4.8 only for architecture decision records or design documents requiring holistic synthesis. | Code docstrings / API reference: Sonnet 4.6 @ medium. ADRs / design docs: Opus 4.8 @ high. | Haiku 4.5 (docstrings from clear specs) → Opus 4.6 @ medium |
| 15 | **Security review** | GPT-5.5 (with cyber flag) | Opus 4.8 @ high | GPT-5.5 achieves 71.4% pass rate on expert cybersecurity tasks; classified "High" cybersecurity capability by OpenAI; includes vulnerability triage, malware analysis, patch validation. DryRun Security testing showed GPT-5.5 agents finished with fewest vulnerabilities. Weakness: concurrency bugs are its Achilles heel (170 threading bugs/mLOC) — Opus 4.8 should cross-review any concurrent code flagged by GPT-5.5. AISI independent evaluation confirmed GPT-5.5's capabilities. | Default security review: GPT-5.5. Concurrency / threading audit: Opus 4.8 @ high as verification step. Never use Haiku for security review. | Opus 4.8 @ high (full security review) → Sonnet 4.6 @ high (surface-level only) |

---

### TABLE 2.2 — ADDITIONAL TASK TYPES (NOT IN ORIGINAL SEED CORPUS)

| # | Task Type | ★ Primary + Effort | ✦ Runner-Up | Decision Rule |
|---|---|---|---|---|
| 16 | **Multi-agent orchestration / coordination** | Opus 4.8 @ xhigh (Dynamic Workflows) | Sonnet 4.6 @ high (as orchestrator with Haiku workers) | Opus 4.8 can spawn parallel sub-agents within a single session. For cost-sensitive orchestration: Sonnet 4.6 as orchestrator, Haiku 4.5 as leaf workers. Rule: >3 parallel separable tasks → consider Dynamic Workflows; linear tasks → Sonnet orchestrator. |
| 17 | **Classification / routing decisions** | Haiku 4.5 | Gemini 2.5 Flash-Lite | Low-effort classification at high volume. Haiku 4.5 at $1/MTok input for single-label routing; Gemini Flash-Lite at $0.10/MTok for extreme volume. Upgrade to Sonnet only if classification has >5 ambiguous categories requiring nuanced judgment. |
| 18 | **Data extraction / structured output** | Sonnet 4.6 @ medium | Gemini 3 Flash | JSON schema extraction with known structure: Sonnet 4.6 at medium effort. Upgrade to Opus only if extraction requires semantic disambiguation of ambiguous fields. Never Haiku if schema has conditional branches. |
| 19 | **Computer use / browser agent** | Opus 4.8 @ high | GPT-5.5 (OSWorld) | Opus 4.8: 84% Online-Mind2Web; BrowseComp single-agent 84.3%, multi-agent 88.5%. GPT-5.5: OSWorld-Verified 78.7%. Opus 4.8 leads on web-agent tasks; GPT-5.5 leads on CLI tasks. Rule: web browser tasks → Opus 4.8; terminal/CLI tasks → GPT-5.5. |
| 20 | **Knowledge work / research synthesis** | Opus 4.8 @ max | Sonnet 4.6 @ high | GDPval-AA: Opus 4.8 @ max = 1,890 pts; GPT-5.5 = 1,769 pts. Covers legal, financial analysis, 50+ paper synthesis. Rule: >10 sources or novel analytical output required → Opus 4.8 @ max. Routine synthesis <10 sources → Sonnet 4.6 @ high. |

---

## SECTION 3: EFFORT-LEVEL GUIDANCE (OFFICIAL ANTHROPIC DOCS, VERIFIED 2026-05-29)

Source: platform.claude.com/docs/en/build-with-claude/effort [fetched 2026-05-29]

| Level | Models | Typical Use | Token Profile |
|---|---|---|---|
| `max` | Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6 | Deepest reasoning, frontier problems, no token constraint | Highest; use sparingly |
| `xhigh` | Opus 4.8, Opus 4.7 | Long-horizon agentic work, repeated tool calling, coding >30 min | ~2x high; default for coding agents |
| `high` | All Opus/Sonnet | Default; complex reasoning, nuanced analysis, difficult code | Standard; API default |
| `medium` | All Opus/Sonnet | Balanced; [agentic mention removed], tool-heavy, routine gen | Moderate savings |
| `low` | All Opus/Sonnet; "simpler tasks / subagents" | Classification, extraction, sub-agent leaves, high-volume | Maximum efficiency |

**Sonnet 4.6 effort guidance (official):**
- `medium` = recommended default for [agentic mention removed] and tool-heavy workflows.
- `low` = high-volume or latency-sensitive; suitable for chat/non-coding.
- `high` = complex reasoning where quality > speed.
- `max` = highest capability, no token constraint.

**Opus 4.8 / 4.7 effort guidance (official):**
- Start at `xhigh` for coding and agentic use cases.
- `high` = minimum for intelligence-sensitive workloads.
- `medium` = cost-sensitive only; confirm quality on evals first.
- `max` = reserve for genuinely frontier problems; "significant cost for relatively small quality gains" on most structured tasks.
- When using `xhigh` or `max`: set `max_tokens` ≥ 64K.

**Haiku 4.5:** No effort parameter. It is effectively always at a fixed "low-effort" profile appropriate for leaf-node tasks.

---

## SECTION 4: CROSS-CUTTING ROUTING PRINCIPLES

### 4.1 Three-Tier Baseline (Validated by Multiple Sources)

The three-tier pattern (Blackburn, 2026) is confirmed by independent routing research:
- **Tier 1 — Orchestrator (5% of tokens):** Opus 4.8 or Sonnet 4.6 for planning, decomposition, tie-breaking.
- **Tier 2 — Implementor (45% of tokens):** Sonnet 4.6 for code generation, debugging, review, test authoring.
- **Tier 3 — Worker (50% of tokens):** Haiku 4.5 for file read/search, classification, simple transforms, boilerplate sub-tasks.

Cost implication: Three-tier routing reduces session cost by 40–60% vs. uniform Opus (Augment Code, 2026). Example: 104K input / 60K output session = $0.98 (three-tier) vs. $2.02 (uniform Opus).

### 4.2 GPT-5.5 Slot Allocation (Cross-Provider Capacity)

The seed corpus notes "+5 slots from other provider; separable work only; split by domain; no duplicate tasks." Based on GPT-5.5's verified strengths:

Allocate GPT-5.5 slots to:
1. Terminal/closed-loop execution (Terminal-Bench 2.0: 82.7%)
2. Security review — initial pass (71.4% cybersecurity expert tasks)
3. Deterministic extraction and formal proofs (FrontierMath leadership)
4. High-volume structured output where cost-per-token + retry-savings math favors GPT-5.5 (60% hallucination reduction = fewer retries)
5. Code review for access-control / API behavior (CodeRabbit: 79.2% curated found-rate)

Do NOT allocate GPT-5.5 to: nuanced gray-area reasoning (Opus leads), concurrency code (GPT-5.5 weakness confirmed), multi-agent orchestration requiring long context (Opus leads on GDPval-AA), strategic planning (Opus leads by 121 points on GDPval-AA), or any task requiring 1M+ context window operation beyond Codex's 400K limit.

### 4.3 Confidence-Based Escalation

[INFERRED from routing literature; not directly benchmarked per source:]
If a model returns output flagged as low-confidence or reaches a decision branch it cannot resolve:
1. Haiku → Sonnet 4.6 @ medium
2. Sonnet → Opus 4.8 @ high
3. Opus 4.8 @ high → Opus 4.8 @ xhigh or @ max (do not switch providers for escalation; keep in Claude for consistency)

### 4.4 Context Window Decision Gate

Before routing any task, apply this gate:
- **Output tokens needed >64K** → Opus 4.8 only (128K output; others max at 64K)
- **Input context >200K tokens** → Opus 4.8 or Sonnet 4.6 only (Haiku hard limit: 200K)
- **Input context >1M tokens** → Opus 4.8 only (GPT-5.5 Codex: 400K; API: 1M but Opus 4.8 competitive)
- **Input context ≤200K + task is mechanical** → Haiku 4.5 always preferred

### 4.5 Topology Note

AdaptOrch (2026 arxiv benchmark) found topology-aware multi-agent orchestration achieves 12–23% improvement over static single-topology baselines using identical underlying models. Routing overhead: <50ms vs. 2–15s per LLM call — routing is essentially free. Implication: a dynamic router that classifies task type before each call is worth building; the classification cost is negligible.

---

## SECTION 5: RISK REGISTER

| Risk | Affected Model | Mitigation |
|---|---|---|
| Confident hallucination | GPT-5.5 | Sandbox all execution; never trust GPT-5.5 for privileged ops; use Opus 4.8 as honesty arbiter |
| Security bugs in generated code | GPT-5.5 | Pair with GPT-5.5 security review OR Opus 4.8 @ high for all GPT-5.5-generated code |
| Concurrency bugs | GPT-5.5 | Always route concurrent/async code review to Opus 4.8 instead |
| Caution/stall on agentic tasks | Opus 4.6 | Upgrade to Opus 4.8; xhigh effort + explicit continuation instructions |
| Verbosity / overthinking | Opus (all) at max effort | Use `max` only for frontier problems; use `xhigh` as default ceiling for coding |
| Shallow reasoning on complex tasks | Haiku 4.5 | Never route gray-area, multi-step reasoning, or >200K context to Haiku |
| Context degradation near 1M edge | Opus 4.8 | Treat 1M as hard ceiling; keep working context ≤750K for synthesis tasks |
| GPT-5.5 literal instruction following | GPT-5.5 | Always provide detailed, unambiguous prompts; never rely on self-correction |
| Cost overrun at max effort | Opus 4.8 | xhigh → max is rarely worth the ~2x cost increase; confirm via evals before deploying max |
| Opus 4.8 honesty caveat [ASSUMPTION] | Opus 4.8 | "4x less likely to miss code flaws" improves quality but does not eliminate flaws; still require test coverage |

---

## SECTION 6: QUICK-REFERENCE DECISION FLOWCHART (TEXT)

```
TASK RECEIVED
    │
    ├─ Is context >200K tokens?
    │       YES → Route to Opus 4.8 or Sonnet 4.6 (Haiku excluded)
    │       NO  → continue
    │
    ├─ Is output >64K tokens required?
    │       YES → Route to Opus 4.8 only
    │       NO  → continue
    │
    ├─ Task type classification:
    │
    │   FILE_READ / SEARCH / CLASSIFICATION / BOILERPLATE
    │       → Haiku 4.5 (no effort param)
    │
    │   RAPID_CODEGEN (isolated, <50 LOC)
    │       → Haiku 4.5; upgrade to Sonnet 4.6 @ medium if multi-file
    │
    │   DEBUGGING / CODE_REVIEW / TEST_AUTHORING / DOCUMENTATION
    │       → Sonnet 4.6 @ medium (default)
    │       → Sonnet 4.6 @ high (quality-critical)
    │       → Opus 4.8 @ high (cross-module / architectural)
    │
    │   TERMINAL_EXECUTION / CLOSED_LOOP / SCRIPTING
    │       → GPT-5.5 @ Codex (primary)
    │       → Opus 4.8 @ xhigh Dynamic Workflows (quality priority)
    │
    │   SECURITY_REVIEW
    │       → GPT-5.5 (initial pass)
    │       → Opus 4.8 @ high (concurrency/threading cross-check)
    │
    │   DETERMINISTIC_EXTRACTION / FORMAL_PROOF
    │       → GPT-5.5 (primary) or Sonnet 4.6 @ medium (JSON extraction)
    │
    │   STRATEGIC_PLANNING / ARCHITECTURE / REFACTOR_INTEGRITY
    │       → Opus 4.8 @ xhigh
    │
    │   NUANCED_REASONING / GRAY_AREA / TIE_BREAKING
    │       → Opus 4.8 @ high (never Haiku; Sonnet only for <2 tradeoff dims)
    │
    │   LONG_CONTEXT_SYNTHESIS / KNOWLEDGE_WORK
    │       → Opus 4.8 @ max (>10 sources or novel output)
    │       → Sonnet 4.6 @ high (<10 sources, routine synthesis)
    │
    └─ DONE
```

---

## SECTION 7: TIER-SUBSTITUTION GUIDE

| If Primary Unavailable | Substitute | Notes |
|---|---|---|
| Opus 4.8 | Opus 4.7 @ xhigh | Near-identical on most tasks; Opus 4.8 leads mainly on agentic/honesty |
| Opus 4.7 | Opus 4.6 @ high | Effort scale differs; `high` on 4.6 ≈ `medium` on 4.7 |
| Sonnet 4.6 | Opus 4.6 @ medium | 40% cost increase; quality improves slightly |
| Haiku 4.5 | Sonnet 4.6 @ low | 3x cost increase; still the right choice if Haiku unavailable |
| GPT-5.5 (Codex) | Opus 4.8 @ xhigh (Dynamic Workflows) | Opus 4.8 beats GPT-5.5 on SWE-Pro; Dynamic Workflows is comparable for agentic tasks |
| GPT-5.5 (security) | Opus 4.8 @ high | Opus 4.8 is the best Claude-family alternative; Mythos Preview if invited |

---

## SECTION 8: ASSUMPTION / INFERENCE LOG

- [ASSUMPTION] Opus 4.8 ≫ Opus 4.7 for the same tasks: Partially confirmed by benchmarks (SWE-bench +1.0 pp, SWE-Pro +4.9 pp, BrowseComp +5.0 pp, MCP-Atlas +4.9 pp). Gap is real but "modest." The seed corpus assumption of "≫" is stronger than the data warrants; "materially better on agentic tasks, approximately equal on isolated coding" is more precise.
- [ASSUMPTION] GPT-5.5 "confident hallucination" risk: Partially confirmed by Sonar evaluation ("followed instructions too literally," weak on ambiguous prompts) and its general category classification. The 60% hallucination reduction vs. GPT-5.4 is real, but the absolute rate is not published; risk designation is appropriate.
- [INFERRED] Sonnet 4.6 adequate for baseline debug / review: Confirmed by SWE-bench Verified 79.6% and developer adoption data (70% of developers prefer Sonnet for daily coding).
- [INFERRED] Haiku 4.5 for ALL coding: The seed corpus overloads Haiku. Haiku 4.5 = Sonnet 4.0 on coding. For isolated, small-scope tasks this holds. For anything multi-file or semantically complex, Sonnet 4.6 @ medium is the correct default. This table refines the directive.
- [INFERRED] GPT-5.5 Codex slots for closed-loop: Supported by Terminal-Bench 2.0 score (82.7%) and independent 20-hour engineering task completion report.

---

## REFERENCES (APA, ORIGINAL SOURCES ONLY)

Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8

Anthropic. (2026, May 29). *Models overview*. https://platform.claude.com/docs/en/about-claude/models/overview

Anthropic. (2026, May 29). *Effort — Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort

Anthropic. (2026, May 29). *Choosing the right model — Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/choosing-a-model

Augment Code. (2026). *Best AI model for coding agents in 2026: A routing guide*. https://www.augmentcode.com/guides/ai-model-routing-guide

Blackburn, L. (2026). *Cross-provider sub-agent routing directive* [internal document].

CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results

AISI (AI Safety Institute, UK). (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities

Endor Labs. (2026). *GPT-5.5 sets a new code security record in Agent Security League*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league

OpenAI. (2026, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/

Sonar. (2026). *OpenAI GPT-5.5: an evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation

The Decoder. (2026, May 29). *Anthropic ships Claude Opus 4.8 as a "modest but tangible improvement" that tops GPT-5.5 in most benchmarks*. https://the-decoder.com/anthropic-ships-claude-opus-4-8-as-a-modest-but-tangible-improvement-that-tops-gpt-5-5-in-most-benchmarks/

tokita.online. (2026). *Best LLM for each task (2026): Production benchmarks*. https://tokita.online/best-llm-for-each-task/

Yang, C. et al. (2026). *AdaptOrch: Task-adaptive multi-agent orchestration in the era of LLM performance convergence*. arXiv:2602.16873.
