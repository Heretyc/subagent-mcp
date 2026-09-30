# Routing-Table Model→Provider Map and Effort Normalization

Load when: mapping a pairing's `model` to a provider, or normalizing a pairing's
`effort` tier to the launch enum, while implementing/auditing `src/routing.ts`.
Leaf of [routing-table-contract.md](routing-table-contract.md); the parent owns
load path, branch selection, candidate construction, and the attempt loop.

## model → provider map

Derive provider from the pairing's `model`:

| `model` value(s) | provider |
|---|---|
| `haiku`, `sonnet`, `sonnet-5-5`, `sonnet-5`, `sonnet-4-6`, `sonnet-4-5`, `opus`, `opus-4-8`, `opus-5-5`, `opus-5`, `opus-4-7`, `opus-4-6`, `opus-4-5`, `fable`, `fable-5`, `fable-5-1` | `claude` |
| `gpt-5.5`, `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` | `codex` |

Rule: Claude model ids map to `claude`; any GPT/codex-family id maps to
`codex`. An unknown model id that maps to neither → skip that pairing (treat as
a launch-time failure for that candidate; advance). Note: the launch model enum
is currently
`["haiku","sonnet","sonnet-5-5","sonnet-5","sonnet-4-6","sonnet-4-5","opus","opus-4-8","opus-5-5","opus-5","opus-4-7","opus-4-6","opus-4-5","fable","fable-5","fable-5-1","gpt-5.5","gpt-5.6","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-6-astra","gpt-6-sol","gpt-6-luna"]`.
Generic `opus`/`sonnet`/`fable` track GA (Opus 5.5 / Sonnet 5.5 / Fable 5.1);
`opus-4-8`, `opus-5-5`, `opus-5`, `opus-4-7`, `opus-4-6`, `sonnet-5-5`, `sonnet-5`,
`sonnet-4-6`, `fable-5-1`, and the pinned `fable-5` stay on their exact CLI ids,
and the dated `opus-4-5` (`claude-opus-4-5-20251101`) and `sonnet-4-5`
(`claude-sonnet-4-5-20250929`) stay pinned to their exact dated ids. The committed
runtime table is launchable-only; its backend id for the public `gpt-5.6`
selector is `gpt-5.6-sol`. Benchmarked codex sibling ids that cannot be launched
are retained only in the audit artifact and filtered out before comparing the
audit universe to the shipped table.

## effort normalization (table tier → launch enum)

Launch enum: `["medium","high","xhigh","max","ultracode"]`. Normalize the
pairing's `effort` before passing to `buildCommand`. Unsupported combinations are
REJECTED (→ skip candidate), NEVER clamped or silently substituted:

1. `haiku` and `sonnet-4-5` → `none` sentinel (effort ignored by `buildCommand`;
   reported as-is; extended-thinking models take no `--effort` flag).
2. Tier not in the launch enum, including `none` on an effort-capable model and
   the banned `low` (never a launch-enum value) → skip this candidate (advance).
   Never guessed.
3. `ultracode` is valid ONLY on `opus-4-8` (CLI settings-file injection verified
   there). Generic `opus` is GA Opus 5.5 and is NOT ultracode-capable → any other
   model is skipped, never downgraded to `xhigh`.
4. Codex `max` is valid only on `CODEX_MAX_MODELS`: the gpt-6 family
   (`gpt-6-astra`/`gpt-6-sol`/`gpt-6-luna`), the gpt-5.6 trio
   (`gpt-5.6-sol`/`gpt-5.6-terra`/`gpt-5.6-luna`), and the generic `gpt-5.6`
   alias (pins `gpt-5.6-sol` and inherits its `max`). Only `gpt-5.5` has no
   `max` tier → skipped, never downgraded.
5. claude effort obeys the per-model ladder (`CLAUDE_EFFORT_LADDERS`, the shared
   SSOT): `sonnet-4-6` and `opus-4-6` accept `medium`/`high`/`max` (NO `xhigh`);
   `opus-4-5` accepts `medium`/`high` only; every other effort-capable claude
   model (`opus`/`opus-5-5`/`opus-5`/`opus-4-8`/`opus-4-7`, `sonnet`/`sonnet-5-5`/
   `sonnet-5`, `fable`/`fable-5-1`/`fable-5`) and api models accept
   `medium`/`high`/`xhigh`/`max`. A tier outside a model's ladder is REJECTED
   (skip candidate), never downgraded.

A rejected pairing is skipped so the attempt loop advances to the next ranked
pairing; if none survive, the handler emits `ERR_NO_CANDIDATES`. The resolver
produces a `{ provider, launchModel, launchEffort }` triple per surviving
candidate. `buildCommand` + `resolveEffort` remain the final authority; they now
throw loudly on any unsupported combo (no silent `high` fallback), and the
attempt loop treats such a throw as a launch failure and advances: defense in
depth.
