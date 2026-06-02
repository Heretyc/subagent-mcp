# routing-contract.md — The 3-Step Routing Contract

**Load when:** implementing or debugging the routing feature; need to understand evaluation order,
precedence, halt conditions, or the input envelope. One-screen summary — all gate thresholds and
category definitions are in cross-referenced leaves.

**Do not load when:** you only need a category definition (→ `./work-categories.md`) or the
per-category route table (→ `./routing-table.md`).

---

## 1. The Contract (three deterministic steps, in order)

```
STEP 1: APPLY GLOBAL HARD GATES (→ ./hard-gates.md)
        Gates override any category default. Evaluate ALL gates; most-restrictive wins.

STEP 2: CLASSIFY into exactly ONE work category (→ ./work-categories.md)
        Walk the precedence order — FIRST match wins.
        If no category reaches confidence → fallback_default.

STEP 3: EMIT  { provider, model, effort }  +  fallback chain  +  validation pattern
        (→ ./routing-table.md for the full per-category table)
```

No model reasoning is used to route. Gates and classification are deterministic lookups.

---

## 2. Precedence Order (verbatim — all builders use this exact string)

```
math_proof > security_review > architecture > quality_review >
debugging > agentic_execution > knowledge_synthesis > coding > mechanical
```

Then `fallback_default` if nothing matches.

**Adjacent-tie escalation rule:** when genuinely uncertain between two *adjacent* tiers, escalate
one tier up. Under-powering high-blast-radius work costs more than the extra tokens. [INFERRED]

---

## 3. Input Envelope Fields

The router accepts this envelope; all fields except `prompt` are optional but improve gate accuracy.

| Field | Type | Purpose |
|---|---|---|
| `prompt` | string | The request text (required) |
| `work_category` | string? | Pre-classified category id (skip step 2 if present + confident) |
| `est_input_tokens` | int? | Enables G_CTX_* gates (→ ./hard-gates.md) |
| `est_output_tokens` | int? | Enables G_CTX_OUT gate (→ ./hard-gates.md) |
| `cost_sensitive` | bool? | Activates G_CTX_272 redirect off GPT-5.5 |
| `data_class` | enum? | `public / internal / confidential / secret / regulated / owner-private` |
| `is_math_or_proof` | bool? | Forces G_MATH regardless of category |
| `touches` | string[]? | Security-surface tags; activates G_SEC if `author_family==openai` |
| `author_family` | enum? | `anthropic / openai` — which provider produced the artifact |
| `action` | enum? | `commit / review / execute / ...` — activates G_COMMIT if `commit` |

---

## 4. Output Envelope

```json
{
  "provider":  "<provider id>",
  "model":     "<model api-id>",
  "effort":    "<effort level or null>",
  "fallback":  [{ "provider": "...", "model": "...", "effort": "..." }],
  "gates_fired": ["<gate id>", ...],
  "validation_pattern": "<pattern id or null>",
  "category":  "<canonical category id>",
  "status":    "ok | blocked | needs_user"
}
```

Blocked/needs_user means **no writes proceed.** See halt conditions below.

---

## 5. Halt-and-Surface Conditions (stop, no writes)

Full definitions in `./governance-halts.md`. Summary form:

| # | Trigger | Status |
|---|---|---|
| H1 | Mandated checker unavailable, or mandated provider/route unavailable | `blocked` |
| H2 | Secret/credential exposure, or destructive/irreversible/external-side-effect ambiguity | `blocked` |
| H3 | Identity/authorization uncertainty, or spec vs prompt vs policy conflict | `needs_user` |
| H4 | Sandbox-bypass requested in a non-hardened (mixed-trust) workspace | `blocked` |
| H5 | Evidence the pipeline is compounding errors (retries obscuring state) | `needs_user` |

Never degrade to a weaker checker when the mandated checker is unavailable — halt instead.

---

## 6. Key Invariants

- **Gate-first, always.** A gate can override a category's primary route but never relaxes a
  mandatory validation.
- **First-match wins.** Walk the precedence order; stop at first confident match.
- **No routing model reasoning.** The only optional model call in routing is the category
  classifier (Haiku @ low effort emitting one category id).
- **Escalate within provider for retry; switch providers only for capability fit.** [INFERRED] (canonical rule → `./routing-table.md`)
- **Reviewer family ≠ generator family.** Anti-Pattern D. See `./routing-table.md` synergy column.
- **Never average conflicting outputs.** Pick one per the authoritative spec (Sanity Rule 7).
- **subagent-mcp feature tie:** this contract is the behavioral specification the feature loads
  at runtime via `./assets/routing-table.json`.

---

*Cross-refs: `./work-categories.md` · `./routing-table.md` · `./hard-gates.md` · `./governance-halts.md`*

---

Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026
