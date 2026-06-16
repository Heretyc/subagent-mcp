# Install — Codex Desktop / IDE extension (MCP-only)

The Codex Desktop / IDE extension has **no per-turn hook host**, so it gets the
**MCP server only**. The `orchestration-mode` tool still flips the marker, but
**nothing is injected per turn** — documented degradation, not a bug. For
per-turn injection use the [Codex CLI](codex-cli.md) host.

Do the [build prerequisite](_INDEX.md) first.

---

## Configure the server (shared with the CLI)

The Desktop/IDE extension and the Codex CLI **share one** `~/.codex/config.toml`
(Windows: `C:\Users\YourName\.codex\config.toml`). If you already registered the
server for the CLI, **it is already available here** — no second step.

If you have not registered it yet, add it once:

```toml
[mcp_servers.subagent-mcp]
command = "node"
args = ["/abs/path/to/subagent-mcp/dist/index.js"]
startup_timeout_sec = 10
tool_timeout_sec = 900

# Windows: forward slashes (or doubled backslashes) in TOML
# args = ["C:/Users/YourName/Dropbox/subagent-mcp/dist/index.js"]
```

`tool_timeout_sec = 900` preserves the `wait` tool's 15-minute semantics.
Restart or reload existing Codex sessions after changing this config.

Or via the CLI helper (writes the same shared file):

```bash
codex mcp add subagent-mcp -- node /abs/path/to/subagent-mcp/dist/index.js
```

The `hooks.json` per-turn hook from the [Codex CLI guide](codex-cli.md) is
**not** loaded here — Desktop/IDE has no hook host. Do not expect per-turn
injection.

---

## Verification

1. **Build present:** confirm `dist/index.js` exists.
2. **Tools appear:** open the extension and confirm the `subagent-mcp` tools
   (`orchestration-mode`, `launch_agent`, etc.) are listed via the shared
   `config.toml`.
3. **Expected degradation:** toggle `orchestration-mode` ON and confirm that
   **no** per-turn directive is injected (no hook host). The marker flips;
   injection does not occur. This is the intended behavior.
