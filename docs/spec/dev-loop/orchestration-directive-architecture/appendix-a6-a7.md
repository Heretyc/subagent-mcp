<!-- Part of orchestration-directive-architecture (split). Retrieval map: ../orchestration-directive-architecture.md -->

## A6 — Marker spec + exact MIGRATE_RE + collapse algorithm

### A6.1 Markers (S2)

```
begin: <!-- subagent-mcp:managed:begin schema=3 -->
end:   <!-- subagent-mcp:managed:end -->
```

### A6.2 MIGRATE_RE (S3) — replaces `BEGIN_RE` at `src/init.ts` line 31

```
/<!-- subagent-mcp:(?:managed:)?begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:(?:managed:)?end -->/
```

Line-by-line verification vs the real `init.ts` (block at lines 34–50):

| Marker in file | How MIGRATE_RE matches |
|---|---|
| `<!-- subagent-mcp:begin v1 -->` (legacy begin) | `(?:managed:)?` absent; `begin\b` matches; `[^>]*` absorbs ` v1`; `-->` matches |
| `<!-- subagent-mcp:end -->` (legacy end) | `(?:managed:)?` absent; the literal ` -->` in the pattern matches the single space before `-->` in the file |
| `<!-- subagent-mcp:managed:begin schema=3 -->` (new begin) | `managed:` present; `begin\b` + `[^>]*` absorbs ` schema=3` |
| `<!-- subagent-mcp:managed:end -->` (new end) | `managed:` present; ` -->` matches |

The body is matched non-greedily (`[\s\S]*?`) so on two adjacent legacy blocks
the first match stops at the FIRST end-marker, leaving the rest for the collapse
loop.

### A6.3 `upsertInitBlock` wiring

- `opts.remove` branch: gate on `MIGRATE_RE.test(body)`; `removeManagedBlock`
  uses `MIGRATE_RE` for both `match` and `replace` → `--remove`/`--uninstall`
  strips legacy v1/schema=2 **and** schema=3.
- main branch: replace `BEGIN_RE.test(body)` with `MIGRATE_RE.test(body)`;
  capture `body.match(MIGRATE_RE)?.[0]`; if `=== block` → `ok` (idempotent),
  else `next = body.replace(MIGRATE_RE, block)` → `updated` (positional in-place
  rewrite; keeps position after the first heading; no orphan/duplicate).
- no match → `insertAfterFirstHeading` (unchanged).
- BOM/EOL preservation and `atomicWrite` unchanged.

### A6.4 Duplicate-collapse algorithm (S3)

```
matches = body.match(new RegExp(MIGRATE_RE, 'g'))
if matches && matches.length > 1:
    next = body.replace(MIGRATE_RE, block)        # replace FIRST occurrence with the new block
    removed = 0
    while removed < 8 and MIGRATE_RE.test(next, after the first block):
        next = next.replace(MIGRATE_RE-after-first, '')   # delete each remaining legacy/dup block
        removed++
    next = collapseBlankRuns(next, eol)           # ONCE, after the loop
    status = 'updated'
    stderr: "collapsed N duplicate managed blocks"
    # single atomicWrite
```

Bounded cap = 8 (matches `OWNER_CAP`). In-memory only; exactly one
`atomicWrite` per call. Result: exactly ONE schema=3 block.

### A6.5 Version bump (D9)

`v1`/`schema=2` → `schema=3` (plus the `:managed:` segment) forces a re-upsert on every
prior install because the captured legacy text never `=== block`. **No migration
note inside the block**; migration guidance lives in release notes + this doc.

## A7 — `ensureParentMarker` spec (S8 / D20) + the 7 unit-test cases

### A7.1 Behavior spec

Exported pure function in `src/launch-prompt.ts` (re-exported from
`src/index.ts` for testability):

```
export function ensureParentMarker(prompt: string): string
```

- `MARKER = "<this is a request from a parent process>"`.
- Compute the **literal first line** = substring from position 0 up to the first
  `\n` (the prompt may use `\n` or `\r\n`; **strip a trailing `\r`** before
  comparison).
- For the `startsWith(MARKER)` comparison **only**, strip a leading BOM
  (`﻿`) from the first line. **Do NOT mutate the prompt body** (S8).
- **Do NOT strip leading whitespace** — the spec is "literal first line begins
  with MARKER" (D19). A marker preceded by spaces on line 1, or on line 2, is
  treated as ABSENT.
- If the first line (after BOM-strip) `startsWith(MARKER)` → return `prompt`
  **unchanged** (no duplicate).
- Else → return `MARKER + "\n" + prompt`.
- Empty / whitespace-only prompts → marker prepended.
- **Idempotent, silent.** Wired into ALL launch paths (Claude Agent SDK + Codex
  app-server).

### A7.2 Unit-test cases — `test/launch-agent-upsert.test.mjs` (node:test, GATING)

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | ABSENT → prepend | `"do X"` | first line `=== MARKER`; body `"do X"` preserved |
| 2 | PRESENT line 1 → no duplicate | prompt already starting with MARKER on line 1 | `result === input`; marker count `=== 1` |
| 3 | PRESENT + trailing content on line 1 | `MARKER + " extra\nrest"` | unchanged (`startsWith` satisfied) |
| 4 | CRLF, marker on line 1 | `MARKER + "\r\n" + rest` | unchanged; single occurrence |
| 5 | MARKER not first (line 2) | `"intro\n" + MARKER + "\n..."` | treated as ABSENT → prepended; **two** occurrences total (proves first-line-anchored) |
| 6 | empty string | `""` | `MARKER + "\n"` |
| 7 | BOM-prefixed marker line | `"﻿" + MARKER + "\nrest"` | treated as PRESENT → unchanged |

All 7 must pass before merge (gating, S7).
