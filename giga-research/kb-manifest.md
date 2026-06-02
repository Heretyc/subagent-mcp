# KB Manifest — `.spec/references/` RAG Knowledge Base (Decomposition Plan)

**Status:** Planning artifact ONLY. This file prescribes the exact file list, canonical-fact
ownership, build partition, work-category spine, and the `routing-table.json` schema so that five
independent builders produce ONE consistent KB. **No builder may invent files, ids, or facts not
listed here.** No `.spec/references` file is written by the architect; builders write the leaves.

**Source of truth being decomposed:** `giga-research/phase-2-core-synthesis.md` (canonical merge),
steered by `giga-research/phase-1.5-fast-interview.md` (authoritative decisions).

**Author metadata (every file footer):** Lexi Blackburn — https://github.com/Heretyc/ — May 2026.

**Hard rules inherited from `AGENTS.md`:**
- Every markdown / RAG file **<=200 lines** (HARD cap). `retrieval-map.md` is also a RAG file: **<=200 lines**.
- Cross-reference related leaves by **RELATIVE PATH only** (navigation, never provenance).
- **One canonical home per fact.** If fact X is owned by leaf A, leaf B may *reference* it but must
  not restate the number/rule. Builders MUST check the "OWNS" column before writing a table.
- `source-ledger.md` cites **ORIGINAL external sources only** (APA). **Never** cite a `.spec/references`
  file as provenance. Leaves carry NO citations inline — they point to `source-ledger.md` by source id.
- No README / changelog / install / index-beyond-retrieval-map clutter. Progressive disclosure.
- Author/AI-attribution co-author lines are **forbidden** in any file (AGENTS.md). The "Lexi Blackburn"
  footer is *author metadata for the KB*, not a git co-author line.

---

## 1. FINAL FILE LIST (exact relative paths under `.spec/references/`)

13 files total: 1 nav map + 9 leaves + 1 source ledger + 1 routing JSON + 1 validator script.

| # | Path (relative to `.spec/references/`) | Scope (one line) | Fed by core-synthesis § | OWNS (canonical facts — nowhere else) | Cross-refs (relative path) |
|--:|----------------------------------------|------------------|-------------------------|----------------------------------------|----------------------------|
| 0 | `retrieval-map.md` | FIRST-LOAD nav: all semantic indices + trigger matrix + per-file "Load when" + stop-and-ask. | §0 TL;DR, §1.10, all (as router) | The trigger->file mapping ONLY (no domain facts; it routes, it does not teach). | every leaf below |
| 1 | `routing-contract.md` | The 3-step contract (gates->classify->emit) + precedence order + 3 halt conditions + adjacent-tie rule. | §0, §1.10 | Precedence order string; first-match rule; adjacent-tie-escalation rule; the 3 halt-and-surface triggers (summary form); input envelope field list. | `work-categories.md`, `routing-table.md`, `hard-gates.md`, `governance-halts.md` |
| 2 | `work-categories.md` | The 8+fallback taxonomy: id, definition, classify signals, examples, boundary/anti-example. | §1.1–§1.9, §1.10 default | Each category's **definition + classify-signal keyword list + boundary/anti-example**. Canonical id spelling. | `routing-table.md`, `routing-contract.md`, `hard-gates.md`, `synergy-patterns.md` |
| 3 | `routing-table.md` | Human-readable per-category route: primary {provider·model·effort} -> fallback chain -> synergy -> gates -> effort rationale. | §2 (table + effort rationale) | Each category's **route + fallback chain + applicable-gate list + task-class effort default**. The "escalate-within-provider / switch-only-for-fit" rule. | `work-categories.md`, `model-profiles.md`, `hard-gates.md`, `synergy-patterns.md`, `cost-model.md`, `assets/routing-table.json` |
| 4 | `hard-gates.md` | The 7 gates (G_MATH, G_CTX*, G_SEC, G_COMMIT, G_SANDBOX, G_DATA, G_OPUS_LOCK): trigger -> action; gate-interaction examples. | §3 | Each gate's **trigger condition + action + threshold numbers** (200K/272K/400K/1M/64K/128K; cross-review family rule; Opus locked-sampling 400-error + max_tokens>=64K). | `routing-contract.md`, `cost-model.md`, `governance-halts.md`, `model-profiles.md` |
| 5 | `model-profiles.md` | Per-model capability + risk + ctx/effort/api-id table (Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5, GPT-5.5, GPT-5.4-mini, GPT-5.5-pro). | §5 (+ §0 Opus framing) | Each model's **api-id, ctx in/out, effort ladder, decisive strength, decisive risk, best categories**; the Opus-4.8 task-split benchmark framing (SWE Verified tie / Pro +10.6pp / Terminal +8.5pp / GDPval 1890). | `cost-model.md`, `routing-table.md`, `failure-modes.md`, `source-ledger.md` |
| 6 | `cost-model.md` | Pricing, tokenizer-inflation 1.4x, effective-cost ladder, 3-tier discipline, ranked cost levers. | §4 | **All $ rates**, the 272K price-cliff numbers, the **1.4x tokenizer-inflation** modeling constant, effective-cost ladder, 40–60% three-tier saving, cost-lever ranking. | `model-profiles.md`, `hard-gates.md`, `routing-table.md` |
| 7 | `synergy-patterns.md` | Cross-provider Patterns 1/2/4a/4b/5/7 + hub-and-spoke topology + the 5 anti-patterns (A–E). | §6 | Each **pattern's name, mechanism, IPC shape, when-to-use**; the 5 anti-patterns; hub-and-spoke vs peer-mesh cascade numbers (0.89/0.32; 17.2x/4.4x; ~75% wall-clock). | `routing-table.md`, `work-categories.md`, `governance-halts.md`, `failure-modes.md` |
| 8 | `failure-modes.md` | Symptom/error -> detection -> routing-term mitigation table (hallucination, concurrency, stall, truncation, injection, 429, etc.). | §7 | Each **failure mode's detection signal + mitigation** (the 170/mLOC concurrency, CWE-732, agentic-overconfidence 73%/35%, 1M context degradation). | `model-profiles.md`, `synergy-patterns.md`, `hard-gates.md`, `governance-halts.md` |
| 9 | `governance-halts.md` | Commit gate, data boundary, write-scoping, halt-and-surface (5 conditions), telemetry fields, subagent output contract. | §8 (+ §0 halts, §10/§11 decision posture) | The **5 halt conditions (full form)**, telemetry field list, subagent `{status,summary,source_locators,risks,writes_requested}` contract, write-scoping rejects, data-retention windows (<=30d). | `hard-gates.md`, `routing-contract.md`, `synergy-patterns.md` |
| 10 | `decision-rationale.md` | WHY the routing is shaped this way: seed-status table, the 8 conflict reconciliations, mandate-overrides-benchmark, label key. | §0 label key, §10, §11 | Each **conflict's resolution + residual uncertainty**; seed [SEED] corroboration status; the "mandate overrides benchmark" calls (G_MATH vs Sonnet 89%); label-key meaning. | `model-profiles.md`, `work-categories.md`, `routing-table.md`, `source-ledger.md` |
| 11 | `source-ledger.md` | APA citations to ORIGINAL sources + source-id -> claim map. | §12 (+ every labeled claim) | **All APA references**; the source-id <-> claim-supported mapping. No domain facts of its own. | (none outbound; leaves point IN to it by source id) |
| 12 | `assets/routing-table.json` | Machine-consumable category->route table the subagent-mcp feature loads at runtime. | §9 | The **machine record** of every category route (mirror of `routing-table.md` + `hard-gates.md`, machine form). Schema in §4 below. | consumed by feature; mirrors leaves 3+4 |
| 13 | `scripts/validate_kb.py` | Deterministic KB validator: line-cap, broken relative links, retrieval-map covers every leaf, JSON schema sanity. | (tooling — not a synthesis section) | n/a (tool, owns no facts) | reads all files |

**Duplication-control note for builders.** `routing-table.md` (human) and `assets/routing-table.json`
(machine) are the **one allowed mirror** in the KB — same facts, two representations, by design (one
is for humans/agents reading, one is loaded by code). Both trace to §2+§9 and to `hard-gates.md` for
gate semantics. Everywhere else, a fact lives in exactly one leaf. Specifically:
- $ figures + 1.4x inflation -> **only** `cost-model.md` (gates/table reference "see cost-model.md").
- Threshold numbers (200K/272K/400K/1M/64K) -> **only** `hard-gates.md` (cost-model references the cliff $, not the routing action).
- Benchmark numbers -> **only** `model-profiles.md` (+ `decision-rationale.md` may name a delta when
  explaining a *conflict resolution*, citing the same source id — phrased as rationale, not a duplicate spec row).
- Category definitions -> **only** `work-categories.md` (routing-table references id, not definition prose).

---

## 2. CANONICAL WORK-CATEGORY SPINE (final ids + precedence — every builder uses these EXACT ids)

Lowercase snake_case ids. Precedence is the deterministic first-match order (§1.10). All 13 files,
including `routing-table.json`, MUST use these strings verbatim.

| precedence | canonical id | KB role |
|---:|--------------|---------|
| 1 | `math_proof` | hard-gate category (G_MATH) |
| 2 | `security_review` | hard-gate category (G_SEC verdict) |
| 3 | `architecture` | orchestrator tier |
| 4 | `quality_review` | contradiction-check / tie-break (G_COMMIT) |
| 5 | `debugging` | observed-failure fix |
| 6 | `agentic_execution` | closed-loop + deterministic extraction (Codex) |
| 7 | `knowledge_synthesis` | long-context / gray-area judgment |
| 8 | `coding` | bounded authored change |
| 9 | `mechanical` | leaf work (Haiku) |
| — | `fallback_default` | unclassifiable -> Sonnet read-only / ask narrower |

**Precedence string (verbatim, used in `routing-contract.md` and JSON `classification_precedence`):**
`math_proof > security_review > architecture > quality_review > debugging > agentic_execution > knowledge_synthesis > coding > mechanical` (then `fallback_default`).

**Gate ids (verbatim, used in `hard-gates.md` + JSON):** `G_MATH`, `G_CTX_200`, `G_CTX_272`,
`G_CTX_400`, `G_CTX_1M`, `G_CTX_OUT`, `G_SEC`, `G_COMMIT`, `G_SANDBOX`, `G_DATA`, `G_OPUS_LOCK`.

**Model api-ids (verbatim):** `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`,
`claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.5-pro`. Providers:
`anthropic`, `openai`. Harness for Codex routes: `codex`.

---

## 3. BUILD PARTITION — 5 BALANCED BUILDER SLOTS

Constraints honored: `retrieval-map.md` + `source-ledger.md` share ONE slot; `assets/routing-table.json`
(+ validator script) is its OWN slot (Codex builder). Remaining leaves balanced ~2 per slot by size/effort.

**Sequencing note for the orchestrator:** the spine (this manifest) is fixed, so slots can run in
parallel. The validator (Slot 5) and `retrieval-map.md` completeness (Slot 1) are the only
cross-cutting checks — run Slot 5's validator AFTER all content slots land. `routing-table.md` (Slot 3)
and `assets/routing-table.json` (Slot 5) must agree; both are pinned to §2/§9 here so they converge
without coupling the builders.

### Slot 1 — Navigation + Provenance (1 builder; keep map+ledger together)
- `retrieval-map.md`
- `source-ledger.md`
- **Content notes:** Build the ledger FIRST from §12 (APA, original sources only; source-id -> claim
  map; never cite internal files). Then build `retrieval-map.md` as the first-load index. It MUST
  contain, all within <=200 lines (use dense tables, terse rows): (a) semantic indices — **topic,
  alias/synonym, trigger-phrase, task-to-doc, symptom/error-to-doc, entity/product/vendor, workflow,
  decision-rule, failure-mode**; (b) a compact **trigger matrix** (trigger family -> exact file paths);
  (c) per-file **"Load when"** one-liners for all 9 leaves + the JSON; (d) MAXIMUM-AGGRESSIVE trigger
  coverage — direct names, aliases, acronyms (G_SEC, IPC, CWE, MTok), **misspellings** (e.g.
  "tokeniser", "architecure", "sonet"), adjacent work, and **implementation / debug / architecture /
  governance intents**, INCLUDING user intents that describe the *problem without naming the topic*
  (e.g. "my agent keeps asking questions and never writes code" -> stall -> `failure-modes.md` +
  `synergy-patterns.md` Pattern 4b; "is it safe to let the AI run shell commands" -> `hard-gates.md`
  G_SANDBOX + `governance-halts.md`; "which model is cheapest" -> `cost-model.md`; "the AI invented an
  API that doesn't exist" -> `failure-modes.md` hallucination + `hard-gates.md` G_SEC); (e) a
  **"when to stop and ask for more context"** section. The map teaches NOTHING — every row routes to a
  leaf. Verify it references EVERY leaf (the validator enforces this).

### Slot 2 — Contract + Taxonomy (1 builder; the classifier-facing core)
- `routing-contract.md`
- `work-categories.md`
- **Content notes:** `routing-contract.md` = the one-screen 3-step contract (gates-first ->
  precedence first-match -> emit `{provider,model,effort}`+fallback+validation), the verbatim
  precedence string, adjacent-tie escalation, the input envelope field list, and the 3 halt summaries
  (full halt detail lives in `governance-halts.md` — reference it). `work-categories.md` = the 9
  category cards + `fallback_default`: id, definition, classify-signal keyword list, 1–2 examples,
  boundary/anti-example. This is the densest content file; keep cards terse and tabular to fit <=200
  lines (a compact per-card table beats prose). Owns category definitions; route lives in
  `routing-table.md` (Slot 3) — link, do not restate routes here.

### Slot 3 — Routing Mechanics + Economics (1 builder; the "what to run + what it costs")
- `routing-table.md`
- `cost-model.md`
- **Content notes:** `routing-table.md` = per-category primary/fallback/synergy/gates/effort
  rationale from §2; reference category *definitions* by link (own only the route). `cost-model.md`
  = §4 in full (pricing tables, **1.4x tokenizer inflation flagged prominently as a migration
  surprise**, effective-cost ladder, three-tier 40–60% saving, ranked cost levers). These two pair
  because effort/route choices are cost-driven; keep the $ numbers ONLY in `cost-model.md` and have
  `routing-table.md` reference it for any price justification.

### Slot 4 — Risk, Patterns, Governance, Rationale (1 builder; the "why + safety" cluster)
- `model-profiles.md`
- `synergy-patterns.md`
- `failure-modes.md`
- `governance-halts.md`
- `decision-rationale.md`
- **Content notes:** Five smaller leaves, each naturally short (§5/§6/§7/§8/§10+§11). `model-profiles.md`
  owns capability+risk+benchmark facts (one table). `synergy-patterns.md` owns the 6 patterns + 5
  anti-patterns + topology. `failure-modes.md` owns the symptom->mitigation table. `governance-halts.md`
  owns the 5 halt conditions (full), telemetry, output contract, data-retention. `decision-rationale.md`
  owns the seed-status table + 8 conflict reconciliations + label key. Heavy cross-linking within this
  slot is expected; the single builder keeps them consistent and de-duplicated. This slot has the most
  files but the lowest tokens-per-file; total load ~ balances Slots 2/3.

### Slot 5 — Machine Artifact + Tooling (CODEX builder; its OWN slot per spec)
- `assets/routing-table.json`
- `scripts/validate_kb.py`
- **Content notes:** Emit `routing-table.json` to the EXACT schema in §4 below — mirror of §9 +
  `hard-gates.md`, machine form, all 9 categories + `fallback_default` + all 11 gates + metadata block.
  Then write `validate_kb.py` (stdlib only; cross-platform; no third-party deps) that deterministically
  checks: (1) every `.md` under `.spec/references/` is <=200 lines; (2) all relative cross-links
  resolve to existing files; (3) `retrieval-map.md` names every leaf file (coverage); (4)
  `routing-table.json` parses, has the metadata block, and every category id + gate id matches the
  spine in §2; (5) no internal `.spec/references` path appears in `source-ledger.md` (provenance
  purity). Exit non-zero with a per-violation report on any failure (fail-loud, Sanity Rule 12).

**Slot balance summary:** Slot1 = 2 files (nav+ledger, index-dense). Slot2 = 2 files (1 very dense).
Slot3 = 2 files (1 very dense). Slot4 = 5 files (all short). Slot5 = 2 files (1 JSON + 1 script).
Workload roughly even; the two densest content files (`work-categories.md`, `cost-model.md`) are split
across Slots 2 and 3 so no single builder owns two heavy files.

---

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

---

## 5. BUILDER CHECKLIST (every slot, before returning)
1. Each `.md` <=200 lines (count it). If over, split detail into a same-named subdir or tighten tables.
2. Cross-refs use relative paths that resolve. No absolute paths. No provenance-by-internal-file.
3. Owned facts only — do not restate a fact another leaf owns (see §1 OWNS column); reference instead.
4. One-screen summary at top of each leaf + "Load when" / "Do not load when" + dense lookup tables + short chunks.
5. Footer: `Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026` (author metadata, not a git co-author line).
6. Preserve `[SEED]`/`[INFERRED]`/`[ASSUMPTION]` labels where the source carried them.
7. Slot 5: run `validate_kb.py`; it must exit 0 before the slot is "done" (fail loud otherwise).
