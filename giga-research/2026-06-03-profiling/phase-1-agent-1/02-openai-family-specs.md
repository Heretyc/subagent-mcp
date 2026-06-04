# §2 — OpenAI / Codex Family: Per-Model Specifications

Source: OpenAI official API model docs (developers.openai.com, Tier 1) + OpenRouter independent
corroboration (Tier 2) for GPT-5.5. Retrieved 2026-06-03.

## 2.1 Current-generation models

| Field | **GPT-5.5** | **GPT-5.5 Pro** | **GPT-5.4 mini** (sibling) |
|---|---|---|---|
| Model id | `gpt-5.5` (snap `gpt-5.5-2026-04-23`) | `gpt-5.5-pro` | `gpt-5.4-mini` (snap `-2026-03-17`) |
| Released | 2026-04-23 | with 5.5 line | 2026-03-17 |
| Context window (total) | 1,050,000 | 1,050,000 | 400,000 |
| — usable input / output | ~922k in / 128k out | (≈922k in) / 128k out | (≈272k in) / 128k out |
| Reasoning effort ladder | none·low·medium(default)·high·xhigh | **unspecified by vendor** [gap] | **full ladder not enumerated** [gap]; GPT-5-mini line caps at `high` [INFERRED] |
| Modality | text+image in, text out (no audio/video) | text+image in, text out | text+image in, text out |
| Knowledge cutoff | Dec 01, 2025 | Dec 01, 2025 | Aug 31, 2025 |
| Price in / cached / out (MTok) | $5 / $0.50 / $30 | $30 / — (no cache discount) / $180 | $0.75 / $0.075 / $4.50 |
| Batch / Flex | 0.5x standard | — | 0.5x [INFERRED] |
| Priority | 2.5x standard | — | — |
| Sampling restrictions | none stated [UNVERIFIED] | none stated | none stated |

## 2.2 GPT-5.5 >272K input price cliff [CRITICAL — official]

> Official (developers.openai.com gpt-5.5): "prompts with >272K input tokens are priced at **2x
> input and 1.5x output for the full session**." → input $5→$10, output $30→$45 above the cliff.
> Applies to the whole session, not just overflow. Confirms baseline `G_CTX_272`. (gpt-5.5-pro
> analog: $30/$180 → ~$60/$270 above cliff is [INFERRED], not vendor-confirmed on the fetched card.)

## 2.3 Codex-harness context cap (operative for local fleet)

GPT-5.5 **API** context = 1,050,000. The **Codex CLI harness** caps usable context at **400,000**
[ASSUMPTION — harness-specific, from baseline `cost-model.md` CR-3; not a vendor model limit and not
re-confirmed from an OpenAI doc this run]. Treat 1.05M as the model spec; 400k as the local harness
operating limit. Flagged for Phase-2 to verify against Codex CLI docs/release notes.

## 2.4 Family enumeration notes

- **GPT-5.5-mini does NOT exist** (2026-06-03): no `gpt-5.5-mini` announced. The current mini/nano
  siblings are `gpt-5.4-mini` and `gpt-5.4-nano` (GPT-5.4 generation). Confirmed by absence across
  OpenAI docs + announce pages searched.
- `gpt-5.5-pro` effort ladder and `gpt-5.4-mini` effort ladder are **vendor gaps** on the fetched
  cards — Pro likely runs a single high-reasoning tier; mini caps at `high`. Both marked [gap]; do
  not invent the ladder. Phase-2 should pull the live effort enum from the OpenAI Models API.
- OpenAI announce page `openai.com/index/introducing-gpt-5-5/` returned **HTTP 403** to WebFetch →
  could not read primary announce; specs above stand on the API model docs + OpenRouter instead.
