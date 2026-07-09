# Governance

The `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` managed blocks (`schema=3`, upserted
by init and vendor registration) make the harness-hook `<subagent-mcp state="...">`
injections the authoritative source of orchestration state. Because the state is
read SOLELY from the injected tag -- never inferred from prose -- the managed
blocks guard against directive drift and model hallucination: a bare mention of
"subagent-mcp" carries no authority, and the absence of any tag is treated as an
explicit fail-safe. See
[dev-loop/orchestration-directive-architecture.md](dev-loop/orchestration-directive-architecture.md).

## Source References

- MCP protocol spec: https://modelcontextprotocol.io
- `@modelcontextprotocol/sdk`: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Agent SDK: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- Claude Code CLI: https://github.com/anthropic-ai/claude-code
- Codex CLI: https://github.com/openai/codex
