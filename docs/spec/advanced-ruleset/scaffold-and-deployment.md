# Advanced-Ruleset Scaffold and Deployment

Normative. Defines the scaffold's single source of truth, how it reaches
`dist/` and the global install, the installer's preserve-user-edits bracket,
and the runtime recreate. Execution semantics live in `execution-contract.md`.

## Critical rule (repeated)

A package update must NEVER overwrite a user-edited `advanced-ruleset.py`.
The installer backs the live file up BEFORE `npm install -g` and restores it
AFTER. The shipped scaffold only ever lands on first install or when the user
file is byte-identical to it.

## Single source of truth

The canonical scaffold content is the tracked file `src/advanced-ruleset.py`
and NOWHERE else. Every other copy is mechanically derived per build, so drift
is impossible (a test asserts byte-equality anyway, `build-and-test.md`):

| Artifact | Derived how |
|---|---|
| `src/ruleset-scaffold.ts` (git-ignored, GENERATED) | `scripts/gen-ruleset-scaffold.mjs` reads the `.py` and emits `export const RULESET_SCAFFOLD: string = <JSON.stringify of the bytes>` with a `GENERATED ... DO NOT EDIT` header. Hard-fails if the `.py` is missing. |
| `dist/advanced-ruleset.py` | `scripts/copy-provider.mjs` copies `src/advanced-ruleset.py` -> `dist/`. HARD-FAILS the build (exit 1) if the source is missing, matching the routing-table and config copy policy for required shipped parts. |
| Runtime recreate | `ensureScaffold()` writes `RULESET_SCAFFOLD` to the dist path when absent (`src/ruleset.ts`). |

Build order (package.json `build`):

```
node scripts/gen-ruleset-scaffold.mjs && tsc && node scripts/copy-provider.mjs
```

The gen step runs BEFORE `tsc` so `import { RULESET_SCAFFOLD } from
"./ruleset-scaffold.js"` always resolves; `prepare` already runs `build`, so
`npm pack` is covered. `.gitignore` gains `src/ruleset-scaffold.ts`.

## Packaging and runtime path

- The tarball ships the file because package.json `files` includes `dist` as a
  whole-dir entry (`["dist", "directives", "LICENSE", "NOTICE", "README.md"]`)
  : no `files`-array change needed. `src/` is NOT in the pack (an older
  installer reference claiming the pack includes `src/` is stale; do not copy
  that claim).
- Runtime path: dist sibling of the compiled module :
  `fileURLToPath(new URL("./advanced-ruleset.py", import.meta.url))` : the
  exact pattern of `defaultTablePath()` for `routing-table.json`
  (src/routing.ts:86-88), so both files live in the same directory.
- Global install path: `$(npm root -g)/@heretyc/subagent-mcp/dist/advanced-ruleset.py`.
  The package is SCOPED; any unscoped `subagent-mcp/dist` path is stale.

## Shipped scaffold content requirements

- `LOAD_RULES = False` as shipped : the ruleset is inert until the user flips
  it (env check then latches `disabled` per process; `execution-contract.md`).
- Stdlib-only logic; runs identically under `py`/`python3`/`python` >= 3.8 (no
  newer syntax); never prints non-JSON to stdout : diagnostics go to stderr;
  exit code 0 on success paths.
- A commented requirements stub (`REQUIREMENTS = []`) plus a pip-check helper
  (`missing_requirements()` via `importlib.util.find_spec`) that the env-check
  uses to report `ready`.
- Docstrings MUST document: (a) the performance warning : rules run
  synchronously inside EVERY `launch_agent` call; slow rules slow every agent
  launch; the user's responsibility, they have been warned; (b) the exact
  expected JSON output shape with a template; (c) the input contract : all
  three exactly as specified in `io-contract.md`.
- Default `apply_rules(candidates, context)` is a passthrough returning the
  list unchanged.

## Installer bracket (`skills/subagent-mcp-installer/scripts/deploy.mjs`)

`npm install -g <tarball>` REPLACES the global package dir in place, so an
in-root backup dies with the dir. Therefore, inside `deploy(root, pkg)`:

1. BEFORE `npm install -g`: compute the prospective root EARLY :
   `npm root -g` + `join(gRoot, ...pkg.name.split("/"))` (the install root is
   otherwise only known after install). If
   `<install>/dist/advanced-ruleset.py` exists: read it into memory AND write
   a safety copy to `os.tmpdir()` as
   `advanced-ruleset.py.bak-deploy-<Date.now()>` (NEVER inside the install
   root), logging the path (matches the existing `backup()` naming
   convention). First install / file absent → silent no-op.
2. AFTER install (before `verify()`): if a snapshot was taken and it DIFFERS
   from the freshly shipped scaffold, write it back over the dist file and log
   `restored user advanced-ruleset.py (package update never overwrites user
   edits)`. Identical content → skip (idempotent, house "already present :
   left as-is" style).
3. `verify()` gains `dist/advanced-ruleset.py` in its required-parts `need`
   array. `src/setup.ts` `verifyInstall()` gains the same entry : keep BOTH
   lists consistent. Both checks are EXISTENCE-ONLY by design: a restored USER
   file satisfies them.
4. `skills/subagent-mcp-installer/SKILL.md` rule-2 part list names the ruleset
   scaffold as a shipped part plus the preserve-on-update guarantee.

## Runtime recreate

When the gate is `unknown` or `enabled`, the server calls `ensureScaffold()`
before each script execution: if the dist file is absent it is rewritten from
`RULESET_SCAFFOLD`. A write failure is a ruleset failure → hard fail
(`io-contract.md`). While the gate is latched `disabled` nothing executes, so
a deleted file stays absent until the next process start.

## Negative constraints

- NEVER overwrite a user-edited `advanced-ruleset.py` during update : the only
  acceptable data-loss path is the user editing the file themselves.
- NEVER store the deploy backup inside the install root (npm deletes it).
- NEVER hand-edit `src/ruleset-scaffold.ts`; regenerate via the build.
- NEVER downgrade the dist scaffold copy to warn-and-skip.
- NEVER claim `src/` ships in the npm pack : only `dist/` does.

## Reused by the global cap config

The `global-subagent-mcp-config.jsonc` cap config reuses THIS leaf's mechanism
verbatim: the same three-site backup/restore bracket (CLI self-update +
installer `deploy.mjs` + runtime recreate-if-absent), the same
gen-scaffold to git-ignored embed to copy-provider hard-fail build chain, the
same `verify()` / `verifyInstall()` existence checks, and the same
never-overwrite-user-edits guarantee. The gen step is the SAME
`scripts/gen-ruleset-scaffold.mjs` extended to also emit
`src/config-scaffold.ts`; the copy step is the SAME `scripts/copy-provider.mjs`
extended to copy `src/global-subagent-mcp-config.jsonc` into `dist/`. The copy
step also emits `dist/global-concurrency.jsonc` as a legacy back-compat name.
Full details and
the cap's own contract live in `../global-concurrency/cap-contract/config-and-build.md`
(Retention And Build). Nothing in the ruleset bracket above changes. The cap adds a
parallel copy of it.

## When to stop and ask the owner

Moving the scaffold out of `dist/`, renaming it, or weakening the
preserve-on-update guarantee changes the owner's stated contract : ask first.
