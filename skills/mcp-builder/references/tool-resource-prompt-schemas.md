# Tool, Resource, and Prompt Schemas

**Load when:** Designing inputSchema, understanding tool/resource/prompt definitions, content types, output schema, annotations.
**Do not load when:** Task is about packaging, config, or install.

Source: modelcontextprotocol.io/docs/concepts/tools [S3], modelcontextprotocol.io/docs/concepts/architecture [S1]

---

This page is an index. Detail lives in `tool-resource-prompt-schemas/`. Load the sub-page for the primitive you are designing:

| Sub-page | Covers |
|----------|--------|
| [`tool-resource-prompt-schemas/01-tools.md`](tool-resource-prompt-schemas/01-tools.md) | Tool definition schema + full field-rules table; `tools/call` request; all result content types (text, image, audio, resource_link, embedded resource, structuredContent, error); protocol vs `isError` error handling; annotations; tool naming best practices. |
| [`tool-resource-prompt-schemas/02-resources.md`](tool-resource-prompt-schemas/02-resources.md) | Resource definition; common URI schemes (`file://`, `https://`, `git://`, `db://`, `custom://`); resource templates (`uriTemplate`); resource read response (`text`/`blob`). |
| [`tool-resource-prompt-schemas/03-prompts-and-descriptions.md`](tool-resource-prompt-schemas/03-prompts-and-descriptions.md) | Prompt definition (`prompts/list`, `prompts/get`); prompt get response; Claude Code `/mcp__server__prompt` slash commands; the tool-description writing guide. |

**Quick facts (no sub-page load needed):**

- `inputSchema` root MUST be `"type": "object"`; omitting the `required` array makes all fields optional.
- Use `isError: true` in the result for recoverable execution errors; reserve protocol errors (e.g. `-32602`) for protocol-level issues.
- `name` is `verb_noun`, alphanumeric + underscore, unique within the server; `description` drives LLM tool selection.
- Claude Code truncates tool descriptions / server instructions at 2KB : put critical info first.
