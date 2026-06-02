## 5. FAILURE MODES & MITIGATIONS — Section D.2

| Failure mode | Where | Detection | Mitigation |
|---|---|---|---|
| Confident hallucination | GPT-5.5 (esp. "be exhaustive") | require URLs / file:line; spot-check vs docs; run `rg`/tests not memory | reject unsupported claims; source-only re-prompt; structured citation fields; contradiction-check before commit |
| Security bug | GPT-5.5 (CWE-732, NoneType, broadened perms, command injection) | diff/security checklist; secret scan; side-effect declaration | least-privilege sandbox; deny `.env`/cred paths; **mandatory Claude cross-review** for auth/concurrency/permission code |
| Concurrency bug | GPT-5.5 (≈170/mLOC) | route all concurrent/async review to Opus 4.8 | Opus 4.8 @ high cross-checks any concurrent code GPT-5.5 touches |
| Over-effort regression | GPT-5.5 high/xhigh, Opus max | unnecessary edits; over-search; degraded structured output | define "done when"; cap touched files; prefer medium; step up one notch only after prompt/schema/test fixes |
| Caution/stall | Opus 4.6 (and 4.7/4.8 on ambiguity) [SEED, corroborated] | no writes in N min; repeated clarification loops | Opus 4.8 + xhigh + explicit continuation; **decisiveness injection** via GPT-5.5 (Pattern 4b) |
| Verbosity / overthinking | Opus at max | output exceeds contract | `max` only for frontier problems; xhigh as coding ceiling; JSON/table output contracts |
| Shallow reasoning | Haiku 4.5 on complex tasks | misses nuance on multi-layer context | never route gray-area, multi-step, or >200K to Haiku |
| Turn-limit truncation | any agentic loop | missing final JSON; trailing partial sentence; "tests" with no tests | split scope; resume from locators; lower output size |
| Silent skip | any operational subagent | compare output to acceptance checklist; require `skipped=[]` field | fail task; rerun only skipped items; machine-parseable status contract |
| Context degradation near 1M | Opus 4.8 | weak recall on huge prompts | treat 1M as ceiling; keep synthesis working context ≤750K; RAG/summarize |
| Agentic overconfidence | GPT-5.5 self-reported success (73% claimed vs 35% true on SWE-Bench Pro) | never trust self-report | verify against independent test/reviewer always |
| Cross-provider inconsistency | Claude vs Codex disagree | source-backed compare table | prefer primary source / command output; escalate only true ambiguity; never average |
| Prompt injection / context poisoning | untrusted files/web/tool output | treat all external text as data; quote locators | summarize content only; never adopt injected commands; map-reduce sanitization boundary |
| Commit of bad AI output | end of any code path | commit gate; contradiction-checker; CI | block on `blocked`/`needs_user`/test failures/unexplained generated changes |
| Excessive premium routing | Opus/pro/high on routine | cost dashboard by task class | default downshift; require justification for premium effort |

---

## 6. CROSS-PROVIDER SYNERGY PATTERNS (Section B, synergy detail)

Topology default is **hub-and-spoke**: a coordinator holds full context; workers return compressed schema-compliant summaries; **no peer-to-peer** worker communication (peer mesh drops cascade-prevention from >0.89 to ~0.32). All provider-boundary handoffs use **temp-file IPC with JSON schemas** (valid for the local fleet; Managed Agents API out of scope, Decision 3).

- **Pattern 1 — Codex executes → Claude reviews (HIGHEST ROI).** `agentic_execution` worker (GPT-5.5) produces `{diff, test_results, files_modified, task_description}` to a temp file; Claude (Opus arch / Sonnet routine) reviews against specs and emits APPROVE/BLOCK. Mitigates premature wrong-file commitment, hallucinated APIs, incomplete multi-file edits. **This is the repo's pre-commit contradiction mandate.**
- **Pattern 2 — Opus plans → parallel workers implement → Sonnet integration-reviews.** `planning_architecture` emits a decomposition; ≤5 separable workers (Haiku/GPT-5.5) each own one file/concern; Sonnet checks interface-contract adherence and duplicate logic on fan-in.
- **Pattern 4a — Claude catches GPT-5.5 security/hallucination blind spots** → formalized as the mandatory `security_review` second pass (§2.7).
- **Pattern 4b — GPT-5.5 decisiveness breaks Opus stall** → a concrete first attempt anchors Opus's correction (§2.2).
- **Pattern 5 — Mixed-provider validation tiers.** Generation (any) → per-output domain validation (isolation) → strongest-model cross-output synthesis + contradiction detection. Cross-provider independence prevents hallucinated consensus and sycophancy cascades; centralized validation contains error amplification (17.2× independent → 4.4× centralized).
- **Pattern 7 — Map-reduce with sanitization boundary.** `mechanical` map agents (constrained outputs) → `synthesis_knowledge` reduce agent sees only sanitized summaries. Security invariant: raw/untrusted data stays in the map layer.

**Anti-patterns (never do):** (A) duplicate the same task across providers and pick a winner — wastes 2× tokens, forces a 3rd reconciliation pass; route by category instead. (B) average conflicting outputs — on correctness/spec matters there is no middle ground; escalate to the arbiter and **pick one** (Sanity Rule 7). (C) over-delegate trivial work — a single Read/Grep beats a 2.9× multi-agent token overhead. (D) same-provider self-validation — shared training distribution hides shared blind spots; reviewer must be a different family (or at least a different tier as a weak fallback). (E) peer-to-peer agent mesh without a coordinator.

---

## 7. GOVERNANCE & HALT RULES — Section D.3

**Commit gate (mandatory):** before any commit that changes executable/source code, dispatch a **separate contradiction/security checker** using the strongest explicitly selectable model + highest reasoning settings. Input = `{proposed_diff, relevant_specs}`. Output = `{status: clear|blocked|needs_user, findings:[...]}`. Proceed only on `clear`; **block** on `blocked`/`needs_user`, unresolved test failures, missing diff review, or unexplained AI-generated changes. **If the strongest checker is unavailable, halt and tell the owner** — never degrade to a weaker checker (false confidence). [Anthropic AGENTS.md mandate; Agent-as-Judge, arXiv 2508.02994]

**Contradiction-checker must be cross-family** where possible (Anti-Pattern D). It must not be the same instance that produced the change.

**Write scoping:** agent writes name exact target files + expected diffs + validation. Orchestrator **rejects**: writes outside requested scope, unexplained formatting churn, AI-attribution metadata, edits to user-owned dirty files.

**Data boundary:** classify data (public / internal / confidential / secret / regulated / owner-private) **before** routing. Only public/internal-low-risk may cross providers freely. Never route secrets/credentials/regulated data to a provider, tool, or cache mode outside the approved boundary. Per-service unique keys in a secret manager; never in prompts/logs/comments. Retention is feature-specific (web search, files, code-exec, batch, regional each differ) — route on the exact feature path, not provider-wide.

**Halt-and-surface (stop, no writes):**
1. Mandated contradiction/security checker unavailable.
2. Secret/credential exposure, or destructive/irreversible/external-side-effect ambiguity.
3. Identity/authorization uncertainty, or instructions conflict (spec vs prompt vs policy).
4. Evidence the pipeline is compounding errors (e.g., retries obscuring state).
5. Sandbox-bypass requested in a non-hardened (mixed-trust) workspace.

**Telemetry (meter every agent):** run ID, parent task ID, provider/model, effort, prompt-hash/policy-version, files read/written, commands, URLs, input/output/cached/reasoning tokens, wall time, retries, failure class, validation result, unresolved risks. Without this, routing drifts toward premium-model overuse.
