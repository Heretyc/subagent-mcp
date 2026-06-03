# §4 — DIFF vs Baseline + Source Ledger

Baselines read for DIFF only (never inherited): `.spec/references/model-profiles.md`,
`.spec/references/cost-model.md`, prior flat `giga-research/phase-1-agent-1*` (dated 2026-05-29).

## 4.1 Deltas / corrections vs baseline

| Item | Baseline said | This run (cited) | Verdict |
|---|---|---|---|
| Opus tokenizer inflation | "~32–45% more tokens; ~1.4x effective" | Official: "**up to 35%** more tokens" | **DIFF** — baseline 1.4x overstates vendor's ≤35%; recommend recalibrate to ≤1.35x [ASSUMPTION on effective $] |
| Opus 4.8 knowledge cutoff | not stated in profiles | reliable **Jan 2026** / training Jan 2026 | NEW fill |
| Sonnet 4.6 cutoff | implied recent | reliable **Aug 2025** / training Jan 2026 | NEW precision |
| Sonnet 4.6 effort | low·med·high·max | confirmed (no xhigh) | MATCH |
| Haiku 4.5 effort | "fixed low (none)" | confirmed: **no effort param**; extended-thinking toggle only | MATCH (clarified) |
| GPT-5.5 context | 1.05M API / 400K Codex / 128K out / 272K cliff | 1,050,000 / 128k out / >272K 2x-in 1.5x-out; 400K = harness [ASSUMPTION] | MATCH; cliff multipliers now precise |
| GPT-5.5 cutoff | not stated | **Dec 01, 2025**; released 2026-04-23 | NEW fill |
| gpt-5.5-pro | $30/$180, effort "pro" | $30/$180 confirmed; effort ladder **[gap]** | MATCH $; ladder unconfirmed |
| gpt-5.4-mini | "light" effort, ctx "—" | 400k/128k, $0.75/$0.075/$4.50, cutoff Aug 31 2025, ladder [gap] | NEW fill |
| Mythos Preview | absent | exists (invite-only defensive-cyber); out-of-fleet | NEW |
| 300k output batch beta | absent | Opus 4.8/4.7/4.6 + Sonnet 4.6 | NEW (output_size gate input) |

## 4.2 Source ledger (ORIGINAL sources; retrieved 2026-06-03)

| id | URL | Tier | Supports |
|---|---|---|---|
| ANTH-OVERVIEW | https://platform.claude.com/docs/en/about-claude/models/overview | 1 | Claude ids, ctx/out, cutoffs, thinking modes, modality |
| ANTH-PRICING | https://platform.claude.com/docs/en/about-claude/pricing | 1 | Claude $ in/out/cache/batch, fast mode, tokenizer ≤35%, 1M std price |
| ANTH-OPUS48 | https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8 | 1 | Opus 4.8 id, 1M/128k, adaptive-only, sampling lock, effort default high |
| ANTH-EFFORT | https://platform.claude.com/docs/en/build-with-claude/effort | 1 | exact effort ladder + per-model support (xhigh=4.8/4.7; max set) |
| OAI-GPT55 | https://developers.openai.com/api/docs/models/gpt-5.5 | 1 | gpt-5.5 1.05M/128k, effort none→xhigh, cutoff Dec-01-2025, >272K cliff, $5/$30 |
| OAI-GPT55PRO | https://developers.openai.com/api/docs/models/gpt-5.5-pro | 1 | gpt-5.5-pro 1.05M/128k, $30/$180, cutoff Dec-01-2025 |
| OAI-GPT54MINI | https://developers.openai.com/api/docs/models/gpt-5.4-mini | 1 | gpt-5.4-mini 400k/128k, $0.75/$0.075/$4.50, cutoff Aug-31-2025 |
| OR-GPT55 | https://openrouter.ai/openai/gpt-5.5 | 2 | independent corroboration: GPT-5.5 1M+ (922k in/128k out), $5/$30 |

**Failed source:** `openai.com/index/introducing-gpt-5-5/` → HTTP 403 (announce page unreadable);
specs sourced from OAI-GPT55 (official API doc) + OR-GPT55 instead.

## 4.3 Open gaps for downstream phases (fail-loud)

1. `gpt-5.5-pro` and `gpt-5.4-mini` effort ladders — pull from the live OpenAI Models API.
2. Codex CLI 400K harness cap — re-confirm against current Codex docs (only [ASSUMPTION] now).
3. Opus effective-cost multiplier — baseline 1.4x vs vendor ≤1.35x; pick one, flag the other.
4. Claude Mythos Preview spec card — no public numbers; leave out-of-fleet unless invite confirmed.
