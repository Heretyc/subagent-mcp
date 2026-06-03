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

**This file is an index.** Per the AGENTS.md <=200-line rule, the detailed sections live in the
same-named `kb-manifest/` subdirectory. Read in order:

| § | Section | File |
|---|---------|------|
| 1 | FINAL FILE LIST (exact relative paths under `.spec/references/`) | [kb-manifest/01-final-file-list.md](kb-manifest/01-final-file-list.md) |
| 2 | CANONICAL WORK-CATEGORY SPINE (final ids + precedence) | [kb-manifest/02-canonical-work-category-spine.md](kb-manifest/02-canonical-work-category-spine.md) |
| 3 | BUILD PARTITION — 5 BALANCED BUILDER SLOTS | [kb-manifest/03-build-partition.md](kb-manifest/03-build-partition.md) |
| 4 | `assets/routing-table.json` FIELD SCHEMA | [kb-manifest/04-routing-table-json-field-schema.md](kb-manifest/04-routing-table-json-field-schema.md) |
| 5 | BUILDER CHECKLIST (every slot, before returning) | [kb-manifest/05-builder-checklist.md](kb-manifest/05-builder-checklist.md) |
