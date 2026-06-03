## 6. MACHINE-CONSUMABLE SCHEMA (E) — the router's data contract

This is the emphasis deliverable. The MCP loads a single declarative file (YAML shown; JSON-equivalent trivially). The router does **no model reasoning** to route — it executes gates then a table lookup. The only model call in the routing step is the optional category classifier (Haiku, `low`).

### 6.1 Schema definition (field contract)

```yaml
# routing_table.schema — one document the MCP parses at startup
version: "2026-05-29"
defaults:
  classifier: { provider: claude, model: claude-haiku-4-5, effort: null }  # emits one category id
  ipc: tempfile_json            # local Claude Code + Codex CLI; Managed Agents API out of scope
  handoff_schema_required: true # every cross-provider handoff is structured JSON

# Gates are evaluated in array order BEFORE category lookup. First match that
# sets a constraint wins; later gates may further constrain but not relax.
gates:
  - id: G1_context
    when: { input_tokens_gt: 200000 }
    force: { provider_in: [claude], model_in: [claude-sonnet-4-6, claude-opus-4-8] }
  - id: G1_context_cliff
    when: { input_tokens_gt: 272000, cost_sensitive: true }
    forbid: { provider_in: [openai] }            # GPT-5.5 272K price cliff
  - id: G1_output
    when: { output_tokens_gt: 64000 }
    force: { model_in: [claude-opus-4-8] }
  - id: G2_math
    when: { category: math_proof }
    force: { provider: openai, model: gpt-5.5, effort: high }
  - id: G3_security_xreview
    when: { category_in: [coding, debugging, review_validation],
            touches_any: [auth, authz, crypto, concurrency, deserialization, filesystem, shell, network],
            author_family: openai }
    require_review: { provider: claude, model: claude-opus-4-8,
                      min_model: claude-sonnet-4-6, before: commit }
  - id: G4_commit_boundary
    when: { action: commit }
    require: { self_commit: false, scoped_diff: true, contradiction_checker: strongest_available }
  - id: G5_sandbox
    when: { provider: openai }
    default_sandbox: workspace-write             # never danger-full-access in mixed-trust dir

# fields per category record:
#   id                : stable enum, the classifier's output label
#   definition        : human/classifier-facing one-liner
#   classify_signals  : list of lexical/structural cues (for prompt-time classification)
#   primary           : { provider, model, effort }   effort=null when unsupported (Haiku)
#   fallback          : ordered list of { provider, model, effort }
#   gates             : gate ids that commonly fire for this category (advisory; gates run globally)
#   synergy_pattern   : named cross-model pattern id + trigger
#   cost_note         : routing-relevant cost caveat (inflation-adjusted where Opus)
categories: [ ... see 6.2 ... ]
```

### 6.2 One worked record per category (8 records)

```yaml
categories:

  - id: coding
    definition: "Write/modify code to a bounded objective, verifiable by compile/test/lint."
    classify_signals: ["implement", "add function/endpoint/flag", "make test pass", "write code that"]
    primary:  { provider: openai, model: gpt-5.5, effort: medium }   # closed-loop in Codex
    fallback: [ { provider: claude, model: claude-sonnet-4-6, effort: medium },
                { provider: claude, model: claude-opus-4-8,  effort: high } ]
    gates: [ G1_context, G3_security_xreview, G5_sandbox ]
    synergy_pattern: { id: codex_execute_then_claude_review, trigger: "codex-authored diff before commit" }
    cost_note: "Codex closed-loop fast/cheap; if Claude path, Sonnet $3/$15 vs Opus ~1.4x-inflated $5/$25."

  - id: architecture
    definition: "Cross-cutting design / refactor integrity / multi-file structural change."
    classify_signals: ["design", "refactor across", "interface change", "migrate module", "public API affected"]
    primary:  { provider: claude, model: claude-opus-4-8, effort: xhigh }
    fallback: [ { provider: claude, model: claude-opus-4-7, effort: xhigh },
                { provider: claude, model: claude-opus-4-6, effort: high },
                { provider: claude, model: claude-sonnet-4-6, effort: max } ]
    gates: [ G1_context ]
    synergy_pattern: { id: opus_plan_fanout_implement_sonnet_review, trigger: ">3 separable subtasks" }
    cost_note: "Opus xhigh is premium; effective ~1.4x nominal from 4.7/4.8 tokenizer inflation. Justified by cascade-error cost."

  - id: debugging
    definition: "Localize root cause from a symptom and apply a minimal verified fix."
    classify_signals: ["fix the bug", "why does X fail", "intermittent/flaky", "regression", "stack trace"]
    primary:  { provider: claude, model: claude-sonnet-4-6, effort: high }
    fallback: [ { provider: claude, model: claude-opus-4-8, effort: high },
                { provider: claude, model: claude-haiku-4-5, effort: null } ]   # shallow bugs only
    gates: [ G1_context, G3_security_xreview ]
    synergy_pattern: { id: escalate_to_opus_if_cross_subsystem, trigger: "root cause spans >1 subsystem; concurrency->Claude verify" }
    cost_note: "Sonnet 2x faster, ~5x cheaper/token than Opus; debug loops are latency-sensitive."

  - id: review_validation
    definition: "Judge an artifact: code/security review, pre-commit contradiction-check, tie-break."
    classify_signals: ["review", "check for", "is this correct/safe", "validate against spec", "which is right", "before commit"]
    primary:  { provider: claude, model: claude-opus-4-8, effort: high }
    fallback: [ { provider: claude, model: claude-opus-4-7, effort: high },
                { provider: claude, model: claude-sonnet-4-6, effort: high } ]
    gates: [ G3_security_xreview, G4_commit_boundary ]
    synergy_pattern: { id: cross_provider_reviewer, trigger: "reviewer family != generator family; NEVER self-review or average" }
    cost_note: "Reviewer cost is small vs blast radius of a missed flaw; Opus 4.8 ~4x less likely to leave flaws unremarked vs 4.7."

  - id: extraction_terminal
    definition: "Closed-loop terminal work + deterministic structured output from local artifacts."
    classify_signals: ["find every place", "extract/parse", "run and summarize", "emit JSON", "cite file:line", "from git log"]
    primary:  { provider: openai, model: gpt-5.5, effort: low }
    fallback: [ { provider: claude, model: claude-sonnet-4-6, effort: medium },
                { provider: claude, model: claude-opus-4-8,  effort: high } ]
    gates: [ G1_context, G5_sandbox ]
    synergy_pattern: { id: map_reduce_sanitized, trigger: "large corpus; raw data stays in map layer, reduce sees sanitized only" }
    cost_note: "GPT-5.5 ~40% fewer output tokens on Codex tasks; use --output-schema to avoid retries."

  - id: math_proof
    definition: "Mathematical reasoning, formal/symbolic proof, multi-step derivation."
    classify_signals: ["prove", "derive", "show that", "theorem/lemma", "formal notation"]
    primary:  { provider: openai, model: gpt-5.5, effort: high }      # G2 forces this
    fallback: [ { provider: openai, model: gpt-5.5, effort: xhigh },
                { provider: claude, model: claude-opus-4-8, effort: high } ]  # verification only
    gates: [ G2_math ]
    synergy_pattern: { id: gpt_derive_opus_verify, trigger: "high-stakes proof: Opus 4.8 verifies as review_validation" }
    cost_note: "Mandated route (interview Q10) overrides Sonnet's 89% arithmetic benchmark; FrontierMath leadership cited for GPT-5.5."

  - id: knowledge_synthesis
    definition: "Long-context/multi-source synthesis, planning, nuanced/gray-area & knowledge-work judgment."
    classify_signals: ["synthesize", "plan the approach", "weigh tradeoffs", "across N sources", "policy/legal/financial", ">3 branches"]
    primary:  { provider: claude, model: claude-opus-4-8, effort: high }
    fallback: [ { provider: claude, model: claude-opus-4-8, effort: max },     # >10 sources / novel
                { provider: claude, model: claude-sonnet-4-6, effort: high } ] # <=10 sources, routine
    gates: [ G1_context ]
    synergy_pattern: { id: decisiveness_injection_if_stalled, trigger: "Opus no-write stall -> GPT-5.5 first concrete attempt -> Opus corrects" }
    cost_note: "Opus max only when >10 sources or novel output; max ~2x xhigh cost for small gains on structured tasks."

  - id: mechanical
    definition: "Leaf work: file read/search, classification, format, pattern boilerplate."
    classify_signals: ["list/grep/find file", "classify into N labels", "format", "boilerplate from template", "extract imports"]
    primary:  { provider: claude, model: claude-haiku-4-5, effort: null }
    fallback: [ { provider: claude, model: claude-sonnet-4-6, effort: low },
                { provider: claude, model: claude-opus-4-6,  effort: low } ]
    gates: [ G1_context ]   # Haiku 200K ceiling -> escalate on overflow
    synergy_pattern: { id: constrained_leaf_in_fanout, trigger: "fan-out/map-reduce; outputs limited to enum/bool/short-JSON" }
    cost_note: "Haiku $1/$5 (~5x cheaper than Sonnet, ~25x cheaper than Opus/token); the cost floor of the fleet."
```

### 6.3 Router algorithm (deterministic pseudocode)

```
route(prompt, category?, ctx):                 # ctx = {input_tokens, output_tokens, cost_sensitive, action, touches[], author_family}
  category = category or classify(prompt)       # Haiku low-effort; pure-language label
  route    = lookup(categories[category].primary)
  for gate in gates (in array order):           # gates override category default
      if gate.when matches (category, ctx):
          route = apply(gate.force / gate.forbid / gate.default_sandbox, route)
          if gate.require_review: attach_review_step(gate)   # e.g. G3 Claude cross-review
          if gate.require:        enforce_commit_boundary()  # G4
  if route now infeasible (gate forbids primary): route = first feasible categories[category].fallback
  attach(synergy_pattern, fallback_chain)
  return route                                  # {provider, model, effort, review_step?, sandbox?, pattern}
```

Properties that make it safe to act on: (1) gates are total and ordered → same input always yields same route; (2) classification is the only model call and it is the cheapest, lowest-variance task; (3) a forbidden primary deterministically falls through to the declared fallback rather than failing open.
