## 8. MACHINE-CONSUMABLE CATEGORY → ROUTE TABLE (Section E)

Pseudo-schema for the `subagent-mcp` router. Input: `{prompt, work_category, est_input_tokens, est_output_tokens, cost_sensitive, data_class, is_math_or_proof, security_subclass}`. The router applies **gates first**, then the category route, then attaches mandatory validation.

```jsonc
{
  "version": "phase-2-synth-2/2026-05-29",
  "classification_precedence": [
    "security_review", "planning_architecture", "reasoning_judgment",
    "agentic_execution", "synthesis_knowledge", "extraction_proof",
    "coding", "mechanical"
  ],
  "hard_gates": [
    { "id": "G1", "if": "est_input_tokens > 200000",
      "then": "exclude_models:[claude-haiku-4-5,claude-sonnet-4-5]" },
    { "id": "G2", "if": "est_input_tokens > 272000 && cost_sensitive",
      "then": "exclude_provider:openai_gpt-5.5; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G2b", "if": "est_input_tokens > 400000",
      "then": "exclude_harness:codex; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G3", "if": "est_output_tokens > 64000",
      "then": "route_to:[claude-opus-4-8]" },
    { "id": "G4", "if": "is_math_or_proof == true",
      "then": "route_to:[gpt-5.5]; note:'overrides category; still subject to G2'" },
    { "id": "G5", "if": "model in [claude-opus-4-7,claude-opus-4-8] && effort in [xhigh,max]",
      "then": "set:max_tokens>=64000" },
    { "id": "G6", "if": "model in [claude-opus-4-7,claude-opus-4-8]",
      "then": "forbid:[temperature,top_p,top_k,budget_tokens]; use:thinking=adaptive" }
  ],
  "routes": {
    "coding": {
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium" },
      "fallback": [
        { "model": "claude-sonnet-4-6", "effort": "high" },
        { "model": "claude-opus-4-8",  "effort": "high" }
      ],
      "validation": "cross_review_if:security_subclass!=none",
      "thinking": "adaptive"
    },
    "agentic_execution": {
      "primary":  { "provider": "openai", "model": "gpt-5.5", "harness": "codex",
                    "effort": "medium", "sandbox": "workspace-write" },
      "fallback": [
        { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "xhigh" },
        { "provider": "anthropic", "model": "claude-opus-4-7", "effort": "xhigh" }
      ],
      "validation": "MANDATORY_claude_review_before_commit (Pattern1)",
      "stall_recovery": "gpt-5.5_decisiveness_injection (Pattern4b)",
      "forbid_model": "claude-haiku-4-5"
    },
    "planning_architecture": {
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "xhigh",
                    "max_tokens": 65536, "thinking": "adaptive" },
      "fallback": [
        { "model": "claude-opus-4-7", "effort": "xhigh" },
        { "model": "claude-opus-4-6", "effort": "high" },
        { "model": "claude-sonnet-4-6", "effort": "max", "note": "single-module plans only" }
      ],
      "validation": "contradiction_check_if_committed_artifact",
      "emits": "decomposition_json:[{task_id,file,inputs,outputs,constraints}]"
    },
    "reasoning_judgment": {
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "escalate_to": "xhigh", "thinking": "adaptive" },
      "fallback": [
        { "model": "claude-opus-4-7", "effort": "high" },
        { "model": "claude-opus-4-6", "effort": "high" },
        { "model": "claude-sonnet-4-6", "effort": "max", "note": "<2 tradeoff dims only" }
      ],
      "validation": "none (this is the arbiter); forbid_self_validation",
      "forbid_model": "claude-haiku-4-5"
    },
    "mechanical": {
      "primary":  { "provider": "anthropic", "model": "claude-haiku-4-5", "effort": null },
      "fallback": [ { "model": "claude-sonnet-4-6", "effort": "low" } ],
      "validation": "none",
      "gate_note": "G1 forces fallback when est_input_tokens>200000"
    },
    "extraction_proof": {
      "primary_math":  { "provider": "openai", "model": "gpt-5.5", "effort": "medium" },
      "primary_json":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium",
                         "output_contract": "schema_validated" },
      "fallback": [
        { "model": "claude-sonnet-4-6", "effort": "high" },
        { "model": "claude-opus-4-8",  "effort": "high", "note": "proof verify / ambiguous fields" }
      ],
      "validation": "claude_verify_if:committed_proof"
    },
    "security_review": {
      "primary":  { "provider": "openai", "model": "gpt-5.5", "effort": "high",
                    "framing": "cyber" },
      "mandatory_second_pass": {
        "when": "security_subclass in [concurrent,auth,permission] || pre_commit",
        "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
        "reason": "GPT-5.5 concurrency/CWE-732 blind spots; cross-provider independence"
      },
      "fallback": [
        { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
          "note": "full review, not just cross-check" },
        { "model": "claude-sonnet-4-6", "effort": "high", "note": "surface-level only" }
      ],
      "forbid_model": "claude-haiku-4-5",
      "forbid": "gpt-5.5_self_review"
    },
    "synthesis_knowledge": {
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "escalate_to": "max", "escalate_if": "sources>10 || novel_analysis" },
      "fallback": [
        { "model": "claude-sonnet-4-6", "effort": "high", "note": "<10 sources, routine" },
        { "model": "claude-opus-4-7", "effort": "high" }
      ],
      "validation": "map_reduce_sanitization_boundary_for_large_corpora",
      "context_note": "treat 1M as ceiling; keep working context <=750K"
    }
  },
  "global_invariants": {
    "commit_gate": "strongest_available_checker; halt_if_unavailable",
    "cross_provider_validation": "reviewer_family != generator_family",
    "no_duplicate_tasks": true,
    "no_output_averaging": true,
    "ipc": "temp_file_json_schema",
    "topology": "hub_and_spoke; no_peer_to_peer",
    "telemetry_required": true
  }
}
```
