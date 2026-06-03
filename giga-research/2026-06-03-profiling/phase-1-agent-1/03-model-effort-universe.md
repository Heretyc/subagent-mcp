# §3 — The Model@Effort Universe (THE SPINE)

The authoritative set of `model@effort` pairings all later Phase agents map onto. Effort ladders are
the **exact vendor ladders** from §1/§2 — not reordered, not invented. A "single operating point"
means the model exposes no effort ladder (use `n/a`).

## 3.1 Primary fleet (consent-doc fleet) — 15 pairings

| # | model@effort | Family | Notes |
|---|---|---|---|
| 1 | `claude-opus-4-8@low` | Claude | |
| 2 | `claude-opus-4-8@medium` | Claude | |
| 3 | `claude-opus-4-8@high` | Claude | default |
| 4 | `claude-opus-4-8@xhigh` | Claude | long-horizon; set max_tokens ≥64k |
| 5 | `claude-opus-4-8@max` | Claude | frontier only |
| 6 | `claude-sonnet-4-6@low` | Claude | |
| 7 | `claude-sonnet-4-6@medium` | Claude | recommended default |
| 8 | `claude-sonnet-4-6@high` | Claude | API default |
| 9 | `claude-sonnet-4-6@max` | Claude | no xhigh on Sonnet |
| 10 | `claude-haiku-4-5@n/a` | Claude | no effort param; single point |
| 11 | `gpt-5.5@none` | OpenAI | reasoning off |
| 12 | `gpt-5.5@low` | OpenAI | |
| 13 | `gpt-5.5@medium` | OpenAI | default |
| 14 | `gpt-5.5@high` | OpenAI | |
| 15 | `gpt-5.5@xhigh` | OpenAI | top reasoning tier |

## 3.2 Extended siblings (scope-permitted) — 7 pairings

| # | model@effort | Family | Notes |
|---|---|---|---|
| 16 | `claude-opus-4-7@low` | Claude | legacy-available "opus" anchor |
| 17 | `claude-opus-4-7@medium` | Claude | |
| 18 | `claude-opus-4-7@high` | Claude | default |
| 19 | `claude-opus-4-7@xhigh` | Claude | recommended start for coding/agentic |
| 20 | `claude-opus-4-7@max` | Claude | |
| 21 | `gpt-5.5-pro@n/a` | OpenAI | effort ladder **[gap]**; treat as single high tier |
| 22 | `gpt-5.4-mini@n/a` | OpenAI | ladder **[gap]**, caps ~`high`; budget leaf |

**Total enumerated = 22 pairings / 7 models.**

## 3.3 Eligibility facets later agents key onto (per pairing)

For each pairing the spine carries: context-in ceiling, max-output ceiling (+300k batch-beta flag
for the 4 Claude eligible), modality (all current = text+image-in/text-out → all satisfy
`perception_required` for image input), sampling-lock flag (Opus 4.7/4.8 only), cutoff date, and
$/MTok in/out (+ Opus tokenizer ≤+35% effective-cost multiplier; + GPT-5.5 >272K cliff 2x/1.5x).

## 3.4 Hard facets that gate the spine (data only — no routing decided here)

- **Context gates:** Haiku 4.5 = 200k ceiling; gpt-5.4-mini = 400k; gpt-5.5 API = 1.05M but Codex
  harness 400k [ASSUMPTION]; gpt-5.5 >272K = full-session price cliff; Opus/Sonnet = 1M.
- **Output gates:** 128k (Opus 4.8/4.7, gpt-5.5/pro/mini) vs 64k (Sonnet 4.6, Haiku 4.5); 300k batch
  beta for the 4 eligible Claude models.
- **Sampling-lock gate (G_OPUS_LOCK):** `temperature`/`top_p`/`top_k`/`budget_tokens` → 400 on Opus
  4.7/4.8; set `max_tokens ≥64k` at xhigh/max or thinking truncates.
- **Knowledge-cutoff spread:** newest reliable = Opus 4.8 (Jan 2026); oldest = Haiku 4.5 (Feb 2025).
