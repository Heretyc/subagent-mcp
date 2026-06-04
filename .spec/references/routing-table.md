# routing-table.md - Per-Category Route Table

**Load when:** selecting a provider/model/effort for a task; checking fallback chains; looking up route-table status by category.
**Do not load when:** you need category definitions or classify signals (-> [work-categories.md](./work-categories.md)); gate trigger conditions or thresholds (-> [hard-gates.md](./hard-gates.md)); benchmark numbers (-> [model-profiles.md](./model-profiles.md)).

**Current state:** the frozen `.spec/references/assets/routing-table.json` mirror is the
**canonical category spine only** (pending manifest, empty pairings) — it supplies classification
precedence + default, never a ranked route. The 2026-06-03 Full-mode re-profile emitted concrete
per-category rankings to the **runtime artifact `src/routing-table.json`** (22 model@effort pairings ×
10 categories, both `performance` and `cost_efficiency` branches; per-pairing citations in
`src/routing-table-audit.json`). Those emitted rankings live there, **not in this frozen mirror.** The
summary below mirrors the frozen spine: every spine category's route columns stay **pending** here —
to consume a ranked route, read `src/routing-table.json`.

---

## Route Summary (frozen pending spine — rankings live in `src/routing-table.json`)

Canonical precedence comes from the June 2026 consensus spine. `fallback_default` is separate and never
outranks a matched spine category. Route columns mirror the frozen pending manifest: until an impartial
profiler run populates this mirror, each route reads **pending** and the consumer follows the pointer to
the emitted runtime artifact.

| prec | category | perf #1 | cost-eff #1 | route source | notes |
|---:|---|---|---|---|---|
| 1 | `math_proof` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | Highest classification precedence. |
| 2 | `security_review` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | G_SEC mandatory cross-review applies as policy. |
| 3 | `debugging` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | — |
| 4 | `quality_review` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | — |
| 5 | `architecture` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | Plan-validity core. |
| 6 | `agentic_execution` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | — |
| 7 | `data_analysis` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | — |
| 8 | `coding` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | — |
| 9 | `knowledge_synthesis` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | — |
| 10 | `mechanical` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `src/routing-table.json` | Lowest precedence; tie-break leaf. |
| 99 | `fallback_default` | — (spine default) | — | n/a | No confident spine match; read-only until narrowed or gated. |

**Emitted-ranking residual risk** (low-confidence categories in the `src/` artifact — `quality_review`,
`data_analysis`, `mechanical` — need research backfill before trusting the runtime route): see
`decision-rationale.md` → "2026-06-03 Full-mode re-profile" for the residual-risk record.

---

## Cross-References

- Category definitions + classify signals -> [work-categories.md](./work-categories.md)
- Gate trigger conditions and thresholds -> [hard-gates.md](./hard-gates.md)
- Benchmark evidence and future profiler inputs -> [model-profiles.md](./model-profiles.md)
- Machine-consumable rankings (runtime) -> `src/routing-table.json` + citations `src/routing-table-audit.json`
- Category spine only (frozen, pending manifest) -> [assets/routing-table.json](./assets/routing-table.json)

---

*Author: Lexi Blackburn - https://github.com/Heretyc/ - June 2026*
