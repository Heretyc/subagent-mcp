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

- Missing or empty registries (`entries=[]` and `globalInit=false`) run the
  same init-scope menu as `setup`: project init runs `runInit([])`, and global
  init runs `runInit(["--global"])`. Non-TTY and `--unattended` update default
  to global without prompting.
- Stale registered roots prompt on a TTY: `Keep or remove? [K/r]`. Non-TTY keeps
  stale entries and logs a warning.
- Unless `--quiet` is set, update prints registered project dirs, or `(none)`.

After install succeeds:

- If `globalInit` is true, global target files are re-initialized.
- `--force` re-initializes global target files and every existing registered
  project entry.
- Successful update silently removes legacy Claude `permissions.deny` entries
  (`Task`, `Explore`, `Agent(Explore)`) from smcp-managed settings files,
  leaving only the canonical `"Agent"` deny entry.
- Successful update prunes `~/.subagent-mcp/backups` timestamp snapshots to the
  most recent directory only.
- Successful update prunes temp update backups matching `*.bak-update-*` to the
  most recent file per basename.

`--force`, `--quiet`, and `--unattended` are the only accepted update flags.

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

## Context-Coaching Setup Prompts

Context coaching has one user-level setting, persisted in
`~/.subagent-mcp/settings.json` or `settings.local.json` (never per-repo, never
per-project):

| Key | Values | Default |
|---|---|---|
| `contextCoaching` | `true` or `false` | `true` |

Prompt behavior, mirroring the auto-update pattern:

- When `~/.subagent-mcp/settings.json` is missing or blank, `setup` asks the
  context coaching on/off prompt (default yes).
- An unrecognized answer RE-PROMPTS rather than being coerced (`askYesNoStrict`
  in `src/prompt.ts`). Empty input takes the stated default.
- When an existing settings file has content, even without the key, `setup`
  asks neither prompt.
- At runtime a missing key is never an error: reads silently resolve to
  `contextCoaching: true`.
- `contextCoaching: false` does NOT mute mandatory lifecycle injections
  (write_required at 80% and session_handoff_required on compaction). Mandatory
  injections fire regardless of this setting (coaching-off isolation). The 15%
  orchestration latch and the 20% `handoff-write` unlock are also unaffected.

## Auto-Compact Reconciliation Setup

`setup` reconciles Claude Code's user-scope `settings.json` by writing
`env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "90"`. The value comes from the source
constant `CODEX_AUTOCOMPACT_PCT`; that constant is not the Claude setting name.
This supports the compaction contract in `handoff.md`:

- Reads the current `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` value before any
  write.
- Backs up existing settings with a timestamped sibling file (same backup
  pattern as other setup writes).
- Writes the string value `"90"`, preserving every unrelated setting and env
  key.
- Reads back the written value to verify it was applied correctly.
- Emits restart messaging: the change takes effect after the next Claude Code
  session restart.
- If the existing `env` value is present but is not a JSON object (`null`, an
  array, or another scalar), leaves it untouched, logs a non-fatal unsupported-
  shape error with repair instructions, and continues setup. There is no
  host-version capability detection.

Codex CLI compacts natively at 90% and requires no setup-time change.

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

`doctor` includes a deny-entry check: it reads smcp-managed Claude settings
files and reports stale `Task`, `Explore`, or `Agent(Explore)` deny entries
left by a prior install. The check is `WARN` when stale entries are found and
offers repair (removes them), leaving only the canonical `"Agent"` entry.

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
| `setup` context coaching | Defaults to enabled (`contextCoaching: true`), no prompt. |
| `setup` auto-compact reconciliation | Writes Claude Code `settings.json` `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "90"` without prompting; emits restart notice. |
| update missing or empty registry | Runs global init without prompting. |
| update stale roots | Keeps entries and logs a warning. |

## Related Docs

See `release-publishing.md` for Windows command-file rules around commits and
publishing. See `git-collaboration.md` for branch and worktree expectations.
