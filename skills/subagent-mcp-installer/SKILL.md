---
name: subagent-mcp-installer
version: 1.0.0
description: Install, deploy, register, or set up the subagent-mcp addon (MCP server + orchestration-mode hooks) standards-compliant across every supported vendor (currently Claude Code CLI and Codex CLI; expandable). Ships ALL parts — MCP stdio server, per-turn hooks, and directive assets — to a PERMANENT, repo-decoupled location and wires each vendor with its official mechanism. Use when asked to "install subagent-mcp", "install the mcp", "install this", "deploy subagent-mcp", "set up subagent-mcp", "add subagent-mcp to Claude/Codex", "register the addon", "globally install subagent-mcp", "reinstall/repoint subagent-mcp", or "update the subagent-mcp install". HARD RULE: never install or run the addon from a worktree, %TEMP%/TMP/tmp, Downloads, or any temporary/ephemeral path — install only to a permanent global location. Stay compliant to the official vendor specs listed in references/compliance.md.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: June 2026
---

# subagent-mcp Installer

Deploy the **subagent-mcp** addon — the MCP stdio server **plus** the per-turn
`orchestration-mode` hooks and their directive assets — to a **permanent,
repo-decoupled location**, then register it with each supported vendor using
that vendor's **official, standards-compliant** mechanism.

**Input** = the host machine + which vendors are present (Claude Code CLI,
Codex CLI). **Output** = a working, verified install that does NOT reference the
dev repo, a worktree, or any temp path.

This skill is the authoritative install SOP. It supersedes the absolute-path-to-
repo examples in `docs/install/*` (those point at the build tree; this ships a
decoupled copy). When they disagree, **this skill wins**.

## Non-negotiable rules

1. **Permanent location only.** Install to the global npm package dir
   (`npm root -g` → `<root>/subagent-mcp`) or another stable, user-owned dir.
   **NEVER** install from or point config at: a git **worktree**, `%TEMP%`,
   `/tmp`, `/TMP`, `$TMPDIR`, `os.tmpdir()`, a `Downloads` folder, or the live
   dev checkout. See `references/locations.md` for the full forbidden list and
   the rationale (these get garbage-collected, moved, or rebuilt under you).
2. **Ship ALL parts.** Server (`dist/index.js`), both hooks
   (`dist/hooks/orchestration-claude.js`, `orchestration-codex.js`), the ruleset
   scaffold (`dist/advanced-ruleset.py`), and the `directives/` dir must all
   land in the install. The compiled hooks resolve their directive assets via
   `../../directives`, so `directives/` must sit beside `dist/` in the install
   root. A user-edited `dist/advanced-ruleset.py` is NEVER overwritten on
   update: `deploy.mjs` snapshots it before `npm install -g` and restores it
   after.
3. **Standards-compliant per vendor.** Use each vendor's official registration
   path and config schema, verbatim from the specs in
   `references/compliance.md`. No bespoke shims.
4. **Decoupled from source.** A repo edit must NOT change a live install until
   the operator re-runs the install. `npm pack` + `npm install -g` (a copy, not
   a symlink — never `npm link`) guarantees this.
5. **Idempotent + reversible.** Re-running is safe; back up any user config file
   before editing it; repoint/uninstall is documented.

## Supported vendors

| Vendor | MCP server | Per-turn hook | Guide |
|---|---|---|---|
| Claude Code CLI | yes (user scope) | yes (`UserPromptSubmit`) | `references/claude-code.md` |
| Codex CLI | yes (`~/.codex/config.toml`) | yes (`SessionStart` + `UserPromptSubmit`) | `references/codex-cli.md` |
| Claude Desktop / Codex IDE | yes (MCP-only) | **no** hook host | see vendor guide |

The vendor set is **expandable**: to add a vendor, add a `references/<vendor>.md`
following the same shape (permanent path, official registration, hook wiring,
verification) and a row here. Keep `references/compliance.md` the single source
of truth for spec URLs.

## Procedure

Run the steps in order. Each is detailed in the linked reference.

1. **Resolve a permanent source** (`references/packaging.md`). The build source
   must be a real clone/checkout on a permanent path — **not** a worktree or
   temp dir. If the only copy you have is a worktree/temp, first clone to a
   permanent dir and build there.
2. **Build + package + global-install** the decoupled copy:
   `scripts/deploy.mjs` does this with a hard guard that REFUSES forbidden
   source paths. It runs `npm run build`, `npm pack`, `npm install -g <tarball>`,
   removes the tarball, resolves `npm root -g`, and verifies every shipped part.
3. **Detect present vendors** — is `claude` on PATH? does `~/.codex/` exist?
   Install for each present vendor; skip absent ones (note what you skipped).
4. **Wire each vendor** with its official mechanism:
   - Claude Code: `references/claude-code.md` (user-scope `claude mcp add` +
     exec-form `UserPromptSubmit` hook in `~/.claude/settings.json`).
   - Codex CLI: `references/codex-cli.md` (`[mcp_servers.subagent-mcp]` +
     `~/.codex/hooks.json` with `commandWindows`).
5. **Verify** per the vendor guide (server connects; tools present; hook fires
   when `orchestration-mode` is ON and is silent when OFF).
6. **Report** the install root, the per-vendor wiring, what was skipped, and any
   required user follow-up (session restart; Codex `/hooks` re-trust).

## Helper script

`skills/subagent-mcp-installer/scripts/deploy.mjs` (zero-dep ESM, Node >= 18) —
the robust, location-guarded installer (path is relative to the repo root). Usage:

```
node skills/subagent-mcp-installer/scripts/deploy.mjs --source <permanent-repo-path> [--wire-claude] [--wire-codex]
```

- Refuses if `--source` resolves into a worktree/temp/Downloads path.
- Always does build → pack → global install → verify and prints the exact,
  ready-to-paste config for every vendor.
- `--wire-claude` runs the official `claude mcp add --scope user` and writes the
  settings.json hook (with a timestamped backup). `--wire-codex` merges the
  Codex `config.toml` + `hooks.json` entries (with backups). Omit the flags to
  do a print-only dry run and wire by hand from the reference guides.

## Forbidden-location guard (always applies)

Before any install action, confirm the source AND the target are permanent.
Reject and stop if either matches `references/locations.md`'s forbidden set.
"It works right now" from a worktree/temp path is a trap — it breaks the moment
the path is cleaned up. Fail loud; do not silently install to a temp path.
