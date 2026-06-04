# Phase 1.5 — Pivotal-Question Interview (run 2026-06-03 Full-mode re-profile)

Derived from ALL Phase-1 outputs. Each question is decision-relevant: its answer materially moves
a per-category tier ranking or the cost_efficiency ordering. Owner-answerable without re-reading raw
research. Record answers inline under each **OWNER ANSWER:** slot. No rankings inherited from baseline.

Taxonomy (FIXED, precedence): math_proof > security_review > debugging > quality_review >
architecture > agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical.

---

## q1 — How does the `opus` route alias resolve: Opus 4.6 or Opus 4.7?

**Why it matters.** Direct source CONFLICT. Phase-0 consent lists `opus` with no version. Agent-2
[ASSUMPTION] attributes ALL its reasoning/security/debug rows to **Opus 4.6**. Agent-1's authoritative
spine instead names **Opus 4.7** the "legacy-available 'opus' anchor" (routable extended sibling, full
low→max ladder) and lists **4.6 as "legacy-available (not routed here)."** Routing `opus`→4.6 would
point at a non-routed model and mis-attribute every Agent-2 score. Moves every category where `opus`
is an option (math_proof, security_review, debugging, quality_review, coding, knowledge_synthesis).

**Options**
- **`opus` = Opus 4.7 (RECOMMENDED)** — matches the authoritative spine; 4.7 is the routable sibling
  with full effort ladder + new tokenizer + G_OPUS_LOCK parity with 4.8; 4.6 is explicitly not routed.
- `opus` = Opus 4.6 — honors Agent-2's working assumption; but 4.6 is out-of-fleet per Agent-1, and
  forces re-tagging 4.7 rows as orphans.
- Carry both as distinct routes (4.6 budget-legacy + 4.7 anchor) — most faithful, but adds a pairing
  the consent fleet did not enumerate.

**OWNER ANSWER:**

---

## q2 — What anchors the `coding` tier, and does the gap break the Opus/gpt-5.5 tie?

**Why it matters.** SWE-bench Verified shows a statistical TIE: Opus 4.8 88.6% vs gpt-5.5 88.7%
(within noise). SWE-bench Pro shows Opus 4.8 **+10.6pp** (69.2% vs 58.6%). But the gpt-5.5 Verified
88.7% is a **pre-deprecation** [ASSUMPTION] aggregator row (OpenAI withdrew Verified self-reporting),
and Agent-2 could not find it at all; the Pro gap rests on a **single press source** (the-decoder).
Determines coding tier-1 sole-vs-shared, and cost_efficiency (gpt-5.5 is cheaper).

**Options**
- **Anchor on SWE-bench Pro → Opus 4.8 sole tier-1, gpt-5.5 tier-2 (RECOMMENDED, gated on q4)** — Pro is
  current, both-family, and discriminates; the Verified gpt-5.5 row is withdrawn/uncorroborated. Adopt
  only if q4 lets a single-press ≥10pp gap move one tier; else fall back to co-tier-1.
- Keep co-tier-1 (Verified tie) — treats Pro as too thinly sourced to break the tie; cost then favors gpt-5.5.
- Anchor on Verified only — rejected: gpt-5.5 row is deprecated and unverifiable.

**OWNER ANSWER:**

---

## q3 — `agentic_execution` tier-1 when benchmarks disagree on the leader?

**Why it matters.** Genuine benchmark DISAGREEMENT. Terminal-Bench 2.1: gpt-5.5 82.7% > Opus 4.8 74.6%
(gpt-5.5 +8pp). OSWorld-Verified: Opus 4.8 ~82–83% > gpt-5.5 78.7%. GDPval-AA: Opus 4.8 1890 > gpt-5.5
1769. All [ASSUMPTION]. The split tracks task TYPE (terminal/CLI vs GUI/desktop + economic agency).
The tile spans single tool-call floor → long multi-step ceiling, so both ends are in-scope. Flips the
top of a precedence-6 tile hit often by auto-mode.

**Options**
- **Co-tier-1, tie-break to gpt-5.5 on cost (RECOMMENDED)** — 2 of 3 signals favor Opus but Terminal-Bench
  is the cleanest closed-loop proxy and gpt-5.5 is far cheaper; treat as genuine task-type divergence.
- Opus 4.8 sole tier-1 — weights OSWorld+GDPval (2 signals, economic agency) over terminal-only.
- Split the tile by sub-type (terminal→gpt-5.5; GUI/long-horizon→Opus) — most accurate, but adds routing
  branching the contract may not support yet.

**OWNER ANSWER:**

---

## q4 — Corroboration posture: how far may an [UNVERIFIED]/[ASSUMPTION]-only gap move a tier?

**Why it matters.** Nearly every headline number (SWE-bench Pro, GPQA, HLE, Terminal-Bench, GDPval,
OSWorld) is vendor-card [UNVERIFIED] or single-press [ASSUMPTION]. Without a rule, thin sourcing can
silently rewrite rankings (esp. q2, q3, q5). Also fixes how to treat WITHDRAWN vendor self-reports
(OpenAI's deprecated Verified row).

**Options**
- **Cap at ±1 tier AND require ≥10pp (or ≥ benchmark noise band); withdrawn self-reports discarded
  (RECOMMENDED)** — lets strong, large, current proxies move one tier but blocks thinly-sourced reshuffles.
- Vendor/single-press evidence informational only — never moves a tier without Tier-2/3 corroboration
  (most conservative; freezes coding/architecture near baseline).
- No cap — rank on best available number regardless of label (fastest; highest mis-rank risk).

**OWNER ANSWER:**

---

## q5 — `architecture` has ZERO measured current-gen data: how to rank it?

**Why it matters.** Weakest tile by design. PlanBench/NATURAL-PLAN/ACPBench are all stale at 2024 (no
Claude 4.x / GPT-5.x rows). The ONLY current-gen signal is SWE-bench Pro (a multi-step proxy, single
press source) → Opus 4.8 > Sonnet 4.6 > gpt-5.5. Precedence-5 tile; interpolation choice sets its whole
ranking. The `architecture_complexity` modifier already forces plan + cross-review, mitigating mis-rank.

**Options**
- **SWE-bench Pro proxy, low-confidence tag (RECOMMENDED)** — only current-gen signal; mirrors coding Pro
  order; flag [PROXY/low-confidence]; mandatory cross-review modifier covers residual risk. Discard 2024 benches.
- Blend debugging + knowledge_synthesis tiers as a synthetic architecture rank — avoids leaning on one
  proxy, but invents a composite with no benchmark backing.
- Hold all architecture pairings at one undifferentiated tier until a current-gen PlanBench run exists —
  safest, but gives auto-mode no preference signal on a high-precedence tile.

**OWNER ANSWER:**

---

## q6 — Opus tokenizer inflation constant: 1.4x or 1.35x, flat or content-dependent?

**Why it matters.** Spec reconciliation. Baseline cost-model uses **1.4x** [ASSUMPTION]; official
Anthropic docs (pricing + migration) state "**up to 35%**" = **1.35x max**. Applies to Opus 4.7/4.8
ONLY (Sonnet/Haiku/4.6 = old tokenizer, no inflation). Shifts Opus cost_efficiency vs gpt-5.5 across
every category; at scale the 1.4x figure overstates cost ~$74K/mo per 1M high-effort calls.

**Options**
- **Adopt 1.35x flat; mark 1.4x [DEPRECATED] (RECOMMENDED)** — vendor-confirmed upper bound; conservative
  for budgeting; single constant keeps the cost model simple.
- 1.0x–1.35x content-dependent (code lower, prose ~1.35x) — most accurate, but needs a content classifier
  the router doesn't have; risks under-budgeting.
- Keep 1.4x — rejected: exceeds the vendor-stated maximum.

**OWNER ANSWER:**

---

## q7 — gpt-5.5 cost_efficiency: price at the ≤272K base rate or the >272K cliff?

**Why it matters.** Spec reconciliation / cost-blend side. The reference blend (100K in / 20K out) sits
BELOW the cliff, so general ranking uses base $5/$30. But >272K input flips the **full session** to
$10/$45 (+86% on a 300K blend) — which can push gpt-5.5 BELOW Claude Opus/Sonnet (no cliff) exactly
when the `context_size`/G_CTX_272 modifier fires. One rate hides this; two rates capture it.

**Options**
- **Two-state cost: base rate for default ranking, cliff rate auto-applied under G_CTX_272 (RECOMMENDED)** —
  matches actual billing; lets the large-context branch correctly de-rank gpt-5.5 and redirect to a
  no-cliff Claude member.
- Always price at base ≤272K rate — simplest; but over-ranks gpt-5.5 on large-context routes (wrong
  cost-efficiency exactly where it matters).
- Always price at cliff rate — over-penalizes the common sub-272K case.

**OWNER ANSWER:**

---

### Cross-cutting notes (not questions)
- q2/q3/q5 all DEPEND on q4 — answer q4 first; it sets how much thin-sourced gaps may move.
- q1 must resolve before any `opus`-route tier is finalized (re-attributes all Agent-2 rows).
- gpt-5.5-pro and gpt-5.4-mini have ladder gaps AND no category benchmark rows — recommend holding both
  as [UNVERIFIED] frontier/budget leaves (no tier claim) until OpenAI Models-API effort data is pulled;
  raise as a follow-up if the owner wants them routable this run.
- data_analysis current-gen is sparse: only gpt-5.5 BIRD-SQL 72.55% [SEED] edges Opus 4.6 70.15%; no
  Opus 4.8 row. Default = rank gpt-5.5 measured-leader, interpolate Opus 4.8 ≥ Opus 4.6 (q4 caps lift).
