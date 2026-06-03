# decision-rationale.md — Decision Rationale, Conflict Reconciliations & Residual Uncertainty

**One-screen summary:** The "why" behind every contested routing decision. Owns the seed-status
corroboration table, the 8 conflict reconciliations (CR-1 through CR-8), the label key, and the
"mandate overrides benchmark" calls. Benchmark figures are owned by `./model-profiles.md` and
cross-referenced here only as rationale deltas. Source APA citations are owned by
`./source-ledger.md`.

**Load when:** questioning why a routing rule is shaped a certain way; auditing a seed hypothesis;
reviewing a conflict between the five synthesis documents; understanding why a mandate overrides
a benchmark; checking residual uncertainty before a policy change.
**Do not load when:** normal routing (load `./routing-table.md`); benchmark lookup (load
`./model-profiles.md`); gate thresholds (load `./hard-gates.md`).

---

## Label Key (Interview Q8)

| Label | Meaning |
|-------|---------|
| `[SEED]` | Blackburn (2026) hypothesis — treated as hypothesis only; docs/benchmarks override |
| `[INFERRED]` | Extrapolated from cited facts; not directly vendor-stated |
| `[ASSUMPTION]` | Mandated working premise (Interview decision); overrides inference |
| *(unlabeled)* | Official vendor docs / verified benchmark — highest authority |

**Authority chain:** (1) Phase 1.5 interview decisions are binding steering. (2) Official vendor
docs + verified benchmarks override seed. (3) Conflicts resolved by best-sourced evidence, not
blind averaging.

---

## Seed Corpus Corroboration Status

> **Routes pending — no winners here.** This table records seed *hypotheses* and their benchmark
> corroboration only. No preferred per-category model/effort is asserted; concrete
> `{provider, model, effort}` rankings are **pending the next impartial model-profiler run**
> (empty `assets/routing-table.json`). Model names in the Outcome column are benchmark/evidence
> facts (owned by `./model-profiles.md` / `./cost-model.md`), not routes.

| [SEED] claim (Blackburn 2026, task-shape) | Outcome (benchmark evidence) | Routing consequence | Source id(s) |
|---|---|---|---|
| Planning / architecture / synthesis / nuance form a high-complexity cluster | **Corroborated** (GDPval-AA 1890; +144 Elo Opus 4.6 vs GPT-5.2) | per-category member pending impartial profiling | `VENTUREBEAT-2026` [PRESS], `DATACAMP-OPUS46` |
| Debugging / review / reasoning form a balanced-complexity cluster | **Corroborated** (79.6% SWE-bench Verified; ~70% dev preference daily coding) | pending impartial profiling | `ANTH-SONNET46`, `DATACAMP-S46` |
| Fast coding / file-ops form a low-latency leaf cluster | **Corroborated** (73.3% SWE-bench; auto-routed leaf work) | pending impartial profiling | `ANTH-HAIKU45`, `DATACAMP-H45` |
| Closed-loop / extraction / proofs / terminal form an agentic cluster | **Corroborated** (Terminal-Bench ~82–83%; ~40% fewer output tokens) | pending impartial profiling | `CODERABBIT-2026`, `OAI-GPT55`; 20-hr task completion [ASSUMPTION — source unconfirmed] |
| Confident-hallucination + security-bug risk concentrates in one model family | **Corroborated** (CWE-732 misses; hallucinated `pathlib` arg; AISI cyber eval; Sonar; Endor) | G_SEC mandatory cross-review (policy, not a route) | `AISI-2026`, `SONAR-2026`, `ENDOR-2026` |
| Caution / stall + verbosity risk under ambiguity | **Corroborated** (official low-effort docs) | Pattern P4b stall recovery (policy) | `ANTH-EFFORT` [INFERRED] |
| ≤5 separable workers + 1 coordinator; no duplicate tasks | **Adopted** as fan-out capacity model | Anti-Pattern A; Patterns P1/P2 | `ADAPTORCH` |
| One frontier version ≫ its predecessor on ALL tasks | **OVERRIDDEN** → task-split framing: leads agentic/long-horizon, ~equal isolated coding (Interview Q2) | §CR-7 below | `CONTRA-2026`, `DECODER-2026` [PRESS] |
| Low-latency leaf member for ALL coding | **OVERRIDDEN** → low-latency leaf is `mechanical`-only; multi-file/semantic coding routed per profiler | §1.9 boundary in `./work-categories.md` | `ANTH-HAIKU45` |

---

## Conflict Reconciliations (CR-1 through CR-8)

### CR-1 — Category count and names (8 vs 9; naming variants)
Synths 1/2/3/5 converged on 8; synth 4 used 9 (added explicit `fallback_default`).
**Resolution:** 8 canonical work categories + explicit `fallback_default` route. The classifier
emits one of 8; the router supplies the default when none match. `extraction_terminal` /
`terminal_exec` / `agentic_operations` → merged into `agentic_execution` (identical routing class).
`reasoning_judgment` / `deep_reasoning` → merged into `knowledge_synthesis`; pure tie-breaking
sits in `quality_review`.
*Residual uncertainty:* `agentic_execution` ∩ `coding` boundary (one-shot edit vs run-observe
loop) is the most likely real-world mis-class. Precedence order + adjacent-tie escalation handle
it; evals should monitor.

### CR-2 — `coding` vs `agentic_execution` boundary (member pending)
Synths split on which member serves `coding`: one framed a balanced one-shot route, another closed-loop.
**Resolution:** `coding` (one-shot write/edit) and `agentic_execution` (run-observe closed loop) are
distinct categories; closed-loop work classifies as `agentic_execution`. The concrete
`{provider, model, effort}` for each is **pending impartial profiling** — no member named here.
*Residual uncertainty:* the one-shot/closed-loop boundary is the likely mis-class; eval-tunable,
not a correctness issue.

### CR-3 — GPT-5.5 context window (400K vs 1M vs 1.05M)
Synth 2 stated 400K; synths 3/4/5 cited ~1M/1.05M.
**Resolution (best-sourced — Phase-1 Agent 5 citing OpenAI docs):** GPT-5.5 = 1,050,000-token
API context, 128K max output. **400K is the Codex harness cap**, not the model. Operative limit
for local fleet = 400K (G_CTX_400). No residual uncertainty on the numbers; nuance is
harness-vs-API, now explicit. Sources: `OAI-USING55`, `OAI-CODEX-M`.

### CR-4 — SWE-bench (tie vs gap)
**Resolution (unanimous Phase-1 Agents 1/3):** SWE-bench Verified is **tied** — Opus 4.8 88.6%
vs GPT-5.5 88.7% (within noise). Real split is SWE-bench Pro: Opus 4.8 69.2% vs GPT-5.5 58.6%
(Opus +10.6pp). This is the task-split framing (Interview Q2): parity on isolated coding, Opus
leads on harder multi-step agentic work. No residual uncertainty. Sources: `CONTRA-2026`, `OAI-USING55`.

### CR-5 — GDPval / knowledge-work figures (1890 vs +144 Elo vs +121 points)
Synth 3 conflated three different comparisons.
**Resolution (Phase-1 Agents 1/3):** Opus 4.8 GDPval-AA = **1890** (vs GPT-5.5 1769; vs Opus
4.7 1753). **"+144 Elo"** is a *separate* comparison: Opus 4.6 vs GPT-5.2 on GDPval (DataCamp).
"+121 points" = Opus 4.8 − GPT-5.5 margin (1890 − 1769) rounded. All three are real but not
interchangeable; cited distinctly in `./model-profiles.md`.
*Residual uncertainty:* Opus 4.8 released same-day as research; 1890 figure is [PRESS]-sourced
(VentureBeat), independent replication pending.

### CR-6 — GPT-5.5 priority pricing ($12.50/$75 vs "credit multiplier")
Synth 4 stated $12.50/input $75/output. Synth 5 said "credit multiplier."
**Resolution (best-sourced — Phase-1 Agent 5 citing OpenAI pricing):** GPT-5.5 priority =
**$12.50/input, $1.25/cached, $75/output** (2.5× standard). Synth 4 is correct. No residual
uncertainty. Figures owned by `./cost-model.md`. Source: `OAI-PRICING`.

### CR-7 — Opus 4.8 magnitude over 4.7
Synths split between "significant jump" and "modest but tangible."
**Resolution (Interview Q2 + Phase-1 Agent 4 caveat):** [ASSUMPTION] Frame as task-split
leadership — materially better on agentic/long-horizon (SWE-Pro +10.6pp vs GPT-5.5;
Terminal-Bench +8.5pp vs Opus 4.7; GDPval 1890 vs 1753); roughly equal on isolated coding.
Not blanket superiority.
*Residual uncertainty:* Opus 4.8 released ~2026-05-29 (same day as research); magnitude claims
carry residual uncertainty pending independent replication; directional task-split is
well-corroborated.

### CR-8 — Tokenizer inflation magnitude (32–45% vs ~35%)
**Resolution:** Anthropic states up to ~35%; third-party (OpenRouter/findskill) estimates
32–45%. Mandated modeling figure: **~1.4× effective cost** (Interview Q7). [ASSUMPTION — 1.4×
is the planning constant, not a per-text guarantee.]
*Residual uncertainty:* exact inflation is content-dependent.

---

### CR-9 — Taxonomy Migration: 9-Spine → 10-Spine (2026-06)

**Status:** RATIFIED 3-0 after a completed 4-round adversarial debate.
**Provenance type:** INTERNAL. See `source-ledger.md` (TAXONOMY-MIGRATION-2026).

#### Old → New Mapping (orphan-free)

| Old id | Disposition | New id(s) | Key rationale |
|---|---|---|---|
| `math_proof` | kept | `math_proof` | Precedence 1 unchanged; deductive-validity verification |
| `security_review` | kept (re-ratified CATEGORY) | `security_review` + `G_SEC` | Adversarial-goal-achievement ≠ verdict-against-criterion; disjoint benchmark family |
| `architecture` | kept, redefined | `architecture` + `architecture_complexity` | Re-anchored on plan-validity core; cascade → modifier |
| `quality_review` | kept | `quality_review` + `G_COMMIT` | Hosts pre-commit contradiction gate; unchanged |
| `debugging` | kept, ↑ 5→3 | `debugging` | Observed-failure → verified-fix more specific than verdict or design; cross-module → `architecture_complexity` modifier, not reclassification |
| `agentic_execution` | kept, narrowed | `agentic_execution` + `data_analysis` + `mechanical` | Shed analytical-finding leg → `data_analysis`; shed extraction leg → `mechanical`; absorbs BFCL floor |
| `knowledge_synthesis` | kept, ↓ 7→9, tightened | `knowledge_synthesis` | Broadest prose floor; structured-dataset findings → `data_analysis` |
| `coding` | kept, tightened | `coding` | Write-code-to-analyze-dataset → `data_analysis` |
| `mechanical` | kept, absorbs | `mechanical` | Absorbs deterministic structured-extraction; BFCL relocated to `agentic_execution` floor |
| `fallback_default` | kept @99 | `fallback_default` | Off-spine catch-all; unchanged |

**Net-new tile:** `data_analysis` @ precedence 7. **Orphans = 0.**
**New modifier:** `perception_required` — cross-cutting; home for multimodal (not a tile).
Debate-internal candidates `structured_extraction` / `multimodal_perception` never shipped.

#### Impartiality Reorientation (BINDING owner directive)

All category/modifier/boundary/precedence text names zero providers, models, or effort levels.
Benchmarks measure categories; they never endorse a route. Provider-coupled gates (G_MATH,
G_SEC, G_CTX_*, G_CTX_OUT, G_SANDBOX, G_OPUS_LOCK) are restated as impartial policies.
The seed table, CR-1/CR-2, and the mandate table have had every preferred model/effort **winner**
removed; concrete per-category `{provider, model, effort}` rankings are **pending the next
impartial model-profiler run**. Model names that remain (CR-3 through CR-8 deltas, Outcome cells)
are benchmark/evidence facts owned by `./model-profiles.md` / `./cost-model.md`, **not** routes.

#### Determination Provenance (INTERNAL — not APA-citable)

- **Candidates:** 2 seed taxonomies (Claude lens + Codex lens). Both embedded provider
  `routes-to` fields; all 3 reviewers discarded those lines as NOISE under the impartiality
  rule; only task-shape structure extracted.
- **Debate:** 3 independent reviewers (R1 coverage-maximalist · R2 benchmark-empiricist ·
  R3 MECE/routing-purist); 4 adversarial rounds; fresh consensus-synthesizer (not one of the 3;
  self-review ban observed).
- **5 disputes resolved:**
  1. `security_review` CATEGORY vs MODIFIER → **CATEGORY + G_SEC** (3-0; r1: 2-1 → r3: 3-0).
     Adversarial-goal-achievement mode + disjoint benchmark family distinguish from quality_review.
  2. Multimodal TILE vs MODIFIER → **`perception_required` MODIFIER** (3-0; r1: 1-2 → r3: 3-0).
     No distinct verification mode; cross-cutting input property.
  3. `architecture` KEEP vs MERGE → **KEEP** (3-0; r1: 2-1 → r3: 3-0). Plan-validity core
     measurable (PlanBench); "proxy ⇒ kill" would equally kill `mechanical` floor.
  4. Extraction SEPARATE TILE vs FOLD → **FOLD into `mechanical`** (3-0; r2: 1-2 → r3: 3-0).
     Same routing class; coherent floor after BFCL relocation to agentic.
  5. Agentic 3-WAY SPLIT vs NARROWED-WHOLE → **NARROWED-WHOLE** (3-0; r2: 1-2 → r3: 3-0).
     Inconsistent split criterion applied by R2; flagship data benches are agentic harnesses.
- **Ratification:** unanimous 3-0; dissent none.
*Residual: `architecture` first-to-displace; `knowledge_synthesis` proxy-leaning;
`mechanical` transform-leaf proxy-only.*

---

## Mandate-Overrides-Benchmark Calls

| Mandate | Benchmark overridden | Why mandate wins |
|---------|---------------------|-----------------|
| `math_proof` member set by mandate (Interview Q10) | Arithmetic-benchmark leader (89% arithmetic) | Deliberate routing policy for formal proofs; arithmetic strength does not extend to proof correctness at frontier difficulty. Concrete member pending impartial profiling. [ASSUMPTION] |
| G_COMMIT — strongest checker or halt (never degrade) | Availability of weaker checkers | False confidence from a degraded checker is worse than a visible halt. [INFERRED] |

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
