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

| [SEED] claim (Blackburn 2026) | Outcome | Routing consequence | Source id(s) |
|---|---|---|---|
| Opus = planning / architecture / synthesis / nuance | **Corroborated** (GDPval-AA 1890; +144 Elo Opus 4.6 vs GPT-5.2) | `architecture`, `knowledge_synthesis` primary = Opus 4.8 | `VENTUREBEAT-2026` [PRESS], `DATACAMP-OPUS46` |
| Sonnet = balanced debug / review / reasoning | **Corroborated** (79.6% SWE-bench Verified; ~70% dev preference daily coding) | `coding`, `debugging` primary = Sonnet 4.6 | `ANTH-SONNET46`, `DATACAMP-S46` |
| Haiku = fast coding / file ops | **Corroborated** (73.3% SWE-bench; Claude Code auto-routes leaf work) | `mechanical` primary = Haiku 4.5 | `ANTH-HAIKU45`, `DATACAMP-H45` |
| GPT-5.5 = closed-loop / extraction / proofs / terminal | **Corroborated** (Terminal-Bench ~82–83%; ~40% fewer output tokens) | `agentic_execution`, `math_proof`, `coding` (closed-loop) | `CODERABBIT-2026`, `OAI-GPT55`; 20-hr task completion [ASSUMPTION — source unconfirmed] |
| GPT-5.5 = confident hallucination + security bugs | **Corroborated** (CWE-732 misses; hallucinated `pathlib` arg; AISI cyber eval; Sonar; Endor) | G_SEC mandatory cross-review | `AISI-2026`, `SONAR-2026`, `ENDOR-2026` |
| Opus = caution / stall + verbosity | **Corroborated** (official low-effort docs) | Pattern P4b stall recovery | `ANTH-EFFORT` [INFERRED] |
| ≤5 separable workers + 1 coordinator; no duplicate tasks | **Adopted** as fan-out capacity model | Anti-Pattern A; Patterns P1/P2 | `ADAPTORCH` |
| Opus 4.8 ≫ 4.7 on ALL tasks | **OVERRIDDEN** → task-split framing: leads agentic/long-horizon, ~equal isolated coding (Interview Q2) | §CR-7 below | `CONTRA-2026`, `DECODER-2026` [PRESS] |
| Haiku for ALL coding | **OVERRIDDEN** → Haiku is `mechanical`-only; multi-file/semantic coding → Sonnet/Codex | §1.9 boundary in `./work-categories.md` | `ANTH-HAIKU45` |

---

## Conflict Reconciliations (CR-1 through CR-8)

### CR-1 — Category count and names (8 vs 9; naming variants)
Synths 1/2/3/5 converged on 8; synth 4 used 9 (added explicit `fallback_default`).
**Resolution:** 8 canonical work categories + explicit `fallback_default` route. The classifier
emits one of 8; the router supplies the default when none match. `extraction_terminal` /
`terminal_exec` / `agentic_operations` → merged into `agentic_execution` (identical Codex route).
`reasoning_judgment` / `deep_reasoning` → merged into `knowledge_synthesis`; pure tie-breaking
sits in `quality_review`.
*Residual uncertainty:* `agentic_execution` ∩ `coding` boundary (one-shot edit vs run-observe
loop) is the most likely real-world mis-class. Precedence order + adjacent-tie escalation handle
it; evals should monitor.

### CR-2 — `coding` primary route (Sonnet vs Codex/GPT-5.5)
Synths 1/2/5 → Sonnet 4.6 @ medium. Synths 3/4 → Codex/GPT-5.5 (closed-loop framing).
**Resolution:** Sonnet 4.6 @ medium is primary for `coding`. GPT-5.5/Codex routes closed-loop
work, which is precisely `agentic_execution`. Preserves cost-quality default (79.6% SWE-bench at
$3/$15 MTok) and clean split.
*Residual uncertainty:* teams running nearly all coding through Codex may prefer the synth-3/4
default; eval-tunable policy, not a correctness issue.

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

## Mandate-Overrides-Benchmark Calls

| Mandate | Benchmark overridden | Why mandate wins |
|---------|---------------------|-----------------|
| `math_proof` → GPT-5.5 (Interview Q10) | Sonnet 4.6 89% arithmetic benchmark | Deliberate routing policy for formal proofs; Sonnet's arithmetic strength does not extend to proof correctness at frontier difficulty. [ASSUMPTION] |
| G_COMMIT — strongest checker or halt (never degrade) | Availability of weaker checkers | False confidence from a degraded checker is worse than a visible halt. [INFERRED] |

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
