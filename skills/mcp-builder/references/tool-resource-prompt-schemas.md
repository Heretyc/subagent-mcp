# Tool, Resource, and Prompt Schemas

**Load when:** Designing inputSchema, understanding tool/resource/prompt definitions, content types, output schema, annotations.
**Do not load when:** Task is about packaging, config, or install.

Source: modelcontextprotocol.io/docs/concepts/tools [S3], modelcontextprotocol.io/docs/concepts/architecture [S1]

---

## Tool Definition Schema

```json
{
  "name": "get_weather",
  "title": "Weather Information",
  "description": "Get current weather for a location. Use when user asks about weather, temperature, or forecast.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "City name, zip code, or coordinates"
      },
      "units": {
        "type": "string",
        "enum": ["metric", "imperial"],
        "default": "metric",
        "description": "Temperature units"
      }
    },
    "required": ["location"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "temperature": { "type": "number" },
      "conditions": { "type": "string" }
    },
    "required": ["temperature", "conditions"]
  }
}
```

**Field rules:**
| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Unique within server. Alphanumeric + underscore. LLM uses this for invocation. |
| `title` | No | Human-readable display name for UI. |
| `description` | Yes | Critical for LLM tool selection. Be specific about when to use it. |
| `inputSchema` | Yes | JSON Schema, root MUST be `type: "object"`. |
| `inputSchema.properties` | No | Each property needs `type` and `description`. |
| `inputSchema.required` | No | Array of required property names. Omit = all optional. |
| `outputSchema` | No | JSON Schema for structured output validation. |
| `annotations` | No | Metadata hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`). |

**inputSchema must have `"type": "object"` at root.** Missing this = schema validation error in some clients.

## Tool Call Request

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "San Francisco", "units": "imperial" }
  }
}
```

## Tool Result Content Types

Tool result is `{ "content": [...], "isError": false }`.

**Text:**
```json
{ "type": "text", "text": "Result string here" }
```

**Image (base64):**
```json
{ "type": "image", "data": "base64string", "mimeType": "image/png" }
```

**Audio:**
```json
{ "type": "audio", "data": "base64string", "mimeType": "audio/wav" }
```

**Resource link** (pointer to a resource):
```json
{
  "type": "resource_link",
  "uri": "file:///project/src/main.rs",
  "name": "main.rs",
  "mimeType": "text/x-rust"
}
```

**Embedded resource** (inline content):
```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///path/to/file",
    "mimeType": "text/plain",
    "text": "file content here"
  }
}
```

**Structured content** (for tools with `outputSchema`):
```json
{
  "content": [{ "type": "text", "text": "{\"temperature\": 22.5}" }],
  "structuredContent": { "temperature": 22.5, "conditions": "Sunny" }
}
```

**Error result** (execution error, NOT protocol error):
```json
{
  "content": [{ "type": "text", "text": "API rate limit exceeded" }],
  "isError": true
}
```

## Tool Error Handling

Two mechanisms:
1. **Protocol error** (use for: unknown tool, invalid schema, server crash):
   ```json
   { "error": { "code": -32602, "message": "Unknown tool: foo" } }
   ```
2. **Tool execution error** (use for: API failure, bad input, business logic):
   ```json
   { "result": { "content": [{"type":"text","text":"Error details"}], "isError": true } }
   ```

Prefer `isError: true` for recoverable errors the LLM should know about. Use protocol errors only for protocol-level issues.

## Annotations

Optional hints to clients about tool behavior:
```json
{
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

Clients **MUST** treat annotations as untrusted unless server is trusted.

## Tool Naming Best Practices

- Use `verb_noun` format: `get_weather`, `create_file`, `search_users`.
- Avoid generic names: `execute`, `run`, `do`.
- Name should match description closely.
- Max ~60 chars. Some clients truncate tool names at 64 chars.
- Unique within server. Conflicts across servers resolved by client (may prefix with server name).

## Resource Definition

Resources = read-only data sources. URI-addressed.

```json
{
  "uri": "file:///project/data.json",
  "name": "Project Data",
  "description": "Main project configuration",
  "mimeType": "application/json"
}
```

**Common URI schemes:**
| Scheme | Use case |
|--------|---------|
| `file://` | Local filesystem files |
| `https://` | Remote URLs |
| `git://` | Git repository content |
| `db://` | Database records |
| `custom://` | Custom namespaced resources |

**Resource template** (parameterized resource):
```json
{
  "uriTemplate": "db://users/{id}",
  "name": "User Record",
  "description": "Fetch user by ID"
}
```

**Resource read response:**
```json
{
  "contents": [
    {
      "uri": "file:///data.json",
      "mimeType": "application/json",
      "text": "{...}"
    }
  ]
}
```

For binary content, use `blob` field with base64 instead of `text`.

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
