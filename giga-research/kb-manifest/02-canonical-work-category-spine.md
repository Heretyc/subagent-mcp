## 2. CANONICAL WORK-CATEGORY SPINE (final ids + precedence — every builder uses these EXACT ids)

Lowercase snake_case ids. Precedence is the deterministic first-match order (§1.10). All 13 files,
including `routing-table.json`, MUST use these strings verbatim.

| precedence | canonical id | KB role |
|---:|--------------|---------|
| 1 | `math_proof` | hard-gate category (G_MATH) |
| 2 | `security_review` | hard-gate category (G_SEC verdict) |
| 3 | `architecture` | orchestrator tier |
| 4 | `quality_review` | contradiction-check / tie-break (G_COMMIT) |
| 5 | `debugging` | observed-failure fix |
| 6 | `agentic_execution` | closed-loop + deterministic extraction (Codex) |
| 7 | `knowledge_synthesis` | long-context / gray-area judgment |
| 8 | `coding` | bounded authored change |
| 9 | `mechanical` | leaf work (Haiku) |
| — | `fallback_default` | unclassifiable -> Sonnet read-only / ask narrower |

**Precedence string (verbatim, used in `routing-contract.md` and JSON `classification_precedence`):**
`math_proof > security_review > architecture > quality_review > debugging > agentic_execution > knowledge_synthesis > coding > mechanical` (then `fallback_default`).

**Gate ids (verbatim, used in `hard-gates.md` + JSON):** `G_MATH`, `G_CTX_200`, `G_CTX_272`,
`G_CTX_400`, `G_CTX_1M`, `G_CTX_OUT`, `G_SEC`, `G_COMMIT`, `G_SANDBOX`, `G_DATA`, `G_OPUS_LOCK`.

**Model api-ids (verbatim):** `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`,
`claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.5-pro`. Providers:
`anthropic`, `openai`. Harness for Codex routes: `codex`.
