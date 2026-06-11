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
     --@heretyc:registry=https://registry.npmjs.org --access public
   ```

3. **Verify REGISTRY-DIRECT**, never through npm config:
   - npmjs: `GET https://registry.npmjs.org/@heretyc%2Fsubagent-mcp` →
     `dist-tags.latest == <ver>`.
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

## npmjs auth — passkeys, no TOTP

- npmjs authentication is **passkey-based**. There is no TOTP / authenticator
  app code. An `EOTP` / "one-time password" error from `npm publish` means the
  CLI session/token is **stale or bound to legacy 2FA** — it is NOT a prompt
  to supply a 6-digit code; none exists.
- Refresh: `npm login --registry=https://registry.npmjs.org` → browser opens →
  authenticate with the **passkey** → the CLI stores a fresh token. Re-run the
  publish (no `--otp`).
- A granular npmjs automation token with publish rights bypasses the browser
  flow; if one is configured for `registry.npmjs.org` in `~/.npmrc` it must be
  current. Never echo tokens into chat, logs, or commits.

## GitHub Packages auth

`~/.npmrc` `//npm.pkg.github.com/:_authToken=<PAT>` with `write:packages` —
see `docs/registration.md` for the consumer-side setup.
