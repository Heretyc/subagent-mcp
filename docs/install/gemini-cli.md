# Install : Gemini CLI

Gemini CLI supports the `subagent-mcp` MCP server, but this repo does not ship a
Gemini per-turn hook. Configure server wiring only. Do the
[build prerequisite](_INDEX.md) first.

Because Gemini injects no `<subagent-mcp state="...">` hook tag, AGENTS.md's
NO-HOOK clause applies: orchestration state is UNKNOWN and defaults to ON.
The expected warning is:

```text
subagent-mcp: no hook injection detected : orchestration state unknown; defaulting to ON
```

This is fail-safe behavior, not a Gemini-specific hook install step. Do not add
a `UserPromptSubmit` hook for Gemini; no such per-turn hook is documented in
this repo.

---

## MCP server : `~/.gemini/settings.json`

Edit `~/.gemini/settings.json` (Windows:
`C:\Users\YourName\.gemini\settings.json`) and merge this `mcpServers` entry
with any existing settings.

**macOS / Linux:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["/abs/path/to/subagent-mcp/dist/index.js"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "subagent-mcp": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Dropbox\\subagent-mcp\\dist\\index.js"]
    }
  }
}
```

Restart the Gemini CLI session after editing.

---

## Native-agent suppression

Gemini has no repo-supported per-turn hook, so suppression is static settings
plus user policy files.

Official Gemini CLI references: user settings live at `~/.gemini/settings.json`
and include `experimental.enableAgents`; user policies load from
`~/.gemini/policies/*.toml` as `[[rule]]` blocks with `toolName`, `decision`,
and `priority`; built-in subagents include `generalist`,
`codebase_investigator`, `cli_help`, and `browser_agent`.
Sources:
<https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md>,
<https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md>,
<https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md>.

In `~/.gemini/settings.json`, preserve existing settings and set:

```json
{
  "experimental": {
    "enableAgents": false
  }
}
```

Create `~/.gemini/policies/subagent-mcp-native-agents.toml`:

```toml
[[rule]]
toolName = "generalist"
decision = "deny"
priority = 999

[[rule]]
toolName = "codebase_investigator"
decision = "deny"
priority = 999

[[rule]]
toolName = "cli_help"
decision = "deny"
priority = 999

[[rule]]
toolName = "browser_agent"
decision = "deny"
priority = 999
```

This blocks known Gemini native agents so sub-agent work routes through
subagent-mcp `launch_agent`. `subagent-mcp setup` and `init --global` merge the
setting and write this policy, backing up existing files first.

---

## Verification

1. **Build present:** confirm `dist/index.js` exists.
2. **Server loads:** restart Gemini CLI and confirm the `subagent-mcp` MCP tools
   are available.
3. **Expected hookless behavior:** no per-turn directive is injected by Gemini.
   With no hook tag, state is UNKNOWN and defaults to ON under AGENTS.md.
4. **Native-agent suppression:** `experimental.enableAgents=false` is present
   and the policy TOML denies `generalist`, `codebase_investigator`,
   `cli_help`, and `browser_agent`.

## Reversibility

Setup/init create timestamped sibling backups before changing existing Gemini
settings or policy files. Doctor/upgrade snapshots include both and can be
restored with `subagent-mcp rollback`.

Regression gate: `npm test`.
