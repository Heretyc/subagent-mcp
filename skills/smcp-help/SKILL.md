---
name: smcp-help
version: 1.0.0
description: Explain and help configure the subagent-mcp addon in Claude Code and Codex without any API dependency. Use when the user says "smcp help", "subagent-mcp help", "/smcp:help", "how do I configure providers", "routing table", or "what is subagent-mcp". Covers marketplace and npm-global install, providers.jsonc slot semantics, .env key setup, and the doctor/rollback/upgrade CLI commands.
author: Lexi Blackburn (https://github.com/Heretyc/)
created: 2026-07-15
updated: 2026-07-15
---

# subagent-mcp Help

Answer questions about installing, configuring, and maintaining the
**subagent-mcp** addon. This skill is documentation only: it explains commands
and config shape. It never edits configs or runs installs on its own. It works
identically in Claude Code and Codex and needs no network or API access.

## What subagent-mcp is

subagent-mcp is an MCP stdio server plus per-turn `orchestration-mode` hooks
that let a host CLI (Claude Code or Codex) launch and manage background
subagents. The server exposes tools such as `launch_agent`, `poll_agent`,
`wait`, `get_status`, `orchestration-mode`, and the `handoff-*` set. Providers
and their routing preferences live in a user-owned `providers.jsonc`; secrets
live only in a sibling `.env`.

Scope note for this release: the provider `routing` slots are **reserved
routing metadata** stored in config. They record intended per-category
priority order. The server validates and reports them (see `doctor` and
`get_status`), but automatic API-based routing across those providers ships in
a later release. Describe slots as config that exists today; do not promise the
routing engine yet.

## Install

### Marketplace plugin (Claude Code)

Bundles the MCP server and the per-turn hook in one plugin.

```
claude plugin marketplace add Heretyc/subagent-mcp
claude plugin install subagent-mcp@subagent-mcp
```

`install` takes `<plugin-name>@<marketplace-name>`; both are `subagent-mcp`.
Add `--scope user` (default, all projects) or `--scope project`. Restart the
session after installing.

### Codex equivalent

Codex has a plugin marketplace too. Install the bundled plugin with:

```
codex plugin marketplace add Heretyc/subagent-mcp
codex plugin add subagent-mcp@subagent-mcp
```

Or register just the server with the official Codex command, which writes
`~/.codex/config.toml`:

```
codex mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

Wire the per-turn hook by copying the repo's `codex/hooks.json` template into
`~/.codex/hooks.json`, then run `/hooks` in a Codex session and trust it.

### npm global

Installs the CLI and server to the global npm tree (a copy, not a symlink):

```
npm install -g @heretyc/subagent-mcp
```

After a global install you still register the server and hook with each vendor
using the vendor commands above.

## Configure providers (providers.jsonc)

Run `subagent-mcp config init` to scaffold `providers.jsonc` and `.env` under
the config home (`~/.subagent-mcp`), which is outside git by default. Re-run
with `--force` to overwrite (it backs up the old file first). Each provider is
an object under `providers`:

```jsonc
{
  "providers": {
    "example": {
      "display_name": "Example provider",
      "command": "example-cli",
      "args": [],
      "key_env": "EXAMPLE_PROVIDER_API_KEY",
      "routing": {
        "math_proof": -1,
        "security_review": -1,
        "debugging": -1,
        "quality_review": -1,
        "architecture": -1,
        "agentic_execution": -1,
        "data_analysis": -1,
        "coding": -1,
        "knowledge_synthesis": -1,
        "mechanical": -1,
        "prompt_engineering": -1,
        "vulnerability_research": -1,
        "molecular_biology": -1,
        "ml_accelerator_design": -1
      }
    }
  }
}
```

### Slot semantics

Each `routing` value is a slot number for that task category:

- `slot = N` (N >= 1) inserts this provider at position N in that category's
  priority order, shifting any existing entries at or below N down by one.
- `slot < 1` (for example `-1`) disables this provider for that category.
- There is **no global default priority**: a provider participates in a
  category only when it has an explicit slot of 1 or greater there.
- List **all 14 task categories** on every provider so coverage is explicit.
  The categories are: `math_proof`, `security_review`, `debugging`,
  `quality_review`, `architecture`, `agentic_execution`, `data_analysis`,
  `coding`, `knowledge_synthesis`, `mechanical`, `prompt_engineering`,
  `vulnerability_research`, `molecular_biology`, `ml_accelerator_design`.

Slots are validated and reported now; the routing engine that consumes them
ships later, so setting slots today is safe forward-looking configuration.

## Set keys (.env)

Credentials never go in `providers.jsonc`. Instead each provider names an env
var via `key_env` (key indirection), and the actual secret lives in a `.env`
file next to `providers.jsonc` under `~/.subagent-mcp`:

```
EXAMPLE_PROVIDER_API_KEY=sk-your-real-key
```

`config init` scaffolds `.env` with one `KEY=YOUR_KEY_HERE` line per distinct
`key_env` it finds. Fill in the real values there and keep `.env` out of git.

## Maintenance commands

- `subagent-mcp doctor` - non-interactive health check of install, wiring,
  config, and keys. Use the `/smcp:doctor` skill to run and interpret it.
- `subagent-mcp upgrade` - one-command upgrade with backup, hook repair, and a
  follow-up doctor run.
- `subagent-mcp rollback` - restore the most recent config backup (asks for
  confirmation before restoring).
- `subagent-mcp config init [--force]` - scaffold `providers.jsonc` and `.env`;
  existing files are skipped unless `--force`, which overwrites them after a
  backup.
- `subagent-mcp config validate` - check that `providers.jsonc` parses and is
  well formed.

For live session state (loaded providers, agent count, recent routing
decisions) use the `/smcp:status` skill, which calls the `get_status` MCP tool.
