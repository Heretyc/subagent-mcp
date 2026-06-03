# routing-table.md - Per-Category Route Table

**Load when:** selecting a provider/model/effort for a task; checking fallback chains; looking up route-table status by category.
**Do not load when:** you need category definitions or classify signals (-> [work-categories.md](./work-categories.md)); gate trigger conditions or thresholds (-> [hard-gates.md](./hard-gates.md)); benchmark numbers (-> [model-profiles.md](./model-profiles.md)).

**Current state:** the route rankings are pending an impartial profiler run. This table carries only the canonical category spine and explicit pending route placeholders.

---

## Route Table

Canonical precedence comes from the June 2026 consensus spine. The `fallback_default` entry is separate and never outranks a matched spine category.

| prec | category | performance route/model | cost-efficient route/model | profiling status | notes |
|---:|---|---|---|---|---|
| 1 | `math_proof` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Formal proof, derivation, and deductive correctness core. |
| 2 | `security_review` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Vulnerability, permission, auth, crypto, and threat-model review. |
| 3 | `debugging` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Observed failure, root-cause localization, and verified repair. |
| 4 | `quality_review` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Non-security artifact review, contradiction checks, and tie-breaks. |
| 5 | `architecture` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Cross-module design, decomposition, and interface-impact planning. |
| 6 | `agentic_execution` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Closed-loop tool execution and structured local-artifact workflows. |
| 7 | `data_analysis` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Data, table, SQL, quantitative analysis, and evidence-backed computation. |
| 8 | `coding` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Bounded implementation, tests, scripts, configs, and docs. |
| 9 | `knowledge_synthesis` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Multi-source synthesis, long-context integration, and gray-area judgment. |
| 10 | `mechanical` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `pending_impartial_profiling` | Deterministic leaf work, search, extraction, and template transforms. |
| 99 | `fallback_default` | pending impartial profiler run (rankings determined solely from discovered research) | pending impartial profiler run (rankings determined solely from discovered research) | `fallback_default` | No confident spine match; read-only until narrowed or gated. |

---

## Cross-References

- Category definitions + classify signals -> [work-categories.md](./work-categories.md)
- Gate trigger conditions and thresholds -> [hard-gates.md](./hard-gates.md)
- Benchmark evidence and future profiler inputs -> [model-profiles.md](./model-profiles.md)
- Machine-consumable route table -> [assets/routing-table.json](./assets/routing-table.json)

---

*Author: Lexi Blackburn - https://github.com/Heretyc/ - June 2026*
