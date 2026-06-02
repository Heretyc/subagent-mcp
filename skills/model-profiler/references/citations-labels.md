# citations-labels.md — Citations, Labels & New-Model Sparsity

**Load when:** any sub-agent makes a sourced claim, or you are reviewing provenance during the
adversarial loop / validation.

---

## Citation rules

- **APA, to ORIGINAL sources only.** Cite the vendor doc, the benchmark, the eval report, the
  primary article — never an internal `.spec/references/*.md` file. Internal leaves are navigation
  targets, not provenance. The validator's provenance-purity check fails any leaf that cites an
  internal KB path as a `Source:`/`Citation:`/`Provenance:` line.
- Each source gets an id in `source-ledger.md` mapping the source to the claims and leaves it
  supports. Add new ids for the new model's sources; keep the existing ledger entries.
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
  `[PRESS]`, and record the residual uncertainty in `decision-rationale.md`.
- Prefer routing changes that are robust to the uncertainty (e.g., keep a strong fallback) until
  corroboration lands; note the route as eval-tunable rather than asserting it as settled.

## Where labels land

- Claim-level labels live inline in the leaf where the claim is stated (`model-profiles.md`,
  `cost-model.md`, etc.).
- The label key + the new model's seed-corroboration row + conflict reconciliations + residual
  uncertainty live in `decision-rationale.md`.
- APA references + id→claim mapping live in `source-ledger.md`.

---

*Author: Lexi Blackburn — https://github.com/Heretyc/ — May 2026*
