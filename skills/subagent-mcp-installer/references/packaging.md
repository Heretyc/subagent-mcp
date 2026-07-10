# Packaging : building the decoupled, shippable copy

Goal: a self-contained install that no longer depends on the dev checkout. The
mechanism is standard npm packaging : `npm pack` then `npm install -g` the
tarball (a **copy**, never `npm link`'s symlink).

## What ships

`subagent-mcp`'s `package.json` declares `bin`/`main` = `dist/index.js`,
`type: module`, and deps `@modelcontextprotocol/sdk` + `zod`. A pack includes:

- `dist/**` : server + compiled provider hooks. `dist/` is git-ignored, but the
  `prepare` script (`npm run build`) rebuilds it before pack, so the tarball
  carries a fresh `dist/`.
- `directives/**` : the per-turn directive assets (tracked, always shipped),
  including orchestration, carryover, reminder, and short pointer files.
- `package.json` (+ `README`, `src/`). Dependencies are resolved by
  `npm install -g` into the global tree : `node_modules` is never in the tarball.

Confirm a pack contains `dist/index.js`, provider hooks,
`dist/advanced-ruleset.py`, `dist/global-subagent-mcp-config.jsonc`, and all
`directives/` carryover/reminder/short pointer assets before trusting it:
`npm pack --dry-run` and check the file list.

## Why pack-and-global-install, not local-path plugin

An earlier approach pointed Claude/Codex at `.../subagent-mcp/dist/...` in the build
tree (or a local-path plugin that copies the working tree). Both keep a live
dependency on a specific checkout. `npm pack` + `npm install -g`:

- produces a **copy** at a permanent global path (`npm root -g`),
- runs `prepare` so the copy has a freshly built `dist/`,
- resolves runtime deps in the global tree,

so the install survives repo edits, branch switches, and worktree cleanup. Repo
changes reach the install only when you re-run the deploy.

## Build source must be permanent

`npm pack` builds from wherever you run it. Run it from a **permanent clone**,
never a worktree or temp dir (see `locations.md`). If your only copy is a
worktree, clone fresh to a permanent path first:

```
git clone https://github.com/Heretyc/subagent-mcp <permanent-path>
cd <permanent-path> && npm install && npm run build
```

`scripts/deploy.mjs --source <permanent-path>` enforces this guard for you.

## Updating an existing install

Re-run the deploy from the updated permanent source. `npm install -g <tarball>`
overwrites the global copy in place; vendor config keeps pointing at the same
`npm root -g` path, so no re-wiring is needed unless the global root itself
moved. After updating, restart vendor sessions; on Codex, re-trust hooks only if
the `hooks.json` content changed.

## Uninstall / repoint

- Uninstall the package: `npm uninstall -g @heretyc/subagent-mcp`, then remove the vendor
  entries (`claude mcp remove subagent-mcp -s user`; delete the settings.json
  hook; delete the Codex `[mcp_servers.subagent-mcp]` table + `hooks.json`
  entries).
  Legacy unscoped installs used the package name `subagent-mcp`.
- Repoint (e.g. to a new global prefix): re-run deploy, then re-run the vendor
  wiring so config references the new `npm root -g`.
