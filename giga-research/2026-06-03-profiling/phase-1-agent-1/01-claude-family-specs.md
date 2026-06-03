# §1 — Claude Family: Per-Model Specifications

Source: Anthropic official model overview + pricing + effort/adaptive-thinking docs (Tier 1),
corroborated by aggregators (Tier 2/5) in §4. Retrieved 2026-06-03. All current models are
text+image **in**, text **out**, vision-capable, multilingual (official "Models overview").

## 1.1 Current-generation fleet

| Field | **Opus 4.8** | **Sonnet 4.6** | **Haiku 4.5** |
|---|---|---|---|
| API id | `claude-opus-4-8` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`) |
| Context window (in) | 1M (200k on MS Foundry) | 1M | 200k |
| Max output | 128k (300k via batch beta) | 64k (300k via batch beta) | 64k |
| Effort ladder | low·medium·high·xhigh·max | low·medium·high·max (**no xhigh**) | **none** (effort param unsupported) |
| Effort default | `high` | `high` (set explicitly — latency) | n/a |
| Thinking mode | adaptive only (no `budget_tokens` → 400) | adaptive (interleaved `budget_tokens` deprecated, still works) | extended thinking Yes; adaptive No |
| Sampling lock | `temperature`/`top_p`/`top_k` non-default → 400 | not locked | not locked |
| Reliable cutoff | **Jan 2026** | **Aug 2025** | **Feb 2025** |
| Training cutoff | Jan 2026 | Jan 2026 | Jul 2025 |
| Price in/out (MTok) | $5 / $25 | $3 / $15 | $1 / $5 |
| Cache hit / 5m write / 1h write | $0.50 / $6.25 / $10 | $0.30 / $3.75 / $6 | $0.10 / $1.25 / $2 |
| Batch in/out | $2.50 / $12.50 | $1.50 / $7.50 | $0.50 / $2.50 |
| Fast mode in/out | $10 / $50 (2.5x speed, preview) | — | — |

## 1.2 Extended / "opus"-alias candidate — Opus 4.7 (legacy-available, in-scope)

| Field | **Opus 4.7** (`claude-opus-4-7`) |
|---|---|
| Context / output | 1M / 128k (300k batch beta) |
| Effort ladder | low·medium·high·xhigh·max · default `high` |
| Thinking | adaptive only; `budget_tokens` → 400 (no manual extended thinking) |
| Sampling lock | `temperature`/`top_p`/`top_k` non-default → 400 |
| Reliable / training cutoff | Jan 2026 / Jan 2026 |
| Price in/out | $5 / $25 · batch $2.50/$12.50 · fast mode $30/$150 |

The bare `opus` selector in scope resolves to the current default Opus (4.8); Opus 4.7 is the
nearest legacy Opus still API-available and is retained as the budget/route-anchor Opus. [INFERRED]

## 1.3 Notes (official)

- **Tokenizer inflation:** Opus 4.7 **and later** use a new tokenizer that "may use up to 35% more
  tokens for the same fixed text"; per-token price unchanged → effective cost per request up to
  +35%. (Anthropic pricing page.) Opus 4.6 uses the old tokenizer. *DIFF vs baseline 1.4x in §4.*
- **1M context at standard price** (no surcharge): Opus 4.8/4.7/4.6 + Sonnet 4.6.
- **Data residency:** `inference_geo:"us"` = 1.1x all token categories (Opus 4.6/Sonnet 4.6+).
- **300k output beta** (`output-300k-2026-03-24`): Opus 4.8/4.7/4.6 + Sonnet 4.6 — feeds `output_size` modifier eligibility.
- **Haiku 4.5 has no effort parameter** (absent from the effort-supported list: Opus 4.8, Mythos,
  4.7, 4.6, Sonnet 4.6, Opus 4.5). It exposes extended-thinking on/off only — a single operating point.
- **Claude Mythos Preview** (Project Glasswing): defensive-cybersecurity research preview, adaptive
  thinking by default, supports effort incl. `max`. **Invite-only, no self-serve** → documented, NOT
  in the routable fleet. [UNVERIFIED — no public spec card]
- Legacy-but-available (read-as-DIFF, not routed): `claude-opus-4-6` (1M/128k, low·med·high·max,
  $5/$25), `claude-opus-4-5` (200k/64k, manual thinking + effort), `claude-sonnet-4-5` (200k/64k).
- Deprecated (retire 2026-06-15): `claude-sonnet-4`, `claude-opus-4`.
