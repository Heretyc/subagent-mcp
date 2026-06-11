# Release Publishing SOP — npm registries

Status: normative. Read before publishing any package version, refreshing npm
registry auth, or diagnosing a publish failure. Lessons encoded from the
v2.8.0 release (2026-06-11).

## Dual-registry contract (BOTH are mandatory per release)

| Registry | Role | Routed by |
|---|---|---|
| GitHub Packages (`npm.pkg.github.com`) | primary publish target | `package.json` `publishConfig` |
| Public npmjs.com (`registry.npmjs.org`) | REQUIRED public mirror, same version | explicit scope flag (below) |

A release is **NOT complete** until npmjs `dist-tags.latest` equals the new
tag. Publishing only via `publishConfig` leaves npmjs stale — in the v2.8.0
release, npmjs sat at 2.7.1 while GitHub Packages served 2.8.0, and machine
installs (which resolve through the `@heretyc` scope mapping to GitHub
Packages) kept working, **masking the gap**. Verify both registries every
release; never infer one from the other.

## Procedure

1. **GitHub Packages:** from the merged release tree in a compliant worktree,
   run `npm publish` (`prepublishOnly` runs the full suite). `publishConfig`
   routes it. Record the tarball `shasum` from the publish log.
2. **Promote the SAME artifact to npmjs** (never rebuild — the mirror must be
   byte-identical):

   ```sh
   npm pack @heretyc/subagent-mcp@<ver>   # scope mapping resolves to GitHub Packages
   # confirm the .tgz shasum matches step 1's publish log — on mismatch STOP;
   # do not publish a divergent artifact, diagnose the pack source first
   npm publish ./heretyc-subagent-mcp-<ver>.tgz \
     --@heretyc:registry=https://registry.npmjs.org --access public --auth-type=web
   ```

   `--auth-type=web` is REQUIRED (per-publish 2FA, below) and the command must
   run in the operator's **interactive shell** — not a captured/CI shell.

3. **Verify REGISTRY-DIRECT**, never through npm config:
   - npmjs: `GET https://registry.npmjs.org/@heretyc%2Fsubagent-mcp` →
     `dist-tags.latest == <ver>` AND `versions.<ver>.dist.shasum` equals the
     step-1 publish-log shasum (byte-identical mirror proof).
   - GitHub Packages: authed
     `npm view @heretyc/subagent-mcp dist-tags --@heretyc:registry=https://npm.pkg.github.com`
     (scope-specific flag for consistency with the traps below; the scope
     mapping resolves there anyway).

## Resolution traps (each cost a debugging round on 2026-06-11)

- The `~/.npmrc` scope mapping (`@heretyc:registry=https://npm.pkg.github.com`)
  **overrides the generic `--registry` flag** for scoped packages, on BOTH
  `npm view` and `npm publish`. A "verified on npmjs" result obtained through
  npm tooling may silently be a GitHub Packages answer. Use the
  **scope-specific flag** (`--@heretyc:registry=...`) to retarget, and verify
  with direct HTTP.
- The tarball's `package.json` carries `publishConfig` pointing at GitHub
  Packages. Do **NOT** strip or rewrite it for the npmjs publish — the npmjs
  copies of prior versions carry the same `publishConfig` (it does not block a
  scope-flag publish), and the mirror must stay byte-identical.
- `npm error You cannot publish over the previously published versions` during
  an npmjs attempt usually means routing **fell through to GitHub Packages**
  (where the version already exists). Fix the routing; do not bump the version.

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

## GitHub Packages auth

`~/.npmrc` `//npm.pkg.github.com/:_authToken=<PAT>` with `write:packages` —
see `docs/registration.md` for the consumer-side setup.
