# Phase 2 Synthesis 5: Cross-Provider Router Contract

Date: 2026-05-29. Scope: local Claude Code plus Codex CLI fleet only. Managed Agents API is out of scope. Labels: `[SEED]` is a Blackburn 2026 hypothesis only; `[INFERRED]` is extrapolation from cited facts; `[ASSUMPTION]` is a cost/effort modeling assumption. Unlabeled claims are sourced in References.

## 1. Highest-Impact Router Rules

1. Apply hard gates before category routing: math/proof -> GPT-5.5; input >200K -> prefer Claude; input >272K and cost-sensitive -> mandatory off GPT-5.5; output >64K -> Opus 4.8.
2. Classify into exactly one broad work category. Do not use LOC thresholds. Size, security, context, and cost are gates, not categories.
3. Route by task split, not brand: GPT-5.5 is strongest for closed-loop terminal execution, deterministic extraction, and math/proof; Opus 4.8 is strongest for architecture, long-context synthesis, nuanced judgment, and final contradiction arbitration; Sonnet 4.6 is the default balanced coding/debug/review tier; Haiku 4.5 is the mechanical leaf tier.
4. Opus 4.8 is framed as "better for harder agentic/task-split work," not as blanket superiority. SWE-bench Verified is effectively tied with GPT-5.5 in the inputs; SWE-bench Pro and long-horizon/knowledge-work evidence drive Opus routing.
5. GPT-5.5 security routing is conditional: use GPT-5.5 for the initial security/cyber pass, but require Claude cross-review before commit for auth, permission, sandbox, crypto, secrets, and concurrency-critical code.
6. Cost surprises are first-class: Opus 4.7/4.8 sticker price equals Opus 4.6, but tokenizer inflation makes same-content cost roughly 1.4x nominal and should be treated as a migration surprise.
7. [SEED] claims never override docs, benchmarks, repo policy, or deterministic evidence. Treat them as hypotheses that help choose what to test.

## 2. Hard Gates

| Gate | Condition | Router action |
|---|---|---|
| G0 math_proof | Mathematical proof, formal derivation, symbolic reasoning, or correctness proof | Route to GPT-5.5, usually medium/high; Opus/Sonnet may review prose clarity, not replace primary route. |
| G1 context | Input >200K tokens | Prefer Claude Sonnet 4.6 or Opus 4.8; Haiku excluded. |
| G2 GPT cliff | Input >272K and cost_sensitive=true | Forbid GPT-5.5; route to Sonnet 4.6 or Opus 4.8 because GPT-5.5 long-context pricing applies to the full session. |
| G3 output | Expected output >64K | Use Opus 4.8; synchronous Sonnet/Haiku cap at 64K. |
| G4 security | Touches auth, permissions, crypto, sandboxing, secrets, CI credentials, deserialization, shell/network boundaries, or concurrency | GPT-5.5 may do initial pass/patch; Claude Sonnet minimum, Opus preferred, must cross-review before commit. |
| G5 commit | Repository commit changing executable/source code | Dispatch strongest available contradiction-checker at max/highest reasoning; block on `blocked` or `needs_user`. |
| G6 sandbox | Requests danger-full-access, bypass approvals, external side effects, deletes, pushes, or destructive ops | Allow only in explicitly hardened disposable environment; otherwise halt and surface. |
| G7 data_boundary | Secret, regulated, owner-private, or provider-restricted data | Halt unless provider/feature/retention/region/cache path is explicitly approved. |

## 3. Canonical Work-Category Taxonomy

| Category | Definition | Classification signals | Examples | Boundary / anti-example |
|---|---|---|---|---|
| `mechanical` | Low-ambiguity file/search/format/classify/boilerplate leaf work. | "find", "list", "extract imports", "format", "label", "scaffold from existing pattern". | Symbol lookup, README link inventory, DTO skeleton, JSON reshaping. | If semantic design, multi-file invariants, or >200K context matters, leave this category. |
| `coding` | Implement or change code to satisfy a known objective. | "add feature", "implement", "modify", "wire", "create test", "make smallest change". | Add CLI flag, update API adapter, write behavior tests from clear spec. | Observed failure/root cause -> `debugging`; architecture choice -> `architecture`. |
| `debugging` | Explain and fix an observed failure. | Stack trace, failing test, regression, flaky/intermittent, "why does this fail". | Reproduce failing test, localize bug, patch minimal files, rerun target suite. | Pure feature work without failure evidence -> `coding`. |
| `review_validation` | Judge an artifact against requirements, policy, security, or contradictions. | "review", "audit", "check diff", "contradiction", "is this safe", "pre-commit". | PR review, security review, spec compliance check, merge gate. | Generating the patch itself -> `coding`; proof construction -> `math_proof`. |
| `extraction_terminal` | Closed-loop CLI/script work and deterministic evidence extraction. | "run command", "parse logs", "emit JSON", "prove by rg", "generate report from files". | CI log triage, schema extraction, inventory by file:line, script-driven transform. | If output is a mathematical proof, G0 routes to `math_proof`; if broad judgment dominates, use `knowledge_synthesis`. |
| `math_proof` | Math, proofs, formal-ish derivations, rigorous correctness arguments. | "prove", "derive", "theorem", "invariant", "formal", "counterexample", "complex calculation". | Complexity proof, invariant proof, symbolic derivation, proof-checking plan. | Arithmetic embedded in routine code review does not reclassify unless proof is the deliverable. |
| `architecture` | Strategic design, refactor integrity, decomposition, orchestration, interface decisions. | "design", "architecture", "refactor plan", "split tasks", "tradeoffs", "orchestrate". | Multi-agent plan, public API migration design, module boundary decision. | Executing an already-approved design -> `coding`. |
| `knowledge_synthesis` | Multi-source or long-context synthesis and nuanced/gray-area reasoning. | "synthesize", "research", "compare sources", "policy", "legal", "financial", "gray area". | 50-source synthesis, governance memo, ambiguous policy decision. | Deterministic extraction from known schema -> `extraction_terminal`. |

## 4. Routing Per Category

| Category | Primary route | Fallback | Synergy / validation pattern | Hard gates |
|---|---|---|---|---|
| `mechanical` | Claude Haiku 4.5, fixed low profile | Sonnet 4.6 low; GPT-5.4-mini for cheap Codex leaves | None unless write side effects; verify by deterministic command or schema. | G1, G7 |
| `coding` | Sonnet 4.6 medium for normal code; GPT-5.5 low/medium when terminal loop is dominant | GPT-5.5 medium; Opus 4.8 high for cross-module or high-blast-radius code | Codex implements/tests -> Claude reviews when security/architecture risk exists. | G1-G7 |
| `debugging` | Sonnet 4.6 high for ambiguous bugs; medium for bounded failures | GPT-5.5 medium/high for CLI-heavy repro; Opus 4.8 high for system-level root cause | Reproduce with tools, patch minimally, independent review if diff crosses interfaces. | G1, G4, G5 |
| `review_validation` | Opus 4.8 high for final gate; Sonnet 4.6 high for routine PR review | GPT-5.5 high for initial cyber/static pass; Opus 4.7/4.6 if 4.8 unavailable | Cross-provider validation, never same-family self-validation for commit gates. | G4, G5, G7 |
| `extraction_terminal` | GPT-5.5 low/medium in Codex CLI | Sonnet 4.6 medium; Haiku for trivial extraction | Use commands/source locators, JSON schema, temp-file handoff for large payloads. | G1, G2, G6, G7 |
| `math_proof` | GPT-5.5 medium/high; xhigh only for hard async proof work | GPT-5.5-pro if repeated high/xhigh failures show capability limit | Opus 4.8 may review exposition/assumptions; deterministic tools where available. | G0, G2, G7 |
| `architecture` | Opus 4.8 xhigh; high if scope is bounded | Opus 4.7 xhigh -> Opus 4.6 high -> Sonnet 4.6 max | Opus plan -> Haiku/Sonnet/GPT workers -> Sonnet/Opus integration review. | G1, G4, G5 |
| `knowledge_synthesis` | Opus 4.8 high; max for frontier or >10-source novel synthesis | Sonnet 4.6 high for routine synthesis; GPT-5.5 medium for source-grounded extraction pass | Map-reduce: cheap mappers emit short JSON; Opus reduces conflicts. | G1, G2, G7 |

## 5. Provider and Model Capability/Risk Profiles

| Model | Best use | Main risks | Do not use when |
|---|---|---|---|
| Claude Opus 4.8 | Architecture, long-horizon agentic coding, nuanced judgment, long-context synthesis, final contradiction gate, web/computer-use quality. | Premium cost, tokenizer inflation, verbosity/over-caution at high effort, locked sampling controls. | Routine file ops, boilerplate, cost-sensitive >272K work where Sonnet suffices, or no acceptance criteria. |
| Claude Opus 4.7 | Near-4.8 fallback for xhigh Opus workflows. | Same tokenizer inflation; stricter prompt behavior; reported tool-skipping in inputs. | New work where 4.8 is available at same price. |
| Claude Opus 4.6 | Legacy old-tokenizer flagship; prompt-compat fallback. | Stall/caution and verbosity most documented; no xhigh. | New routing unless prompt migration cost dominates. |
| Claude Sonnet 4.6 | Default balanced coding, debugging, routine review, 1M-context cost control. | May lose coherence before Opus on long autonomous chains; high default can surprise latency/cost. | Deep architecture, final high-risk arbiter, proof mandate, or mechanical work Haiku can do. |
| Claude Haiku 4.5 | Cheap/fast file reads, search, classification, extraction, boilerplate leaf agents. | 200K context cap, no adaptive thinking, shallow multi-step reasoning. | Security review, gray-area judgment, architecture, long-context work. |
| GPT-5.5 Codex/API | Closed-loop terminal execution, deterministic extraction, math/proof, concise script work, initial cyber pass. | Confident hallucination, literal prompts, wrong-file commitment, security/concurrency bugs, 272K price cliff. | Final architecture/security authority, cost-sensitive >272K context, ungrounded external truth. |
| GPT-5.5-pro | Capability-limited hard proofs/reviews after GPT-5.5 high/xhigh fails. | Very high cost and latency. | Routine tasks, missing-evidence tasks, or anything without independent validation. |

## 6. Cost Model and Cost-Aware Rules

Formula: `cost = input_tokens*input_rate + cached_tokens*cache_rate + (visible_output + hidden_reasoning)*output_rate + tool/storage + multipliers`. Hidden reasoning/thinking tokens bill as output. Output contracts are budget controls.

Nominal standard rates per MTok: Opus 4.8/4.7/4.6 = $5 in / $25 out; Sonnet 4.6 = $3/$15; Haiku 4.5 = $1/$5; GPT-5.5 short context = $5/$30; GPT-5.5 long context = $10/$45; GPT-5.5-pro short = $30/$180. Batch halves both providers. Opus 4.8 fast mode is $10/$50; Opus 4.6/4.7 fast mode is $30/$150; GPT-5.5 fast mode is a credit multiplier. US/data-residency can add 10 percent.

Inflation adjustment: Anthropic states Opus 4.7+ can use up to 35 percent more tokens for the same fixed text; Phase 1 tokenizer analysis estimates 32-45 percent. Router cost estimates should treat Opus 4.7/4.8 as approximately 1.4x nominal for same-content migration: $5/$25 sticker behaves like about $7/$35 per content-MTok. This is the migration surprise.

Effective cost per 100K input + 20K visible output task, excluding cache/tools, using hidden-output assumptions none=0, low=0.1x, medium=0.25x, high=0.75x, xhigh=1.5x, max=2.5x:

| Provider/model | none/fixed | low | medium | high | xhigh | max |
|---|---:|---:|---:|---:|---:|---:|
| Haiku 4.5 | $0.20 | n/a | n/a | n/a | n/a | n/a |
| Sonnet 4.6 | n/a | $0.63 | $0.68 | $0.83 | n/a | $1.05 |
| Opus 4.6 | n/a | $1.05 | $1.13 | $1.38 | n/a | $1.75 |
| Opus 4.8/4.7, inflation-adjusted | n/a | $1.47 | $1.58 | $1.93 | $2.45 | $3.15 |
| GPT-5.5 short context | $1.10 | $1.16 | $1.25 | $1.55 | $2.00 | n/a |
| GPT-5.5 long context | $1.90 | $1.99 | $2.13 | $2.58 | $3.25 | n/a |

Cost-aware routing rules: use Haiku for mechanical leaves; use Sonnet before Opus for ordinary coding/debug; use Opus only where missed contradictions or wrong architecture cost more than tokens; use GPT-5.5 low/medium for verifiable terminal/extraction/proof work; reserve high/xhigh/max for measured quality need; never use premium effort to compensate for missing evidence or ambiguous authorization; use batch/flex for async bulk work, not interactive blockers; do not use fast/priority for background research.

## 7. Failure Modes, Symptoms, Mitigations

| Failure mode | Symptom | Mitigation |
|---|---|---|
| GPT-5.5 hallucination | Plausible API/file/pricing claim without locator | Require URL/file:line/command evidence; reject unsupported claims; cross-review. |
| GPT-5.5 security bug | Broad permission, unsafe shell, CWE-style miss, concurrency weakness | G4 cross-review; secret scan; threat-model checklist; targeted tests. |
| Opus stall/over-caution | Caveats, repeated asks, no concrete artifact | Re-scope to concrete artifact; use GPT-5.5 decisiveness injection; Opus reviews result. |
| Verbosity/over-effort | Long rationale buries decision, high token bill | Strict schema, line budgets, lower effort, summarize-restart. |
| Silent skip | Claims complete but omits required source/test/file | Compare against checklist; require `skipped` and `uncertainty` fields. |
| Turn-limit truncation | Missing final JSON/status, partial tables | Split task; resume from temp file/locators only. |
| Context overload | Slow response, weak recall, high cost | Use G1/G2; preserve locators not transcripts; map-reduce. |
| Sandbox bypass misuse | `--dangerously-bypass` in real workspace | Halt unless hardened disposable environment is explicit. |
| Cross-provider conflict | Claude/Codex disagree on deterministic fact | Do not average; choose primary source/command output; escalate arbiter only if evidence conflicts. |
| Data boundary breach | Secret/private data routed to wrong provider/cache/log | Halt, contain, rotate if needed, document incident. |

## 8. Governance Controls

Commit-time: source/executable commits require an independent contradiction/security checker using the strongest explicitly selectable model and highest reasoning setting; no writes/commits proceed on `blocked` or `needs_user`.

Secrets: never paste credentials into prompts, logs, issue comments, or repo-code-visible env vars. Use secret managers, least privilege, spending limits, provider allowlists, and immediate revocation on exposure.

Sandbox: default to scoped workspace-write. Bypass approvals/sandbox only inside a disposable, externally isolated runner with no ambient secrets and clean ownership boundaries.

Halt-and-surface: halt on secret exposure, destructive-action ambiguity, external side effect ambiguity, identity/authorization uncertainty, conflicting instructions, unsafe broad write, missing mandated checker, mandated provider unavailable, or compounding pipeline error.

Audit: every run should log parent task, category, model, effort, files read/written, commands, external URLs, token/cost estimate, validation result, skipped work, and unresolved risks. Subagent IPC should use temp files for large payloads; subagents return only compact status JSON.

## 9. Machine-Consumable Route Table

```yaml
version: phase-2-synth-5
hard_gates:
  - {id: G0_math_proof, when: {category: math_proof}, force: {provider: openai, model: gpt-5.5}}
  - {id: G1_context, when: {input_tokens_gt: 200000}, prefer_provider: anthropic, exclude_models: [claude-haiku-4-5]}
  - {id: G2_gpt_cliff, when: {input_tokens_gt: 272000, cost_sensitive: true}, forbid_provider: openai}
  - {id: G3_output, when: {expected_output_tokens_gt: 64000}, force: {provider: anthropic, model: claude-opus-4-8}}
  - {id: G4_security, when_any_touches: [auth, permissions, crypto, sandbox, secrets, ci_credentials, deserialization, shell, network, concurrency], require_review: {provider: anthropic, min_model: claude-sonnet-4-6}}
  - {id: G5_commit, when: {commit_executable_or_source: true}, require_checker: {model: strongest_available, reasoning: max}, block_status: [blocked, needs_user]}
routes:
  mechanical:
    primary: {provider: anthropic, model: claude-haiku-4-5, effort: fixed_low}
    fallback: [{provider: anthropic, model: claude-sonnet-4-6, effort: low}, {provider: openai, model: gpt-5.4-mini, effort: low}]
    validation: deterministic_check_or_schema
    cost_note: "Fleet cost floor: $1/$5 MTok; exclude above 200K context."
    risk_flags: [shallow_reasoning, context_200k_cap]
  coding:
    primary: {provider: anthropic, model: claude-sonnet-4-6, effort: medium}
    fallback: [{provider: openai, model: gpt-5.5, effort: medium}, {provider: anthropic, model: claude-opus-4-8, effort: high}]
    validation: codex_execute_then_claude_review_when_risky
    cost_note: "Sonnet is default; Opus 4.8 effective cost about 1.4x sticker, reserve for blast radius."
    risk_flags: [security_review_if_sensitive, commit_checker_required]
  debugging:
    primary: {provider: anthropic, model: claude-sonnet-4-6, effort: high}
    fallback: [{provider: openai, model: gpt-5.5, effort: high}, {provider: anthropic, model: claude-opus-4-8, effort: high}]
    validation: reproduce_patch_rerun_tests
    cost_note: "Use GPT-5.5 when CLI repro dominates; avoid Opus unless cross-system reasoning matters."
    risk_flags: [flaky_repro, over_effort]
  review_validation:
    primary: {provider: anthropic, model: claude-opus-4-8, effort: high}
    fallback: [{provider: anthropic, model: claude-sonnet-4-6, effort: high}, {provider: openai, model: gpt-5.5, effort: high}]
    validation: cross_provider_no_self_validation
    cost_note: "Reviewer cost is justified at commit/security gates; use Sonnet for routine PRs."
    risk_flags: [same_family_blind_spot, blocked_means_halt]
  extraction_terminal:
    primary: {provider: openai, model: gpt-5.5, effort: low}
    fallback: [{provider: openai, model: gpt-5.5, effort: medium}, {provider: anthropic, model: claude-sonnet-4-6, effort: medium}]
    validation: source_locators_json_schema_command_evidence
    cost_note: "Good value below 272K; above 272K cost-sensitive tasks must leave GPT-5.5."
    risk_flags: [hallucinated_locator, sandbox_bypass]
  math_proof:
    primary: {provider: openai, model: gpt-5.5, effort: high}
    fallback: [{provider: openai, model: gpt-5.5, effort: xhigh}, {provider: openai, model: gpt-5.5-pro, effort: pro}]
    validation: optional_opus_exposition_review
    cost_note: "Interview-mandated route; use pro only after high/xhigh evidence of capability limit."
    risk_flags: [proof_gap, high_reasoning_cost]
  architecture:
    primary: {provider: anthropic, model: claude-opus-4-8, effort: xhigh}
    fallback: [{provider: anthropic, model: claude-opus-4-7, effort: xhigh}, {provider: anthropic, model: claude-opus-4-6, effort: high}, {provider: anthropic, model: claude-sonnet-4-6, effort: max}]
    validation: plan_then_domain_split_workers_then_integration_review
    cost_note: "Premium route; Opus 4.8 same-content cost about $7/$35 effective after tokenizer inflation."
    risk_flags: [stall, verbosity, over_delegation]
  knowledge_synthesis:
    primary: {provider: anthropic, model: claude-opus-4-8, effort: high}
    fallback: [{provider: anthropic, model: claude-sonnet-4-6, effort: high}, {provider: openai, model: gpt-5.5, effort: medium}]
    validation: map_reduce_with_short_sourced_outputs
    cost_note: "Use Sonnet for routine synthesis; Opus max only for frontier or high-stakes multi-source judgment."
    risk_flags: [context_overload, source_drift, seed_hypothesis_not_authority]
```

## References

AI Safety Institute. (2026). *Our evaluation of OpenAI's GPT-5.5 cyber capabilities*. https://www.aisi.gov.uk/blog/our-evaluation-of-openais-gpt-5-5-cyber-capabilities
Anthropic. (2025, October 15). *Introducing Claude Haiku 4.5*. https://www.anthropic.com/news/claude-haiku-4-5
Anthropic. (2026). *Adaptive thinking - Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
Anthropic. (2026). *Effort - Claude API docs*. https://platform.claude.com/docs/en/build-with-claude/effort
Anthropic. (2026). *Models overview - Claude API docs*. https://platform.claude.com/docs/en/about-claude/models/overview
Anthropic. (2026). *Pricing - Claude API docs*. https://platform.claude.com/docs/en/about-claude/pricing
Anthropic. (2026). *Rate limits - Claude API docs*. https://platform.claude.com/docs/en/api/rate-limits
Anthropic. (2026, May 28). *Introducing Claude Opus 4.8*. https://www.anthropic.com/news/claude-opus-4-8
CodeRabbit. (2026). *OpenAI GPT-5.5 benchmark results*. https://www.coderabbit.ai/blog/gpt-5-5-benchmark-results
Endor Labs. (2026). *GPT-5.5 sets a new code security record*. https://www.endorlabs.com/learn/gpt-5-5-sets-a-new-code-security-record-with-cursor-not-codex-in-agent-security-league
OpenAI. (2026). *Codex models*. https://developers.openai.com/codex/models
OpenAI. (2026). *Codex non-interactive mode*. https://developers.openai.com/codex/noninteractive
OpenAI. (2026). *Codex permissions*. https://developers.openai.com/codex/permissions
OpenAI. (2026). *GPT-5.5 model*. https://developers.openai.com/api/docs/models/gpt-5.5/
OpenAI. (2026). *Pricing*. https://developers.openai.com/api/docs/pricing
OpenAI. (2026). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance
OpenAI. (2026). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model
OpenRouter. (2026). *Opus 4.7's new tokenizer: What it actually costs*. https://openrouter.ai/announcements/opus-47-tokenizer-analysis
Sonar. (2026). *OpenAI GPT-5.5: An evaluation*. https://www.sonarsource.com/blog/openai-gpt-5-5-evaluation
