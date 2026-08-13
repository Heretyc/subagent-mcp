<!-- Part of model-profiler SKILL.md (split). See ../SKILL.md for the skill index. -->

## Pipeline at a Glance

The Phase 0 to VALIDATE pipeline : wrapped by the SETUP (worktree gate) and DELIVER (commit, push,
PR, deliver link+summary) boxes of invariant #15 : is diagrammed in `references/overview.md`
(section Pipeline at a Glance). Start there, then follow the decision tree per phase.

## Output Contract

The skill run produces **EXACTLY 3 persisted artifacts** : nothing else persists to the repo:
- `src/routing-table.json` : lean canonical routing table (`performance` + `cost_efficiency`,
  14 fixed categories, ordered pairings). Copied to `dist/routing-table.json` by `copy-provider.mjs`.
- `src/routing-table-audit.json` : full-provenance audit trail (per-pairing source URLs, ISO8601
  retrieval times, annotations, tier rationale). SOLE provenance store; the change note (what shifted +
  why) lives in its metadata.
- `research-seed-sites.json` (repo root) : accumulating learned source registry, merged from this run's
  audit citations by `update_seed_sites.mjs`.

Phase research is EPHEMERAL : written to `%TEMP%\model-profiler\<run-id>\`, consumed, never persisted.

## Cross-Links

- **Validators:** provider = `scripts/validate_provider.mjs`; seed = `scripts/validate_seed_sites.mjs`.
- **Fixed taxonomy:** definitions in `.spec/references/work-categories.md`; methodology + rationale
  in `docs/spec/task-taxonomy/`.
- **Provenance:** durable provenance = the audit file's `citations[]` + `research-seed-sites.json`;
  prior `src/routing-table.json` + `research-seed-sites.json` are the diff template for new runs.
- **Routing dogfood:** when selecting sub-agent tiers, route by the routing table's own rules
  (see `references/dispatch-mechanics.md` and `references/citations-labels.md`).
