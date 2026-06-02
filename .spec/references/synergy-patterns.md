# synergy-patterns.md — Cross-Provider Synergy Patterns & Anti-Patterns

**One-screen summary:** Canonical cross-provider handoff and validation patterns (P1/P2/P4a/P4b/P5/P7),
hub-and-spoke topology with cascade numbers, and the five anti-patterns the router must refuse.
Category definitions live in `./work-categories.md`; per-category routes live in `./routing-table.md`;
failure-mode mitigations that reference these patterns live in `./failure-modes.md`; governance
enforcement of the anti-patterns lives in `./governance-halts.md`.

**Load when:** implementing a cross-provider handoff; debugging an agent coordination failure;
designing a fan-out pipeline; choosing between hub-and-spoke vs peer mesh; understanding stall
recovery; building a map-reduce with untrusted input.
**Do not load when:** single-provider single-model task; routing table lookup (load
`./routing-table.md`); model capability questions (load `./model-profiles.md`).

---

## Topology: Hub-and-Spoke (default, mandatory)

All cross-provider handoffs use a **coordinator** holding full context; workers return
**compressed schema-compliant summaries only** — no peer-to-peer worker mesh.

Source: `ADAPTORCH` (see [source-ledger.md](./source-ledger.md))

| Metric | Hub-and-Spoke | Peer-to-Peer Mesh |
|--------|:-------------:|:-----------------:|
| Cascade-prevention rate | **0.89** | 0.32 |
| Error amplification (independent) | — | 17.2× |
| Error amplification (centralized validation) | **4.4×** | — |
| Wall-clock reduction (separable work) | **~75%** | n/a |

IPC for local fleet: **temp-file JSON schema** (Managed Agents API is out of scope).

---

## Pattern Table

| ID | Name | Mechanism | IPC shape | When to use |
|----|------|-----------|-----------|-------------|
| **P1** | Codex-execute → Claude-review | `agentic_execution` worker (GPT-5.5/Codex) writes `{diff, test_results, files_modified, task_description}` to temp file; Claude (Opus arch / Sonnet routine) reviews vs specs → APPROVE / BLOCK | Temp-file JSON; schema-bound output | **MANDATORY before any Codex-authored commit.** Mitigates wrong-file commit, hallucinated APIs, incomplete multi-file edits. Highest ROI pattern. |
| **P2** | Opus-plan → parallel workers → Sonnet integration-review | `architecture`: Opus emits JSON decomposition `[{task_id, file, inputs, outputs, constraints}]`; ≤5 separable workers (Haiku/GPT-5.5/Sonnet) each own one concern; Sonnet checks interface-contract adherence + duplicate logic on fan-in | JSON decomposition → per-worker assignments → integration report | >3 separable subtasks; ~75% wall-clock reduction on separable work |
| **P4a** | Claude catches GPT-5.5 security/hallucination blind spots | Formalized as the mandatory `security_review` second pass (G_SEC). Cross-provider distributional independence is the whole point. | Review temp-file + verdict field | Any GPT-5.5-generated code touching auth / crypto / concurrency / secrets / filesystem / shell / network / CI-CD |
| **P4b** | GPT-5.5 decisiveness breaks Opus stall | On Opus no-write stall (no writes in N min, repeated clarification loops): inject GPT-5.5 to produce a concrete first attempt → Opus resumes as corrector. A concrete wrong answer is easier to fix than an underspecified question. [SEED — Blackburn 2026, corroborated] | Concrete draft to temp file; Opus receives it as correction input | `knowledge_synthesis` or `architecture` Opus stall; also see `stall_recovery` field in `./assets/routing-table.json` |
| **P5** | Mixed-provider validation tiers | Generation (any provider) → per-output domain validation (isolation) → strongest-model cross-output synthesis + contradiction detection. Centralized validation contains error amplification (17.2× independent → 4.4× centralized). | Isolated validation JSON per output; synthesis receives only validation summaries | Multi-provider parallel generation where outputs may conflict |
| **P7** | Map-reduce with sanitization boundary | `mechanical` map agents emit **constrained outputs** (enum / bool / short-JSON) → `knowledge_synthesis` reduce agent sees **only sanitized summaries**. Raw / untrusted data never reaches the synthesis layer. Security invariant: prompt-injection containment. | Map: constrained-schema JSON; Reduce: sanitized summaries only | Large corpora with untrusted or web-sourced input; multi-source knowledge synthesis |

---

## Anti-Patterns (router must refuse these)

| ID | Anti-pattern | Why it fails | Correct alternative |
|----|-------------|-------------|---------------------|
| **A** | Duplicate task across providers + pick a winner | Burns 2× tokens + a 3rd reconciliation pass; wastes budget on averaging | Route by category; use one primary + fallback chain |
| **B** | Average conflicting outputs | On code/spec correctness there is no middle ground; averaging produces neither correct output | Escalate to arbiter (Opus); pick one per authoritative spec (Sanity Rule 7) |
| **C** | Over-delegate trivial work to multi-agent pipeline | A single Read/Grep beats ~2.9× multi-agent token overhead | `mechanical` → Haiku direct; deterministic transforms → code, not model (Sanity Rule 5) |
| **D** | Same-provider / same-instance self-validation | Shared training distribution hides shared blind spots; confirmation bias | Reviewer family ≠ generator family; minimum: different tier as weak fallback |
| **E** | Peer-to-peer agent mesh without coordinator | Cascade-prevention drops from 0.89 to 0.32; errors amplify 17.2× | Hub-and-spoke only; coordinator holds full context |

---

## Pattern-to-Category Quick Reference

| Category | Required / relevant patterns |
|----------|------------------------------|
| `math_proof` | gpt_derive_opus_verify (P2 variant for high-stakes proofs) |
| `security_review` | P4a (G_SEC mandatory cross-review) |
| `architecture` | P2 (Opus plan → worker fan-out → Sonnet review) |
| `quality_review` | P5 (cross-provider reviewer; never same-family) |
| `debugging` | Escalate to Opus if cross-subsystem; concurrency → P4a (G_SEC) |
| `agentic_execution` | **P1 MANDATORY before commit**; P4b for stall recovery |
| `knowledge_synthesis` | P7 (map-reduce sanitization); P4b (stall recovery) |
| `coding` | P4a if security surface; P1 if Codex-authored |
| `mechanical` | P7 map tier; constrained outputs only |

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
