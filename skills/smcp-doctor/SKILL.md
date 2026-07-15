---
name: smcp-doctor
version: 1.0.0
description: Run subagent-mcp doctor non-interactively, explain each health check in plain English, and offer the exact repair for every WARN or FAIL only after explicit Y/n confirmation. Use when the user says "smcp doctor", "/smcp:doctor", "fix my setup", "health check", or "something broken". Never modifies configs without confirmation; the CLI backs up first.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-15
updated: 2026-07-15
---

# subagent-mcp Doctor

Diagnose subagent-mcp install and wiring health, explain the results, and drive
repairs with the user in the loop. This skill mirrors the CLI's S8 repair
behavior: it asks in conversation, then runs a repair **only after the user
confirms**. It never edits a config on its own.

## Step 1: Run doctor non-interactively

Run the CLI with stdin redirected from empty so it is never a TTY and can never
prompt. In non-TTY mode every check is read-only and reports `no changes made`
for anything repairable:

```
# macOS / Linux
subagent-mcp doctor < /dev/null
# Windows
subagent-mcp doctor < NUL
```

If `subagent-mcp` is not on PATH, the addon is likely not installed globally -
point the user at the `/smcp:help` install steps and stop.

## Step 2: Parse the E1 output

Every check prints one line in this exact shape, followed by a summary line:

```
[PASS|WARN|FAIL|INFO] <id> <name>: <detail>
Summary: pass=<n> warn=<n> fail=<n> info=<n> exit=<0|1>
```

Exit code is `1` when any check is FAIL, else `0`. Read each line by its `id`
and `name`, and explain the `detail` in plain English. Status meanings:

- `[PASS]` - healthy, nothing to do.
- `[WARN]` - degraded or incomplete; usually has a repair.
- `[FAIL]` - broken; blocks correct operation and needs a fix.
- `[INFO]` - informational only (for example network probes); no repair.

## Step 3: The 9 checks and their repairs

Cover every check. For each WARN or FAIL that has a repair, offer the exact
repair path below and ask a clear `Y/n` question **before** running anything
that changes a config. On `Y`, run the repair; on `n`, skip it and move on.
The CLI creates a timestamped backup before it modifies any file (via its
backup routine and `.bak-` copies), so state that the change is reversible.
Note that reachability, update-check, and a healthy session-state line are the
only INFO-class outputs and carry no repair.

1. **install-mode** - is subagent-mcp installed via npm-global or a marketplace
   plugin? FAIL means no install was found. Repair (guidance, not a config
   edit): reinstall per `/smcp:help`, then re-run doctor.
2. **mcp-registration** - does the host's live MCP config resolve to an
   existing `dist/index.js`? WARN/FAIL flags a stale or dangling entry. Repair:
   ask "Repair MCP registration now? [Y/n]"; on Y run `subagent-mcp doctor`
   interactively (a real terminal) so its built-in "Fix MCP registration?"
   prompt fires, or re-register with `claude mcp add` / `codex mcp add` per
   `/smcp:help`.
3. **duplicate-hooks** - are there redundant subagent-mcp hook entries (same
   id, a legacy pair, or a user copy that duplicates a plugin manifest)? WARN
   lists each duplicate. Repair: ask "Remove the duplicate hook entries? [Y/n]";
   on Y run `subagent-mcp doctor` interactively so its per-entry
   "Remove duplicate entry ...? [Y/n]" prompts fire (it backs up first).
4. **provider-config** - does `providers.jsonc` exist and parse? FAIL means it
   is missing or malformed. Repair: if missing, ask "Scaffold providers.jsonc
   now? [Y/n]" and on Y run `subagent-mcp config init` (backs up any existing
   file). If it is a parse error, do not auto-run anything - explain the parse
   error location and have the user fix the JSONC by hand.
5. **env-keys** - are all `key_env` vars present in `.env` and not left as
   `YOUR_KEY_HERE`? WARN lists missing keys or a missing `.env`. Repair
   (no CLI edit - secrets are user-owned): tell the user which keys to add to
   `~/.subagent-mcp/.env`; offer to open or scaffold via
   `subagent-mcp config init` only with `Y/n` confirmation, and never print or
   invent a key value.
6. **routing-coverage** - how many of the 14 task categories have a provider
   slotted at 1 or greater? WARN `no API routing active` is expected on this
   release because slots are reserved metadata and the routing engine ships
   later. Explain that; the "repair" is optional: set slots in `providers.jsonc`
   per `/smcp:help`. No confirmation needed since nothing is auto-changed.
7. **reachability** - INFO per configured `base_url`: reports the HTTP status or
   `unreachable`. No repair; surface it as a note (this is the reachability
   signal `/smcp:status` may reference).
8. **update-check** - is a newer published version available? WARN means yes.
   Repair: ask "Upgrade subagent-mcp now? [Y/n]"; on Y run
   `subagent-mcp upgrade` (it backs up, repairs hooks, and re-runs doctor).
   INFO `offline or undeterminable` needs nothing.
9. **session-state** - is the `SessionStart` hook present in the installed
   manifest, and can server session state be reached via `get_status`? WARN
   means the hook is missing. Repair: ask "Restore the SessionStart hook?
   [Y/n]"; on Y run `subagent-mcp doctor` interactively so its
   "Restore SessionStart hook? [Y/n]" prompt fires (it backs up first). A
   healthy state is INFO and needs nothing.

## Rules

- Never run a config-modifying command without an explicit `Y` in the
  conversation for that specific repair.
- Always tell the user the CLI backs up before it writes, and that
  `subagent-mcp rollback` restores the most recent backup.
- Prefer the CLI's own repair paths (interactive `doctor`, `config init`,
  `upgrade`) over hand-editing files, so repairs stay standards-compliant.
- After any repair, re-run Step 1 non-interactively and re-report.
