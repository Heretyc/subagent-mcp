## 0. TL;DR — The Routing Contract in One Screen (most load-bearing)

The router does three deterministic things, in order, for every request:

1. **Apply GLOBAL HARD GATES first** (§3). Gates override category defaults. Context size, output size, math/proof routing, and security cross-review are gates, not preferences.
2. **Classify the prompt into exactly ONE work category** (§1) using first-match precedence (§1.10). If nothing matches, use the **`fallback_default`** route.
3. **Emit `{provider, model, effort}` + fallback chain + validation pattern** (§2) so the orchestrator knows what to do on failure and before commit.

**The two most load-bearing rules:**

- **(A) Security cross-review gate (G_SEC):** code touching auth, authorization/permissions, crypto, concurrency/threading, deserialization, secrets, filesystem, shell, network, or CI/CD that was **produced by GPT-5.5** gets a **mandatory Claude (Opus 4.8 preferred, Sonnet 4.6 minimum) cross-review before commit.** GPT-5.5 may do the *initial* security pass; the **verdict on high-risk code is Claude's** (Interview Q4).
- **(B) Context gates (G_CTX):** input **>200K tokens → Claude only** (Haiku/Sonnet 4.5 excluded); input **>272K AND cost-sensitive → mandatory OFF GPT-5.5** (price cliff); output **>64K → Opus 4.8 only** (Interview Q9).

**Eight canonical work categories** (one is `coding`) + an explicit fallback. Effort is a **task-class default** (Interview Q5), not a per-model default:

| precedence | id | one-line definition | primary route | effort |
|---:|----|--------------------|---------------|--------|
| 1 | `math_proof` | Mathematical / formal / symbolic proof or multi-step derivation | **GPT-5.5** (Codex) | high |
| 2 | `security_review` | Vulnerability / auth / permission / crypto / threat-model assessment + verdict | **Opus 4.8** (GPT-5.5 may do initial pass) | high |
| 3 | `architecture` | Cross-cutting design, refactor integrity, decomposition, orchestration | **Opus 4.8** | xhigh |
| 4 | `quality_review` | Judge a non-security artifact; tie-break; pre-commit contradiction-check | **Opus 4.8** | high |
| 5 | `debugging` | Diagnose + fix an *observed failure* | **Sonnet 4.6** | high |
| 6 | `agentic_execution` | Closed-loop terminal/CLI work + deterministic structured extraction | **GPT-5.5** (Codex) | medium |
| 7 | `knowledge_synthesis` | Long-context / multi-source synthesis, nuanced gray-area judgment | **Opus 4.8** | high→max |
| 8 | `coding` | Write/modify code to a bounded, verifiable objective | **Sonnet 4.6** | medium |
| 9 | `mechanical` | Low-reasoning leaf work: read/search/classify/format/boilerplate | **Haiku 4.5** | n/a (fixed) |
| — | `fallback_default` | Under-specified / unclassifiable / unsupported | **Sonnet 4.6** read-only, or ask for narrower category | medium |

**Three halt-and-surface conditions (no writes):** missing mandated contradiction/security checker (or mandated provider unavailable); secret/credential exposure or destructive-action ambiguity; conflicting instructions, identity/authorization uncertainty, or evidence the pipeline is compounding errors.

**Opus 4.8 framing (Interview Q2, de-hyperbolized):** clear leader on **agentic / long-horizon / nuance** work; **roughly equal on isolated coding**. Route by task-split, not blanket superiority. (SWE-bench Verified 88.6% vs GPT-5.5 88.7% = tied within noise; SWE-bench Pro 69.2% vs 58.6% = Opus +10.6pp.)
