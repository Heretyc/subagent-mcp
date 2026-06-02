# phase-2-synthesis.md — Flagship Synthesis + Canonical Merge

**Load when:** running Phase 2. Prereq: 5 research files + persisted interview answers.

---

## Phase 2 — 5 independent flagship syntheses

Dispatch **5 max-effort flagship synthesizers**, **mixed provider**: Opus at max/xhigh effort +
Codex GPT at `xhigh`, all launched via `mcp__subagent-mcp__launch_agent`
(`provider: claude|codex`; see `dispatch-mechanics.md`). Each synthesizer **independently** produces a
full synthesis organized around the **work-category taxonomy** (see `category-derivation.md` for
the exact count and criteria; do NOT hardcode a category count here) — i.e., for each category it
states the recommended `{provider, model, effort}`, the gates that fire, the synergy pattern, cost
note, and risk flags, **with the new model reconciled in**. Each reads:

- all five `giga-research/phase-1-agent-*.md`,
- the persisted interview answers (binding),
- the current `.spec/references/` routes (so output is a delta, not a rewrite).

Each writes to `giga-research/phase-2-synth-{1..5}.md` and returns JSON only.

> Independence matters: do **not** have synthesizers read each other's drafts. Divergence between
> the five is the signal the merge step reconciles. Never average conflicting outputs
> (Anti-Pattern B) — the merge picks the best-sourced position and records why.

### Dual output requirement

Each synthesizer must emit **both**:

1. **Routing synthesis** — per-category `{provider, model, effort}` recommendations, gates, synergy
   patterns (as before).
2. **Tier-ordering inputs for provider.json** — for each category: the ordered list of model+effort
   pairings (best→worst) with the raw normalized-benchmark composite that supports the ordering, plus
   the cost figure per pairing (sourced from `cost-model.md` methodology). These inputs feed the
   merge step's `provider.json` emission path.

If a synthesizer cannot produce tier-ordering inputs (e.g., insufficient benchmark coverage), it must
surface that as a gap in its JSON `risks` field — not silently omit the section.

### Synthesizer prompt skeleton

```
<this is a request from a parent process>
ROLE: Phase-2 flagship synthesizer K (independent).
INPUT: giga-research/phase-1-agent-1..5.md + interview answers (binding) + current
  .spec/references routes + category-derivation.md (taxonomy criteria).
TASK: produce (a) a complete routing synthesis around the taxonomy categories, reconciling new
  model <names>; state per-category {provider, model, effort}, gates, synergy pattern, cost note,
  risks; AND (b) for each category, the ordered model+effort pairings (best→worst) with raw
  normalized-benchmark composites + cost figures per pairing. Cite ORIGINAL sources; label claims.
  Flag every place the new model changes the current route and WHY.
WRITE full synthesis to %TEMP% then giga-research/phase-2-synth-K.md.
RETURN ONLY JSON {status, summary, source_locators, risks, writes_requested}.
```

## Canonical merge

Dispatch **one** flagship (Opus, max effort) to **MERGE** the five syntheses into a single
canonical core, written to `giga-research/phase-2-core-synthesis.md`. The merger:

- Reconciles divergences using the **authority chain** (interview decisions > vendor docs/verified
  benchmarks > seed hypotheses), never by averaging.
- Produces, for each conflict, a numbered reconciliation (CR-style) with the resolution and any
  residual uncertainty — these become entries in `decision-rationale.md`.
- Emits the canonical per-category routing decisions that DECOMPOSE/UPDATE will write into the KB.
- Decides whether the **category taxonomy itself shifts** (new category, merge, rename) because of
  the new model. If so, it flags a manifest re-architecture for the next phase.
- **Emits the following merger outputs explicitly** (required for the provider.json path):
  1. The canonical N-category spine (category names + ordering), derived per `category-derivation.md`.
  2. The **total old→new category mapping** — every current category + `fallback_default` explicitly
     mapped to a new category, recorded as merged/renamed/dropped with rationale (CR-style). None
     dropped silently.
  3. The **math/security decision**: whether math and security are first-class categories or
     orthogonal gate-modifiers, with rationale recorded in `decision-rationale.md`.
  4. The **per-category ordered model+effort pairings** (performance branch input) — the composite
     ordering for each category, resolved from the five synthesizers' tier-ordering inputs.
  5. The **cost figures per pairing** (cost_efficiency branch input) — sourced from `cost-model.md`,
     with gaps labelled `[ASSUMPTION]`/`[UNVERIFIED]`.

The merger is a **fresh** flagship distinct from the five producers (self-review ban).

### Checkpoint before DECOMPOSE/UPDATE

Confirm: 5 synthesis files + 1 core synthesis on disk; the core lists per-category routes and an
explicit "taxonomy stable" or "taxonomy shifts: …" verdict; all five merger outputs above are
present; conflicts are reconciled (not averaged). Then load `decompose-update.md`.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
