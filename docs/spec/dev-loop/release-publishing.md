# Release Publishing SOP — npm registries

Status: normative. Read before publishing any package version, refreshing npm
registry auth, or diagnosing a publish failure. Lessons encoded from the
v2.8.0 release (2026-06-11).

## Registry contract (npmjs primary, GitHub Packages optional)

| Registry | Role | Routed by |
|---|---|---|
| Public npmjs.com (`registry.npmjs.org`) | DEFAULT publish target | `package.json` `publishConfig` |
| GitHub Packages (`npm.pkg.github.com`) | OPTIONAL secondary channel, same version | explicit `--registry` flag (below) |

`publishConfig` now points at npmjs, so a bare `npm publish` goes to npmjs by
default — that is the primary, required channel. A stable release is **NOT
complete** until npmjs `dist-tags.latest` equals the new tag. A prerelease is
**NOT complete** until its intended prerelease dist-tag (currently `beta`) equals
the new tag and `latest` remains on the prior stable version. GitHub Packages is
an OPTIONAL mirror: publish there only when you want the `@heretyc` scope to
resolve through GitHub Packages too, and do it with an explicit
`--registry=https://npm.pkg.github.com`. When you publish both, verify each
registry directly; never infer one from the other.

## Procedure

0. **Version-sync gate:** before commit, tag, release, or publish, all package
   version surfaces MUST match exactly:
   - `package.json` top-level `version`
   - `package-lock.json` top-level `version`
   - `package-lock.json` `packages[""].version`
   - `src/index.ts` MCP server `version`

   Run `npm run check:versions`. This is wired into `npm run build`, `npm test`,
   and the publish workflow; any mismatch blocks the build/publish. Use
   `npm version <patch|minor|major> --no-git-tag-version` for package manifests,
   then update the MCP server version in `src/index.ts` to the same value.

1. **npmjs (default, required):** from the merged release tree, run `npm publish`
   (`prepublishOnly` runs the full suite). `publishConfig` routes it to npmjs.
   Stable publishes use `--tag latest`; prerelease publishes use `--tag beta`.
   `--auth-type=web` is REQUIRED for the per-publish 2FA flow (below) and the
   command must run in the operator's **interactive shell** — not a
   captured/CI shell:

   ```sh
   npm publish --tag latest --access public --auth-type=web
   npm publish --tag beta --access public --auth-type=web  # prereleases only
   ```

   Record the tarball `shasum` from the publish log.

2. **GitHub Packages (optional secondary):** to also serve the SAME artifact
   from GitHub Packages, publish it explicitly (never rebuild — the mirror must
   be byte-identical):

   ```sh
   npm pack @heretyc/subagent-mcp@<ver>   # from npmjs, the default registry
   # confirm the .tgz shasum matches step 1's publish log — on mismatch STOP;
   # do not publish a divergent artifact, diagnose the pack source first
   npm publish ./heretyc-subagent-mcp-<ver>.tgz \
     --registry=https://npm.pkg.github.com --access public
   ```

3. **Verify REGISTRY-DIRECT**, never through npm config:
   - npmjs: `GET https://registry.npmjs.org/@heretyc%2Fsubagent-mcp` →
     for stable versions, `dist-tags.latest == <ver>`; for prereleases,
     `dist-tags.beta == <ver>` AND `dist-tags.latest` still points at the prior
     stable version. In all cases, `versions.<ver>.dist.shasum` equals the
     step-1 publish-log shasum.
   - GitHub Packages (only if you published there): authed
     `npm view @heretyc/subagent-mcp dist-tags --@heretyc:registry=https://npm.pkg.github.com`
     (scope-specific flag for consistency with the traps below).

## Shipped parts and pre-publish tests

These travel inside the tarball via the whole-dir `dist` entry — no
`files`-array change — and the build regenerates them every time, so a publish
of a stale tree cannot ship a drifted copy:

- `dist/advanced-ruleset.py` — gen-scaffold embed + `copy-provider.mjs`
  hard-fail copy; preserved on update (`../advanced-ruleset/scaffold-and-deployment.md`).
- `dist/global-concurrency.jsonc` — the global concurrent-subagent cap config.
  Shipped by the SAME chain: `gen-ruleset-scaffold.mjs` also emits
  `src/config-scaffold.ts` and `copy-provider.mjs` also copies
  `src/global-concurrency.jsonc → dist/`, both HARD-FAILING the build if the
  source is missing. Preserved on update by the parallel three-site bracket
  (`../global-concurrency/cap-contract/config-and-build.md`). `npm run build` must regenerate
  and copy it before publish.

Pre-publish test expectations — `npm test` (run by `prepublishOnly`) must
include:

- `test/global-concurrency-cap.test.mjs` — clamp table, template parses,
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
  `unknown shorthand flag: '>' in ->`. NEVER inline a PR/commit/publish body.
  - Write the body to a file (the agent's file-writer, or
    `[System.IO.File]::WriteAllText($path,$text)` — NOT `Out-File -Encoding
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
  exit 1 — re-run natively to confirm before reporting pass or fail.

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

## npmjs auth — passkeys, no TOTP (confirmed working flow, 2026-06-11 v2.8.0)

- npmjs authentication is **passkey-based**. There is no TOTP / authenticator
  app code. An `EOTP` / "one-time password" error from `npm publish` is NOT a
  prompt to supply a 6-digit code — none exists. It means either the session
  token is stale, or (the common case) the per-publish 2FA web flow could not
  run (non-interactive shell, see below).
- **Session refresh (when login is stale):**
  `npm login --registry=https://registry.npmjs.org` in an interactive shell →
  browser opens → authenticate with the **passkey** → CLI stores a fresh token.
- **Login alone is NOT sufficient.** npmjs enforces **per-publish 2FA**: even
  with a fresh session, a plain `npm publish` fails `EOTP`. Pass
  `--auth-type=web` so the publish itself opens the browser passkey prompt.
- **Interactive shell required.** `--auth-type=web` only works on a TTY. In a
  captured/redirected/CI/agent shell, npm silently falls back to the legacy
  OTP path and fails `EOTP` even with fresh auth — hand the exact publish
  command to the operator's own terminal and have them run it there.
- **Unattended alternative:** a granular npmjs automation token with publish
  rights (bypasses per-publish 2FA) configured for `registry.npmjs.org` in
  `~/.npmrc`. Never echo tokens into chat, logs, or commits.

## GitHub Packages auth (only when publishing the optional secondary)

`~/.npmrc` `//npm.pkg.github.com/:_authToken=<PAT>` with `write:packages` —
see `docs/registration.md` for the consumer-side setup.
