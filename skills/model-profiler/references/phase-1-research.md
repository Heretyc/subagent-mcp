# phase-1-research.md — Domain-Partitioned Research + Pivotal-Question Interview

**Load when:** dispatching Phase 1 (parallel research) or Phase 1.5 (the 10-question interview).
Prereq: Phase 0 consent persisted.

---

## Phase 1 — 5 domain-partitioned research agents

Dispatch **5 parallel research sub-agents**, each owning one domain (no overlap — no duplicate
tasks, Anti-Pattern A). **Mix providers:** Sonnet + Codex GPT across the five, all launched via
`mcp__subagent-mcp__launch_agent` (`provider: claude|codex`; see `dispatch-mechanics.md`). All
agents are **web-enabled** (recency matters for a new model). Each writes its full output
to `giga-research/phase-1-agent-N.md` and returns only the JSON status.

| Agent | Domain | Focus |
|-------|--------|-------|
| 1 | **New-model capabilities / effort settings** | Benchmarks, context in/out, supported effort/reasoning levels, modality, knowledge cutoff, sampling locks of the *new* model |
| 2 | **Existing-fleet deltas vs the new model** | Where the new model beats / ties / loses to each current fleet member; which current routes are now contestable |
| 3 | **task -> model -> effort mapping** | For each work category, the best `{provider, model, effort}` given the new model; cost-quality tradeoff |
| 4 | **Cross-model synergy / handoffs** | Producer/critic pairings, fan-out capacity, hub-and-spoke handoff patterns involving the new model |
| 5 | **Ops / cost / failure / governance** | Pricing, priority tiers, rate limits, failure modes (hallucination, stalls), security posture, commit/data gates affected |

### Additional research dimension: per-pairing tier inputs

Each agent must **also** gather, for every model+effort pairing within its domain, the raw data
the scoring leaf (`tier-ranking-and-scoring.md`) will consume:

- **Exhaustive benchmarks:** every publicly reported benchmark score for the pairing (illustrative
  benchmark types, not the deliverable: MMLU, HumanEval, MATH, SWE-Bench, GPQA, BigBench-Hard, etc.),
  keyed to whichever of the 10 generic-agentic categories each benchmark is most diagnostic of. Cite
  original source (vendor release, third-party eval). Label `[UNVERIFIED]` if sourced only from
  vendor marketing copy.
- **Anecdotal / sentiment signals:** practitioner observations, community sentiment, and comparative
  qualitative assessments keyed to the same categories. Label `[INFERRED]` or `[ASSUMPTION]`
  as appropriate.
- **Gap acknowledgement:** vendors rarely publish per-effort-tier benchmarks. When a pairing has no
  measured data for a category, record it explicitly as a gap and flag it for the interpolation rule
  (see `tier-ranking-and-scoring.md`). Do not invent scores; gaps become `interpolated:true` entries.
- **Surface normalized inputs:** for each pairing, emit a structured table of raw benchmark values
  (unnormalized) alongside the category each maps to. Phase 2 synthesizers normalize and composite
  these; Phase 1 agents must not pre-normalize.

This dimension feeds directly into the `provider.json` tier-ranking pipeline. Agents that do not
surface raw inputs for their pairings block the synthesis step.

### Research-agent prompt skeleton

```
<this is a request from a parent process>
ROLE: Phase-1 research agent N. Domain: <domain>.
CONTEXT: profiling new model(s) <names> (see consent record). Existing fleet + current routes:
  read .spec/references/{model-profiles,routing-table,cost-model,...}.md as needed.
TASK: web-research your domain. APA-cite ORIGINAL sources only. Label [SEED]/[INFERRED]/
  [ASSUMPTION]/[UNVERIFIED]. For a brand-new model with sparse corroboration, use task-split
  framing and mark assumption-based claims.
WRITE: full findings to %TEMP%\... then to giga-research/phase-1-agent-N.md.
RETURN ONLY JSON {status, summary<=80w, source_locators, risks, writes_requested}.
```

Tier the agents by dogfooding the KB's routing (see `dispatch-mechanics.md`): research/review ->
Sonnet; deterministic extraction/structured pulls -> Codex.

## Phase 1.5 — 10 pivotal questions (interview)

1. Dispatch **one** sub-agent to read all five `phase-1-agent-*.md` outputs and **derive the 10
   most pivotal questions** whose answers would most change the routing reshuffle (conflicts,
   magnitude calls, policy choices for the new model). It writes them to
   `giga-research/phase-1.5-...md` and returns them in its JSON.
2. The **orchestrator relays** those questions to the owner via **AskUserQuestion** (batched).
   The orchestrator does not answer them itself.
3. **Persist the answers** into the interview file. These answers are **binding steering**
   (authority chain: interview decisions > vendor docs/benchmarks > seed) and feed Phase 2 and the
   `decision-rationale.md` label key / conflict reconciliations.

### Checkpoint before Phase 2

Confirm: 5 research files exist on disk, the interview file holds 10 questions + owner answers, and
no agent returned `blocked`/`needs_user` unresolved. If any did, resolve or surface before
synthesis.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
