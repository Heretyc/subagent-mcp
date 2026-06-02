# category-derivation.md — Procedure for Deriving the 10 Agentic Categories

**Load when:** a run reaches the category-derivation step (Phase 1.5 / Phase 2 merge). This leaf
encodes the criteria and self-validation rules. It does NOT contain the actual category names or
final taxonomy — those are produced by the run and recorded in `decision-rationale.md`.

---

## Derivation Criteria (all must hold)

| # | Criterion | Enforcement |
|---|---|---|
| 1 | **Exactly 10** categories — no fewer, no more | Run rejects any result outside this count |
| 2 | **Generic-agentic** — each category is a provider-neutral task shape, not a product/model quirk | No vendor names in category ids |
| 3 | **MECE / tiling** — categories are mutually exclusive and collectively exhaustive over the agentic work surface | Verify: every prompt in the scenario suite routes to exactly one category |
| 4 | **Routing-usable** — each category maps unambiguously to a provider + model + effort default | Verified by scenario routing tests (§ Self-Validation) |
| 5 | **Gate-preservation** (below) — every hard gate ID survives | Required; see Gate-Preservation section |

---

## Gate-Preservation Requirement

Every hard gate from `hard-gates.md` MUST survive the taxonomy change as either a **first-class
category** (the gate's trigger condition aligns with one category) or an **orthogonal modifier**
(applied on top of any category). Gate IDs are never silently renamed; any unavoidable rename is
recorded in `decision-rationale.md` with old→new.

| Gate ID | Must survive as |
|---|---|
| `G_MATH` | Category OR modifier on any category where `is_math_or_proof == true` |
| `G_SEC` | Category OR modifier on any category where `author_family == openai` + sensitive touch surface |
| `G_CTX_200`, `G_CTX_272`, `G_CTX_400`, `G_CTX_1M`, `G_CTX_OUT` | Orthogonal modifiers (context-size gates remain independent of category) |
| `G_COMMIT` | Orthogonal modifier (applies to any commit action regardless of category) |
| `G_SANDBOX` | Orthogonal modifier (applies to any OpenAI route) |
| `G_DATA` | Orthogonal modifier (applies to any data-sensitive call) |
| `G_OPUS_LOCK` | Orthogonal modifier (applies whenever Opus 4.7/4.8 is the routed model) |

---

## Math / Security: Category-vs-Modifier Decision

The run MUST decide and record one of two postures for each of math and security:

- **Category posture:** math (or security) becomes one of the 10 categories; its gate becomes a
  routing default for that category.
- **Modifier posture:** math (or security) is not a standalone category; its gate fires as a
  cross-cutting override on top of whichever category the task routes to.

Decision is binding and recorded in `decision-rationale.md` with rationale (coverage, MECE
impact, routing clarity). Both may not be silently omitted — if neither works cleanly, surface
`needs_user`.

---

## Total Old→New Mapping

None of the current 9 categories — `math_proof`, `security_review`, `architecture`,
`quality_review`, `debugging`, `agentic_execution`, `knowledge_synthesis`, `coding`,
`mechanical` — plus `fallback_default` may be silently dropped. Each must be explicitly:

- **Mapped:** old id → new id (one-to-one or merged into one of the 10), OR
- **Renamed:** recorded with old id, new id, rationale, OR
- **Merged:** recorded as N-old → 1-new, with rationale for collapse.

Record the full mapping table in `decision-rationale.md` in CR-style (old id, disposition,
new id, rationale). Orphan check: every old id appears exactly once in the mapping.

**`fallback_default` disposition:** retain as a routing catch-all at precedence 99. It is not
one of the 10 categories; it is a routing safety net that fires after all category and gate
evaluation fails. Record its retention explicitly in `decision-rationale.md`.

---

## Self-Validation Procedure

After the run produces its taxonomy, validate before writing any RAG leaf:

1. **Validator constants** — update `EXPECTED_CATEGORIES` and `EXPECTED_PRECEDENCE` in
   `validate_kb.py`; run `python -m py_compile` to confirm syntax.
2. **JSON↔MD spine mirror** — `assets/routing-table.json` category keys must match
   `work-categories.md` ids exactly and in the same order; `validate_kb.py` enforces this.
3. **Orphan-free mapping** — every old id in the mapping table resolves to exactly one new id;
   run the orphan check before committing.
4. **Scenario routing tests** (≥6 scenarios, must include):
   - A pure math/proof task → confirm `G_MATH` fires regardless of which category it routes to.
   - A GPT-5.5-authored security-sensitive task → confirm `G_SEC` fires and verdict is Claude's.
   - A fallback prompt that matches no category → confirm `fallback_default` catches it at
     precedence 99.
   - At least 3 additional scenarios covering spread across the 10 categories.
5. All 4 checks must PASS before the taxonomy is locked and downstream RAG writes begin.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
