## 9. MACHINE-CONSUMABLE CATEGORY → ROUTE TABLE (the MCP loads this)

The router does **no model reasoning** to route — it executes gates, then a table lookup. The only model call in the routing step is the optional category classifier (Haiku, `low`), which emits one category id. Input envelope: `{prompt, work_category?, est_input_tokens, est_output_tokens, cost_sensitive, data_class, is_math_or_proof, touches[], author_family, action}`.

```json
{
  "schema_version": "2.0.0",
  "provenance": "phase-2-core-synthesis/2026-05-29",
  "fleet": ["claude_code", "codex_cli"],
  "ipc": "temp_file_json_schema",
  "topology": "hub_and_spoke",
  "default_category": "fallback_default",
  "classification_precedence": [
    "math_proof", "security_review", "architecture", "quality_review",
    "debugging", "agentic_execution", "knowledge_synthesis", "coding", "mechanical"
  ],
  "classification_rule": "run_gates_first; walk_precedence_first_match_wins; on_adjacent_tie_escalate_one_tier_up; if_no_match -> fallback_default",
  "hard_gates": [
    { "id": "G_MATH",    "if": "category == 'math_proof' || is_math_or_proof",
      "then": "force:{provider:openai,model:gpt-5.5,effort:high}; note:'overrides category; subject to G_CTX'" },
    { "id": "G_CTX_200", "if": "est_input_tokens > 200000",
      "then": "exclude_models:[claude-haiku-4-5,claude-sonnet-4-5]; allow:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G_CTX_272", "if": "est_input_tokens > 272000 && cost_sensitive",
      "then": "exclude_provider:openai; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G_CTX_400", "if": "est_input_tokens > 400000",
      "then": "exclude_harness:codex; route_to:[claude-opus-4-8,claude-sonnet-4-6]" },
    { "id": "G_CTX_1M",  "if": "est_input_tokens > 1000000",
      "then": "split_reduce_first; no_single_route_call" },
    { "id": "G_CTX_OUT", "if": "est_output_tokens > 64000",
      "then": "route_to:[claude-opus-4-8]" },
    { "id": "G_SEC",     "if": "author_family == 'openai' && touches_any:[auth,authz,crypto,concurrency,deserialization,secrets,filesystem,shell,network,ci_credentials]",
      "then": "require_review:{provider:anthropic,model:claude-opus-4-8,min_model:claude-sonnet-4-6,before:commit}; forbid:gpt-5.5_self_review" },
    { "id": "G_COMMIT",  "if": "action == 'commit' && changes_executable_or_source",
      "then": "require_checker:{model:strongest_available,reasoning:max,cross_family:true,not_self:true}; block_status:[blocked,needs_user]; if_checker_unavailable:halt_owner" },
    { "id": "G_SANDBOX", "if": "provider == 'openai'",
      "then": "default_sandbox:workspace-write; bypass_only:hardened_disposable_runner" },
    { "id": "G_DATA",    "if": "data_class in [secret,regulated,owner-private]",
      "then": "halt_unless_approved_boundary; never_key_as_repo_visible_env" },
    { "id": "G_OPUS_LOCK","if": "model in [claude-opus-4-7,claude-opus-4-8]",
      "then": "forbid:[temperature,top_p,top_k,budget_tokens]; if effort in [xhigh,max]:set max_tokens>=65536" }
  ],
  "categories": {
    "math_proof": {
      "definition": "Mathematical/formal/symbolic proof, derivation, or rigorous correctness argument.",
      "classify_signals": ["prove","derive","theorem","lemma","invariant","formal","counterexample","complexity bound","FrontierMath"],
      "precedence": 1,
      "primary":  { "provider": "openai", "model": "gpt-5.5", "effort": "high" },
      "fallback": [ { "provider":"openai","model":"gpt-5.5","effort":"xhigh" },
                    { "provider":"openai","model":"gpt-5.5-pro","note":"capability-limited only" },
                    { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"verification only" } ],
      "gates": ["G_MATH","G_CTX_272"],
      "synergy_pattern": { "id":"gpt_derive_opus_verify", "trigger":"high-stakes proof: Opus 4.8 verifies assumptions/exposition" },
      "cost_note": "Mandated route (Interview Q10) overrides Sonnet 89% arithmetic; GPT-5.5 FrontierMath leadership.",
      "risk_flags": ["proof_gap","high_reasoning_cost"]
    },
    "security_review": {
      "definition": "Assess code/design for vulns, auth/permission/crypto/threat-model correctness; emit verdict.",
      "classify_signals": ["security review","vulnerability","exploitable","auth","permissions","crypto","deserialization","secret handling","threat model","CWE"],
      "precedence": 2,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "initial_pass_optional": { "provider":"openai","model":"gpt-5.5","effort":"high","framing":"cyber" } },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"full review" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high","note":"surface only" } ],
      "gates": ["G_SEC","G_COMMIT","G_DATA"],
      "synergy_pattern": { "id":"cross_provider_mandatory", "trigger":"gpt-5.5-authored high-risk code; reviewer family != generator; NEVER self-review" },
      "cost_note": "Reviewer cost is small vs blast radius; Opus 4.8 ~4x less likely to leave flaws unremarked vs 4.7.",
      "risk_flags": ["same_family_blind_spot","gpt55_concurrency_cwe732_miss","blocked_means_halt"]
    },
    "architecture": {
      "definition": "Cross-cutting design / refactor integrity / decomposition / orchestration planning.",
      "classify_signals": ["design","architecture","refactor across","interface/contract change","migrate module","decompose","orchestrate","tradeoff",">2 files or public API"],
      "precedence": 3,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "xhigh", "max_tokens": 65536 },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-7","effort":"xhigh" },
                    { "provider":"anthropic","model":"claude-opus-4-6","effort":"high" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"max","note":"single-module plans only" } ],
      "gates": ["G_CTX_OUT","G_OPUS_LOCK"],
      "synergy_pattern": { "id":"opus_plan_fanout_implement_sonnet_review", "trigger":">3 separable subtasks" },
      "emits": "decomposition_json:[{task_id,file,inputs,outputs,constraints}]",
      "cost_note": "Opus xhigh premium; effective ~1.4x nominal from tokenizer inflation. Justified by cascade-error cost.",
      "risk_flags": ["stall","verbosity","over_delegation"]
    },
    "quality_review": {
      "definition": "Judge a non-security artifact; tie-break; pre-commit contradiction-check.",
      "classify_signals": ["review this diff","is this correct","compare A vs B","tie-break","contradiction check","validate against spec","before commit"],
      "precedence": 4,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high" },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-7","effort":"high" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high","note":"surface only" },
                    { "provider":"anthropic","model":"claude-opus-4-6","effort":"max" } ],
      "gates": ["G_COMMIT","G_DATA"],
      "synergy_pattern": { "id":"cross_provider_reviewer", "trigger":"reviewer family != generator; NEVER self-review or average" },
      "cost_note": "Reviewer cost small vs missed-flaw blast radius.",
      "risk_flags": ["same_family_blind_spot","no_averaging"]
    },
    "debugging": {
      "definition": "Localize root cause from an observed failure and apply a minimal verified fix.",
      "classify_signals": ["fix the bug","why does X fail","intermittent/flaky","regression","root cause","stack trace","CI failure"],
      "precedence": 5,
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "high" },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"cross-subsystem" },
                    { "provider":"openai","model":"gpt-5.5","effort":"medium","note":"CLI-heavy repro" },
                    { "provider":"anthropic","model":"claude-haiku-4-5","effort":null,"note":"shallow bugs only" } ],
      "gates": ["G_CTX_200","G_SEC","G_COMMIT"],
      "synergy_pattern": { "id":"escalate_to_opus_if_cross_subsystem", "trigger":"root cause spans >1 subsystem; concurrency->Opus verify (G_SEC)" },
      "cost_note": "Sonnet ~2x faster, ~5x cheaper/token than Opus; debug loops are latency-sensitive.",
      "risk_flags": ["flaky_repro","over_effort"]
    },
    "agentic_execution": {
      "definition": "Closed-loop terminal/CLI work + deterministic structured extraction from local artifacts.",
      "classify_signals": ["run","execute","in the sandbox","iterate until tests pass","codex exec","parse logs","emit JSON","cite file:line","from git log","inventory"],
      "precedence": 6,
      "primary":  { "provider": "openai", "model": "gpt-5.5", "harness": "codex", "effort": "medium", "sandbox": "workspace-write" },
      "fallback": [ { "provider":"anthropic","model":"claude-opus-4-8","effort":"xhigh" },
                    { "provider":"anthropic","model":"claude-opus-4-7","effort":"xhigh" },
                    { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"medium","note":"simple ops" } ],
      "gates": ["G_CTX_272","G_CTX_400","G_SANDBOX","G_COMMIT","G_DATA"],
      "synergy_pattern": { "id":"codex_execute_then_claude_review", "trigger":"MANDATORY before commit (Pattern 1)" },
      "stall_recovery": "gpt-5.5_decisiveness_injection (Pattern 4b)",
      "forbid_model": "claude-haiku-4-5",
      "cost_note": "GPT-5.5 ~40% fewer output tokens on Codex tasks; use --output-schema to avoid retries.",
      "risk_flags": ["hallucinated_locator","wrong_file_commit","sandbox_bypass","agentic_overconfidence"]
    },
    "knowledge_synthesis": {
      "definition": "Long-context/multi-source synthesis, research, nuanced gray-area/policy/legal/financial judgment.",
      "classify_signals": ["synthesize","research","compare sources","across N sources","policy/legal/financial","gray area",">10 sources"],
      "precedence": 7,
      "primary":  { "provider": "anthropic", "model": "claude-opus-4-8", "effort": "high",
                    "escalate_to": "max", "escalate_if": "sources>10 || novel_analysis" },
      "fallback": [ { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high","note":"<=10 sources routine" },
                    { "provider":"anthropic","model":"claude-opus-4-7","effort":"high" },
                    { "provider":"openai","model":"gpt-5.5","effort":"medium","note":"source-grounded extraction pass" } ],
      "gates": ["G_CTX_200","G_CTX_272"],
      "synergy_pattern": { "id":"map_reduce_sanitized", "trigger":"large corpus; raw data stays in map layer, reduce sees sanitized only" },
      "stall_recovery": "gpt-5.5_decisiveness_injection (Pattern 4b)",
      "cost_note": "Opus max only when >10 sources or novel output; treat 1M as ceiling, keep working context <=750K.",
      "risk_flags": ["context_overload","source_drift","seed_hypothesis_not_authority"]
    },
    "coding": {
      "definition": "Write/modify code to a bounded objective, verifiable by compile/test/lint.",
      "classify_signals": ["implement","add function/endpoint/flag","make test pass","write code that","wire up","update config"],
      "precedence": 8,
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium" },
      "fallback": [ { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"high" },
                    { "provider":"openai","model":"gpt-5.5","effort":"medium","note":"closed-loop in Codex" },
                    { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"cross-module/high-blast-radius" } ],
      "gates": ["G_CTX_200","G_SEC","G_COMMIT","G_SANDBOX"],
      "synergy_pattern": { "id":"security_review_if_sensitive_else_codex_review", "trigger":"security surface -> G_SEC; codex-authored -> Pattern 1" },
      "cost_note": "Sonnet $3/$15 default; Opus 4.8 effective ~1.4x sticker, reserve for blast radius.",
      "risk_flags": ["security_review_if_sensitive","commit_checker_required"]
    },
    "mechanical": {
      "definition": "Leaf work: file read/search, symbol resolution, classification, format, pattern boilerplate.",
      "classify_signals": ["list/grep/find","trace imports","classify into N labels","reformat","scaffold from template","extract imports"],
      "precedence": 9,
      "primary":  { "provider": "anthropic", "model": "claude-haiku-4-5", "effort": null },
      "fallback": [ { "provider":"anthropic","model":"claude-sonnet-4-6","effort":"low" },
                    { "provider":"anthropic","model":"claude-opus-4-6","effort":"low" },
                    { "provider":"openai","model":"gpt-5.4-mini","effort":"low","note":"cheap Codex leaf" } ],
      "gates": ["G_CTX_200"],
      "synergy_pattern": { "id":"constrained_leaf_in_fanout", "trigger":"fan-out/map-reduce; outputs limited to enum/bool/short-JSON" },
      "cost_note": "Haiku $1/$5 fleet cost floor (~25x cheaper than Opus/token); G_CTX_200 forces Sonnet fallback on overflow.",
      "risk_flags": ["shallow_reasoning","context_200k_cap"]
    },
    "fallback_default": {
      "definition": "Under-specified, mixed-beyond-resolution, or unsupported prompts.",
      "classify_signals": ["no category reaches confidence","absent/invalid hint","tied signals"],
      "precedence": 99,
      "primary":  { "provider": "anthropic", "model": "claude-sonnet-4-6", "effort": "medium", "mode": "read_only" },
      "fallback": [ { "provider":"openai","model":"gpt-5.5","effort":"low","note":"local deterministic inspection" },
                    { "provider":"anthropic","model":"claude-opus-4-8","effort":"high","note":"high-risk ambiguity" } ],
      "gates": ["G_DATA"],
      "synergy_pattern": { "id":"ask_for_narrower_category", "trigger":"writes/side-effects implied" },
      "cost_note": "Read-only by default; never commits without a narrower category.",
      "risk_flags": ["ambiguous_scope","needs_user"]
    }
  },
  "global_invariants": {
    "commit_gate": "strongest_available_checker; cross_family; not_self; halt_if_unavailable",
    "cross_provider_validation": "reviewer_family != generator_family",
    "no_duplicate_tasks": true,
    "no_output_averaging": true,
    "no_peer_to_peer_mesh": true,
    "subagent_output_contract": "{status,summary,source_locators,risks,writes_requested}",
    "telemetry_required": true
  }
}
```
