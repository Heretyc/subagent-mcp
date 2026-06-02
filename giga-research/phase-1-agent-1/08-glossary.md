## 8. Claude-Specific Glossary

**Adaptive thinking:** A thinking mode (`thinking: {type: "adaptive"}`) where Claude dynamically decides whether and how much to use extended reasoning per turn. Automatically enables interleaved thinking. Supported on Opus 4.8 (only mode), Opus 4.7 (only mode), Opus 4.6, Sonnet 4.6, and Mythos Preview. Not available on Haiku 4.5 or Sonnet 4.5.

**Budget tokens:** The `budget_tokens` parameter in manual extended thinking (`thinking: {type: "enabled"}`). Sets a soft cap on thinking tokens. Required for Haiku 4.5 and Sonnet 4.5. Deprecated on Opus 4.6 and Sonnet 4.6. Returns 400 on Opus 4.7 and 4.8.

**Dynamic Workflows:** A research preview feature in Claude Code (released with Opus 4.8) that orchestrates hundreds of parallel subagents, verifying outputs before reporting. [OFFICIAL]

**Effort parameter:** `output_config.effort` — a behavioral signal controlling how eagerly Claude spends tokens. Affects text output, tool calls, AND extended thinking. Values: `low`, `medium`, `high`, `xhigh` (Opus 4.7/4.8 only), `max`. Default is always `high`.

**Extended thinking:** The capability for Claude to generate internal reasoning blocks before responding, visible in the response as `type: "thinking"` content blocks. Improves quality on multi-step problems. Billed at output token rates.

**Fast mode:** A research preview feature on Opus 4.8 (`speed: "fast"`) providing up to 2.5× higher output throughput at 2× standard pricing. [OFFICIAL]

**Interleaved thinking:** The ability to think between tool calls (not just before the first response). Automatically enabled with adaptive thinking. In manual mode: only available on Sonnet 4.6 via beta header. NOT available in manual mode on Opus 4.6. [OFFICIAL]

**Message Batches API:** Asynchronous batch processing endpoint offering 50% discount on input and output tokens. Supports 300k max output via beta header. Useful for offline/batch workloads.

**Mid-conversation system messages:** New in Opus 4.8 — allows `role: "system"` entries in the `messages` array after a user turn. Enables instruction updates without breaking prompt cache on earlier turns. [OFFICIAL]

**New tokenizer:** Introduced in Opus 4.7. Produces 32–45% more tokens than the Opus 4.6/Sonnet tokenizer for equivalent text. Despite identical per-token pricing, effective costs are ~40% higher when migrating from Opus 4.6 to 4.7/4.8. [THIRD-PARTY]

**Opus tier:** The highest-capability Claude model tier. As of 2026-05-29: Opus 4.8 is current; Opus 4.7 and 4.6 are legacy.

**Priority Tier:** A service tier providing higher rate limits and throughput. Supported on all current models. [OFFICIAL]

**Prompt caching:** Mechanism to reuse input tokens from repeated system prompts, tool schemas, or stable conversation history. Cache reads at 10% of standard input price. Cache writes at a premium. Minimum cacheable prompt: 1,024 tokens on Opus 4.8 (lower than prior models). [OFFICIAL]

**Refusal stop details:** `stop_details` object on refusal responses (Opus 4.7+, public doc on Opus 4.8). Describes the category of refusal beyond just `stop_reason: "refusal"`. Useful for application-layer routing when the model declines. [OFFICIAL]

**Sonnet tier:** The mid-tier Claude model. As of 2026-05-29: Sonnet 4.6 is current; Sonnet 4.5 is legacy.

**Summarized thinking:** Default display mode on Opus 4.6/Sonnet 4.6 (`thinking.display: "summarized"`). Returns a summary of internal reasoning in the response body. Billing is for the full internal thinking tokens, not the summary. [OFFICIAL]

**Omitted thinking:** Default display mode on Opus 4.7/4.8/Mythos Preview (`thinking.display: "omitted"`). Returns empty `thinking` field in response but signature is preserved for multi-turn. Reduces streaming latency without reducing billing. [OFFICIAL]

**Ultracode mode:** A Claude Code UI mode pairing `xhigh` effort with standing permission for multi-agent workflows. Not a separate API effort level. [OFFICIAL]

**xhigh effort:** The fifth effort level, available only on Opus 4.7 and Opus 4.8. Sits between `high` and `max`. Recommended starting point for all agentic and coding use cases on Opus. [OFFICIAL]
