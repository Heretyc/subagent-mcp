# Advanced-Ruleset Build Partition and Test Plan

Normative. Defines the non-overlapping implementer file partition, the test
plan with intent rationale, and the verification gate. Contracts under test
live in the sibling leaves.

## File-ownership partition (non-overlapping; zero shared files)

| Impl | Owns exclusively |
|---|---|
| A — ruleset core | `src/ruleset.ts` (new) · `src/advanced-ruleset.py` (new) · `src/routing.ts` (export `LAUNCH_MODELS`/`LAUNCH_EFFORTS`/`HAIKU_EFFORT` only) · `scripts/gen-ruleset-scaffold.mjs` (new) · `scripts/copy-provider.mjs` (hard-fail scaffold copy) · `.gitignore` (`src/ruleset-scaffold.ts`) |
| B — server wiring | `src/index.ts` (gate singleton, hook insertion, veto error, visibility fields/payloads, grace window + `tryLaunchCandidate` param, explicit-failure guard) · `package.json` (version 2.4.0 → 2.5.0; `build` gen-step; `test` chain += the 4 fixed test entries) |
| C — installer | `skills/subagent-mcp-installer/scripts/deploy.mjs` · `src/setup.ts` · `skills/subagent-mcp-installer/SKILL.md` |
| D — docs | this leaf set (new) · `AGENTS.md` (extend the auto-mode trigger line in place, net 0 lines) · `docs/spec/auto-mode/_INDEX.md` / `param-contract.md` / `resolution-matrix.md` / `routing-table-contract.md` (surgical amendments) |
| E — tests (after A+B land) | `test/ruleset.test.mjs` · `test/ruleset-exec.test.mjs` · `test/ruleset-handler.test.mjs` · `test/failover.test.mjs` · `test/index-handler.test.mjs` (makeTempEnv update only) · `test/fixtures/fake-ruleset-preload.cjs` · `test/fixtures/ruleset-routing-table.fixture.json` |

Frozen cross-partition interface (no renegotiation): A exports
`createRulesetGate`, `validateRulesetOutput`, `ensureScaffold`,
`defaultScaffoldPath`, `interpreterCandidates`, `RULESET_TIMEOUT_MS`,
`RULESET_HARD_FAIL_MSG`, `RulesetStdinPayload` from `src/ruleset.ts`. B writes
the package.json `test` entries with E's exact four filenames. Parallelism:
A ∥ C ∥ D immediately; B compiles against A's landed code; E strictly after
A+B.

## Test harness rules (house style)

- No framework: hand-rolled `test(name, fn)` runner + `node:assert/strict` +
  `process.exit(1)`; header WHY comments; numbered banner comments per case.
- All imports from `dist/`; NEVER import `dist/index.js` in a unit test (it
  opens the stdio transport and registers an interval).
- Verbatim strings (hard-fail, veto) are duplicated as consts in the tests and
  asserted with full equality so spec drift fails loudly.

The interpreter stub (no production test seams): tests set
`SUBAGENT_RULESET_PYTHON = process.execPath` plus
`NODE_OPTIONS=--require test/fixtures/fake-ruleset-preload.cjs`. The preload
no-ops unless `process.argv[1]` ends with `.py` (MCP server child and fake
CLIs untouched), reads its behavior from the file named by
`FAKE_RULESET_MODE_FILE`, appends an execution line to `FAKE_RULESET_LOG`, and
exits before node parses the `.py`. The mode lives in a FILE so one MCP
session can flip behavior between calls — that is what PROVES non-latching.

## Test plan (file → coverage, with WHY)

| File | Covers |
|---|---|
| `test/ruleset.test.mjs` (pure) | `validateRulesetOutput` matrix (valid triples incl. haiku+`"none"`; rejects codex+`max`, sonnet+`ultracode`, unknown model/provider, non-array, non-object element, junk effort that effort.ts fallback would coerce); empty array = valid; `interpreterCandidates` order win32/posix + `SUBAGENT_RULESET_PYTHON` exclusivity; gate latch semantics with injected exec (false→disabled forever, true→enabled, failure→state stays unknown and exec is called again); `RULESET_TIMEOUT_MS === 120000`; hard-fail string verbatim; scaffold drift guard (`src/advanced-ruleset.py` bytes === `RULESET_SCAFFOLD`, contains `LOAD_RULES = False`). |
| `test/ruleset-exec.test.mjs` (spawns interpreter, no MCP server) | Real exec plumbing via the gate with `scriptPath` at the dist scaffold + fake interpreter: env-check JSON round-trip; routing stdin delivered intact; timeout via injected `timeoutMs: 500` + sleep mode; non-zero exit; invalid JSON; `ensureScaffold` recreates a deleted file byte-identical; conditional real-python smoke test (loud SKIP line if no interpreter — fail-loud rule). |
| `test/ruleset-handler.test.mjs` (integration, `createMcpSession`) | Gate runs ONCE (3 launches, 1 env-check log line; payloads byte-identical to pre-feature); load-rules-false no-op; override path (`ruleset_applied` + `ruleset_original_selection` in launch + poll, passthrough → fields ABSENT); explicit-mode override; failure → EXACT hard-fail string then flip mode file → next launch succeeds (NON-LATCHING recovery, same session); ready-false and bad-model → same exact string; empty list → exact veto text; deadlock window NOT consumed on ruleset failure. |
| `test/failover.test.mjs` (integration) | Fake-CLI die/stall variants, `SUBAGENT_SPAWN_GRACE_MS=300`: candidate 1 dies → candidate 2 wins (silent advance); ALL die → `ERR_ALL_FAILED` with numbered early-exit reasons; grace=0 → legacy behavior (proves the window is the mechanism); early-exit reason includes the exit code. |
| `test/index-handler.test.mjs` (modify) | `makeTempEnv()` gains the ruleset-disabled fake env + `SUBAGENT_SPAWN_GRACE_MS: "0"` so ALL existing assertions stay valid (legacy fake CLIs exit instantly; host may lack python). |

`package.json` test chain: append `&& node test/ruleset.test.mjs && node
test/ruleset-exec.test.mjs && node test/ruleset-handler.test.mjs && node
test/failover.test.mjs` after `node test/index-handler.test.mjs`, before the
validator entries. New fixtures live under `test/fixtures/`.

## Sequencing caveat (fail loud)

Between B landing and E landing, `npm test` is RED — the grace window and the
ruleset gate break the legacy integration tests until `makeTempEnv()` is
updated. Acceptable mid-stream on the feature branch ONLY; never merge red.

## Verification gate (before PR)

1. `npm run build` clean (gen-scaffold + tsc + copy-provider, incl. the
   hard-fail scaffold copy).
2. Full `npm test` green, including the four new files in the chain.
3. `node scripts/check_mcp_compliance.mjs` passes (no tool-description text
   changed, but the gate is mandatory pre-commit).
4. Contradiction-checker sub-agent dispatched vs this leaf set and
   `../auto-mode/` (its first step re-runs the compliance script).
