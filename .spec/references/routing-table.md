# routing-table.md - Per-Category Route Table

**Load when:** selecting a provider/model/effort for a task; checking fallback chains; looking up route-table status by category.
**Do not load when:** you need category definitions or classify signals (-> [work-categories.md](./work-categories.md)); gate trigger conditions or thresholds (-> [hard-gates.md](./hard-gates.md)); benchmark numbers (-> [model-profiles.md](./model-profiles.md)).

**Current state:** the 2026-06-03 Full-mode re-profile has emitted per-category rankings. The
**machine-readable rankings now live in `src/routing-table.json`** (runtime artifact, 22
model@effort pairings × 10 categories, both `performance` and `cost_efficiency` branches); per-pairing
citations in `src/routing-table-audit.json`. The frozen `.spec/references/assets/routing-table.json`
mirror remains the **canonical category spine only** (pending manifest, empty pairings) — it supplies
classification precedence + default, never a ranked route. The summary below is human-readable and
**derived from the emitted `src/routing-table.json` rank-1 rows** — do not edit it by hand; regenerate
from the JSON.

---

## Top-Route Summary (derived from `src/routing-table.json`)

Canonical precedence comes from the June 2026 consensus spine. `fallback_default` is separate and never
outranks a matched spine category. "perf #1" = rank-1 `performance` pairing; "cost-eff #1" = rank-1
`cost_efficiency` pairing. ⚠ marks **low-confidence** categories (see notes). Rankings are scored
impartially from discovered benchmark research; they are evidence-derived, not endorsements.

| prec | category | perf #1 | cost-eff #1 | conf | notes |
|---:|---|---|---|---|---|
| 1 | `math_proof` | `claude-opus-4-8@high` | `claude-opus-4-8@high` | high | perf rank-2 (`@xhigh`) is interpolated/low. |
| 2 | `security_review` | `gpt-5.5@none` | `claude-sonnet-4-6@low` | perf high / cost med | Branches diverge: GPT leads raw, Sonnet wins $/perf. |
| 3 | `debugging` | `claude-opus-4-8@low` | `gpt-5.5@none` | medium | Opus + gpt-5.5 tie at top of perf; gpt-5.5 cheapest. |
| 4 | `quality_review` | `gpt-5.5@none` | `gpt-5.5@none` | ⚠ low | Zero exact-effort rows; extreme polarity split (gpt-5.5 1.0 vs opus-4-8 0.0) off 2 inverted benchmarks. |
| 5 | `architecture` | `claude-opus-4-8@low` | `claude-opus-4-8@low` | high | Plan-validity core; opus lineage sweeps top. |
| 6 | `agentic_execution` | `claude-opus-4-8@high` | `gpt-5.5@none` | measured/high | Only category with measured rank-1 perf (0.748). |
| 7 | `data_analysis` | `claude-opus-4-8@low` | `claude-opus-4-8@low` | ⚠ low | Rank-1 is SOP-1 promoted/interpolated; thin rows. |
| 8 | `coding` | `claude-opus-4-8@low` | `claude-opus-4-8@low` | high | gpt-5.5 SWE-bench Verified rows withdrawn (SOP-3). |
| 9 | `knowledge_synthesis` | `claude-opus-4-8@low` | `gpt-5.5@none` | medium | Opus tops perf; gpt-5.5 wins $/perf. |
| 10 | `mechanical` | `claude-haiku-4-5@null` | `claude-haiku-4-5@null` | ⚠ low | **All sentinel** — zero universe benchmark rows; order is tie-break only, not measured. |
| 99 | `fallback_default` | — (spine default) | — | n/a | No confident spine match; read-only until narrowed or gated. |

**Low-confidence categories** (⚠ — need research backfill before trusting the route): `quality_review`,
`data_analysis`, `mechanical`. See `decision-rationale.md` → "2026-06-03 Full-mode re-profile" for the
residual-risk record.

---

## Cross-References

- Category definitions + classify signals -> [work-categories.md](./work-categories.md)
- Gate trigger conditions and thresholds -> [hard-gates.md](./hard-gates.md)
- Benchmark evidence and future profiler inputs -> [model-profiles.md](./model-profiles.md)
- Machine-consumable rankings (runtime) -> `src/routing-table.json` + citations `src/routing-table-audit.json`
- Category spine only (frozen, pending manifest) -> [assets/routing-table.json](./assets/routing-table.json)

---

*Author: Lexi Blackburn - https://github.com/Heretyc/ - June 2026*
