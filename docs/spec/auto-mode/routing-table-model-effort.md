# Routing-Table Model→Provider Map and Effort Normalization

Load when: mapping a pairing's `model` to a provider, or normalizing a pairing's
`effort` tier to the launch enum, while implementing/auditing `src/routing.ts`.
Leaf of [routing-table-contract.md](routing-table-contract.md); the parent owns
load path, branch selection, candidate construction, and the attempt loop.

## model → provider map

Derive provider from the pairing's `model`:

| `model` value(s) | provider |
|---|---|
| `haiku`, `sonnet`, `sonnet-5-5`, `sonnet-4-6`, `opus`, `opus-4-8`, `opus-5-5`, `fable`, `fable-5`, `fable-5-1` | `claude` |
| `gpt-5.5`, `gpt-5.6`, `gpt-5.6-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` | `codex` |

Rule: Claude model ids map to `claude`; any GPT/codex-family id maps to
`codex`. An unknown model id that maps to neither → skip that pairing (treat as
a launch-time failure for that candidate; advance). Note: the launch model enum
is currently
`["haiku","sonnet","sonnet-5-5","sonnet-4-6","opus","opus-4-8","opus-5-5","fable","fable-5","fable-5-1","gpt-5.5","gpt-5.6","gpt-6-astra","gpt-6-sol","gpt-6-luna"]`.
Generic `opus`/`sonnet`/`fable` track GA (Opus 5.5 / Sonnet 5.5 / Fable 5.1);
`opus-4-8`, `opus-5-5`, `sonnet-5-5`, `sonnet-4-6`, `fable-5-1`, and the pinned
`fable-5` stay on their exact CLI ids. The committed
runtime table is launchable-only; its backend id for the public `gpt-5.6`
selector is `gpt-5.6-sol`. Benchmarked codex sibling ids that cannot be launched
are retained only in the audit artifact and filtered out before comparing the
audit universe to the shipped table.

## effort normalization (table tier → launch enum)

Launch enum: `["medium","high","xhigh","max","ultracode"]`. Normalize the
pairing's `effort` before passing to `buildCommand`. Unsupported combinations are
REJECTED (→ skip candidate), NEVER clamped or silently substituted:

1. `haiku` → `none` sentinel (effort ignored by `buildCommand`; reported as-is).
2. Tier not in the launch enum, including `none` on an effort-capable model and
   the banned `low` (never a launch-enum value) → skip this candidate (advance).
   Never guessed.
3. `ultracode` is valid ONLY on `opus-4-8` (CLI settings-file injection verified
   there). Generic `opus` is GA Opus 5.5 and is NOT ultracode-capable → any other
   model is skipped, never downgraded to `xhigh`.
4. Codex `max` is valid only on the gpt-6 family (`gpt-6-astra`/`gpt-6-sol`/
   `gpt-6-luna`); `gpt-5.5`/`gpt-5.6` → skipped, never downgraded.
5. claude (non-haiku) and api models accept `medium`/`high`/`xhigh`/`max` as-is.

A rejected pairing is skipped so the attempt loop advances to the next ranked
pairing; if none survive, the handler emits `ERR_NO_CANDIDATES`. The resolver
produces a `{ provider, launchModel, launchEffort }` triple per surviving
candidate. `buildCommand` + `resolveEffort` remain the final authority; they now
throw loudly on any unsupported combo (no silent `high` fallback), and the
attempt loop treats such a throw as a launch failure and advances: defense in
depth.
