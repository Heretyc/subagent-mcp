<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## A6 - Marker spec + exact MIGRATE_RE + collapse algorithm

### A6.1 Markers (S2)

```
begin: <!-- subagent-mcp:managed:begin schema=3 -->
end:   <!-- subagent-mcp:managed:end -->
```

### A6.2 MIGRATE_RE (S3) - replaces `BEGIN_RE` at `src/init.ts` line 31

```
/<!-- subagent-mcp:(?:managed:)?begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:(?:managed:)?end -->/
```

Line-by-line verification vs the real `init.ts` block:

| Marker in file | How MIGRATE_RE matches |
|---|---|
| `<!-- subagent-mcp:begin v1 -->` | `(?:managed:)?` absent; `begin\b` matches; `[^>]*` absorbs ` v1`; `-->` matches |
| `<!-- subagent-mcp:end -->` | `(?:managed:)?` absent; the literal ` -->` in the pattern matches the single space before `-->` |
| `<!-- subagent-mcp:managed:begin schema=3 -->` | `managed:` present; `begin\b` + `[^>]*` absorbs ` schema=3` |
| `<!-- subagent-mcp:managed:end -->` | `managed:` present; ` -->` matches |

The body is matched non-greedily (`[\s\S]*?`) so on two adjacent legacy blocks
the first match stops at the first end-marker, leaving the rest for the collapse
loop.

### A6.3 `upsertInitBlock` wiring

- `opts.remove` branch: gate on `MIGRATE_RE.test(body)`; `removeManagedBlock`
  uses `MIGRATE_RE` for both `match` and `replace`, so `--remove`/`--uninstall`
  strips legacy v1/schema=2 and schema=3.
- Main branch: replace `BEGIN_RE.test(body)` with `MIGRATE_RE.test(body)`;
  capture `body.match(MIGRATE_RE)?.[0]`; if `=== block` then `ok`
  (idempotent), else `next = body.replace(MIGRATE_RE, block)` then `updated`.
- No match: `insertAfterFirstHeading` (unchanged).
- BOM/EOL preservation and `atomicWrite` unchanged.

### A6.4 Duplicate-collapse algorithm (S3)

```
matches = body.match(new RegExp(MIGRATE_RE, 'g'))
if matches && matches.length > 1:
    next = body.replace(MIGRATE_RE, block)
    removed = 0
    while removed < 8 and MIGRATE_RE.test(next, after the first block):
        next = next.replace(MIGRATE_RE-after-first, '')
        removed++
    next = collapseBlankRuns(next, eol)
    status = 'updated'
    stderr: "collapsed N duplicate managed blocks"
```

Bounded cap = 8. In-memory only; exactly one `atomicWrite` per call. Result:
exactly one schema=3 block.

### A6.5 Version bump (D9)

`v1`/`schema=2` -> `schema=3` (plus the `:managed:` segment) forces a re-upsert
on every prior install because the captured legacy text never `=== block`. No
migration note goes inside the block; migration guidance lives in release notes
and this doc.

## A7 - Parent-marker predicate/upsert spec (S8 / D20)

### A7.1 Behavior spec

Exported pure functions in `src/launch-prompt.ts`:

```
export function hasParentMarker(prompt: unknown): boolean
export function ensureParentMarker(prompt: string): string
```

- `MARKER = "<this is a request from a parent process>"`.
- `hasParentMarker` returns `false` for non-string input. For strings, it scans
  at most the first 4096 chars, computes the literal first line from position 0
  up to the first `\n`, and strips a trailing `\r` before comparison.
- For the `startsWith(MARKER)` comparison only, strip a leading BOM from the
  first line. Do not mutate the prompt body (S8).
- Do not strip leading whitespace. A marker preceded by spaces on line 1, or on
  line 2, is treated as absent.
- `ensureParentMarker(prompt)` returns `prompt` unchanged when
  `hasParentMarker(prompt)` is true; otherwise it returns
  `MARKER + "\n" + prompt`.
- Empty / whitespace-only prompts get the marker prepended.
- Idempotent, silent. `ensureParentMarker` is wired into all launch paths
  (Claude Agent SDK + Codex app-server). Hook adapters use `hasParentMarker` as
  their final child-detection tier after spawn env and host-structured metadata.

### A7.2 Unit-test cases - `test/launch-agent-upsert.test.mjs` (node:test, GATING)

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | Absent -> prepend | `"do X"` | first line `=== MARKER`; body preserved |
| 2 | Present line 1 -> no duplicate | prompt already starting with MARKER on line 1 | `result === input`; marker count `=== 1` |
| 3 | Marker not first | `"intro\n" + MARKER + "\n..."` | treated as absent -> prepended; two occurrences total |
| 4 | CRLF marker line | `MARKER + "\r\n" + rest` | unchanged; single occurrence |
| 5 | Empty string | `""` | `MARKER + "\n"` |
| 6 | BOM-prefixed marker line | BOM + `MARKER + "\nrest"` | treated as present -> unchanged |
| 7 | Idempotence | representative prompts | applying `ensureParentMarker` twice is unchanged |
| 8 | Predicate/upsert coherence | positives and spoof negatives | `hasParentMarker(ensureParentMarker(x)) === true`; predicate-true inputs are unchanged |

All cases must pass before merge (gating, S7).
