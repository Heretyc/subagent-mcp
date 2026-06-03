# routing-contract.md — The 3-Step Routing Contract

**Load when:** implementing or debugging the routing feature; need to understand evaluation order,
precedence, halt conditions, or the input envelope. One-screen summary — all gate thresholds and
category definitions are in cross-referenced leaves.

**Do not load when:** you only need a category definition (→ `./work-categories.md`) or the
per-category route table (→ `./routing-table.md`).

Classification is a **pure task-shape language task** — it inspects the request's deliverable,
cognitive demand, and verification mode. No provider, model, effort, or route is named or implied
in this contract; routing emits an abstract `{provider, model, effort}` only at Step 3 via the
route table.

---

## 1. The Contract (three deterministic steps, in order)

```
STEP 1: APPLY GLOBAL HARD GATES (→ ./hard-gates.md)
        Gates are impartial policies; they override any category default.
        Evaluate ALL gates; most-restrictive wins.

STEP 2: CLASSIFY into exactly ONE work category (→ ./work-categories.md)
        Walk the precedence order — FIRST match wins (most-specific-signal-first).
        If no category reaches confidence → fallback_default.

STEP 3: EMIT  { provider, model, effort }  +  fallback chain  +  validation pattern
        (→ ./routing-table.md for the full per-category table)
```

No model reasoning is used to route. Gates and classification are deterministic lookups over task
shape.

---

## 2. Precedence Order (verbatim — all builders use this exact string)

```
math_proof > security_review > debugging > quality_review > architecture >
agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical
```

Then `fallback_default` @ precedence 99 if nothing matches (off-spine; never overrides a hard gate).

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
| `cost_sensitive` | bool? | Activates G_CTX_272 redirect off the price-cliff member |
| `data_class` | enum? | `public / internal / confidential / secret / regulated / owner-private` |
| `is_math_or_proof` | bool? | Forces G_MATH regardless of category |
| `touches` | string[]? | Security-surface tags; activates G_SEC (cross-family verdict required) |
| `author_family` | enum? | The authoring provider family — enables cross-family / not-self checks (G_SEC, G_COMMIT) |
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
| H1 | Mandated checker unavailable, or mandated capability/route unavailable | `blocked` |
| H2 | Secret/credential exposure, or destructive/irreversible/external-side-effect ambiguity | `blocked` |
| H3 | Identity/authorization uncertainty, or spec vs prompt vs policy conflict | `needs_user` |
| H4 | Sandbox-bypass requested in a non-hardened (mixed-trust) workspace | `blocked` |
| H5 | Evidence the pipeline is compounding errors (retries obscuring state) | `needs_user` |

Never degrade to a weaker checker when the mandated checker is unavailable — halt instead.

---

## 6. Classification Boundary Tests (adjacent pairs — one crisp discriminator each)

First-match resolves true dual-matches to the narrower object. These discriminators (from the
taxonomy §F) do the real disambiguation; precedence is the tie-break backstop.

| Pair | Discriminating signal |
|---|---|
| `math_proof` ↔ `security_review` | Verified by **deductive/symbolic proof-validity** → `math_proof`. By **adversarial exploitability** against a target → `security_review`. |
| `security_review` ↔ `debugging` | **Adversarial vuln/threat assessment** (exploitability-checked) → `security_review`. A **non-security observed failure** to fix → `debugging`. |
| `debugging` ↔ `quality_review` | An **observed failure/symptom** (verified by no-longer-reproducing) → `debugging`. **Unprompted verdict** on a candidate → `quality_review`. |
| `quality_review` ↔ `architecture` | **Verdict on an existing candidate** (incl. an existing design doc) → `quality_review`. **Production of a new design/plan** → `architecture`. |
| `architecture` ↔ `agentic_execution` | **Design/plan produced without acting** (no code artifact, no loop) → `architecture`. **Target end-state reached by acting/iterating** → `agentic_execution`. |
| `agentic_execution` ↔ `data_analysis` | Scored by a **harness end-state/submission** via iteration in a mutating env → `agentic_execution`. By **correctness of a finding about a dataset** (even if code runs) → `data_analysis`. |
| `data_analysis` ↔ `coding` | Object of work is a **dataset** (deliverable = finding/model about it) → `data_analysis`. A **reusable code artifact** → `coding`. |
| `coding` ↔ `knowledge_synthesis` | A **runnable/bounded code artifact** (compile/test-verifiable) → `coding`. **Novel integrated prose** over sources → `knowledge_synthesis`. |
| `knowledge_synthesis` ↔ `mechanical` | **Substantive novel integration/reasoning** → `knowledge_synthesis`. **Deterministic single-pass transform**, exact-match verified → `mechanical`. |

Key non-adjacent tie-breaks: `math_proof` fires first whenever primary verification is proof-validity
(else host tile + `G_MATH`). `debugging` ↔ `coding`: observed-failure precondition → `debugging`, else
greenfield → `coding`. `coding` ↔ `mechanical`: substantive reasoning/design → `coding`, deterministic
edit/transform → `mechanical`. `agentic_execution` ↔ `mechanical`: any tool/function invocation (even
one call) → `agentic_execution`, pure transform → `mechanical`.

---

## 7. Key Invariants

- **Gate-first, always.** A gate can override a category's primary route but never relaxes a
  mandatory validation.
- **First-match wins.** Walk the precedence order; stop at first confident match.
- **No routing model reasoning.** The only optional model call in routing is the category
  classifier emitting one category id — a pure task-shape language task; no member is named to it.
- **Escalate within capability tier for retry; switch families only for capability fit.** [INFERRED]
  (canonical rule → `./routing-table.md`)
- **Reviewer family ≠ generator family.** Anti-Pattern D. See `./routing-table.md` synergy column.
- **Never average conflicting outputs.** Pick one per the authoritative spec (Sanity Rule 7).
- **subagent-mcp feature tie:** this contract is the behavioral specification the feature loads
  at runtime via `./assets/routing-table.json`.

---

*Cross-refs: `./work-categories.md` · `./routing-table.md` · `./hard-gates.md` · `./governance-halts.md`*

---

Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026
