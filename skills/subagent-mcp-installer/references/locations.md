# Install locations : permanent only

The addon must run from a **permanent, user-owned** path. A temporary or
ephemeral path "works" until it is cleaned up, rebuilt, or moved : then every
vendor that points at it breaks silently. Enforce this on BOTH the build source
and the install target.

## Forbidden locations (refuse and stop)

Reject if a normalized, resolved path matches any of these:

- A git **worktree** : any path under a `*.worktrees/` dir, or any path whose
  `git rev-parse --git-common-dir` differs from its `--absolute-git-dir`
  (a linked worktree). Worktrees are throwaway by policy.
- The OS temp dir : `os.tmpdir()` and anything under it. On Windows that
  includes `%TEMP%`, `%TMP%`, and `...\AppData\Local\Temp\...`. On POSIX, `/tmp`,
  `/TMP`, `$TMPDIR`.
- A **`Downloads`** folder (any case).
- The live **dev checkout** you are actively editing (install a decoupled copy
  instead : see `packaging.md`).
- Any path segment matching `(?i)\b(temp|tmp)\b`, or a UNC/removable/transient
  mount you do not control.

## Permanent locations (use these)

- **Global npm package dir (default, recommended):** `npm root -g` returns the
  global `node_modules`. The install lives at `<npm root -g>/@heretyc/subagent-mcp`. This
  is stable across sessions and reboots and is the idiomatic home for a Node MCP
  server installed via `npm install -g`.
  - Windows: typically `C:\Users\<you>\AppData\Roaming\npm\node_modules\@heretyc\subagent-mcp`.
  - macOS/Linux: typically `<prefix>/lib/node_modules/@heretyc/subagent-mcp`.
  - Note: Windows global modules are under `<prefix>\node_modules`, POSIX under
    `<prefix>/lib/node_modules`. Always resolve with `npm root -g` rather than
    hardcoding : it returns the correct dir on every platform.
- **A dedicated user dir:** e.g. `~/.subagent-mcp/` or
  `~/Library/Application Support/subagent-mcp/` (macOS) : acceptable if you copy
  the full package (`dist/`, `directives/`, `package.json`, and resolved
  `node_modules`) there and point config at it. Global npm is simpler because it
  resolves dependencies for you.

## Resolving the install root

```
npm root -g            # -> <global node_modules>
# install root = <global node_modules>/@heretyc/subagent-mcp
# server       = <install root>/dist/index.js
# claude hook  = <install root>/dist/hooks/orchestration-claude.js
# claude gate  = <install root>/dist/hooks/orchestration-claude-pretool.js
# codex hook   = <install root>/dist/hooks/orchestration-codex.js
# directives   = <install root>/directives
```

`scripts/deploy.mjs` resolves and prints these for you after a global install.

## Why this matters (do not skip)

A worktree gets removed when its branch work is done; `%TEMP%` is purged by the
OS; `Downloads` is user-churned. Any of these as an install root turns a
"working" install into a `spawn ENOENT` / "MCP server failed to connect" the
next day, with no obvious cause. Fail loud at install time instead.
