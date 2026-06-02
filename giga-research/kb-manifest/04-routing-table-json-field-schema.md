## 4. `assets/routing-table.json` FIELD SCHEMA (Codex builder emits EXACTLY this shape)

Top-level object with a `metadata` block, the global routing scaffolding, a `hard_gates` array, and a
`categories` map. Mirrors core-synthesis §9 but pinned here so the Codex builder needs no other file.

### 4.1 Top-level metadata block (REQUIRED)
```json
"metadata": {
  "author": "Lexi Blackburn",
  "author_url": "https://github.com/Heretyc/",
  "version": "2.0.0",
  "generated_for": "subagent-mcp cross-provider work-category routing feature",
  "source": "phase-2-core-synthesis/2026-05-29",
  "generated": "2026-05"
}
```

### 4.2 Global scaffolding (REQUIRED, verbatim values from §9)
```json
"schema_version": "2.0.0",
"fleet": ["claude_code", "codex_cli"],
"ipc": "temp_file_json_schema",
"topology": "hub_and_spoke",
"default_category": "fallback_default",
"classification_precedence": ["math_proof","security_review","architecture","quality_review","debugging","agentic_execution","knowledge_synthesis","coding","mechanical"],
"classification_rule": "run_gates_first; walk_precedence_first_match_wins; on_adjacent_tie_escalate_one_tier_up; if_no_match -> fallback_default"
```

### 4.3 `hard_gates`: array of records, each:
```json
{ "id": "G_SEC", "if": "<deterministic condition string>", "then": "<action string>" }
```
All 11 gate ids from §2 present, conditions/actions transcribed from §3 / §9 (numbers live here in
machine form — this is the one sanctioned mirror of `hard-gates.md`).

### 4.4 `categories`: map of `<category_id>` -> record. **Each record MUST have these fields:**

| field | type | meaning |
|-------|------|---------|
| `id` | string | canonical category id (== map key; redundant-but-explicit for record portability) |
| `definition` | string | one-sentence definition (from `work-categories.md`/§1) |
| `classify_signals` | string[] | keyword/phrase triggers the classifier matches on |
| `precedence` | int | 1–9 (or 99 for `fallback_default`) |
| `primary` | object | `{ provider, model, effort }` (+ optional `harness`, `sandbox`, `max_tokens`, `mode`, `initial_pass_optional`, `escalate_to`/`escalate_if`) |
| `fallback` | object[] | ordered chain; each `{ provider, model, effort, note? }` |
| `gates` | string[] | gate ids that apply to this category (subset of §2 gate ids) |
| `synergy_pattern` | object | `{ id, trigger }` (cross-provider validation/pattern for this category) |
| `cost_note` | string | one-line cost framing (references the cost driver; no raw $ duplication needed) |
| `risk_flags` | string[] | machine-readable risk tags (e.g. `gpt55_concurrency_cwe732_miss`, `same_family_blind_spot`, `needs_user`) |

**Optional per-record extras (include only where §9 has them):** `emits` (architecture decomposition
shape), `stall_recovery`, `forbid_model`. **`effort` is `null`** for `mechanical` (fixed low) and for
fallback rungs that pin a fixed profile. Provider/model/effort string values MUST use the verbatim
ids from §2. The Codex builder validates its own output parses and that every `categories` key and
every `gates[]` entry exists in the §2 spine (the validator script re-checks this).

### 4.5 `global_invariants` (REQUIRED, from §9 tail)
```json
"global_invariants": {
  "commit_gate": "strongest_available_checker; cross_family; not_self; halt_if_unavailable",
  "cross_provider_validation": "reviewer_family != generator_family",
  "no_duplicate_tasks": true,
  "no_output_averaging": true,
  "no_peer_to_peer_mesh": true,
  "subagent_output_contract": "{status,summary,source_locators,risks,writes_requested}",
  "telemetry_required": true
}
```
