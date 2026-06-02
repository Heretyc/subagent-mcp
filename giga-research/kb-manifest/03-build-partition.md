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
