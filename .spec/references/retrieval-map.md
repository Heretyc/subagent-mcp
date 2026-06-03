# Retrieval Map — `.spec/references/` KB (FIRST-LOAD router)

**What this covers:** Cross-provider work-category routing for the subagent-mcp fleet (Claude Code +
Codex CLI). Routes every agent request to `{provider, model, effort}` via gates → precedence →
fallback. **Load this file first on ANY routing, classification, model-selection, or cost question.
It routes; it does not teach — follow every pointer to its leaf.**

---

## 1. Trigger Matrix (trigger family → exact leaf files)

| Trigger family | Load these files |
|----------------|------------------|
| **Classify / route a task** | `routing-contract.md` → `work-categories.md` → `routing-table.md` |
| **Gate check** (ctx size, output size, math, security, commit, sandbox, data) | `hard-gates.md` |
| **Model selection / capabilities / benchmarks** | `model-profiles.md` |
| **Benchmark source list / eval citations** | `skills/model-profiler/references/benchmark-sources.md` |
| **Cost / pricing / token budget / inflation** | `cost-model.md` |
| **Multi-agent pattern / topology / anti-pattern** | `synergy-patterns.md` |
| **Failure / symptom / error / stall / hallucination / 429** | `failure-modes.md` |
| **Governance / halt / commit / write-scope / data-boundary** | `governance-halts.md` |
| **Why this routing / conflict resolution / label provenance** | `decision-rationale.md` |
| **Machine-readable route table (runtime load)** | `assets/routing-table.json` |
| **Citation / claim lineage / source verification** | `source-ledger.md` |

---

## 2. Per-File "Load When" Rules

| File | Load when… | Skip when… |
|------|-----------|------------|
| `routing-contract.md` | Starting any routing decision; need 3-step contract or precedence string | Only need one category's definition |
| `work-categories.md` | Classifying a prompt; need definitions, signals, or boundaries | Route and effort already known |
| `routing-table.md` | Choosing provider/model/effort/fallback for a classified task | Only need category definitions |
| `hard-gates.md` | Any gate (G_MATH, G_CTX*, G_SEC, G_COMMIT, G_SANDBOX, G_DATA, G_OPUS_LOCK) fires | No gate in play |
| `model-profiles.md` | Comparing models; capability/risk/ctx/effort; benchmark numbers | Gate or routing decision only |
| `skills/model-profiler/references/benchmark-sources.md` | Looking up the canonical external benchmark source list (leaderboard URLs, eval datasets, source tiers) | Routing; model selection; claim citation |
| `cost-model.md` | Pricing; token budgets; tokenizer inflation; price cliff; effort cost | No cost tradeoff |
| `source-ledger.md` | Verifying claim lineage; citation source ID; provenance audit | Operational routing |
| `synergy-patterns.md` | Multi-agent setup; Patterns 1/2/4a/4b/5/7; anti-patterns A–E; topology | Single-model, no orchestration |
| `failure-modes.md` | Debugging agent behavior; symptom/error; stall; hallucination; 429 | No observed failure |
| `governance-halts.md` | Commit gate; halt conditions; write scoping; data retention; telemetry | No commit or destructive action |
| `decision-rationale.md` | Auditing WHY a route exists; conflict reconciliation; label provenance | Operational routing |
| `decision-rationale/01-sop-provenance.md` | WHY behind the 3 owner SOPs (version-promotion, worst-case cost, sourcing); their label provenance | Not auditing the SOPs |
| `assets/routing-table.json` | Runtime machine consumption by subagent-mcp feature code | Human routing/advisory only |

---

## 3. Semantic Index — Topic / Alias / Synonym

| Canonical topic | Aliases / synonyms / misspellings | Leaf |
|-----------------|-----------------------------------|------|
| Work categories / taxonomy | task types, task class, work type, categori, catagory, buckets | `work-categories.md` |
| Routing contract | 3-step contract, routing logic, dispatch, router, route logic | `routing-contract.md` |
| Precedence order | first-match, tie-break, classification order, precendence | `routing-contract.md`, `work-categories.md` |
| Hard gates | gates, preconditions, overrides, G_MATH, G_CTX, G_SEC, G_COMMIT, G_SANDBOX, G_DATA, G_OPUS_LOCK | `hard-gates.md` |
| Cross-cutting modifiers (7) | perception_required, architecture_complexity, context_size, output_size, long_horizon, data_sensitivity, execution_sandbox; multimodal → perception_required modifier | `work-categories.md`, `hard-gates.md` |
| Model capabilities | model comparison, which model, AI selection, provider choice, LLM selection | `model-profiles.md` |
| Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5 | claude-opus-4-8, sonet, oppus, haiku, claude | `model-profiles.md` |
| GPT-5.5, GPT-5.4-mini, GPT-5.5-pro | gpt5.5, gpt-5, codex model, openai model, GPT55 | `model-profiles.md` |
| Pricing / cost | token cost, price per call, MTok, $/M, cost per token, how much does it cost | `cost-model.md` |
| Tokenizer inflation | tokeniser, token inflation, opus inflation, migration surprise, effective cost multiplier | `cost-model.md` |
| Context window / size | ctx, context length, long context, context cap, gate thresholds | `hard-gates.md`, `model-profiles.md` |
| Effort levels | high/xhigh/max effort, reasoning level, thinking tokens | `model-profiles.md`, `routing-table.md` |
| Security review / G_SEC | vuln, auth, authz, crypto, deserialization, CWE, threat model, security audit, AISI | `hard-gates.md`, `work-categories.md` |
| Commit gate / G_COMMIT | pre-commit, contradiction-check, commit checker, before commit | `hard-gates.md`, `governance-halts.md` |
| Sandbox / G_SANDBOX | codex sandbox, danger-full-access, workspace-write, bypass approval | `hard-gates.md`, `governance-halts.md` |
| Data boundary / G_DATA | secrets, credentials, regulated data, owner-private, data routing | `hard-gates.md`, `governance-halts.md` |
| Math / proof | math_proof, theorem, derivation, formal proof, G_MATH, FrontierMath, maths | `work-categories.md`, `hard-gates.md` |
| Architecture | design, refactor, decompose, ADR, orchestration, cross-cutting, architecure | `work-categories.md`, `routing-table.md` |
| Debugging | bug fix, failure, crash, flaky test, regression, root cause, CI failure | `work-categories.md`, `failure-modes.md` |
| Agentic execution | codex loop, terminal work, closed-loop, iterate-to-end-state, function call, tool invocation, CLI, agentic_execution | `work-categories.md`, `routing-table.md` |
| Data analysis | data_analysis, SQL query, dataframe, table reasoning, dataset finding, analyze data, statistical analysis, data_analysis_query | `work-categories.md`, `routing-table.md` |
| Knowledge synthesis | long-context synthesis, multi-source, gray-area, policy judgment, knowledge_synthesis, summarize, translate, draft (prose), rewrite | `work-categories.md`, `routing-table.md` |
| Coding | implement, write code, add feature, make test pass, coding | `work-categories.md`, `routing-table.md` |
| Mechanical | grep, find, list, reformat, classify, leaf work, boilerplate, extract to schema, structured extraction, deterministic transform | `work-categories.md`, `routing-table.md` |
| Multi-agent patterns / anti-patterns | hub-and-spoke, fan-out, map-reduce, Pattern 1/2/4a/4b/5/7, synergy; A–E, duplicate task, average outputs, self-review, peer mesh, peer-to-peer, skip coordinator | `synergy-patterns.md` |
| Failure modes | hallucination, stall, truncation, concurrency bug, 429, rate-limit, quota, retry-after, wrong file, injection | `failure-modes.md` |
| Latency / wall-clock sensitivity | speed, fast mode, priority tier, blocking, real-time, latency-sensitive | `cost-model.md` |
| Recency / knowledge cutoff | up to date, latest, post-cutoff, stale, current info, knowledge cutoff | `model-profiles.md` |
| Documentation / PR review | write docs, README, docstring, add comments (→ `coding`); review my PR, pull request review (→ `quality_review`) | `work-categories.md`, `routing-table.md` |
| Managed Agents API / Agent SDK | Anthropic Managed Agents, Agent SDK — OUT OF SCOPE | `synergy-patterns.md` |
| Halt / output contract / telemetry | halt-and-surface, blocked, needs_user, stop, no writes; status/summary/source_locators/risks; run telemetry; IPC, subagent handoff, temp file JSON | `governance-halts.md`, `synergy-patterns.md` |
| Conflict resolution / rationale | why, decision, seed status, [SEED], [INFERRED], [ASSUMPTION] | `decision-rationale.md` |

### Decision-Rule & Failure-Mode Index

| Rule / Symptom | File | Gate/Pattern |
|----------------|------|--------------|
| Gate-first / first-match / no-averaging / self-review ban / adjacent-tie | `routing-contract.md` §1–2,§6 | — |
| Peer mesh banned (hub-and-spoke only) | `synergy-patterns.md` Anti-E | — |
| Escalate within provider / switch-only-for-fit | `routing-table.md` | — |
| Hallucinated API / confident hallucination | `failure-modes.md` | G_SEC, P4a |
| Concurrency bug / CWE-732 | `failure-modes.md` | G_SEC |
| Agentic overconfidence / false success | `failure-modes.md` | P1 verify |
| Stall / never writes | `failure-modes.md` | P4b |
| Wrong-file commit | `failure-modes.md` + `governance-halts.md` | G_COMMIT |
| Context degradation / 429 / truncation / silent skip / injection | `failure-modes.md` | varies |

---

## 4. Problem-Description Trigger Index (user describes problem without naming topic)

| User says / problem symptom | Load | Gate / pattern |
|-----------------------------|------|----------------|
| "Which model should I use for X?" | `model-profiles.md` → `routing-table.md` | — |
| "Which is cheapest / most expensive?" | `cost-model.md` | — |
| "My agent keeps asking questions and never writes code" | `failure-modes.md` + `synergy-patterns.md` | Pattern 4b |
| "The AI invented an API that doesn't exist" | `failure-modes.md` + `hard-gates.md` | G_SEC |
| "It committed to the wrong file" | `failure-modes.md` + `governance-halts.md` | G_COMMIT |
| "Is it safe to let the AI run shell commands?" | `hard-gates.md` + `governance-halts.md` | G_SANDBOX |
| "The output is getting cut off / truncated" | `failure-modes.md` + `hard-gates.md` | G_CTX_OUT |
| "The context is too big / hitting the limit" | `hard-gates.md` | G_CTX_* |
| "This is too expensive / costing a lot" | `cost-model.md` + `routing-table.md` | — |
| "I upgraded from Opus 4.6 and costs went up" | `cost-model.md` | 1.4× inflation |
| "It keeps writing the same thing / looping" | `failure-modes.md` | stall / verbosity |
| "Two models gave me different answers" | `governance-halts.md` + `synergy-patterns.md` | Anti-Pattern B |
| "The agent checked its own work" | `governance-halts.md` + `synergy-patterns.md` | Anti-Pattern D |
| "How do I do the pre-commit check?" | `hard-gates.md` + `governance-halts.md` | G_COMMIT |
| "When should I escalate to a higher-capability tier?" | `routing-table.md` + `work-categories.md` | precedence |
| "Proof / math derivation route?" | `work-categories.md` + `hard-gates.md` | G_MATH |
| "Auth/permissions code was written by GPT-5.5" | `hard-gates.md` | G_SEC mandatory |
| "My input is 300K tokens and I'm using GPT" | `hard-gates.md` | G_CTX_272 |
| "Can Haiku handle this long document?" | `hard-gates.md` + `model-profiles.md` | G_CTX_200 |
| "Agent never admits it skipped something" | `failure-modes.md` + `governance-halts.md` | silent skip |
| "I need to pass secrets / credentials to the model" | `hard-gates.md` + `governance-halts.md` | G_DATA |
| "Agent says it succeeded / tests pass but they don't / reported success with no proof" | `failure-modes.md` + `synergy-patterns.md` | P1 verify / agentic_overconfidence |
| "Agent edited files outside scope / added attribution lines / random formatting changes" | `governance-halts.md` + `failure-modes.md` | write-scoping reject / over-effort |
| "Review my PR / pull request / review my changes" | `work-categories.md` (`quality_review`) + `routing-table.md` | G_COMMIT; security surface → `security_review` |
| "Set up a CI gate / merge gate / pre-merge review / branch-protection check / CI/CD diff review / pipeline review before merge" | `governance-halts.md` + `hard-gates.md` (G_COMMIT) + `routing-table.md` (`quality_review`) | G_COMMIT |
| "Which provider / model may commit code? / who is allowed to commit / commit authority / provider permissions" | `governance-halts.md` + `hard-gates.md` (G_COMMIT, G_SEC) | G_COMMIT; G_SEC |
| "This keeps stalling and costing too much / slow and expensive / not finishing and burning budget / keeps stalling and burning tokens" | `failure-modes.md` (stall/P4b) + `cost-model.md` (three-tier) + `synergy-patterns.md` (Anti-C over-delegation) | Pattern 4b; Anti-C |
| "Can the agents talk to each other directly / skip the coordinator / agents calling agents?" | `synergy-patterns.md` + `governance-halts.md` | Anti-Pattern E (hub-and-spoke only) |
| "I keep getting rate limited / quota errors / retry-after" | `failure-modes.md` | 429 backoff/batch |
| "I need this fast / it's blocking a user / production incident / interactive call" | `cost-model.md` | fast/priority reserve rule |
| "Should I split this across several agents / parallelize / run these in parallel?" | `synergy-patterns.md` + `routing-table.md` | Pattern 2; Anti-Pattern C (no trivial over-delegation) |
| "Should I use the Managed Agents API / Agent SDK for this?" | `synergy-patterns.md` | OUT OF SCOPE — local IPC (temp-file JSON) only |
| "Does this model know about [recent event] / is its info current / is it stale?" | `model-profiles.md` | knowledge cutoff (Haiku cutoff date — see model-profiles.md) |
| "Is it safe to send customer/PII/regulated data to another provider?" | `hard-gates.md` + `governance-halts.md` | G_DATA |

---

## 5. Entity / Product / Vendor Index

| Entity | Leaf |
|--------|------|
| Anthropic, Claude | `model-profiles.md`, `cost-model.md` |
| Opus 4.8 / claude-opus-4-8 | `model-profiles.md`, `routing-table.md` |
| Sonnet 4.6 / claude-sonnet-4-6 | `model-profiles.md`, `routing-table.md` |
| Haiku 4.5 / claude-haiku-4-5 | `model-profiles.md`, `routing-table.md`, `hard-gates.md` |
| OpenAI, Codex CLI, GPT-5.5 / gpt-5.5 | `model-profiles.md`, `cost-model.md`, `hard-gates.md` |
| GPT-5.4-mini, GPT-5.5-pro | `model-profiles.md`, `routing-table.md` |
| subagent-mcp | `routing-contract.md`, `assets/routing-table.json` |
| Managed Agents API / Agent SDK (OUT OF SCOPE) | `synergy-patterns.md` |
| Blackburn (2026) seed directive | `decision-rationale.md`, `source-ledger.md` |
| AISI, Sonar, Endor, CodeRabbit | `source-ledger.md` → `failure-modes.md`, `hard-gates.md` |
| SWE-bench, GDPval-AA, Terminal-Bench | `model-profiles.md`, `decision-rationale.md` |
| Microsoft Foundry | `model-profiles.md` (Opus 4.8 caps at 200K on Foundry) |

---

## 6. Workflow Index

| Workflow | Files to load (in order) |
|----------|--------------------------|
| Route a new task end-to-end | `routing-contract.md` → `work-categories.md` → `hard-gates.md` → `routing-table.md` |
| Set up a multi-agent pipeline | `synergy-patterns.md` → `routing-table.md` → `governance-halts.md` |
| Pre-commit validation | `hard-gates.md` (G_COMMIT) → `governance-halts.md` |
| Security review of GPT-5.5 output | `hard-gates.md` (G_SEC) → `routing-table.md` (security_review) |
| Debug a failing agent run | `failure-modes.md` → `model-profiles.md` → `governance-halts.md` |
| Estimate / optimize cost | `cost-model.md` → `model-profiles.md` → `routing-table.md` |
| Audit routing decisions / WHY | `decision-rationale.md` → `source-ledger.md` |
| Integrate subagent-mcp feature | `assets/routing-table.json` + `routing-contract.md` |

---

## 7. When to Stop and Ask for More Context

| Condition | Action |
|-----------|--------|
| Category unclear AND write/side-effect implied | Ask for narrower scope; use `fallback_default` read-only |
| Input token count unknown and G_CTX* may apply | Measure first |
| Data classification unknown (public/secret/regulated) | Classify before routing |
| Provider/model unavailable and fallback chain exhausted | `status: blocked` |
| Two hard gates conflict (e.g., G_MATH → GPT-5.5, G_CTX_272 → off-GPT-5.5, irreducible) | Surface to owner |
| Spec / prompt / policy instructions contradict | `status: needs_user`; name conflict |
| G_COMMIT checker unavailable | Halt; never degrade to weaker checker |
| Destructive/irreversible action with unclear scope | Halt |
| Managed Agents API / Agent SDK requested | Out of scope — local IPC only; surface to owner |
| Multimodal-only task (no classifiable text goal) | `fallback_default`; ask for concrete deliverable |
| Recency/post-cutoff data required; no web-enabled model | Flag Haiku stale (Feb 2025); halt and surface if needed |

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
