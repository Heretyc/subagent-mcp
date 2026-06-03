# Phase 0 — Consent (run 2026-06-03, Full-mode re-profile)

- Profiling scope: Claude family (opus-4-8 = Opus 4.8, opus, sonnet = Sonnet 4.6, haiku = Haiku 4.5) + OpenAI/Codex family (gpt-5.5); current-generation. Both `claude` and `codex` CLIs verified present on PATH.
- Mode: **Full** (wider fan-out + extra adversarial passes).
- Runtime/budget: background detached run; generous wall-clock; no hard token ceiling (ultracode posture). ≥5 min between check-ins per agent.
- Provider mix: claude + codex reachable now; cross-family mandatory and satisfiable.
- Model universe scope: **current-generation** (keeps older low-cost tiers that anchor low-complexity routes; avoids orphaning a budget route).
- routing-table.json + audit + build-wiring authorized: **yes**.
- Consent: granted by owner (rich.mint2554@ioc.dev) via AskUserQuestion at session start 2026-06-03.
- Output location: this run's provenance lives under `giga-research/2026-06-03-profiling/`. Prior flat `giga-research/*` files are the committed DIFF BASELINE — read to diff/flag deltas, never inherit as source of truth, never overwrite.
- Notes/constraints: This run feeds the subagent-mcp "auto mode" feature being built in parallel on branch `feature/auto-mode-routing`. Profiler is DATA-ONLY — it must NOT edit `src/index.ts` (auto-mode routing logic owned by the parallel build track). It MAY write: `.spec/references/**` leaves, `.spec/references/assets/routing-table.json` + `routing-table-audit.json`, `src/routing-table.json`, `scripts/copy-provider.mjs`, `scripts/validate_provider.mjs`, `.spec/references/scripts/validate_kb.py` taxonomy constants, `source-ledger.md`, `decision-rationale.md`, this run's `giga-research/2026-06-03-profiling/**`. It must NOT touch `package.json` (owned by the build track this run).
- Fixed taxonomy precedence: math_proof > security_review > debugging > quality_review > architecture > agentic_execution > data_analysis > coding > knowledge_synthesis > mechanical; fallback_default @ 99.
