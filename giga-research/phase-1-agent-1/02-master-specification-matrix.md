## 3. Master Specification Matrix

### 3.1 Current Models (Active / Recommended)

| Specification | Claude Opus 4.8 | Claude Sonnet 4.6 | Claude Haiku 4.5 |
|---------------|-----------------|-------------------|------------------|
| **API ID** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5-20251001 |
| **API alias** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5 |
| **Context window** | 1M tokens (~555k words) | 1M tokens (~750k words) | 200k tokens (~150k words) |
| **Max output (sync)** | 128k tokens | 64k tokens | 64k tokens |
| **Max output (batch)** | 300k tokens* | 300k tokens* | 64k tokens |
| **Input pricing** | $5 / MTok | $3 / MTok | $1 / MTok |
| **Output pricing** | $25 / MTok | $15 / MTok | $5 / MTok |
| **Fast mode input** | $10 / MTok | N/A | N/A |
| **Fast mode output** | $50 / MTok | N/A | N/A |
| **Comparative latency** | Moderate | Fast | Fastest |
| **Adaptive thinking** | Yes (only mode) | Yes | No |
| **Extended thinking (manual)** | No (400 error) | Deprecated (still functional) | Yes (manual only) |
| **Effort parameter** | Yes (low/medium/high/xhigh/max) | Yes (low/medium/high/max) | No |
| **temperature/top_p/top_k** | Locked (400 error) | Settable | Settable |
| **Reliable knowledge cutoff** | Jan 2026 | Aug 2025 | Feb 2025 |
| **Training data cutoff** | Jan 2026 | Jan 2026 | Jul 2025 |
| **Tokenizer** | New (4.8/4.7 tokenizer) | Standard | Standard |
| **Prompt cache min length** | 1,024 tokens | [INFERRED] standard | [INFERRED] standard |
| **Microsoft Foundry context** | 200k tokens only | 1M tokens | 200k tokens |

*Batch 300k output requires `output-300k-2026-03-24` beta header. [OFFICIAL]

### 3.2 Legacy Models (Available, Migration Recommended)

| Specification | Claude Opus 4.7 | Claude Opus 4.6 | Claude Sonnet 4.5 |
|---------------|-----------------|-----------------|-------------------|
| **API ID** | claude-opus-4-7 | claude-opus-4-6 | claude-sonnet-4-5-20250929 |
| **Context window** | 1M tokens (~555k words) | 1M tokens (~750k words) | 200k tokens |
| **Max output** | 128k (sync), 300k (batch) | 128k (sync), 300k (batch) | 64k (sync), 300k (batch) |
| **Input pricing** | $5 / MTok | $5 / MTok | $3 / MTok |
| **Output pricing** | $25 / MTok | $25 / MTok | $15 / MTok |
| **Adaptive thinking** | Yes (only mode) | Yes | No |
| **Extended thinking (manual)** | No (400 error) | Deprecated, functional | Yes (required) |
| **Effort levels** | low/medium/high/xhigh/max | low/medium/high/max | low/medium/high/max |
| **Tokenizer** | New (~30-45% more tokens vs Opus 4.6 for equivalent input) | Standard | Standard |
| **Reliable knowledge cutoff** | Jan 2026 | May 2025 | Jan 2025 |

**Tokenizer warning for Opus 4.7 and 4.8:** The new tokenizer introduced in Opus 4.7 produces 32–34% more tokens than Opus 4.6 for the same large (10k+) prompts, and 42–45% more for smaller prompts. Despite identical per-token pricing, effective cost is ~40% higher when migrating from 4.6 to 4.7/4.8 at equivalent prompt sizes. [THIRD-PARTY] Source: openrouter.ai/announcements/opus-47-tokenizer-analysis, findskill.ai/blog/claude-opus-4-7-tokenizer-cost-math

### 3.3 Deprecated (DO NOT USE for new work)

- `claude-sonnet-4-20250514` (Claude Sonnet 4) — Retirement: June 15, 2026 [OFFICIAL]
- `claude-opus-4-20250514` (Claude Opus 4) — Retirement: June 15, 2026 [OFFICIAL]
