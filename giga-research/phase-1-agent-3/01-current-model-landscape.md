## SECTION 1: CURRENT MODEL LANDSCAPE (WEB-VERIFIED, 2026-05-29)

### Claude Family — Confirmed Specifications

| Model | API ID | Context In/Out | Pricing ($/MTok) | Effort Support | Latency |
|---|---|---|---|---|---|
| **Opus 4.8** [NEW] | claude-opus-4-8 | 1M / 128k | $5 / $25 | low/med/high/xhigh/max | Moderate |
| Opus 4.7 | claude-opus-4-7 | 1M / 128k | $5 / $25 | low/med/high/xhigh/max | Moderate |
| Opus 4.6 | claude-opus-4-6 | 1M / 128k | $5 / $25 | low/med/high/max | Moderate |
| **Sonnet 4.6** | claude-sonnet-4-6 | 1M / 64k | $3 / $15 | low/med/high/max | Fast |
| **Haiku 4.5** | claude-haiku-4-5 | 200k / 64k | $1 / $5 | — | Fastest |

**Opus 4.8 key facts (web-verified):**
- Released May 28–29, 2026; pricing parity with Opus 4.7 ($5/$25 per MTok).
- SWE-bench Verified: 88.6% (vs. 87.6% Opus 4.7; vs. 88.7% GPT-5.5). [INFERRED: margin within noise; task-specific routing matters more than top-line rank.]
- SWE-bench Pro (harder variant): 69.2% vs. GPT-5.5's 58.6% — Opus 4.8 leads by ~10.6 pp.
- GDPval-AA (real knowledge work, max effort): 1,890 pts vs. GPT-5.5's 1,769 pts (~67% head-to-head win rate).
- Super-Agent benchmark: only model to complete all cases end-to-end.
- ~4x less likely than Opus 4.7 to leave code flaws unremarked (honesty improvement).
- Dynamic Workflows (research preview): parallel sub-agent orchestration within a single session.
- Effort default is `high` on all surfaces; use `xhigh` for coding/agentic; `max` for frontier reasoning only.
- Adaptive thinking (not extended thinking); `thinking: {type: "adaptive"}` required to enable.
- Knowledge cutoff: Jan 2026 (reliable); training data cutoff: Jan 2026.

**GPT-5.5 key facts (web-verified):**
- Released April 23, 2026; first fully retrained OpenAI base model since GPT-4.5.
- Terminal-Bench 2.0: 82.7% (Codex CLI + GPT-5.5: 82.0%) — state-of-the-art for autonomous CLI.
- SWE-bench Verified: 88.7% (±noise vs. Opus 4.8's 88.6%).
- SWE-bench Pro: 58.6% — substantially behind Opus 4.8's 69.2%.
- GDPval (knowledge work): 84.9; OSWorld-Verified (computer use): 78.7.
- 60% hallucination reduction vs. GPT-5.4; 40% fewer output tokens on same Codex tasks.
- CyberGym / security: 71.4% pass rate on expert cybersecurity tasks (classified "High" capability).
- Weakness: concurrency bugs (170/mLOC threading issues dominate bug profile); "follows instructions too literally" when prompts lack clarity.
- 1M token context (API); 400K (Codex).

**Claude Sonnet 4.6:**
- SWE-bench Verified: 79.6% (vs. Opus 4.6's 80.8% — 1.2 pp gap).
- 40% cheaper than Opus; ~2x faster; 70% more token-efficient in real-world coding tests.
- Extended thinking + adaptive thinking supported.
- Recommended effort for most use: `medium` ([agentic mention removed], tool-heavy workflows); `high` for quality-critical; `low` for high-volume/latency-sensitive.

**Claude Haiku 4.5:**
- SWE-bench Verified: 73.3% (vs. Sonnet 4.6's 79.6% — 6.3 pp gap).
- 3–5x faster than Sonnet; $1/$5 per MTok (3x cheaper than Sonnet on output).
- Context window 200K (vs. 1M for Sonnet/Opus) — a hard constraint for long-document tasks.
- No effort parameter support.
- Extended thinking supported (but not recommended for sub-agent leaf nodes).
- Optimal for: file nav, symbol resolution, import tracing, format checks, classification, extraction, simple codegen, sub-agent leaf nodes.
- Limitation: multi-step reasoning chains, nuanced judgment, synthesis of very long documents.
