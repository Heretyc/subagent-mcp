# Release Publishing SOP : npm registries

Status: normative. Read before cutting a release or diagnosing a publish
failure. Release publishing is performed by the owner-approved GitHub release
workflow `.github/workflows/npm-publish.yml`, not by hand. Lessons encoded from
the v2.8.0 release (2026-06-11) and the move to OIDC Trusted Publishing.

## Registry contract (npmjs primary, GitHub Packages secondary)

| Registry | Role | Routed by |
|---|---|---|
| Public npmjs.com (`registry.npmjs.org`) | DEFAULT publish target | `package.json` `publishConfig` |
| GitHub Packages (`npm.pkg.github.com`) | Secondary channel, same version and dist-tag | explicit `--registry` flag in the `github-packages` job |

`publishConfig` points at npmjs, so a bare `npm publish` routes to npmjs by
default : that is the primary, required channel. A stable release is **NOT
complete** until npmjs `dist-tags.latest` equals the new version. A prerelease is
**NOT complete** until its prerelease dist-tag (currently `beta`) equals the new
version and `latest` remains on the prior stable version. GitHub Packages is a
secondary channel that the workflow's `github-packages` job publishes on every
release with the SAME version and dist-tag, routed explicitly with
`--registry=https://npm.pkg.github.com`. Each job builds independently, so verify
each registry directly; never infer one from the other.

## Procedure

Publishing is triggered by **publishing a GitHub release** on the version tag :
the workflow runs `on: release: [published]`, and its jobs publish to both
registries.

The owner-approved GitHub release workflow `.github/workflows/npm-publish.yml`
uses one shared `build` job per release tag as a fail-fast gate. Its concurrency
group is `npm-publish-<tag>`, with cancellation disabled. The build job runs
`npm ci`, `npm run check:versions`, `npm run build`, and `npm test`; if it fails,
neither publish job runs. Both publish jobs `needs: build`, then each checks out
the full release tree (`actions/checkout`) at the tagged commit and runs
`npm ci`, so npm's own lifecycle rebuilds and retests from complete sources:
`prepare` runs `npm run build` (which needs `scripts/`), and `prepublishOnly`
runs `npm test` at publish time. The publish jobs deliberately do not
`--ignore-scripts`; they need the full repo, not a packed artifact subset.

0. **Version-sync gate:** before commit, tag, release, or publish, all package
   version surfaces MUST match exactly:
   - `package.json` top-level `version`
   - `package-lock.json` top-level `version`
   - `package-lock.json` `packages[""].version`
   - `src/index.ts` MCP server `version`
   - `.claude-plugin/plugin.json` `version` (plus each `plugins[].version` in
     `.claude-plugin/marketplace.json` / `marketplace.json` when present)

   Run `npm run check:versions`. This is wired into `npm run build`, `npm test`,
   and the publish workflow; any mismatch blocks the build/publish. Use
   `npm version <patch|minor|major> --no-git-tag-version` for package manifests,
   then update the MCP server version in `src/index.ts` to the same value.

1. **npmjs (default, required) : automated, OIDC Trusted Publishing.** The
   `npm-public` job runs in the `release` environment with `id-token: write`,
   pins npm to `11.5.1` (the OIDC minimum with a working sigstore), and publishes
   with **provenance** and **no npm token**:

   ```sh
   npm publish --tag "$NPM_DIST_TAG" --provenance --access public \
     --registry=https://registry.npmjs.org --@heretyc:registry=https://registry.npmjs.org
   ```

   The dist-tag is computed from the version string, not passed by hand:
   `NPM_DIST_TAG` is `beta` when `package.json` `version` contains `-` (a
   prerelease), otherwise `latest`. After publish the job runs
   `npm run verify:npmjs-release` (see step 3).

2. **GitHub Packages (secondary) : automated.** The `github-packages` job checks
   out the same tagged tree, runs `npm ci` (so the lifecycle builds and tests
   before publish), and publishes the same version and dist-tag to GitHub
   Packages using the automatic `GITHUB_TOKEN` (`packages: write`):

   ```sh
   npm publish --tag "$NPM_DIST_TAG" --registry=https://npm.pkg.github.com
   ```

   `publishConfig` defaults to npmjs, so this job routes to GitHub Packages
   explicitly with `--registry`. Because each job builds independently, treat the
   two registries as separate publishes and verify each directly; do not assume
   one from the other.

3. **Verify REGISTRY-DIRECT**, never through npm config:
   - npmjs: `GET https://registry.npmjs.org/@heretyc%2Fsubagent-mcp` :
     for stable versions, `dist-tags.latest == <ver>`; for prereleases,
     `dist-tags.beta == <ver>` AND `dist-tags.latest` still points at the prior
     stable version; in all cases `versions.<ver>` is present with a recorded
     `dist.shasum`. The dist-tag and presence assertions are exactly what the
     `npm-public` job runs via `npm run verify:npmjs-release`
     (`scripts/verify_npmjs_release.mjs`, which retries registry propagation and
     rejects `latest` moving onto a prerelease). Re-run that script or the HTTP
     GET to confirm; the `--provenance` publish also attaches a provenance
     attestation to the published version.
   - GitHub Packages (published every release by the workflow): authed
     `npm view @heretyc/subagent-mcp dist-tags --@heretyc:registry=https://npm.pkg.github.com`
     (scope-specific flag for consistency with the traps below).

## Shipped parts and pre-publish tests

These travel inside the tarball via the whole-dir `dist` entry : no
`files`-array change : and the build regenerates them every time, so a publish
of a stale tree cannot ship a drifted copy:

- `dist/routing-table.json` : `copy-provider.mjs` hard-fail copy from
  `src/routing-table.json`; the build refuses to publish without the runtime
  routing table.
- `dist/advanced-ruleset.py` : gen-scaffold embed + `copy-provider.mjs`
  hard-fail copy; preserved on update (`../advanced-ruleset/scaffold-and-deployment.md`).
- `dist/global-subagent-mcp-config.jsonc` - the global concurrent-subagent cap config.
  Shipped by the SAME chain: `gen-ruleset-scaffold.mjs` also emits
  `src/config-scaffold.ts` and `copy-provider.mjs` copies
  `src/global-subagent-mcp-config.jsonc` into `dist/`, both HARD-FAILING the build if
  the source is missing. The copy step also emits `dist/global-concurrency.jsonc`
  as a legacy back-compat name. Preserved on update by the parallel three-site
  bracket (`../global-concurrency/cap-contract/config-and-build.md`). `npm run build`
  must regenerate and copy it before publish.

Pre-publish test expectations : `npm test` (run by `prepublishOnly`) must
include:

- `test/global-concurrency-cap.test.mjs` : clamp table, template parses,
  reject-at-cap, reserve-under-cap, release-idempotent
  (`../global-concurrency/cap-contract/enforcement-fail-open-tests.md`). A red bar here blocks the
  publish exactly as the version-sync gate does.

The four version surfaces in the step-0 gate are unchanged by this feature.

## Windows shell traps (operator + agent shells)

Release/PR/commit commands on Windows fail in two shell-specific ways. Both bit
the 2026-06-14 prep run; route around them, never retry the command verbatim.

- **PowerShell 5.1 native-arg mangling.** A multi-line or special-char string
  passed inline as one argument to a native exe (`gh`, `git`, `npm`) is
  re-split by PowerShell when it contains `"`, `->`, `[]`, or backticks. Real
  failure: `gh pr create --body "...packages[""]... -> green"` exits with
  `unknown shorthand flag: '>' in ->`. NEVER inline a PR/commit/release body.
  - Write the body to a file (the agent's file-writer, or
    `[System.IO.File]::WriteAllText($path,$text)` : NOT `Out-File -Encoding
    utf8`, which prepends a BOM the tool then ingests), then pass it by file:
    `gh pr create --body-file <f>`, `git commit -F <f>`.
  - Put the file INSIDE the worktree (sandbox-writable) and delete it after:
    `$env:TEMP` can resolve empty under the agent sandbox, collapsing a temp
    path to a root path (`/<name>`) the sandbox refuses to write or
    `Remove-Item` (`protected from removal`).
- **cygwin git-Bash `fork()` failures.** The bundled Git Bash intermittently
  aborts long or process-spawning commands with cygwin `fork()` errors (e.g.
  `child_copy ... read copy failed`, `cygheap base mismatch detected`),
  truncating output and returning a misleading exit 1 even when the inner
  command succeeded. Run release validation (`npm run build`, `npm test`,
  `node scripts/check_mcp_compliance.mjs`) and git writes via native PowerShell
  + `git`/`node`, or delegate them to a CLI sub-agent; never trust a lone Bash
  exit 1 : re-run natively to confirm before reporting pass or fail.

## Resolution traps (each cost a debugging round on 2026-06-11)

- The `~/.npmrc` scope mapping (if set to
  `@heretyc:registry=https://npm.pkg.github.com`) **overrides the generic
  `--registry` flag** for scoped packages, on BOTH `npm view` and `npm publish`.
  A result obtained through npm tooling may silently be a GitHub Packages answer.
  Use the **scope-specific flag** (`--@heretyc:registry=...`) to retarget, and
  verify with direct HTTP.
- `npm error You cannot publish over the previously published versions` usually
  means routing **fell through to the wrong registry** (where the version
  already exists). Fix the routing; do not bump the version.

## npmjs auth : OIDC Trusted Publishing (no token, no interactive 2FA)

- Release publishing to npmjs uses **OIDC Trusted Publishing**, configured on
  npm for this package and gated by the workflow's `release` environment. The
  `npm-public` job requests `id-token: write` and publishes with `--provenance`;
  it carries **no npm token** and performs **no interactive 2FA**.
- The publishing identity is the workflow's OIDC token, so the npmjs release
  publish runs only inside the `npm-public` job; a workstation has no OIDC
  identity and cannot produce the same provenance-attested publish. Re-run the
  workflow to (re)publish a release.
- OIDC Trusted Publishing requires Node >= 22.14 and npm >= 11.5.1; the job pins
  `npm@11.5.1` because npm@latest has shipped a broken `sigstore` dependency that
  makes `npm publish --provenance` fail with `MODULE_NOT_FOUND: Cannot find
  module 'sigstore'`.

## GitHub Packages auth

The `github-packages` job authenticates with the automatic `GITHUB_TOKEN`
(`permissions: packages: write`); no personal access token is used or needed for
the release publish itself. The `~/.npmrc`
`//npm.pkg.github.com/:_authToken=<PAT>` with `write:packages` is the
CONSUMER-side setup : see `docs/registration.md`.
