# routing-table.md — Per-Category Route Table

**Load when:** selecting a provider/model/effort for a task; checking fallback chains; looking up which gates apply to a category; understanding synergy patterns by category.
**Do not load when:** you need $ figures or inflation math (→ [cost-model.md](./cost-model.md)); category definitions or classify signals (→ [work-categories.md](./work-categories.md)); gate trigger conditions or thresholds (→ [hard-gates.md](./hard-gates.md)); benchmark numbers (→ [model-profiles.md](./model-profiles.md)).

**One-screen summary:** First-match precedence order and adjacent-tie escalation rule are owned by [routing-contract.md](./routing-contract.md) §2. Escalate within a provider for retry; switch providers only for capability fit. This table owns the per-category route, fallback chain, gates, synergy, and effort rationale.

---

## Route Table

IDs are canonical per the manifest spine. All provider/model values are verbatim api-ids from the manifest. Cross-references for $ → [cost-model.md](./cost-model.md); for thresholds → [hard-gates.md](./hard-gates.md); for benchmarks → [model-profiles.md](./model-profiles.md).

| prec | category | primary {provider · model · effort} | fallback chain (ordered) | gates | synergy pattern | effort rationale |
|---:|---|---|---|---|---|---|
| 1 | `math_proof` | `openai` · `gpt-5.5` · `high` (`xhigh` adversarial) | `gpt-5.5` xhigh → `gpt-5.5-pro` (capability-limited only) → `claude-opus-4-8` high [verification only] | `G_MATH`, `G_CTX_272` | GPT-5.5 derives; Opus 4.8 verifies assumptions when result affects arch/security (as `quality_review` step) | Mandated route [ASSUMPTION, Interview Q10]; `high` default; `xhigh` for adversarial proofs |
| 2 | `security_review` | `anthropic` · `claude-opus-4-8` · `high` (GPT-5.5 `high` initial cyber pass optional) | `claude-opus-4-8` high [full review] → `claude-sonnet-4-6` high [surface only] → `claude-opus-4-7` high | `G_SEC`, `G_COMMIT`, `G_DATA` | **Mandatory cross-review (G_SEC):** GPT-5.5-authored high-risk code → Claude reviews before commit; reviewer family ≠ generator family; never GPT-5.5 self-review | Correctness depends on deep reasoning; blast radius of missed vuln >> token cost |
| 3 | `architecture` | `anthropic` · `claude-opus-4-8` · `xhigh` (`high` if bounded scope); `max_tokens` ≥ 64K | `claude-opus-4-7` xhigh → `claude-opus-4-6` high → `claude-sonnet-4-6` max [single-module plans only] | `G_CTX_OUT`, `G_OPUS_LOCK` | Pattern 2: Opus emits JSON decomposition → ≤5 separable workers implement → Sonnet integration-reviews fan-in | Official Anthropic agentic/planning starting point; `xhigh` because cascade-error cost >> token premium; see [cost-model.md](./cost-model.md) for 1.4× inflation note |
| 4 | `quality_review` | `anthropic` · `claude-opus-4-8` · `high` | `claude-opus-4-7` high → `claude-sonnet-4-6` high [surface only] → `claude-opus-4-6` max | `G_COMMIT`, `G_DATA` | Cross-provider (reviewer family ≠ generator); never same-family self-validation; Opus arbitrates and picks one — never averages [SANITY RULE 7] | Correctness-critical; serves as mandatory contradiction-checker (G_COMMIT IS this category) |
| 5 | `debugging` | `anthropic` · `claude-sonnet-4-6` · `high` (`medium` for bounded failures) | `claude-opus-4-8` high [cross-subsystem] → `gpt-5.5` medium–high [CLI-heavy repro] → `claude-haiku-4-5` null [shallow bugs only] | `G_CTX_200`, `G_SEC`, `G_COMMIT` | Reproduce→patch→rerun loop; escalate to Opus if root cause spans subsystems; concurrency bug → G_SEC Opus 4.8 cross-review mandatory | Debug loops are latency-sensitive; Sonnet ~5× cheaper than Opus; `high` default for deep root-cause |
| 6 | `agentic_execution` | `openai` · `gpt-5.5` · `medium` (harness: `codex`; sandbox: `workspace-write`); `low` fast-lane; `high` ambiguous/migration; `xhigh` when one error is expensive | `claude-opus-4-8` xhigh [Dynamic Workflows] → `claude-opus-4-7` xhigh → `claude-sonnet-4-6` medium [simple ops]; **never `claude-haiku-4-5`** | `G_CTX_272`, `G_CTX_400`, `G_SANDBOX`, `G_COMMIT`, `G_DATA` | **Pattern 1 MANDATORY before commit:** Codex executes loop → `{diff, test_results, files_modified, task_description}` temp file → Claude reviews (Opus arch / Sonnet routine) → APPROVE/BLOCK | OpenAI balanced Codex default; ~40% fewer output tokens; use `--output-schema` to avoid retries |
| 7 | `knowledge_synthesis` | `anthropic` · `claude-opus-4-8` · `high` (escalate to `max` if sources>10 or novel analysis) | `claude-sonnet-4-6` high [≤10 sources routine] → `claude-opus-4-7` high → `gpt-5.5` medium [source-grounded extraction pass] | `G_CTX_200`, `G_CTX_272` | Pattern 7 (map-reduce + sanitization): raw/untrusted data stays in map layer; Opus reduces over sanitized summaries only. Pattern 4b on stall: GPT-5.5 produces concrete first attempt → Opus corrects | Opus `high` default; `max` only when evals show headroom; context-degradation ceiling → see [failure-modes.md](./failure-modes.md) |
| 8 | `coding` | `anthropic` · `claude-sonnet-4-6` · `medium` (or `gpt-5.5` low–medium when terminal loop dominates) | `claude-sonnet-4-6` high [quality-critical] → `gpt-5.5` medium [closed-loop in Codex] → `claude-opus-4-8` high [cross-module / high-blast-radius]; downshift to Haiku only if task is actually `mechanical` | `G_CTX_200`, `G_SEC`, `G_COMMIT`, `G_SANDBOX` | None by default; security surface → escalate to `security_review` (G_SEC); Codex-authored → Pattern 1 Claude review on handoff; worker tier under `architecture` orchestrator (Pattern 2) | Sonnet `medium` = official balanced default; reserve Opus 4.8 for blast-radius cases (see [cost-model.md](./cost-model.md)) |
| 9 | `mechanical` | `anthropic` · `claude-haiku-4-5` · `null` (fixed low) | `claude-sonnet-4-6` low [3× cost, still correct] → `claude-opus-4-6` low → `gpt-5.4-mini` low [cheap Codex leaf]; **never upgrade to Opus for mechanical work** | `G_CTX_200` | None (verifiable by inspection / deterministic command / schema). In map-reduce: Haiku is the **map** tier emitting constrained outputs (enum/bool/short-JSON) so reduce agent's context stays bounded | Fixed low — reasoning gap irrelevant; fleet cost floor; G_CTX_200 forces Sonnet fallback on overflow |
| — | `fallback_default` | `anthropic` · `claude-sonnet-4-6` · `medium`, read-only | `gpt-5.5` low [local deterministic inspection] → `claude-opus-4-8` high [high-risk ambiguity] | `G_DATA` | Ask orchestrator for narrower category if writes/side-effects implied | Never commits without a narrower category; if hard gate applies, do not fall back — route or halt per gate |

---

## Escalate / Switch Rules

> These rules are owned by [routing-contract.md](./routing-contract.md) §2 and §6. Summary: escalate within a provider on retry; switch providers only for capability fit; on adjacent-tier tie escalate one tier up.

## Cross-References

- Category definitions + classify signals → [work-categories.md](./work-categories.md)
- All $ figures, 1.4× inflation, effective-cost ladder → [cost-model.md](./cost-model.md)
- Gate trigger conditions, thresholds, gate-interaction examples → [hard-gates.md](./hard-gates.md)
- Synergy pattern mechanics (Patterns 1/2/4a/4b/5/7; anti-patterns A–E) → [synergy-patterns.md](./synergy-patterns.md)
- Model api-ids, benchmarks, risk flags → [model-profiles.md](./model-profiles.md)
- Machine-consumable form of this table → [assets/routing-table.json](./assets/routing-table.json)

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
