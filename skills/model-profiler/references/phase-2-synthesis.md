# phase-2-synthesis.md — Flagship Judging + Canonical Merge

**Load when:** running Phase 2. Prereq: the Phase-1 discovery roster + benchmark files + persisted
interview answers exist on disk.

---

## Phase 2 — independent flagship judges

Dispatch **several flagship-judging members at elevated/maximal effort**, **cross-family**, all
launched via `mcp__subagent-mcp__launch_agent` (the `provider:` field is set per
`dispatch-mechanics.md`; the operator binds the concrete family — the skill names none). Scale the
count with the Phase-0 mode.

Each judge **independently** ARBITRATES the Phase-1 discovered research into rankings organized around
the **FIXED 10 categories** (`.spec/references/work-categories.md`; the count is fixed at 10 +
`fallback_default`@99 — do not derive, add, drop, rename, or reorder it). For each fixed category the
judge states the recommended `{provider, model, effort}`, the gates that fire, the synergy pattern,
cost note, and risk flags — with every newly discovered pairing placed. Each reads:

- all `giga-research/phase-1-agent-*.md` (discovery roster + benchmarks),
- the persisted interview answers (binding),
- the current `.spec/references/` rankings — **to diff and flag what changed, never to inherit**. The
  ranking is re-derived **solely** from the discovered research (Invariant: impartial judging).

Each writes to `giga-research/phase-2-synth-{K}.md` and returns JSON only.

> Independence matters: do **not** have judges read each other's drafts. Divergence between them is
> the signal the merge step reconciles. Never average conflicting outputs (Anti-Pattern B) — the
> merge picks the best-sourced position and records why.

### Dual output requirement

Each judge must emit **both**:

1. **Routing judgment** — per-category recommended `{provider, model, effort}`, gates, synergy
   patterns.
2. **Tier-ordering inputs for routing-table.json** — for each fixed category: the ordered list of
   model+effort pairings (best→worst) with the normalized-benchmark composite that supports the
   ordering, the cost figure per pairing (sourced from `cost-model.md` methodology), **and a
   one-line rationale per tier placement** citing the backing benchmark(s). These feed the merge
   step's emission path.
   Each pairing's tier input must carry its **audit citations**: the `{url, retrieved_at, annotation}`
   records (from Phase 1 `source_locators`) for every source backing that pairing's ordering. These
   propagate unchanged into `routing-table-audit.json`; a pairing with no audit citation blocks emission.

If a judge cannot produce tier-ordering inputs (e.g., insufficient benchmark coverage), it must
surface that as a gap in its JSON `risks` field — not silently omit the section.

### Judge prompt skeleton

```
<this is a request from a parent process>
ROLE: Phase-2 flagship judge K (independent). Impartial — rank SOLELY from the discovered research.
INPUT: giga-research/phase-1-agent-*.md (discovery roster + benchmarks) + interview answers (binding)
  + FIXED taxonomy (.spec/references/work-categories.md) + current .spec/references rankings (DIFF only).
TASK: produce (a) a per-category routing judgment over the FIXED 10 categories, placing every
  discovered pairing; state per-category {provider, model, effort}, gates, synergy, cost, risks; AND
  (b) for each category, the ordered model+effort pairings (best→worst) with normalized-benchmark
  composites, cost figures, a one-line rationale per tier placement, and the audit citations per
  pairing. Cite ORIGINAL sources; label claims. Flag every place a newly discovered pairing changes
  the current ranking and WHY. Do NOT alter the taxonomy.
WRITE full judgment to %TEMP% then giga-research/phase-2-synth-K.md.
RETURN ONLY JSON {status, summary, source_locators, risks, writes_requested}.
```

## Canonical merge

Dispatch **one fresh flagship judge-merger at maximal effort** (distinct from the producers —
self-review ban) to **MERGE** the independent judgments into a single canonical core, written to
`giga-research/phase-2-core-synthesis.md`. The merger:

- Reconciles divergences using the **authority chain** (interview decisions > vendor docs/verified
  benchmarks > seed hypotheses), never by averaging.
- Produces, for each conflict, a numbered reconciliation (CR-style) with the resolution and any
  residual uncertainty — these become entries in `decision-rationale.md`.
- Emits the canonical per-category rankings that DECOMPOSE/UPDATE will write into the KB.
- **Confirms taxonomy integrity:** every pairing maps onto exactly one of the FIXED 10 (or
  `fallback_default`@99); no category is invented, dropped, renamed, or reordered. If a score fits no
  fixed category, it is recorded as out-of-spine context and surfaced — the spine is never changed
  here.
- **Emits the following merger outputs explicitly** (required for the routing-table.json path):
  1. The **per-category ordered model+effort pairings** (performance branch input) — the composite
     ordering for each FIXED category, resolved from the judges' tier-ordering inputs, each placement
     carrying its one-line rationale.
  2. The **cost figures per pairing** (cost_efficiency branch input) — sourced from `cost-model.md`,
     with gaps labelled `[ASSUMPTION]`/`[UNVERIFIED]`.
  3. The **per-pairing audit citation set** — for every pairing in both branches, the list of
     `{url, retrieved_at(ISO8601), annotation(one sentence), source_id?, label?}` records that
     support its ranking. This is the source-of-truth for `routing-table-audit.json`.

### Checkpoint before DECOMPOSE/UPDATE

Confirm: the independent judgment files + 1 core synthesis on disk; the core lists per-category
rankings over the FIXED 10 with a rationale per tier placement; all three merger outputs above are
present; the taxonomy-integrity check passed (spine unchanged); conflicts are reconciled (not
averaged). Then load `decompose-update.md`.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
