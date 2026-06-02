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
