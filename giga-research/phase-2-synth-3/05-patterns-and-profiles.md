## 7. Synergy patterns & anti-patterns the table references (C-support)

**Patterns (cited in `synergy_pattern`):**
- **`codex_execute_then_claude_review` (Pattern 1, highest ROI):** Codex runs the autonomous edit→test loop; Claude (Opus 4.8) reviews the diff for cross-file correctness + security on a temp-file handoff `{diff, test_results, files_modified, task_description}`. Mitigates Codex's premature wrong-file commitment and hallucinated APIs.
- **`opus_plan_fanout_implement_sonnet_review` (Pattern 2):** Opus emits a JSON decomposition with interface contracts → ≤5 Haiku/Codex workers implement in parallel → Sonnet integration review. Up to ~75% wall-clock reduction on separable work.
- **`cross_provider_reviewer` (Patterns 3/4):** Reviewer is a *different family* than the generator (distributional independence catches shared blind spots). Subsumes the AGENTS.md pre-commit contradiction-checker; uses strongest available model.
- **`decisiveness_injection_if_stalled` (Pattern 4b):** On Opus no-write stall, GPT-5.5 produces a concrete first attempt; Opus resumes as corrector. A concrete wrong answer is easier to fix than an underspecified one.
- **`map_reduce_sanitized` (Pattern 7):** Map agents (Haiku) see raw/untrusted data and emit constrained outputs; reduce agent (Opus/Sonnet) sees only sanitized summaries — prompt-injection containment boundary.

**Anti-patterns the router must refuse (Agent 4 §3; CLAUDE.md Rule 7):**
- **Task duplication across providers** (same task to Claude+Codex to pick a winner) — burns 2× tokens, then needs a 3rd reconciliation pass.
- **Averaging conflicting outputs** — on code correctness / spec compliance there is no middle ground; escalate to `review_validation` to pick the right one. Surface conflicts, don't blend.
- **Same-provider self-validation** — shared training distribution hides shared blind spots; reviewer must differ from generator (falls to a different *tier* if cross-provider unavailable).
- **Over-delegating trivial work** — a grep/read is the Read/Grep tool, not a subagent; 3-agent topology ~2.9× token overhead before useful work.
- **Peer-to-peer agent mesh** — all comms route through the coordinator (hub-and-spoke); free peer comms drop cascade-prevention from ~0.89 to ~0.32.

---

## 8. Per-provider/model capability + risk profiles (C, condensed)

| Model | API id | Context (in/out) | Effort levels | Decisive strength | Decisive risk | Best categories |
|---|---|---|---|---|---|---|
| **Opus 4.8** | `claude-opus-4-8` | 1M / 128K | low/med/high/xhigh/max | Agentic/long-horizon, honesty (~4× fewer unremarked flaws vs 4.7), web computer-use (84% Mind2Web), nuance, planning | Verbosity/over-hedge at high effort; locked temp/top_p; tokenizer inflation ~1.4×; Foundry only 200K | architecture, review_validation, knowledge_synthesis |
| **Opus 4.7** | `claude-opus-4-7` | 1M / 128K | low/med/high/xhigh/max | Near-4.8; introduced `xhigh` | Stricter instruction-following can break 4.6 prompts; tool-skip cases (fixed in 4.8) | fallback for Opus categories |
| **Opus 4.6** | `claude-opus-4-6` | 1M / 128K | low/med/high/max | Old-tokenizer flagship; strong knowledge work (+144 Elo vs GPT-5.2 GDPval) | Stall/caution, verbosity (most documented here); no `xhigh`; no interleaved thinking in manual mode | legacy fallback |
| **Sonnet 4.6** | `claude-sonnet-4-6` | 1M / 64K | low/med/high/max | Cost-quality sweet spot (79.6% SWE-bench, ~1.2pp below Opus 4.6); verification thoroughness; 89% math | Loses coherence before Opus on very long agentic chains; `high` default can surprise latency — set effort explicitly | coding, debugging, review (surface) |
| **Haiku 4.5** | `claude-haiku-4-5` | 200K / 64K | none (manual budget_tokens only) | Fastest, cheapest ($1/$5); 73.3% SWE-bench; near-Sonnet on non-reasoning tasks | 200K ceiling; degrades on multi-step reasoning/nuance; no adaptive thinking | mechanical, fan-out leaves |
| **GPT-5.5 (Codex)** | `gpt-5.5` | 1M API / 400K Codex; 272K price cliff | none/minimal/low/med/high/xhigh | Closed-loop terminal (Terminal-Bench ~82–83%), deterministic extraction, math, fast-to-patch, ~40% fewer tokens/task | Confident hallucination; security bugs (CWE-732); concurrency weakness; commits to wrong file before full exploration; literal instruction-following | extraction_terminal, math_proof, coding (closed-loop) |
| `gpt-5.4-mini` | `gpt-5.4-mini` | — | — | Cheaper/faster light coding & subagents | Not for security/architecture authority | cheap Codex subagent leaves |

> **Benchmark reconciliation (across the 5 inputs):** SWE-bench Verified is effectively tied — Opus 4.8 88.6% vs GPT-5.5 88.7% (within noise; Agents 1, 3). The real split is **SWE-bench Pro**: Opus 4.8 69.2% vs GPT-5.5 58.6% (~+10.6pp Opus) — i.e., parity on isolated coding, Opus leads on harder multi-step agentic work. This is exactly the interview's task-split framing (Q2) and why `architecture`/`knowledge_synthesis` go to Opus while `coding`/`extraction_terminal` can sit on Codex. [ASSUMPTION on Opus 4.8 magnitude, per mandate — "materially better on agentic, ~equal on isolated coding," not "≫".]
