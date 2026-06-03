# phase-1-research.md — Model Discovery + Benchmark Research + Pivotal-Question Interview

**Load when:** dispatching Phase 1 (parallel discovery+research) or Phase 1.5 (the interview).
Prereq: Phase 0 consent persisted.

**Check first:** `references/benchmark-sources.md` — the canonical, provider-impartial source list
(tiered) + the per-category benchmark-family map. Every Phase 1 agent loads it BEFORE searching so
profiling stays stable run-to-run; only go beyond it for genuinely new entrants.

---

## Phase 1 — domain-partitioned discovery + research agents

Dispatch **parallel sub-agents**, each owning one domain (no overlap — no duplicate tasks,
Anti-Pattern A). **Cross-family mix** across the set (a web-research member + a deterministic-extraction
member at minimum), all launched via `mcp__subagent-mcp__launch_agent` (the `provider:` field is set
per `dispatch-mechanics.md`; the operator binds the concrete family — the skill names none). All
agents are **web-enabled** (recency matters). Each writes its full output to
`giga-research/phase-1-agent-N.md` and returns only the JSON status.

| Agent | Domain | Focus |
|-------|--------|-------|
| 1 | **Model discovery + specs** | Enumerate **every** model published in the in-scope recency window by **each** in-scope provider family; for each, capture supported effort/reasoning tiers, context in/out, modality, knowledge cutoff, sampling locks, pricing tier. This roster is the authoritative model+effort universe every later agent maps onto. |
| 2 | **Benchmark capture — reasoning/correctness spine** | For each discovered pairing, gather all public scores + stats diagnostic of `math_proof`, `security_review`, `debugging`, `quality_review`. |
| 3 | **Benchmark capture — build/execute spine** | Same, for `architecture`, `agentic_execution`, `data_analysis`, `coding`. |
| 4 | **Benchmark capture — synthesis/leaf + modifier signals** | Same, for `knowledge_synthesis`, `mechanical`; plus the capability data the cross-cutting modifiers need (context-size, output-size, perception, long-horizon, data-sensitivity). |
| 5 | **Ops / cost / failure / governance** | Pricing, priority tiers, rate limits, failure modes (hallucination, processing stalls), security posture, the commit/data/sandbox gates each pairing affects. |

Partition benchmark capture by category-group (agents 2–4) so coverage of the FIXED 10 is exhaustive
and non-overlapping. Scale the agent count with the Phase-0 mode without changing this partition.

### Mapping rule (onto the FIXED 10)

Every score is keyed to whichever of the 10 fixed categories it is most diagnostic of, using the
per-category benchmark-family map in `benchmark-sources.md`. Benchmarks **measure** a category; they
never endorse a model. Do not invent a new category to hold a score — if a score fits no fixed
category, record it as out-of-spine context and flag it; the spine does not change.

### Additional research dimension: per-pairing tier inputs

Each agent must **also** gather, for every model+effort pairing within its domain, the raw data the
scoring leaf (`tier-ranking-and-scoring.md`) will consume:

- **Exhaustive benchmarks:** every publicly reported score for the pairing, keyed to the fixed
  category it is most diagnostic of (use the `benchmark-sources.md` family map). Cite the ORIGINAL
  source (vendor card, third-party eval, official leaderboard). Label `[UNVERIFIED]` if sourced only
  from vendor marketing copy; corroborate vendor self-claims at an independent tier before trusting.
- **Audit-grade source capture (for routing-table-audit.json):** for every benchmark/source you
  cite, capture a structured record: the **original source URL**, the **ISO8601 retrieval timestamp**
  (`retrieved_at`, the moment you fetched it), and a **single-sentence annotation** stating why that
  source supports the specific pairing's ranking in its category. Return these in `source_locators`
  as objects `{url, retrieved_at, annotation, source_id?, label?}` — not bare strings. A bare URL
  with no retrieval time or annotation is an incomplete locator and blocks the audit emission.
- **Anecdotal / sentiment signals:** practitioner observations and comparative qualitative
  assessments keyed to the same fixed categories. Label `[INFERRED]` / `[ASSUMPTION]`.
- **Gap acknowledgement:** vendors rarely publish per-effort-tier benchmarks. When a pairing has no
  measured data for a category, record it explicitly as a gap and flag it for the interpolation rule
  (`tier-ranking-and-scoring.md`). Do not invent scores; gaps become `interpolated:true` entries.
- **Surface normalized inputs:** for each pairing, emit a structured table of raw benchmark values
  (unnormalized) alongside the fixed category each maps to. Phase 2 judges normalize and composite
  these; Phase 1 agents must not pre-normalize.

This dimension feeds the `routing-table.json` tier-ranking pipeline directly. Agents that do not
surface raw inputs for their pairings block the judging step.

### Research-agent prompt skeleton

```
<this is a request from a parent process>
ROLE: Phase-1 discovery+research agent N. Domain: <domain>.
CONTEXT: profiling scope = <in-scope provider families + recency window> (see consent record).
  Fixed taxonomy: .spec/references/work-categories.md. Source list + category map:
  skills/model-profiler/references/benchmark-sources.md (CHECK FIRST). Existing fleet + current
  rankings: read .spec/references/{model-profiles,routing-table,cost-model,...}.md to DIFF, not inherit.
TASK: discover/measure your domain on the web. Map every score onto the FIXED 10 categories via the
  family map. APA-cite ORIGINAL sources only. Label [SEED]/[INFERRED]/[ASSUMPTION]/[UNVERIFIED].
  For a brand-new model with sparse corroboration, use task-split framing and mark assumptions.
WRITE: full findings to %TEMP%\... then to giga-research/phase-1-agent-N.md.
RETURN ONLY JSON {status, summary<=80w, source_locators, risks, writes_requested}.
  NOTE: source_locators entries are objects {url, retrieved_at(ISO8601), annotation(one sentence),
  source_id?, label?}, one per cited source, feeding routing-table-audit.json.
```

Tier the agents by dogfooding the KB's own routing (`dispatch-mechanics.md`): classify each agent's
task shape to its fixed category and route to the best-ranked member for that category; the operator
binds the concrete member. The skill names no model here.

## Phase 1.5 — pivotal-question interview

1. Dispatch **one** sub-agent to read all `phase-1-agent-*.md` outputs and **derive the most pivotal
   questions** whose answers would most change the per-category tier rankings (score conflicts,
   magnitude calls, corroboration-posture choices, gap-handling). It writes them to
   `giga-research/phase-1.5-...md` and returns them in its JSON.
2. The **orchestrator relays** those questions to the owner via **AskUserQuestion** (batched).
   The orchestrator does not answer them itself.
3. **Persist the answers** into the interview file. These answers are **binding steering**
   (authority chain: interview decisions > vendor docs/verified benchmarks > seed) and feed Phase 2
   and the `decision-rationale.md` label key / conflict reconciliations.

### Checkpoint before Phase 2

Confirm: the discovery roster + benchmark files exist on disk, the interview file holds the pivotal
questions + owner answers, and no agent returned `blocked`/`needs_user` unresolved. If any did,
resolve or surface before judging.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
