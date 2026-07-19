# phase-1-research.md : Model Discovery + Benchmark Research + Pivotal-Question Interview

**Load when:** dispatching Phase 1 (parallel discovery+research) or Phase 1.5 (the interview).
Prereq: Phase 0 consent persisted.

**Check first:** `references/benchmark-sources.md` : the canonical, provider-impartial CURATED source
list (tiered) + the per-category benchmark-family map. Every Phase 1 agent loads it BEFORE searching
so profiling stays stable run-to-run; only go beyond it for genuinely new entrants.

**Also read (if present):** `research-seed-sites.json` at the repo root : the LEARNED/accumulating
seed registry, harvested from prior runs' audit citations. Each Phase 1 agent reads it **in addition
to** `benchmark-sources.md`: the learned seed augments the curated seed (two seed loci by design). On
a fresh clone before the first run it is absent; that is fine : fall back to the curated seed alone.

---

## Phase 1 : domain-partitioned discovery + research agents

Dispatch **parallel sub-agents**, each owning one domain (no overlap : no duplicate tasks,
Anti-Pattern A). Use a web-research member + a deterministic-extraction member at minimum, all launched
via `mcp__subagent-mcp__launch_agent` (the `provider:` field is set per `dispatch-mechanics.md`; the
operator binds the concrete family : the skill names none). Provider mix is optional: single-family
and multi-family are both fully supported. All agents are **web-enabled** (recency matters). Each writes its full output to
`%TEMP%\model-profiler\<run-id>\phase-1-agent-N.md` (ephemeral scratch : never persisted to the repo)
and returns only the JSON status.

| Agent | Domain | Focus |
|-------|--------|-------|
| 1 | **Model discovery + specs** | Enumerate **every** model published in the in-scope recency window by **each** in-scope provider family; for each, capture supported effort/reasoning tiers, context in/out, modality, knowledge cutoff, sampling locks, pricing tier. Classify whether the model has selectable effort tiers or no selectable effort; never list `none` as a tier when selectable tiers exist. This roster is the authoritative model+effort universe every later agent maps onto. **#8 HARD RULE: Agent 1 MUST NEVER emit a `[DATA_MISSING]` GAP stub. A missing or failed roster is categorically worse than a missing benchmark : it silently drops entire models from the universe, making any "comprehensive" claim false. If roster discovery fails (access error, provider API down, unresolvable ambiguity), the run exits with status `blocked`, NOT `gap_stubbed`. A partial roster (some models found, others unresolvable) exits `blocked` with a full explanation; do not proceed with a partial universe.** |
| 2 | **Benchmark capture : reasoning/correctness spine** | For each discovered pairing, gather all public scores + stats diagnostic of `math_proof`, `security_review`, `debugging`, `quality_review`. |
| 3 | **Benchmark capture : build/execute spine** | Same, for `architecture`, `agentic_execution`, `data_analysis`, `coding`. |
| 4 | **Benchmark capture : synthesis/leaf + modifier signals** | Same, for `knowledge_synthesis`, `mechanical`; plus the capability data the cross-cutting modifiers need (context-size, output-size, perception, long-horizon, data-sensitivity). |
| 5 | **Ops / cost / failure / governance** | Pricing, priority tiers, rate limits, failure modes (hallucination, processing stalls), security posture, the commit/data/sandbox gates each pairing affects. |

Partition benchmark capture by category-group (agents 2:4) so coverage of the directly benchmarked parent categories is exhaustive
and non-overlapping. Scale the agent count with the Phase-0 mode without changing this partition.

### Mapping rule (onto the directly benchmarked parents)

Every score is keyed to whichever of the directly benchmarked parent categories it is most diagnostic of, using the
per-category benchmark-family map in `benchmark-sources.md`. Benchmarks **measure** a category; they
never endorse a model. Do not invent a new category to hold a score : if a score fits no fixed
category, record it as out-of-spine context and flag it; the spine does not change. The 4
composite-inferred tiles (11:14) carry no benchmark : never map a raw score onto them; their
competency is composed from parent scores in Phase 2.

**Open-weight rule:** open-weight models are profiled ONLY on quantizations/checkpoints with
published benchmark provenance. Do not infer quality from unknown quants. Name models by canonical
HuggingFace `org/model` id.

> **No-effort exclusion (SKILL.md invariant #14):** models whose ONLY effort is a no-effort sentinel
> (`null`/`none`/`n/a`) are NOT ranked in `agentic_execution`, `architecture`, `security_review`,
> `debugging`, `quality_review`, `knowledge_synthesis`. They REMAIN ranked in `math_proof`,
> `data_analysis`, `coding`, `mechanical`. The builder enforces the exclusion at ranking; still capture
> all available scores for these models : the exclusion is applied downstream, not by dropping data here.

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
  as objects `{url, retrieved_at, annotation, source_id?, label?}` : not bare strings. A bare URL
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

### Counter-search under-represented families / categories (anti-skew directive)

The learned seed (`research-seed-sites.json`) harvests only the citations a prior run happened to
cite, so its corpus **skews** toward whatever provider families and categories were heavy last run,
and toward a few repeatedly-cited secondary domains. Each site now carries an `attempt_ledger`
(`provider_family`, `categories`, `benchmark_names`, `source_class`, ...) and a `selection` annotation
(`demoted` / `health`, demote-**without**-delete : the seed never deletes and has no TTL). Use them
to **diagnose and actively counter** the skew, do not merely inherit it:

- **Before searching,** scan the seed's `attempt_ledger.provider_family` / `categories` counts. Any
  in-scope provider family or fixed category that is thin or absent is **under-represented** : spend
  proportionally MORE search budget there, with independent (higher-tier) sources, to balance the
  corpus. Do not let a heavily-cited family crowd out a sparsely-covered one.
- **Treat `selection.demoted` sites as a skew signal, not a denylist:** a site demoted `over_source_class_cap`
  marks an over-represented (category, source_class) bucket : counter-search a DIFFERENT source class
  / family for that category rather than piling onto the saturated bucket. A `low_health_tier0` demote
  means the seed lacks an independently-corroborated source there : prioritise finding one.
- **Never delete or skip a demoted/low-tier seed row to "fix" balance** : storage is accumulate-forever
  by design; you rebalance by ADDING under-represented coverage, the selection layer down-weights softly.

### Research-agent prompt skeleton

```
<this is a request from a parent process>
ROLE: Phase-1 discovery+research agent N. Domain: <domain>.
CONTEXT: profiling scope = <in-scope provider families + recency window> (see consent record).
  Fixed taxonomy: .spec/references/work-categories.md. Source list + category map:
  skills/model-profiler/references/benchmark-sources.md (curated seed : CHECK FIRST) AND
  research-seed-sites.json (learned/accumulating seed at repo root, if present : augments the curated
  seed). Existing fleet + current rankings: read the prior src/routing-table.json +
  research-seed-sites.json to DIFF, not inherit.
TASK: discover/measure your domain on the web. Map every score onto the directly benchmarked parent categories via the
  family map (composite tiles 11:14 carry no benchmark : never score them directly). APA-cite ORIGINAL sources only. Label [SEED]/[INFERRED]/[ASSUMPTION]/[UNVERIFIED].
  Open-weight models: profile only quantizations/checkpoints with published benchmark provenance;
  do not infer quality from unknown quants; name by canonical HuggingFace org/model id.
  For a brand-new model with sparse corroboration, use task-split framing and mark assumptions.
  If a model has selectable effort tiers, do not emit `none` as one of its model+effort pairings
  (this is an owner directive enforced independent of vendor documentation:exclude such pairings).
WRITE: full findings to %TEMP%\model-profiler\<run-id>\phase-1-agent-N.md (ephemeral scratch : never
  persisted to the repo).
RETURN ONLY JSON {status, summary<=80w, source_locators, risks, writes_requested}.
  NOTE: source_locators entries are objects {url, retrieved_at(ISO8601), annotation(one sentence),
  source_id?, label?}, one per cited source, feeding routing-table-audit.json.
```

Tier the agents by dogfooding the KB's own routing (`dispatch-mechanics.md`): classify each agent's
task shape to its fixed category and route to the best-ranked member for that category; the operator
binds the concrete member. The skill names no model here.

## Phase 1.5 : pivotal-question interview

1. Dispatch **one** sub-agent to read all `phase-1-agent-*.md` outputs and **derive the most pivotal
   questions** whose answers would most change the per-category tier rankings (score conflicts,
   magnitude calls, corroboration-posture choices, gap-handling). It writes them to
   `%TEMP%\model-profiler\<run-id>\phase-1.5-...md` (ephemeral) and returns them in its JSON.
2. If Phase 0 used the `bare-reprofile-default` standing profile, do **not** stop for owner
   interview answers. Dispatch one fresh adjudication sub-agent to resolve each pivotal question
   from the recorded authority chain (owner SOPs/interview records > vendor docs/verified
   benchmarks > seed). Persist the resolutions, labels, and residual risks. Return `needs_user`
   only for questions that would authorize out-of-allowlist writes, credentials/private data,
   destructive action, taxonomy-spine changes, or git writes. (Single-family execution is NOT a
   `needs_user` event and NOT a degrade : it is a fully-supported path per invariant #5.)
3. Otherwise, the **orchestrator relays** those questions to the owner via **AskUserQuestion**
   (batched). The orchestrator does not answer them itself.
4. **Persist the answers or standing-profile resolutions** into the interview file. These are
   **binding steering** and feed Phase 2 and the audit's `basis` (label key / conflict
   reconciliations).

### Checkpoint before Phase 2

**Classify each Phase-1 output** before dispatching Phase 1.5:
- **COMPLETE** : `%TEMP%\model-profiler\<run-id>\phase-1-agent-N.md` was produced by THIS run's fresh
  dispatch with non-empty research content. (Pre-existing scratch is NEVER reused : FRESH-DATA mandate.)
- **MISSING** : file absent, empty, or agent returned `blocked`/`needs_user`/error.

**For MISSING agents:** apply the finite-wait + fallback policy in `dispatch-mechanics.md`. If
fallback also fails, write an explicit GAP stub at `%TEMP%\model-profiler\<run-id>\phase-1-agent-N.md`. Record the
GAP in the run's `risks`; do not halt the run for a domain GAP. (Single-family is a supported path,
not a risk to log : invariant #5.)

**Exception: Agent 1 (model discovery) MUST NEVER be GAP-stubbed** : see #8 HARD RULE above.
A roster failure exits `blocked`, not `gap_stubbed`. GAP stubs are only for benchmark agents (2:5).

**#8 strict_release_window mode:** when `STRICT_RELEASE_WINDOW=true` is set, Agent 1 must output
a per-provider inclusion/exclusion table listing every model considered, with release dates and the
reason for inclusion or exclusion. A run without this table in strict mode exits `blocked`.

**No bounded-continuation on budget** (FRESH-DATA mandate): there is NO reuse of prior/partial scratch
to bypass a Phase 1 budget shortfall. If Phase 1 fresh fan-out cannot complete within the session
budget, **ABORT** the run as `blocked` (`fresh-data-unsatisfiable: budget`) : do not reuse existing
agents and do not GAP-stub to dodge budget. (GAP stubs remain valid ONLY for a genuinely stalled/
failed single benchmark agent (2:5) per the provider-resilience policy in `dispatch-mechanics.md`,
never to substitute stale data or to dodge budget.)

The Phase 1.5 adjudication agent reads all `phase-1-agent-*.md` files including GAP stubs. It must
note every GAP domain explicitly and include "what data would fill this GAP" as a pivotal question.
For the bare standing-profile path: a single-family fallback is **not** a new `needs_user` event and
**not** a degrade : it is a fully-supported path (invariant #5), not an authorization question.

Confirm before dispatching Phase 2: every expected `phase-1-agent-N.md` exists on disk (complete from
THIS run's fresh dispatch, or a provider-resilience GAP stub : never reused stale scratch), the
interview file holds pivotal questions plus owner answers or standing-profile
resolutions, and no non-GAP agent returned `blocked`/`needs_user` unresolved.

---

*Author: Lexi Blackburn : https://github.com/Heretyc/ : May 2026*
