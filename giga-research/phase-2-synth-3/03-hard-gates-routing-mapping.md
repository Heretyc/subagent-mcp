## 3. HARD GATES (B, applied BEFORE category routing)

Gates are deterministic preconditions evaluated first. They **override** the category's primary route. Order matters: G1 → G2 → G3 → then category default.

**G1 — Context-size gate (HARD).**
- Input >200K tokens → **must** use Claude (Sonnet 4.6 or Opus 4.8); Haiku (200K) and Sonnet 4.5 (200K) excluded.
- Input >272K tokens **and** task is cost-sensitive → **mandatory redirect off GPT-5.5** (GPT-5.5 charges 2× input / 1.5× output for the *entire session* above 272K input — a price cliff; Agent 5). Route to Opus 4.8 / Sonnet 4.6 (1M context, no long-context premium).
- Output >64K tokens required → **Opus 4.8 only** (128K output; Sonnet/Haiku cap at 64K).
- Source: Anthropic models overview; OpenAI GPT-5.5 model/pricing. Interview Q9.

**G2 — Math/proof gate (HARD).** Any request classified `math_proof` → **GPT-5.5** regardless of other signals (interview Q10). Effort `high` default; `xhigh` for adversarial/long derivations. This is an authoritative routing mandate that overrides the Sonnet-math benchmark.

**G3 — Security cross-review gate (HARD, pre-commit).** If code that touches **authentication, authorization/permissions, cryptography, concurrency/threading, deserialization, filesystem, shell, or network** was produced by **Codex/GPT-5.5**, a **Claude (Opus 4.8 preferred, Sonnet 4.6 minimum) cross-review is mandatory before commit.** Rationale: GPT-5.5's documented systematic misses (CWE-732 file-permission handling, hallucinated API signatures, concurrency as its "Achilles heel" at ~170 threading bugs/mLOC; Agents 2–4). Initial security *triage* may run on GPT-5.5 (71.4% expert cyber pass rate), but the **verdict** is Claude's. Interview Q4. This subsumes the AGENTS.md pre-commit contradiction-checker mandate.

**G4 — Commit/write trust boundary (always).** No agent output self-commits. Writes must name exact target files + expected diff; orchestrator rejects out-of-scope writes, unexplained formatting churn, and edits to pre-existing user-owned dirty files. Secrets/credentials/regulated data must not be routed to a provider outside the approved data boundary, and never set `OPENAI_API_KEY`/`CODEX_API_KEY` as job-level env vars where repo-controlled code runs (OpenAI non-interactive docs; Agent 5).

**G5 — Sandbox gate (Codex).** Codex runs least-privilege: `--sandbox read-only` for inspection, `workspace-write` for edits, `danger-full-access`/`--dangerously-bypass-approvals-and-sandbox` **only** in externally hardened, disposable, secret-free runners — never a mixed-trust home directory (Agent 2).

---

## 4. Routing per Category (B) — primary, fallback, synergy, gates

Notation: effort applies to Opus/Sonnet/GPT-5.5; **Haiku has no effort param**. "Codex `gpt-5.5`" = GPT-5.5 in the Codex CLI harness via `codex exec`.

| Category | Primary {provider · model · effort} | Fallback chain | Synergy / validation pattern | Triggered gates |
|----------|-------------------------------------|----------------|------------------------------|-----------------|
| `coding` | Codex · `gpt-5.5` · low–medium (closed-loop), **or** Claude · Sonnet 4.6 · medium | Sonnet 4.6 medium → Opus 4.8 high | If Codex-authored: Claude review on handoff (Pattern 1). If security-adjacent: G3. | G1, G3 |
| `architecture` | Claude · Opus 4.8 · xhigh | Opus 4.7 xhigh → Opus 4.6 high → Sonnet 4.6 max | Opus plans → fan-out implement (Haiku/Codex) → Sonnet integration review (Pattern 2). | G1 |
| `debugging` | Claude · Sonnet 4.6 · high | Opus 4.8 high (cross-subsystem) → Opus 4.6 high → Haiku (shallow only) | Edit→test loop; escalate to Opus if root cause spans subsystems. Concurrency bug → G3 Claude verify. | G1, G3 |
| `review_validation` | Claude · Opus 4.8 · high | Opus 4.7 high → Sonnet 4.6 high (surface only) | **Cross-provider**: reviewer ≠ generator's family (Pattern 3/4). Opus arbitrates conflicts; never average (§7). | G3, G4 |
| `extraction_terminal` | Codex · `gpt-5.5` · low (medium if multi-command) | Sonnet 4.6 medium → Opus 4.8 high | Use `--json` / `--output-schema` for machine-readable output; map-reduce for large corpora (Pattern 7). | G1, G5 |
| `math_proof` | Codex · `gpt-5.5` · high | `gpt-5.5` xhigh → Opus 4.8 high (proof *verification* only) | GPT-5.5 derives; Opus 4.8 may verify the proof as a `review_validation` step. | G2 |
| `knowledge_synthesis` | Claude · Opus 4.8 · high→max | Opus 4.7 high → Sonnet 4.6 high | >10 sources / novel output → Opus max. Sonnet high for ≤10 sources, routine. Decisiveness injection if stalled (Pattern 4b). | G1 |
| `mechanical` | Claude · Haiku 4.5 · (n/a) | Sonnet 4.6 low → Opus 4.6 low | Leaf node in fan-out/map-reduce; constrained (enum/bool/short-JSON) outputs only. | G1 |

**Effort defaults are task-class, not per-model** (interview Q5): the category sets effort; if the fallback model lacks the level (e.g., `xhigh` only on Opus 4.7/4.8), step to the nearest supported level (Opus 4.6/Sonnet `high`; Haiku none).

**Escalation ladder (within Claude, do not switch providers to escalate):** Haiku → Sonnet 4.6 medium → Opus 4.8 high → Opus 4.8 xhigh → max. Provider switches are for *capability fit* (a category's primary), not for retry. [INFERRED from Agent 3 §4.3]

---

## 5. Mapping Agent-3's 20 task types → 8 categories (traceability)

| Agent-3 task type | Category | Note |
|---|---|---|
| Strategic planning, Knowledge work/research synthesis, Nuanced/gray-area, Tie-breaking & oversight | `knowledge_synthesis` (tie-breaking → `review_validation`) | Opus xhigh/high/max |
| Architecture & refactor integrity, Multi-agent orchestration | `architecture` | Opus xhigh |
| Debugging | `debugging` | Sonnet high |
| Code review, Security review | `review_validation` | Opus/cross-provider; G3 |
| Long-context synthesis | `knowledge_synthesis` | G1 output/context gates |
| Rapid coding/codegen, Test authoring, Documentation, Data extraction (structured) | `coding` (docstrings/scaffold → `mechanical`) | Sonnet medium / Haiku |
| File read/search, Functional boilerplate, Classification/routing | `mechanical` | Haiku |
| Deterministic extraction/proofs, Terminal/closed-loop execution | `extraction_terminal` (formal proof → `math_proof`) | Codex |
| Computer use / browser agent | `architecture`-adjacent → route Opus 4.8 high (web) / Codex (CLI) | Opus leads web (84% Mind2Web), GPT-5.5 leads CLI |

This shows the 8-bucket set loses no coverage from the detailed matrix; it only removes LOC thresholds (now handled by gates) and collapses specialist-equivalent rows.
