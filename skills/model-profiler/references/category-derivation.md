# category-derivation.md — Fixed Taxonomy (pointer leaf)

**Load when:** any phase references "the categories." This leaf exists as a stable back-link target.
Its former derive-the-categories content is **superseded**: the taxonomy is now **fixed and
immutable**, and this skill profiles models **against** it — it never derives, chooses, renames,
reorders, merges, or reshuffles categories.

---

## The FIXED canonical 10 (immutable)

Precedence order (first-match-wins, most-specific-signal-first):

```
math_proof > security_review > debugging > quality_review > architecture >
agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical
```

`fallback_default` @ precedence 99 — off-spine no-match catch-all; never one of the 10; never
overrides a hard gate. Math and security are **categories** (each paired with a coupled
modifier, `G_MATH` / `G_SEC`); multimodal is the cross-cutting `perception_required` **modifier**,
not a tile.

## Where the detail lives

| You need… | Read |
|---|---|
| Operational definitions of each category (signals, examples, boundaries, findability) + the cross-cutting modifiers/gates | `.spec/references/work-categories.md` |
| Determination methodology — how the fixed 10 were derived | `docs/spec/task-taxonomy/derivation-methodology.md` |
| Determination rationale + debate provenance (the ratified adversarial-debate record, old→new mapping, honest weaknesses) | `docs/spec/task-taxonomy/determination-rationale.md` |
| The per-category benchmark-family map (which benchmarks measure which category) | `references/benchmark-sources.md` |

## What this means for a run

- Treat the 10 + `fallback_default`@99 as a **given input**. Do not re-derive, re-validate, or
  re-rank the categories themselves.
- If a run surfaces evidence the taxonomy itself is wrong (a genuinely homeless task shape, a broken
  boundary), **surface it to the owner as `needs_user`** — taxonomy change happens in
  `docs/spec/task-taxonomy/`, never inside this skill.
- Every Phase-2 judgment and the merged core must map each model+effort pairing onto exactly one of
  the fixed categories (or `fallback_default`@99); the spine is read, never written.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — June 2026*
