# graphify Directive

Status: repository directive for graphify setup, health, graph consumption, and
refresh behavior.

## Purpose

graphify builds a persistent knowledge graph for this repository from code and
documents. It writes generated graph data under `graphify-out/`, including:

- `graphify-out/graph.json`: machine-readable graph for CLI and MCP access.
- `graphify-out/GRAPH_REPORT.md`: plain-language architecture and community
  report.
- `graphify-out/wiki/index.md`: optional agent-crawlable community wiki.

Use graphify to understand relationships before searching raw files, especially
for architecture, navigation, cross-module dependency, and "how does X relate to
Y" questions.

## MCP Health

At session start and before graph-dependent work, expect the `graphify` MCP to
be reachable. Check health with:

```powershell
graphify hook status
```

If graphify is unavailable, fix the local setup before relying on graph queries
or graph MCP tools. Do not pretend the graph is current or available when the
health check fails.

## Setup

Install the repository-vendored graphify package from the repo root with either:

```powershell
pip install -e tools/vendor/graphify-local[mcp]
```

or:

```powershell
uv tool install --editable tools/vendor/graphify-local --force
```

After install, enable graphify git hooks when hook management is in scope:

```powershell
graphify hook install
graphify hook status
```

## Build And Update

Run a full graph build when no graph exists or when semantic extraction needs a
fresh pass:

```powershell
graphify .
```

The full build scans the repository and may perform LLM semantic extraction for
documents and other non-code material.

Run an incremental AST refresh after edits:

```powershell
graphify update .
```

`graphify update .` reprocesses changed files incrementally and is the default
post-edit maintenance command. For code-only changes it is AST-only and avoids
LLM API cost.

Do not copy `graphify-out/` from another repository. It is generated from this
repo and must be rebuilt here.

## Consume The Graph

Before answering architecture or repository-navigation questions, read:

```text
graphify-out/GRAPH_REPORT.md
```

Use it first for god nodes, communities, cohesion notes, and surprising
connections. If present, navigate the wiki next:

```text
graphify-out/wiki/index.md
```

Prefer graph-aware queries over raw text search when the question is about
relationships, dependencies, architecture, concepts, or paths:

```powershell
graphify query "<question>"
graphify path "<A>" "<B>"
graphify explain "<concept>"
```

When the graphify MCP is online, prefer its graph tools for graph inspection
before falling back to `rg`, `find`, or manual file traversal. Use raw search
after graph context has narrowed the target, or when the question is a literal
text lookup.

## After Edits

After modifying repository code or docs that graphify tracks, refresh the graph:

```powershell
graphify update .
```

If the update reports that semantic extraction is required for changed
non-code files, follow graphify's instructions rather than assuming the graph is
fresh.
