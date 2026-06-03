## SECTION 5: RISK REGISTER

| Risk | Affected Model | Mitigation |
|---|---|---|
| Confident hallucination | GPT-5.5 | Sandbox all execution; never trust GPT-5.5 for privileged ops; use Opus 4.8 as honesty arbiter |
| Security bugs in generated code | GPT-5.5 | Pair with GPT-5.5 security review OR Opus 4.8 @ high for all GPT-5.5-generated code |
| Concurrency bugs | GPT-5.5 | Always route concurrent/async code review to Opus 4.8 instead |
| Caution/stall on agentic tasks | Opus 4.6 | Upgrade to Opus 4.8; xhigh effort + explicit continuation instructions |
| Verbosity / overthinking | Opus (all) at max effort | Use `max` only for frontier problems; use `xhigh` as default ceiling for coding |
| Shallow reasoning on complex tasks | Haiku 4.5 | Never route gray-area, multi-step reasoning, or >200K context to Haiku |
| Context degradation near 1M edge | Opus 4.8 | Treat 1M as hard ceiling; keep working context ≤750K for synthesis tasks |
| GPT-5.5 literal instruction following | GPT-5.5 | Always provide detailed, unambiguous prompts; never rely on self-correction |
| Cost overrun at max effort | Opus 4.8 | xhigh → max is rarely worth the ~2x cost increase; confirm via evals before deploying max |
| Opus 4.8 honesty caveat [ASSUMPTION] | Opus 4.8 | "4x less likely to miss code flaws" improves quality but does not eliminate flaws; still require test coverage |

---

## SECTION 6: QUICK-REFERENCE DECISION FLOWCHART (TEXT)

```
TASK RECEIVED
    │
    ├─ Is context >200K tokens?
    │       YES → Route to Opus 4.8 or Sonnet 4.6 (Haiku excluded)
    │       NO  → continue
    │
    ├─ Is output >64K tokens required?
    │       YES → Route to Opus 4.8 only
    │       NO  → continue
    │
    ├─ Task type classification:
    │
    │   FILE_READ / SEARCH / CLASSIFICATION / BOILERPLATE
    │       → Haiku 4.5 (no effort param)
    │
    │   RAPID_CODEGEN (isolated, <50 LOC)
    │       → Haiku 4.5; upgrade to Sonnet 4.6 @ medium if multi-file
    │
    │   DEBUGGING / CODE_REVIEW / TEST_AUTHORING / DOCUMENTATION
    │       → Sonnet 4.6 @ medium (default)
    │       → Sonnet 4.6 @ high (quality-critical)
    │       → Opus 4.8 @ high (cross-module / architectural)
    │
    │   TERMINAL_EXECUTION / CLOSED_LOOP / SCRIPTING
    │       → GPT-5.5 @ Codex (primary)
    │       → Opus 4.8 @ xhigh Dynamic Workflows (quality priority)
    │
    │   SECURITY_REVIEW
    │       → GPT-5.5 (initial pass)
    │       → Opus 4.8 @ high (concurrency/threading cross-check)
    │
    │   DETERMINISTIC_EXTRACTION / FORMAL_PROOF
    │       → GPT-5.5 (primary) or Sonnet 4.6 @ medium (JSON extraction)
    │
    │   STRATEGIC_PLANNING / ARCHITECTURE / REFACTOR_INTEGRITY
    │       → Opus 4.8 @ xhigh
    │
    │   NUANCED_REASONING / GRAY_AREA / TIE_BREAKING
    │       → Opus 4.8 @ high (never Haiku; Sonnet only for <2 tradeoff dims)
    │
    │   LONG_CONTEXT_SYNTHESIS / KNOWLEDGE_WORK
    │       → Opus 4.8 @ max (>10 sources or novel output)
    │       → Sonnet 4.6 @ high (<10 sources, routine synthesis)
    │
    └─ DONE
```
