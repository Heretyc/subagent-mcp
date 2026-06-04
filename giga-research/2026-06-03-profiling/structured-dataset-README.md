# Structured Dataset Extraction Index

Run: 2026-06-03 profiling provenance consolidation.

## Counts

- Models in `models`: 7
- Model@effort universe size: 22
- Benchmark rows: 301
- Gap rows: 192
- Withdrawn rows: 2
- Fixed categories: 10

## Extraction Caveats

- Agent 1 is the authoritative universe/spec source.
- Raw values are unnormalized; percent and score units are retained separately.
- `any` effort means the source did not report a canonical effort tier.
- Gaps are exact effort/category gaps, so `any` benchmark rows do not close tier-specific gaps.
- GPT-5.5 SWE-bench Verified 88.7 was excluded and recorded as withdrawn per Phase 1.5.
- Numeric modifier rows were mapped to the nearest fixed category for schema completeness.
- Qualitative non-numeric rows were omitted because `raw` must be numeric.
- Date-only `retrieved_at` values mirror provenance files that gave no exact timestamp.
- Manual failure-mode metrics were included from Phase 1 Agent 5 using that file's source ledger.

## Outputs

- `structured-dataset.json`
- `structured-dataset-README.md`
