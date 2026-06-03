## 0. TL;DR — The Routing Contract in One Screen

The router does three deterministic things, in order, for every request:

1. **Apply HARD GATES first** (they override category defaults — see §3). Context size and math/proof routing are gates, not preferences.
2. **Map `category` → primary {provider, model, effort}** from the table in §4 / §6.
3. **Attach the synergy/validation pattern and fallback** so the orchestrator knows what to do on failure or before commit.

Eight categories. One is `coding`. All are agent-classifiable from the prompt without LOC counting:

| id | one-line definition | primary route | effort |
|----|--------------------|---------------|--------|
| `coding` | Write/modify code in a scoped, verifiable loop (edit→run→test) | Codex `gpt-5.5` (closed-loop) or Sonnet 4.6 | medium |
| `architecture` | Cross-cutting design, refactor integrity, multi-file structural change | Claude Opus 4.8 | xhigh |
| `debugging` | Localize and fix a defect from a symptom | Claude Sonnet 4.6 | high |
| `review_validation` | Judge an artifact: code review, contradiction-check, security, correctness gate | Claude Opus 4.8 (cross-provider on Codex output) | high |
| `extraction_terminal` | Closed-loop terminal work, deterministic extraction, structured output from local artifacts | Codex `gpt-5.5` | low |
| `math_proof` | Mathematical reasoning, formal/symbolic proof, multi-step derivation | Codex `gpt-5.5` | high |
| `knowledge_synthesis` | Long-context synthesis, research, nuanced/gray-area judgment, planning | Claude Opus 4.8 | high→max |
| `mechanical` | Low-reasoning leaf work: file read/search, classification, format, boilerplate | Claude Haiku 4.5 | n/a |

> The two most load-bearing rules: (a) **security/auth/concurrency/permission-critical code that Codex produced gets a mandatory Claude cross-review before commit** (§3 G3); (b) **input >200K tokens forces Claude; >272K + cost-sensitive forces *off* GPT-5.5** (§3 G1). Everything else is a default that evals may tune.

---

## 1. Why these eight categories (design rationale)

The taxonomy is engineered against four constraints from the authoritative interview (Phase 1.5):

- **Deterministic & agent-classifiable.** A classifier (Haiku-class, `low` effort) reads the prompt and emits exactly one `category` id. No numeric thresholds inside the classification step — size is handled separately as a *gate* (§3), not a category boundary. This keeps classification a pure-language task that even the cheapest model does reliably. [INFERRED from Agent 3 §4.5 "classification doesn't exercise the reasoning gap"]
- **Small (8).** Below the 6–10 target ceiling, low enough to memorize, broad enough to cover the Phase-1 task matrix. The 20 fine-grained task types in Agent 3's matrix collapse cleanly into these 8 (mapping in §5).
- **One category is `coding`** per mandate, kept narrow (scoped, verifiable code changes) so that the genuinely different work — *designing* code (`architecture`), *fixing* code (`debugging`), and *judging* code (`review_validation`) — routes to its correct specialist instead of being averaged into one bucket.
- **Provider-discriminating.** Each category's primary route reflects a real, benchmark-backed capability split, not vibes: Opus leads agentic/long-horizon/nuance; Codex/GPT-5.5 leads closed-loop terminal + deterministic extraction + math; Sonnet is the cost-quality default for ordinary code work; Haiku owns leaf/mechanical work.

The split between `coding`, `architecture`, `debugging`, and `review_validation` is the single most important design choice: collapsing them into one "coding" bucket is exactly the anti-pattern Agent 4 warns against (averaging conflicting specialist strengths).
