# hard-gates.md — Global Hard Gates

**Load when:** implementing gate evaluation; verifying thresholds; understanding when a route is
overridden; debugging a `blocked` or `needs_user` status.

**Do not load when:** you only need category definitions (→ `./work-categories.md`) or the
per-category route table (→ `./routing-table.md`).

Gates are **impartial policies** — they state *what must happen*, layered over the object-of-work
tile. No gate names or implies a provider, model, effort, or route; each de-names to a capability,
handling, or process requirement. Gate IDs and numeric thresholds are stable identifiers.

---

## Evaluation Order & Rule

Evaluate ALL gates before routing. The most-restrictive applicable gate wins. Gates override
category defaults but **never relax** a mandatory validation. Full routing contract: `./routing-contract.md`.

Three gates are **category-coupled** (`G_MATH`→`math_proof`, `G_SEC`→`security_review`,
`G_COMMIT`→`quality_review`); the rest are **cross-cutting** modifiers. None is a category.

---

## Gate Table

| Gate ID | Trigger condition | Action (impartial policy) |
|---|---|---|
| **G_MATH** | `category == math_proof` OR `is_math_or_proof == true` | Route the proof/derivation core to the member that maximizes deductive/symbolic validity, at elevated reasoning effort (escalated to maximal for adversarial/long derivations). **Overrides benchmark inference** for the proof core. Subject to the context-size gates. |
| **G_CTX_200** | `est_input_tokens > 200 000` | Exclude members whose context window cannot hold the input; restrict to large-context-capable members. |
| **G_CTX_272** | `est_input_tokens > 272 000` AND `cost_sensitive == true` | Redirect off any member subject to the high-context price cliff to large-context members. If a math/proof core is irreducible below the cliff → reduce evidence with a large-context member first; if reduction would change validity → `needs_user`. Price-cliff numbers → `./cost-model.md`. |
| **G_CTX_400** | `est_input_tokens > 400 000` | Exclude any locally-context-capped execution harness; route to a full-large-context member. |
| **G_CTX_1M** | `est_input_tokens > 1 000 000` | No single-route call. Mandate split / retrieve / map-reduce before routing. |
| **G_CTX_OUT** | `est_output_tokens > 64 000` | Restrict to the member(s) offering the extended output ceiling; all other members cap at the standard output limit. |
| **G_SEC** | `changes_touch_any:[auth, authz, crypto, concurrency, threading, deserialization, secrets, filesystem, shell, network, ci_credentials]` | No member self-certifies its own work on a sensitive surface. Require an **independent cross-family** security review whose verdict is rendered by a member **NOT in the authoring family**, before commit. The authoring family may triage but may not self-clear. |
| **G_COMMIT** | `action == commit` AND `changes_executable_or_source == true` | Require a separate checker: strongest available, cross-family, not-self, at maximal effort. Input `{proposed_diff, relevant_specs}`; output `{status, findings}`. Proceed only on `clear`. Block on `blocked` / `needs_user` / unresolved test failures / unexplained AI-generated changes. **If no qualified checker is available → HALT, tell owner.** Never degrade to a weaker checker. |
| **G_SANDBOX** | A member executes via a local harness | Default to a write-restricted workspace sandbox. Full-access / approval-bypass only inside an externally hardened, disposable, secret-free runner. **Halt on any sandbox-bypass ambiguity** (→ halt condition H4, `./governance-halts.md`). |
| **G_DATA** | `data_class in [secret, regulated, owner-private]` | Classify data sensitivity before routing. Halt unless an approved boundary exists. Only `public` / `internal-low-risk` may cross provider boundaries freely. Never expose any cross-provider API credential as repo-visible env. Retention windows → `./governance-halts.md`. |
| **G_OPUS_LOCK** | A sampling-locked member is selected | Member-config policy (NOT task routing): do not set the forbidden sampling params (hard API error); at elevated/maximal effort set the output-token floor high enough to avoid reasoning truncation (`max_tokens >= 65 536`). **Recommended to relocate out of the impartial routing layer into the member-profile/config layer.** |

---

## Threshold Summary

| Threshold | Gate | Effect (impartial) |
|---|---|---|
| 200 000 input tokens | G_CTX_200 | Exclude below-threshold-context members |
| 272 000 input tokens + cost-sensitive | G_CTX_272 | Redirect off the price-cliff member |
| 400 000 input tokens | G_CTX_400 | Exclude the locally-context-capped harness |
| 1 000 000 input tokens | G_CTX_1M | No single route; split first |
| 64 000 output tokens | G_CTX_OUT | Extended-output-capable member(s) only |
| sampling-locked member | G_OPUS_LOCK | `max_tokens >= 65 536` at elevated/maximal effort |

---

## Gate-Interaction Examples

1. **`knowledge_synthesis`, 300K context, cost-sensitive** → G_CTX_200 excludes
   below-threshold-context members; G_CTX_272 redirects off the price-cliff member. The
   large-context primary stands.

2. **`math_proof`, 300K context, cost-sensitive** → G_MATH mandates the deductive-validity-strongest
   member; G_CTX_272 redirects off the price-cliff member. Reduce evidence with a large-context
   member first, then send the proof core to the strongest deductive member; if irreducible →
   `needs_user` (surface: the large-context member may not be the strongest proof member;
   verification required).

3. **`agentic_execution`, 450K context** → G_CTX_400 excludes the locally-context-capped harness;
   fall back to a full-large-context member per the fallback chain in `./routing-table.md`.

---

## Security Cross-Review Scope (G_SEC surface list)

`auth` · `authz` · `crypto` · `concurrency` · `threading` · `deserialization` · `secrets` ·
`filesystem` · `shell` · `network` · `ci_credentials`

The verdict on any change touching these surfaces must come from a member **not in the authoring
family** before commit (G_SEC). The authoring family may triage but may not self-certify. This is
impartial by construction: it names roles (author / independent verifier), never a specific member.

---

*Cross-refs: `./routing-contract.md` · `./cost-model.md` · `./governance-halts.md` · `./model-profiles.md`*

---

Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026
