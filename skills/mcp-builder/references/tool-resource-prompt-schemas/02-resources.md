# Resource Schemas: Definition, URI Schemes, Templates, Read Response

Part of `tool-resource-prompt-schemas.md`. Source: modelcontextprotocol.io/docs/concepts/tools [S3], modelcontextprotocol.io/docs/concepts/architecture [S1]

---

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
