# Phase 0 — Consent Record

- Session date: 2026-05-29 (orchestrator has no wall-clock tool; date from session context)
- Platform mechanism: Claude Code `AskUserQuestion` (native structured-question tool; no mode switch)
- Subject (confirmed): Cross-provider model-routing knowledge base — which models (OpenAI Codex/GPT-5.5 vs Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5) and which effort/reasoning settings are best for which software-engineering task types, with emphasis on cross-model synergy/handoffs. Working assumption (accepted, sparse external corroboration): Opus 4.8 is materially stronger than Opus 4.6/4.7 at the same tasks.
- Pipeline mode: FAST (Phases 0, 1, 1.5, 2). The user's mandated 3-pass adversarial loop runs downstream as a QA gate on the `.spec/references/` artifact (compatible: Fast = research engine; 3-pass = post-assembly critique).
- Provider mix: Claude + Codex (GPT-5.5).
- Consent responses:
  - (a) Subject confirmation: Confirmed as summarized.
  - (b) Pipeline mode: Fast.
  - (c) Runtime acknowledgment: Confirmed — proceed.
  - (d) Usage/quota (Full mode only): N/A in Fast mode; user separately confirmed budget.
- Final deliverable: `.spec/references/` decomposed RAG knowledge base. `giga-research/` holds provenance/reproducibility artifacts.
- Author: Lexi Blackburn (GitHub: https://github.com/Heretyc/).
- Known degraded condition at dispatch time: EKM memory MCP recall returned DatabaseError ("malformed database schema"); durable memory save is deferred and re-checked before any write.
