# Prompt Schemas & Tool Description Writing Guide

Part of `tool-resource-prompt-schemas.md`. Source: modelcontextprotocol.io/docs/concepts/tools [S3], modelcontextprotocol.io/docs/concepts/architecture [S1]

---

## Prompt Definition

Prompts = reusable templates. Exposed via `prompts/list` and retrieved via `prompts/get`.

```json
{
  "name": "summarize_code",
  "description": "Generate a code summary",
  "arguments": [
    {
      "name": "code",
      "description": "The code to summarize",
      "required": true
    },
    {
      "name": "language",
      "description": "Programming language",
      "required": false
    }
  ]
}
```

**Prompt get response:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "Summarize this Python code:\n```python\n{code}\n```"
      }
    }
  ]
}
```

In Claude Code: MCP prompts become `/mcp__servername__promptname` slash commands.

## Tool Description Writing Guide

Good description signals:
- What the tool does (one sentence).
- When to use it (trigger conditions).
- What it returns.
- Any constraints or prerequisites.

Example (good):
> "Searches GitHub issues by keyword and label. Use when user asks about open bugs, feature requests, or existing issues. Returns issue titles, numbers, and URLs. Requires GITHUB_TOKEN in environment."

Example (bad):
> "Gets issues."

Claude Code truncates tool descriptions and server instructions at 2KB. Put critical info first.
