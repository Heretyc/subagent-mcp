# Auto-Mode Resolution Matrix

Normative. The complete param-presence -> behavior table for auto-mode
validation. Exact error text lives in
[resolution-errors.md](resolution-errors.md).

## Presence matrix

`P`=provider, `M`=model, `E`=effort present. Present means
`value !== undefined`; an empty string still counts as present. `launchable
valid` means one of the 14 taxonomy categories other than `fallback_default`.
`fallback_default` is a valid category sentinel, but resolver-backed modes
cannot launch it.

| C | P | M | E | Outcome |
|---|---|---|---|---|
| launchable valid | : | : | : | `auto` mode; build candidate list, attempt loop |
| launchable valid | yes | : | : | `provider` mode; provider-matched candidates first, then de-duplicated auto fallbacks; attempt loop |
| launchable valid | yes | yes | : | `provider_model` mode; single attempt on rank-1 provider+model-matched candidate; hard-fails on failure with no auto substitute |
| launchable valid | yes | yes | yes | `explicit` mode; single attempt on the fully-pinned triple; hard-fails loudly with no auto substitute |
| fallback_default | : | : | : | **ERR_FALLBACK_DEFAULT** |
| fallback_default | yes | : | : | **ERR_FALLBACK_DEFAULT** |
| fallback_default | yes | yes | : | **ERR_FALLBACK_DEFAULT** |
| fallback_default | yes | yes | yes | `explicit` mode; requested triple first; no table fallback category |
| launchable valid/fallback_default | : | yes | : | **ERR_MODEL_NEEDS_PROVIDER** |
| launchable valid/fallback_default | : | yes | yes | **ERR_EFFORT_NEEDS_BOTH** (effort rule checked first; see Validation order) |
| launchable valid/fallback_default | : | : | yes | **ERR_EFFORT_NEEDS_BOTH** |
| launchable valid/fallback_default | yes | : | yes | **ERR_EFFORT_NEEDS_BOTH** |
| absent/invalid | * | * | * | **ERR_BAD_CATEGORY** (validate category FIRST, before P/M/E rules) |

All rows above assume `deadlock` absent or `false`. `deadlock=true` combinations
are in the **Deadlock combinations** sub-table below (checked at validation
step 2, before the P/M/E rules).

Validation order in the handler:

1. `task_category` valid? else `ERR_BAD_CATEGORY`.
2. `deadlock === true` AND any of `provider`/`model`/`effort` present ->
   `ERR_DEADLOCK_WITH_OVERRIDES`. Runs BEFORE the effort/model rules, so it
   pre-empts `ERR_EFFORT_NEEDS_BOTH`/`ERR_MODEL_NEEDS_PROVIDER` for those combos.
3. If `effort` present and not (`provider` and `model`) -> `ERR_EFFORT_NEEDS_BOTH`.
4. If `model` present and not `provider` -> `ERR_MODEL_NEEDS_PROVIDER`.
5. (explicit mode only) provider+model must match the existing
   provider<->model rule from `src/index.ts` (claude<->{haiku,sonnet,opus,opus-4-8,fable};
   codex<->{gpt-5.5,gpt-5.6}); reuse that existing check and its message verbatim.
6. If `task_category` is `fallback_default` and mode is not `explicit` ->
   `ERR_FALLBACK_DEFAULT`.
6b. (Presence/mode validation complete.) If `sub-orchestrator: true`, check
   `currentLaunchDepth() >= 1` -> `ERR_SUBORCH_DEPTH`. This depth gate runs AFTER
   presence validation (so a bad presence combo gets the presence error, not the
   depth error) and BEFORE the model-mode gate.
7. All validation passed. If `deadlock === true`, ARM the deadlock window now
   (counter = 3; `routing-table-contract.md section Branch selection`) : never before
   this point, so a rejected call never arms. Then build the candidate list for
   the selected branch and run the attempt loop (`routing-table-contract.md`).

### Deadlock combinations

`D` = `deadlock=true` (see Validation order step 2; `false`/absent -> use the
main matrix). Step 2 precedes the effort/model rules, so ANY override alongside
`deadlock=true` yields `ERR_DEADLOCK_WITH_OVERRIDES` : even a combo that would
otherwise be `ERR_MODEL_NEEDS_PROVIDER` or `ERR_EFFORT_NEEDS_BOTH`.

| C | D | P | M | E | Outcome |
|---|---|---|---|---|---|
| launchable valid | yes | yes | : | : | **ERR_DEADLOCK_WITH_OVERRIDES** |
| launchable valid | yes | : | yes | : | **ERR_DEADLOCK_WITH_OVERRIDES** (pre-empts ERR_MODEL_NEEDS_PROVIDER) |
| launchable valid | yes | : | : | yes | **ERR_DEADLOCK_WITH_OVERRIDES** (pre-empts ERR_EFFORT_NEEDS_BOTH) |
| launchable valid | yes | yes | yes | yes | **ERR_DEADLOCK_WITH_OVERRIDES** |
| launchable valid | yes | : | : | : | `auto`; arm window (counter=3), read `performance`, attempt loop |
| launchable valid | no | : | : | : | `auto`; read `performance` if a window is live, else `cost_efficiency` |

`deadlock=false` is identical to omitting it (last row): it never arms and never
errors with overrides : `false` + full P/M/E is plain `explicit` mode.

## Exact error messages

See [resolution-errors.md](resolution-errors.md) for exact error text, shared
hint blocks, and anti-examples.
