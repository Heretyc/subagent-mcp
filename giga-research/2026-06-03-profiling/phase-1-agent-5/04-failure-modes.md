# 04 — Failure Modes & Security Posture
*Sources: SONAR-2606, OAI-SYSTEMCARD-2606, AISI-2606, ANTH-MIGRATE-2606. Retrieved 2026-06-03.*

## GPT-5.5 Code Quality (Sonar Java Benchmark — SONAR-2606)

Methodology: 4,444 tasks, 703,324 LOC, Java, SonarQube analysis, medium reasoning effort, temp=1.0.

### Bug Density (per mLOC)

| Category | Rate | Severity profile |
|---|---:|---|
| **Overall** | **520** | Blocker 43, Critical 26, Major 232, Minor 220 |
| **Concurrency/threading** | **170** | Dominant category — passes functional tests, fails under prod timing |
| Resource/stream leaks | 67 | |
| Exception handling | 54 | |
| Type safety/casts | 27 | |

Specific concurrency patterns: broken double-checked locking, unsound sync on value-based classes
(e.g., `Boolean`), holding locks during `Thread.sleep()`.

### Security Vulnerability Density (per mLOC)

| Category | Rate |
|---|---:|
| **Overall** | **75** (= 0.075/kLOC) |
| Cryptography misconfiguration | 17 |
| XML External Entity (XXE) | 8 |
| Path traversal/injection | 7 |

Sonar characterizes security as "a definitive strength" — low vulnerability density, flat
distribution across severity levels.

### Other Performance Metrics

| Metric | Value |
|---|---|
| Test pass rate | 78.7% |
| Missing completions | 0.18% |
| Cyclomatic complexity | 251.1/kLOC |
| Cognitive complexity | 151.8/kLOC |

## GPT-5.5 Hallucination

Source: OAI-SYSTEMCARD-2606.
- 60% hallucination rate reduction vs GPT-5.4
- Individual claims 23% more likely factually correct
- Responses containing factual error: 3% fewer
- HealthBench: 56.5 (+2.5 vs GPT-5.4); HealthBench Professional: 51.8% (+3.7)
- **[DELTA vs baseline]**: Baseline only qualitative ("confident hallucination"). Now quantified.

## GPT-5.5 Cyber Capability & Security Posture

Sources: OAI-SYSTEMCARD-2606, AISI-2606.

### Capability Classification

- **Rating: HIGH** (explicitly below Critical threshold per OpenAI Preparedness Framework)
- Cannot develop "functional zero-day exploits of all severity levels in many hardened real-world
  critical systems without human intervention" — threshold for Critical not met

### Performance Metrics (AISI-2606)

| Metric | GPT-5.5 | GPT-5.4 | Opus 4.7 | Mythos Preview |
|---|---|---|---|---|
| Expert cyber task avg | **71.4%** ±8.0% | 52.4% ±9.8% | 48.6% ±10.0% | 68.6% ±8.7% |
| 32-step network attack (2/10) | 2/10 completed | 0/10 | 0/10 | 3/10 |
| Complex reverse-engineering | ~10 min (rust_vm) | slower | — | — |

- CTF cyber range: 93% pass rate (OpenAI system card)
- 90.5% pass@5 on expert-level narrow tasks (AISI)
- ICS/OT attacks: failed on Cooling Tower (no model has succeeded)

### Deployed Safeguards

- Live restrictions on scaled agentic vulnerability research (operator-level)
- Threat-intel driven investigation/detection controls
- Trusted Access for Cyber program (gates legitimate security work)
- Universal jailbreak found via 6h expert red-team → mitigations deployed pre-launch
- Jailbreak robustness: comparable to GPT-5.4-thinking on multiturn adversarial attacks
- CoT monitorability: 96% overall (regressions in 2 health-query evals)

**Gate implication**: G_SEC applies to ALL GPT-5.5 diffs touching security surfaces. The model's
elevated cyber capability means cross-family review is non-negotiable — it can plausibly introduce
exploitable patterns that same-family review would not catch.

## Claude Failure Modes (Unchanged/Confirmed from Baseline)

These are confirmed patterns, not new findings:

| Mode | Model | Symptoms | Mitigation |
|---|---|---|---|
| Caution/stall | Opus 4.6/4.7/4.8 | No writes; repeated clarification loops; long planning with no artifact | Re-scope to concrete artifact; decisive-draft injection from separate family |
| Verbosity / overthinking | Opus at max | Output exceeds contract; prose where JSON requested | Strict output contracts; JSON/table + line budgets |
| Shallow reasoning | Haiku 4.5 on complex | Misses multi-layer context; wrong label on ambiguous class | Don't route gray-area, multi-step, over-threshold input to Haiku |
| Context degradation | Opus 4.8 near 1M | Weak recall; contradictions | Keep synthesis context ≤750K; apply RAG/summarize |

**NEW — Opus 4.7/4.8 specific (ANTH-MIGRATE-2606)**:
- Default effort=high on 4.8 (all surfaces incl. Claude Code) — check cost impact before deploy
- Opus 4.7 respects effort levels strictly at low end → risk of under-thinking on moderately complex tasks
- Sampling lock: `temperature`/`top_p`/`top_k` → 400 error (breaking from 4.6); only `effort` controls intelligence
- Cybersecurity safeguards added in 4.7+: legit security work requires Cyber Verification Program

## Agentic Overconfidence (GPT-5.5)

Per baseline `failure-modes.md`, source `ARXIV-2602-06948` [UNVERIFIED — lineage uncertain].
This run found no new independent corroboration. Qualitative pattern retained; specific figures
remain unverified. Treat as [UNVERIFIED — qualitative pattern only].
