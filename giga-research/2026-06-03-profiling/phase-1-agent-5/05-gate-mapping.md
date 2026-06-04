# 05 — Gate Mapping per Model+Effort
*Cross-ref: .spec/references/hard-gates.md. Retrieved 2026-06-03. Sources: ANTH-PRICING-2606, OAI-GPT55-2606, ANTH-RATELIMITS-2606.*

Gate IDs per hard-gates.md: G_MATH, G_CTX_200, G_CTX_272, G_CTX_400, G_CTX_1M, G_CTX_OUT,
G_SEC, G_COMMIT, G_SANDBOX, G_DATA, G_OPUS_LOCK.

## Context Gate Eligibility by Model

| Model | G_CTX_200 (>200K) | G_CTX_272 (>272K, cost-sensitive) | G_CTX_400 (>400K) | G_CTX_1M (>1M) |
|---|---|---|---|---|
| claude-opus-4-8 | eligible (1M window) | NOT triggered (no cliff) | eligible (1M window) | NOT triggered (1M context) |
| claude-opus-4-7 | eligible | NOT triggered | eligible | NOT triggered |
| claude-opus-4-6 | eligible | NOT triggered | eligible | NOT triggered |
| claude-sonnet-4-6 | eligible | NOT triggered | eligible | NOT triggered |
| claude-haiku-4-5 | **EXCLUDED** (200K window) | **EXCLUDED** | **EXCLUDED** | **EXCLUDED** |
| gpt-5.5 | eligible (1.05M window) | **TRIGGERS** (cliff applies) | eligible | NOT triggered |
| gpt-5.5-pro | eligible | **TRIGGERS** | eligible | NOT triggered |
| gpt-5.4 | eligible [INFERRED] | **TRIGGERS** [INFERRED] | eligible [INFERRED] | NOT triggered [INFERRED] |
| gpt-5.4-mini | **EXCLUDED** [INFERRED ~128K] | **EXCLUDED** | **EXCLUDED** | **EXCLUDED** |
| gpt-5.4-nano | **EXCLUDED** [INFERRED ~32K] | **EXCLUDED** | **EXCLUDED** | **EXCLUDED** |

G_CTX_272 note: applies when cost_sensitive=true AND input>272K. Redirect off gpt-5.5 to a
large-context member that doesn't have a cliff (Claude Opus/Sonnet 4.x). For math/proof tasks:
reduce evidence first; if irreducible → `needs_user`.

G_CTX_OUT (>64K output): Only claude-opus-4-8 and claude-opus-4-7 offer 128K output. All other
models cap at 64K standard (Sonnet 4.6, Haiku 4.5, gpt-5.5 family).

## G_OPUS_LOCK Applicability

| Model | Sampling locked | max_tokens floor at elevated effort | Notes |
|---|---|---|---|
| claude-opus-4-8 | YES | 65,536 | Default effort=high; no temp/top_p/top_k |
| claude-opus-4-7 | YES | 65,536 | Breaking change from 4.6 |
| claude-opus-4-6 | NO | N/A | Old tokenizer; temp/top_p/top_k accepted |
| claude-sonnet-4-6 | NO | N/A | Standard params accepted |
| claude-haiku-4-5 | NO | N/A | No extended thinking |
| gpt-5.5 | NO | N/A | Reasoning controlled via effort param |

## G_SEC Gate — Security Review Requirement

G_SEC fires when changes touch: auth, authz, crypto, concurrency, threading, deserialization,
secrets, filesystem, shell, network, ci_credentials.

**Independent cross-family review required before commit. Authoring family may NOT self-certify.**

| Model family | As author (G_SEC source) | As reviewer (G_SEC verifier) | Notes |
|---|---|---|---|
| Claude (any) | Requires OpenAI/Codex cross-review | Can review OpenAI/Codex output | Cross-family by construction |
| OpenAI/Codex (any) | Requires Claude cross-review | Can review Claude output | |

**gpt-5.5 specific**: Elevated cyber capability (71.4% expert tasks — AISI) means it CAN introduce
subtle exploitable patterns that GPT-5.5 self-review might miss (shared training distribution).
Strict G_SEC enforcement is critical. Do not relax.

**gpt-5.5 concurrency flag**: 170 threading bugs/mLOC (Sonar). Any async/threading diff from
gpt-5.5 MUST trigger G_SEC regardless of whether the surface is explicitly security-sensitive.

## G_COMMIT Gate

Applies when: action=commit AND changes_executable_or_source=true.
Requires: strongest available, cross-family, not-self checker at maximal effort.
Input: {proposed_diff, relevant_specs}. Output: {status, findings}.
Proceed only on `clear`. Block on `blocked`/`needs_user`/unresolved failures.

| Model | G_COMMIT role eligibility |
|---|---|
| claude-opus-4-8 (max effort) | Eligible checker for OpenAI-authored code |
| claude-opus-4-7 (max effort) | Eligible checker for OpenAI-authored code |
| gpt-5.5 (xhigh) | Eligible checker for Claude-authored code |
| claude-sonnet-4-6 (high) | Downgrade only when Opus unavailable; flag as degraded checker |
| claude-haiku-4-5 | NOT eligible for G_COMMIT (shallow reasoning risk) |
| gpt-5.4 (high) | Eligible for Claude-authored code when gpt-5.5 unavailable |
| gpt-5.4-mini / nano | NOT eligible for G_COMMIT |

## G_DATA Gate

G_DATA fires when data_class in {secret, regulated, owner-private}.
Halt unless approved boundary exists.

| Model | Cross-boundary (public/internal-low-risk) | Restricted (secret/regulated/owner-private) |
|---|---|---|
| All Claude models | OK | HALT — requires approved boundary |
| All OpenAI/Codex models | OK | HALT — requires approved boundary |

Key retention windows (unchanged from baseline):
- OpenAI: ≤30 days default abuse monitoring retention
- Anthropic: ≤30 days default auto-delete (ZDR applies only to eligible APIs with commercial org key)

Cross-provider key rule: NEVER expose cross-provider API credentials as repo-visible env in any
workflow running repo-controlled code.

## G_SANDBOX Gate

Fires when a member executes via a local harness (Claude Code, Codex CLI, etc.).
Default: write-restricted workspace sandbox. Full-access/bypass only inside externally hardened,
disposable, secret-free runner. Halt on sandbox-bypass ambiguity (H4).

| Surface | Default sandbox state |
|---|---|
| claude-code CLI | Write-restricted unless --dangerously-allow-approvals in hardened runner |
| codex CLI | Write-restricted; full-access bypass only in approved runner |
| API (no CLI harness) | G_SANDBOX does not apply (no local execution) |

## Summary Gate Matrix (effort rows, model columns)

Gates that ALWAYS apply regardless of effort: G_SEC (surface-triggered), G_COMMIT (commit-triggered),
G_DATA (data-class-triggered), G_SANDBOX (harness-triggered).
Gates that ALWAYS apply to gpt-5.5: G_CTX_272 when cost_sensitive + input>272K.
Gates that apply to Haiku 4.5: G_CTX_200 excludes it above 200K; G_CTX_400 excludes it.
G_OPUS_LOCK: applies Opus 4.7/4.8 at elevated effort (max_tokens ≥ 65,536 required).
