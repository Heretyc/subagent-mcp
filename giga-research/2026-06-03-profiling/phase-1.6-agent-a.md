# Phase 1.6 — Agent A: Distinct Opus-Version Metrics (4.6 vs 4.7 vs 4.8)

**Run:** 2026-06-03 Full-mode re-profile · **Agent:** phase-1.6-agent-a · **Status:** ok
**Domain:** SEPARATE Opus 4.6 / 4.7 / 4.8 per-version benchmark scores across the FIXED 10 categories.
**Mandate:** FILL GAPS only (do not duplicate Phase-1). Where a version has no measured score for a
category, RECORD AS GAP — the deterministic builder fills via the version-promotion SOP. Do NOT invent,
do NOT normalize. Versions are DISTINCT models (Phase-1.5 Q1 binding).
**Retrieved:** all rows this pass at **2026-06-03T20:19:07Z** unless noted.

Labels: `[SEED]`=direct official leaderboard (T3) · `[INFERRED]`=corroborated across aggregators ·
`[UNVERIFIED]`=vendor-only or single secondary aggregator, no independent leaderboard · `[GAP]`=no
original per-version raw score found this pass. Vendor cards = `[UNVERIFIED]` per policy.

---

## Pre-existing per-version Opus coverage (from Phase-1 — NOT re-collected here)

| Category | 4.6 | 4.7 | 4.8 |
|---|---|---|---|
| math_proof | ✓ agent-2 (MathArena 55.9) | **was GAP → FILLED below** | ✓ agent-2 (MathArena 70.4) |
| security_review | ✓ agent-2 (CyberGym 66.6) | **was GAP → FILLED below** | ✓ agent-2 (CyberGym 78.8) |
| debugging | ✓ agent-2 (SWE-V 80.84) | partial → corroborated below | ✓ agent-2 (SWE-V 88.6) |
| quality_review | GAP | GAP | partial (vendor honesty proxy only) |
| architecture (SWE-Pro proxy) | ✓ 53.4 (agent-3) | ✓ 64.3 (agent-3) | ✓ 69.2 (agent-3) |
| agentic_execution | ✓ OSWorld 72.7 | ✓ corroborated below | ✓ Terminal 74.6 |
| data_analysis | partial BIRD 70.15 (agent-3) | GAP | GAP |
| coding | ✓ LCB 70.7 / SWE-Pro 53.4 | ✓ SWE-V 87.6 / aider 72.0 | ✓ SWE-V 88.6; aider+LCB GAP |
| knowledge_synthesis | ✓✓ agent-4 | ✓✓ agent-4 | ✓✓ agent-4 |
| mechanical | GAP | GAP | GAP (all models, all versions) |

---

## NEW raw rows found THIS pass (gap-fills) — UNNORMALIZED

### math_proof — FILLS the Opus 4.7 gap (T3 direct)

| version | effort | category | benchmark | raw score | source | label |
|---|---|---|---|---|---|---|
| Opus 4.7 | adaptive thinking | math_proof | MathArena expected performance | 52.9%; rank #13; $3.02/problem | matharena.ai/models/anthropic_opus_47 | [SEED][T3] |
| Opus 4.7 | adaptive thinking | math_proof | MathArena ArXivMath | 50.0%; rank 6/9; $0.96/prob | matharena.ai/models/anthropic_opus_47 | [SEED][T3] |
| Opus 4.7 | adaptive thinking | math_proof | MathArena AIME 2026 | 95.83%; rank 8/28; $0.27/prob | matharena.ai/models/anthropic_opus_47 | [SEED][T3] |
| Opus 4.7 | adaptive thinking | math_proof | MathArena HMMT Feb 2026 | 93.94%; rank 9/28; $0.56/prob | matharena.ai/models/anthropic_opus_47 | [SEED][T3] |
| Opus 4.7 | adaptive thinking | math_proof | MathArena Apex | 40.62%; rank 6/44; $2.10/prob | matharena.ai/models/anthropic_opus_47 | [SEED][T3] |
| Opus 4.7 | adaptive thinking | math_proof | MathArena BrokenArxiv | 4.64%; rank 9/9; $2.31/prob | matharena.ai/models/anthropic_opus_47 | [SEED][T3] |

> **Version-separation note (surface, do NOT normalize):** MathArena *expected* ranks 4.6=55.9% (#11,
> agent-2) ABOVE 4.7=52.9% (#13). This is an artifact of an expanded competitor field + the broader
> 2026 problem set on the 4.7 page, NOT a regression claim — the two pages are different snapshots.
> On the shared AIME 2026 sub-task: 4.6=96.67%, 4.7=95.83%, 4.8=100% (all within noise). Builder
> should anchor version order on the **shared sub-tasks**, not the expected-performance composite.

### security_review — FILLS Opus 4.7 (secondary; original 4.7 system card still needed)

| version | effort | category | benchmark | raw score | source | label |
|---|---|---|---|---|---|---|
| Opus 4.7 | default | security_review | CyberGym | 73.1% (≈flat vs 4.6 revised 73.8%) | llm-stats.com/blog/research/claude-opus-4-7-launch | [UNVERIFIED] |
| Opus 4.7 | default | security_review | Cybench | 96% (same as 4.6) | llm-stats.com/blog/research/claude-opus-4-7-launch | [UNVERIFIED] |

> Anthropic states cyber capability is deliberately held ≈flat across 4.6→4.7 ("differentially reduced"
> in training). So 4.7 security ≈ 4.6, and 4.8 (CyberGym 78.8% off, agent-2) is the only clear riser.
> NOTE: CyberGym 4.6 number differs between sources — agent-2 cites 66.6% (Opus 4.6 system card);
> the 4.7-launch secondary cites a "revised 73.8%" for 4.6. **Surfaced conflict — prefer the original
> 4.6 system card (66.6%) unless the 4.7 system-card PDF confirms a restated 4.6 baseline.**

### debugging / coding / agentic — Opus 4.7 corroboration + new sub-benchmarks

| version | effort | category | benchmark | raw score | source | label |
|---|---|---|---|---|---|---|
| Opus 4.7 | default | debugging/coding | SWE-bench Verified | 87.6% (vs 4.6 80.8%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [INFERRED] (corroborates agent-3 llm-stats) |
| Opus 4.7 | default | coding/architecture | SWE-bench Pro | 64.3% (vs 4.6 53.4%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [INFERRED] (matches agent-3) |
| Opus 4.7 | default | agentic_execution | Terminal-Bench 2.0 | 69.4% (vs 4.6 65.4%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [UNVERIFIED] |
| Opus 4.7 | default | agentic_execution | OSWorld-Verified | 78.0% (vs 4.6 72.7%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [INFERRED] (matches agent-3) |
| Opus 4.7 | default | agentic_execution | MCP-Atlas (scaled tool use) | 77.3% (vs 4.6 75.8%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [UNVERIFIED] |
| Opus 4.7 | default | knowledge_synthesis | BrowseComp (single-agent) | 79.3% (REGRESSION vs 4.6 83.7%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [INFERRED] (matches agent-4) |

> **Terminal-Bench conflict (surface):** agent-3 has 4.7=66.1% on Terminal-Bench **2.1** (the-decoder);
> Vellum has 4.7=69.4% on Terminal-Bench **2.0**. Different bench *versions* → not a contradiction;
> builder must key agentic order to ONE TB version. 4.8=74.6% is TB 2.1 (agent-3) — pair with 66.1%.

### Vendor-only (Opus 4.7 launch) — [UNVERIFIED][T1]; weak/proxy category fits

| version | effort | category | benchmark | raw score | source | label |
|---|---|---|---|---|---|---|
| Opus 4.7 | default | coding | CursorBench | 70% (vs 4.6 58%) | anthropic.com/news/claude-opus-4-7 | [UNVERIFIED][T1] |
| Opus 4.7 | default | data_analysis | General Finance module | 0.813 (vs 4.6 0.767) | anthropic.com/news/claude-opus-4-7 | [UNVERIFIED][T1][proxy] |
| Opus 4.7 | default | data_analysis | Finance Agent v1.1 | 64.4% (vs 4.6 60.1%) | vellum.ai/blog/claude-opus-4-7-benchmarks-explained | [UNVERIFIED][proxy] |
| Opus 4.7 | default | data_analysis | OfficeQA Pro | "21% fewer errors than 4.6" | anthropic.com/news/claude-opus-4-7 | [UNVERIFIED][T1][proxy] |
| Opus 4.7 | default | perception_required | XBOW visual-acuity | 98.5% (vs 4.6 54.5%) | anthropic.com/news/claude-opus-4-7 | [UNVERIFIED][T1] |

---

## REMAINING GAPS for the version-promotion SOP to fill (deterministic builder)

> Per Phase-1.5 SOP guard: a version NEVER listed for a category is NOT inserted by the promotion rule.
> Flag below = which versions ARE listed (anchor exists) vs genuinely absent.

| Category | 4.6 | 4.7 | 4.8 | SOP note |
|---|---|---|---|---|
| math_proof | listed | **listed (now)** | listed | full chain — no promotion needed |
| security_review | listed | **listed (now, secondary)** | listed | full chain; confirm 4.7 w/ original system card |
| debugging | listed | **listed (now)** | listed | full chain |
| quality_review | **GAP** | **GAP** | proxy-only | NO RewardBench/JudgeBench/CriticBench public rows for ANY Opus version → builder cannot promote within-family; must fall back to the agent-4 vendor honesty proxy or cross-category prior. **Hard gap.** |
| architecture | listed (proxy) | listed (proxy) | listed (proxy) | SWE-Pro proxy only; full chain |
| agentic_execution | listed | **listed (now)** | listed | reconcile TB 2.0 vs 2.1 first |
| data_analysis | partial (BIRD 70.15) | proxy-only (Finance) | **GAP** | No 4.7/4.8 BIRD/Spider/DABstep rows. 4.6 is the only hard SQL anchor → 4.7/4.8 must be promoted from 4.6 by SOP (both ARE listed elsewhere, but NOT on a SQL bench → promotion guard may block; builder should use Finance proxy or carry 4.6 anchor forward explicitly). |
| coding | listed | listed | aider+LCB **GAP** | 4.8 has SWE-V/SWE-Pro but NO aider polyglot / LiveCodeBench row (leaderboards lag the 2026-05-28 release). Promote from 4.7 aider 72.0%. |
| knowledge_synthesis | listed | listed | listed | full chain |
| mechanical | **GAP** | **GAP** | **GAP** | StructEval / IFEval / BFCL-AST have NO current-gen rows for any Opus version (agent-4). Whole tile is promotion-blind → builder relies on the agentic-floor BFCL prior, NOT a measured mechanical score. **Hard gap, all versions.** |

### Searched but NOT found (record so the gap is auditable, not silent)
- RewardBench / RewardBench 2 / JudgeBench / CriticBench: zero per-version Opus rows (only legacy Claude
  3.5 Sonnet 72% on Multimodal RewardBench — out of scope/version).
- BIRD-SQL / Spider 2.0 leaderboards: no Opus 4.7 or 4.8 rows (latest Claude = 4.6 / sonnet-4-5 vintage).
- aider polyglot / LiveCodeBench: no Opus 4.8 row (release post-dates leaderboard refresh).
- IFEval / StructEval / BFCL-AST: no current-gen Opus row of any version.
- Opus 4.7 FrontierMath (Epoch): no per-version row; 4.7 math is MathArena-only.

---

## Provenance / risks
- Vellum + llm-stats blog are SECONDARY aggregators (re-report vendor numbers); labeled [INFERRED] only
  where they corroborate a second source (agent-3/agent-4), else [UNVERIFIED]. None is an original
  leaderboard except MathArena (T3 [SEED]).
- Opus 4.7 CyberGym/Cybench need the ORIGINAL 4.7 system-card PDF for promotion to [UNVERIFIED][T1];
  current cite is a launch-recap blog.
- All "future" model pages (4.7/4.8, gpt-5.5) are 2026-dated; no value was invented — absent data = GAP.
- Did NOT run git. Wrote only under giga-research/2026-06-03-profiling/.
