# Routing-Table Model→Provider Map and Effort Normalization

Load when: mapping a pairing's `model` to a provider, or normalizing a pairing's
`effort` tier to the launch enum, while implementing/auditing `src/routing.ts`.
Leaf of [routing-table-contract.md](routing-table-contract.md); the parent owns
load path, branch selection, candidate construction, and the attempt loop.

## model → provider map

Derive provider from the pairing's `model`:

| `model` value(s) | provider |
|---|---|
| `haiku`, `sonnet`, `opus`, `opus-4-8`, `fable` | `claude` |
| `gpt-5.5`, `gpt-5.6` | `codex` |

Rule: Claude model ids map to `claude`; any GPT/codex-family id maps to
`codex`. An unknown model id that maps to neither → skip that pairing (treat as
a launch-time failure for that candidate; advance). Note: the launch model enum
is currently `["haiku","sonnet","opus","opus-4-8","fable","gpt-5.5","gpt-5.6"]`. The
committed runtime table is launchable-only; benchmarked codex sibling ids that
cannot be launched are retained only in the audit artifact and filtered out
before comparing the audit universe to the shipped table.

## effort normalization (table tier → launch enum)

Launch enum: `["medium","high","xhigh","max","ultracode"]`. Normalize the
pairing's `effort` before passing to `buildCommand`:

1. If the tier is already a launch-enum value, pass it through, THEN apply the
   model-specific clamps below.
2. `none` (haiku has no effort) → for `haiku`, effort is ignored by
   `buildCommand`; pass `none` as a placeholder (it is dropped) and report the
   pairing tier `none`-equivalent as the launched effort label.
3. Model-specific clamps (mirror `src/effort.ts` so the resolver never feeds an
   invalid combo into `buildCommand`):
   - `ultracode` is valid ONLY on `opus`/`opus-4-8`. On any other model →
     clamp DOWN to `xhigh`.
   - codex (`gpt-5.5`, `gpt-5.6`) has no `max`/`ultracode`: `max` → `xhigh`;
     `ultracode` → `xhigh`.
   - haiku ignores effort entirely.
4. Unknown / unrecognized tier (not in the enum, not `none`) → skip this
   candidate (advance). Do NOT guess.

The resolver should produce a `{ provider, launchModel, launchEffort }` triple
per surviving candidate. `buildCommand` + `resolveEffort` remain the final
authority; if they still throw for an edge combo, the attempt loop treats it as
a launch failure and advances (auto/partial modes) : defense in depth.
