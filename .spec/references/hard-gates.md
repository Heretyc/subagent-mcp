# hard-gates.md — Global Hard Gates

**Load when:** implementing gate evaluation; verifying thresholds; understanding when a route is
overridden; debugging a `blocked` or `needs_user` status.

**Do not load when:** you only need category definitions (→ `./work-categories.md`) or the
per-category route table (→ `./routing-table.md`).

---

## Evaluation Order & Rule

Evaluate ALL gates before routing. The most-restrictive applicable gate wins. Gates override
category defaults but **never relax** a mandatory validation. Full routing contract: `./routing-contract.md`.

---

## Gate Table

| Gate ID | Trigger condition | Action |
|---|---|---|
| **G_MATH** | `category == math_proof` OR `is_math_or_proof == true` | Force `{provider:openai, model:gpt-5.5, effort:high}`; `xhigh` for adversarial/long derivations. **Overrides benchmark inference** (mandate, Interview Q10). Subject to G_CTX_272. |
| **G_CTX_200** | `est_input_tokens > 200 000` | Exclude `claude-haiku-4-5`. Allow: `claude-opus-4-8`, `claude-sonnet-4-6` (both 1M context). |
| **G_CTX_272** | `est_input_tokens > 272 000` AND `cost_sensitive == true` | Mandatory redirect **off GPT-5.5** (price cliff: 2× input / 1.5× output for the full session above 272K). Route to `claude-opus-4-8` / `claude-sonnet-4-6`. If math/proof is irreducible below the cliff → reduce evidence with Claude first; if reduction would change validity → `needs_user`. Price cliff numbers → `./cost-model.md`. |
| **G_CTX_400** | `est_input_tokens > 400 000` | Exclude Codex harness (local fleet cap). Route to Claude 1M-context model. Note: GPT-5.5 *API* reaches 1.05M but the local fleet uses Codex at 400K (§11 reconciliation). |
| **G_CTX_1M** | `est_input_tokens > 1 000 000` | No single-route call. Split / retrieve / map-reduce before routing. |
| **G_CTX_OUT** | `est_output_tokens > 64 000` | Route to `claude-opus-4-8` only (128K output). All other models cap at 64K. |
| **G_SEC** | `author_family == openai` AND `touches_any:[auth, authz, crypto, concurrency, deserialization, secrets, filesystem, shell, network, ci_credentials]` | Require cross-review: `{provider:anthropic, model:claude-opus-4-8, min_model:claude-sonnet-4-6, before:commit}`. Forbid GPT-5.5 self-review. Initial triage may run on GPT-5.5; **verdict is Claude's**. GPT-5.5 documented risk evidence → [failure-modes.md](./failure-modes.md). |
| **G_COMMIT** | `action == commit` AND `changes_executable_or_source == true` | Require separate checker: strongest available model, `effort:max`, cross-family, not-self. Input `{proposed_diff, relevant_specs}`; output `{status, findings}`. Proceed only on `clear`. Block on `blocked` / `needs_user` / unresolved test failures / unexplained [agentic mention removed] changes. **If checker unavailable → HALT, tell owner.** Never degrade to a weaker checker. |
| **G_SANDBOX** | `provider == openai` (Codex) | Default sandbox: `workspace-write`. `danger-full-access` / `--dangerously-bypass-approvals-and-sandbox` only inside an externally hardened, disposable, secret-free runner. **Halt on any sandbox-bypass ambiguity** (→ halt condition H4, `./governance-halts.md`). |
| **G_DATA** | `data_class in [secret, regulated, owner-private]` | Halt unless approved boundary. Classify data before routing. Only `public` / `internal-low-risk` may cross providers freely. Never set `OPENAI_API_KEY` / `CODEX_API_KEY` as repo-visible env. Retention windows → [governance-halts.md](./governance-halts.md). |
| **G_OPUS_LOCK** | `model in [claude-opus-4-7, claude-opus-4-8]` | Forbid `temperature`, `top_p`, `top_k`, `budget_tokens` (400 error). At `xhigh` / `max` effort: set `max_tokens >= 65 536` or reasoning truncates. |

---

## Threshold Summary

| Threshold | Gate | Effect |
|---|---|---|
| 200 000 input tokens | G_CTX_200 | Exclude Haiku |
| 272 000 input tokens + cost-sensitive | G_CTX_272 | Off GPT-5.5 |
| 400 000 input tokens | G_CTX_400 | Off Codex harness |
| 1 000 000 input tokens | G_CTX_1M | No single route; split first |
| 64 000 output tokens | G_CTX_OUT | Opus 4.8 only |
| 64K / 128K out (Opus sampling) | G_OPUS_LOCK | `max_tokens >= 65 536` at xhigh/max |

---

## Gate-Interaction Examples

1. **`knowledge_synthesis`, 300K context, cost-sensitive** → G_CTX_200 excludes Haiku; G_CTX_272
   pushes off GPT-5.5 (irrelevant — primary is already Opus 4.8). Opus 4.8 `high` stands.

2. **`math_proof`, 300K context, cost-sensitive** → G_MATH mandates GPT-5.5; G_CTX_272 overrides
   back to Claude. Reduce evidence with Claude first, then send proof core to GPT-5.5; if
   irreducible → `needs_user` (surface: Opus is not the strongest proof model, verification required).

3. **`agentic_execution`, 450K context** → G_CTX_400 excludes Codex harness; fall back to
   Claude 1M-context model (Opus 4.8 xhigh per fallback chain in `./routing-table.md`).

---

## Security Cross-Review Scope (G_SEC surface list)

`auth` · `authz` · `crypto` · `concurrency` · `threading` · `deserialization` · `secrets` ·
`filesystem` · `shell` · `network` · `ci_credentials`

GPT-5.5 documented weak spots: CWE-732 file-permission handling, concurrency bugs (~170/mLOC),
hallucinated API signatures. Sources (see [source-ledger.md](./source-ledger.md)): `SONAR-2026`, `ENDOR-2026`, `AISI-2026`.
Full failure-mode evidence → [failure-modes.md](./failure-modes.md). Model profiles → [model-profiles.md](./model-profiles.md).

---

*Cross-refs: `./routing-contract.md` · `./cost-model.md` · `./governance-halts.md` · `./model-profiles.md`*

---

Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026
