# Init Registry And Update

Status: normative. Documents the v3.1.0 init registry and auto-update behavior
implemented by commits `210af50` and `0559045`.

## Registry Contract

The registry lives at `~/.subagent-mcp/init-registry.json`:

```json
{
  "globalInit": false,
  "autoUpdate": false,
  "entries": [
    {
      "root": "/absolute/project/root",
      "files": ["/absolute/project/root/AGENTS.md"],
      "scope": "project",
      "timestamp": "2026-07-17T00:00:00.000Z",
      "blockHash": "sha256"
    }
  ]
}
```

`scope` is `project` or `global`. Registry reads strip a leading UTF-8 BOM and
invalid or missing fields collapse to safe defaults. Writes go through
`atomicWriteFile` with mode `0600` and a trailing newline.

`blockHash` is the SHA-256 hash of managed block content only. The begin and end
delimiter lines are excluded, so delimiter schema churn does not change the
hash by itself.

## Init Registration

Every successful non-dry-run `subagent-mcp init` registers or replaces one
entry for the resolved `root` plus `scope`. Project init records the target
files selected by `targetFiles`; global init records `globalTargetFiles(home)`
and sets `globalInit=true`.

`init --remove` deregisters the matching `root` plus `scope`. With `--global`,
it also clears `globalInit`. `uninstall` calls `clearInitRegistry`, leaving the
registry file present with `globalInit=false`, `autoUpdate=false`, and no
entries.

## Update Flow

`subagent-mcp update` calls `prepareRegistryForUpdate` before npm install and
`applyRegistryAfterUpdate` only after a clean npm success.

Before install:

- Empty registries are backfilled only on a TTY and only after a yes/no prompt.
  The scan looks at `cwd`, `~/.claude`, `~/.codex`, and `~/.gemini` for managed
  blocks in the project and global target files. Non-TTY skips backfill.
- Stale registered roots prompt on a TTY: `Keep or remove? [K/r]`. Non-TTY keeps
  stale entries and logs a warning.
- Unless `--quiet` is set, update prints registered project dirs, or `(none)`.

After install succeeds:

- If `globalInit` is true, global target files are re-initialized.
- `--force` re-initializes global target files and every existing registered
  project entry.
- Successful update prunes `~/.subagent-mcp/backups` timestamp snapshots to the
  most recent directory only.

`--force` and `--quiet` are the only accepted update flags.

## Auto-Update

The notifier follows the `update-notifier` pattern: update checks run
asynchronously, never throw, never block MCP stdio boot, and never interpolate
registry-sourced strings into injected output. Checks are disabled by
`NO_UPDATE_NOTIFIER`, `CI`, `NODE_ENV=test`, or `SUBAGENT_UPDATE_CHECK=0|false`.

Pending update notices are throttled by session or by a 12 hour emit interval.
The registry check itself is throttled to once per 24 hours.

`setup` asks `Enable auto-update? [Y/n]` unless the registry already contains an
`autoUpdate` key. The default is yes. `--unattended` and non-TTY setup both
enable it without prompting. The choice is persisted in the registry
`autoUpdate` flag.

When `autoUpdate=true`, a newer npm `latest` can trigger self-update only when:

- the package version has been published for at least 48 hours;
- npm metadata has provenance according to `hasNpmProvenance`, meaning
  `dist.attestations`, `versions[version].dist.attestations`,
  `dist.signatures`, or `versions[version].dist.signatures` is present.

Without provenance, the update is skipped and the next appended notice includes
`Notice: skipped auto-update: no provenance.` With provenance, the process
spawns `node dist/index.js update --quiet` detached with
`SUBAGENT_AUTO_UPDATE=1`. A zero exit records a one-line appended notice:
`Notice: subagent-mcp auto-updated X->Y. Restart CLI sessions to use the new
build.`

## Doctor Check

`doctor` includes check `11 init-registry`. It reports:

- `globalInit`
- `autoUpdate`
- `entries`
- stale path count
- out-of-date block count
- `lastUpdateCheck`
- `pendingVersion`

The check is `WARN` when any registered root is stale or any existing root has
missing or out-of-date managed blocks; otherwise it is `PASS`.

## Non-TTY Matrix

| Flow | Non-TTY behavior |
|---|---|
| `setup` init scope | Defaults to `global`. |
| `setup` auto-update | Defaults to enabled. |
| update stale roots | Keeps entries and logs a warning. |
| update empty registry backfill | Skips scan and prompt. |

## Related Docs

See `release-publishing.md` for Windows command-file rules around commits and
publishing. See `git-collaboration.md` for branch and worktree expectations.
