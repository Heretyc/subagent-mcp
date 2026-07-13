# Adapter Contracts (Odysseus / Onyx / Hermes / OpenClaw)

Status: SPEC-ONLY. No hook/adapter code ships for the four harnesses named in
this leaf as part of this redesign (mission item 8). Only Claude Code and
Codex get real metering implementations now (see context-metering.md). This
document exists so a future implementer has a normative, non-ambiguous
contract to build against, without re-deriving window/usage source fields
from scratch.

The shared metering record shape, window-resolution ladder, and
`used_percentage` / `near_limit` / `phase` formulas defined in
context-metering.md apply unchanged to any future adapter for these four
harnesses. This leaf only pins down, per harness, WHERE the window size and
usage numbers come from.

## Odysseus (llama.cpp)

- Context window source: the llama.cpp server's `/props` endpoint, field
  `n_ctx`. A future adapter queries this endpoint once per session (or
  caches it per model/server process) rather than hardcoding a window size.
- Usage source: the completion response returned by the running request
  (the token counts llama.cpp reports back alongside the completion).
- No static model-to-window map is needed for Odysseus; `n_ctx` is always
  authoritative because it is the server's own configured value.

## Onyx (LiteLLM)

- Integration point: a LiteLLM `CustomLogger` hook. A future adapter
  registers a `CustomLogger` and lifts usage from the logger callback rather
  than polling.
- Context window source: LiteLLM's `model_cost` map, field
  `max_input_tokens`. If that field is missing or zero for the active model,
  the adapter MUST fall back to a guard value of 4096 tokens rather than
  treating the window as unknown or undetectable. This fallback is a
  deliberate exception to the general "missing window data => null /
  undetectable" rule used elsewhere, because LiteLLM's `model_cost` map is
  frequently incomplete for newer or custom models and a small guard value
  is safer than silently disabling metering for those models.
- Usage source: the token counts LiteLLM's `CustomLogger` callback receives
  for the completed request.

## Hermes (vLLM / TGI / Ollama)

Hermes is a multi-backend harness; the adapter picks whichever running
backend it detects and reads that backend's own fields. No single field
covers all three backends.

- Context window source (pick whichever the running backend exposes):
  - vLLM: `max_model_len`.
  - TGI (text-generation-inference): `max_total_tokens`.
  - Ollama: `context_length`.
- Usage source (pick the matching style for the detected backend):
  - vLLM / TGI-style backends: `prompt_tokens` from the completion response.
  - Ollama-style backend: `prompt_eval_count` from the completion response.
- A future adapter detects which backend is running (for example by probing
  the backend's own API shape or a configured backend-type setting) and
  binds to that backend's field names; it does not attempt to read all
  three sets of fields speculatively.

## OpenClaw

- OpenClaw has no reliable provider-reported context-window or usage
  signal. Treat context size as unverified for OpenClaw at all times.
- A future adapter MUST report an honest "unavailable" state, using the
  same shape as the existing `UNAVAILABLE_NO_METERING` condition documented
  in context-metering.md and handoff.md (context_window_size: null,
  used_tokens: null, used_percentage: null) -- never a fabricated or guessed
  number.
- A future adapter MUST NEVER fall back to local tokenization (tiktoken or
  any other tokenizer library) to estimate or fake a usage number for
  OpenClaw. Local re-tokenization does not match the harness's actual
  provider-side accounting and would silently violate the "hooks lift
  provider-reported numbers only, never tokenize" rule that governs every
  other harness in this redesign. An honest "unavailable" is always
  preferable to an invented number.

## Summary

| Harness  | Window source                                          | Usage source                              |
|----------|----------------------------------------------------------|--------------------------------------------|
| Odysseus | llama.cpp `/props` `n_ctx`                                | completion response token counts           |
| Onyx     | LiteLLM `model_cost` `max_input_tokens` (4096 fallback)   | `CustomLogger` hook callback               |
| Hermes   | vLLM `max_model_len` / TGI `max_total_tokens` / Ollama `context_length` | `prompt_tokens` (vLLM/TGI) / `prompt_eval_count` (Ollama) |
| OpenClaw | none (unverified)                                          | none (unverified); never tiktoken          |

This leaf is spec-only: no `src/hooks/orchestration-*.ts` file exists for any
of these four harnesses in this redesign. Implementing one is future work and
must follow the field bindings above.
