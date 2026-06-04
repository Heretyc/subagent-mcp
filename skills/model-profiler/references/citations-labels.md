# citations-labels.md — Citations, Labels & New-Model Sparsity

**Load when:** any sub-agent makes a sourced claim, or you are reviewing provenance during the
adversarial loop / validation.

---

## Citation rules

- **APA, to ORIGINAL sources only.** Cite the vendor doc, the benchmark, the eval report, the
  primary article — never an internal `.spec/references/*.md` file. Internal leaves are navigation
  targets, not provenance. The validator's provenance-purity check fails any leaf that cites an
  internal KB path as a `Source:`/`Citation:`/`Provenance:` line.
- Each source is recorded in `src/routing-table-audit.json` `citations[]` (url, retrieved_at,
  one-sentence annotation, optional label) on the pairing it backs, and is harvested into
  `research-seed-sites.json` (the accumulating learned source registry). Add the new model's sources to
  the audit citations; the emission step merges them into the seed registry. There is no `.spec` ledger.
- If a source URL is dead/redirecting, keep the citation but mark it `[UNVERIFIED]` (or note the
  redirect) and flag dependent claims — do not silently drop it.

## Label key

| Label | Meaning | Authority |
|-------|---------|-----------|
| *(unlabeled)* | Official vendor docs / verified benchmark | Highest |
| `[INFERRED]` | Extrapolated from cited facts; not directly vendor-stated | Below vendor docs |
| `[ASSUMPTION]` | Mandated working premise (an interview decision); overrides inference | Binding steering |
| `[SEED]` | A prior hypothesis (e.g., Blackburn seed) — treated as hypothesis; docs/benchmarks override | Lowest |
| `[PRESS]` | Press/announcement-sourced, pending independent replication | Use with caution |

**Authority chain:** Phase 1.5 interview decisions are binding > official vendor docs + verified
benchmarks override seed > conflicts resolved by best-sourced evidence, never by blind averaging.

## New / sparsely corroborated model (the common case here)

A just-released model often has only the vendor announcement and same-day press. For it:

- Use **task-split framing** — claim leadership only where evidence supports it (e.g., "leads on
  long-horizon/agentic; roughly equal on isolated coding"), not blanket superiority.
- Mark magnitude/superiority claims that lack independent replication as `[ASSUMPTION]` or
  `[PRESS]`, and record the residual uncertainty in the audit `basis`/`citations[]`.
- Prefer routing changes that are robust to the uncertainty (e.g., keep a strong fallback) until
  corroboration lands; note the route as eval-tunable rather than asserting it as settled.

## Where labels land

- Claim-level labels live inline on the pairing's `basis` field in `src/routing-table-audit.json`.
- The label key + the new model's seed-corroboration + conflict reconciliations + residual uncertainty
  live in the audit metadata (`basis`/`citations[]`), not a separate prose file.
- APA references + the source→claim mapping live in the audit `citations[]`; each source is harvested
  into `research-seed-sites.json`.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
