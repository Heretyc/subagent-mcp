# Advanced-Ruleset Execution Contract

Normative. Defines WHEN and HOW `advanced-ruleset.py` runs: interpreter
resolution, the two execution modes, per-process latch semantics, the timeout,
and the hook position inside the `launch_agent` handler. Payload shapes and
exact error text live in `io-contract.md`; file deployment in
`scaffold-and-deployment.md`.

## Critical rules (repeated where they bind)

1. The script is the USER'S EXPLICIT OVERRIDE layer and has FINAL authority:
   it ALWAYS RUNS LAST, after applicable cost-efficiency auto `slotInsert`, and
   its validated output is consumed verbatim by the attempt loop in ALL
   selection modes including `explicit`.
2. ANY failure of the script pipeline hard-fails `launch_agent` with the exact
   message in `io-contract.md`. There is NO fallback to the unmodified list.
3. Env-check SUCCESS latches for the process lifetime; FAILURE NEVER LATCHES :
   the next `launch_agent` call retries, so an admin fix recovers without a
   server restart.
4. The script CANNOT see deadlock/branch/tier state (negative constraint
   below). Do not add such fields without owner approval.

## Actor table (who does what)

| Actor | Responsibility |
|---|---|
| MCP server (`src/ruleset.ts` + `src/index.ts`) | Resolve interpreter; recreate scaffold if absent; run env-check once per process; run routing mode once per launch; strictly validate output; map every failure to the hard-fail message; persist visibility fields. |
| User-edited `advanced-ruleset.py` | Implement `apply_rules`; print ONLY JSON to stdout; keep rules lean : it runs synchronously inside EVERY `launch_agent` call (user responsibility; the scaffold docstring warns). |
| Installer (`deploy.mjs` / `setup.ts`) | Ship the scaffold; preserve user edits across updates; verify the file exists (`scaffold-and-deployment.md`). |

## Interpreter resolution

1. If `SUBAGENT_RULESET_PYTHON` is set (non-empty), it is the ONLY candidate.
   It is EXCLUSIVE: a wrong override must surface as the hard fail, never be
   masked by PATH luck : no fallback past it.
2. Otherwise auto-detect, in order: win32 → `py`, `python3`, `python`;
   non-win32 → `python3`, `python` (`py` is Windows-only).
3. There is no separate probe run: the env-check execution itself walks the
   list. A candidate that fails to SPAWN (sync throw, or async ENOENT/EACCES
   `error` event) advances to the next. The FIRST candidate that successfully
   spawns is THE interpreter for that execution; a script-level failure under
   it is a ruleset failure, NOT a cue to try the next interpreter
   (deterministic : a broken default python must surface, not be masked).
4. All candidates unspawnable = "missing interpreter" = ruleset failure →
   hard fail. Yes: a python-less machine hard-fails every `launch_agent` until
   Python is installed or `SUBAGENT_RULESET_PYTHON` is fixed (see `_INDEX.md`
   warning). Recovery needs no restart (rule 3 above).
5. The chosen interpreter is remembered ONLY when the env-check latches
   success. On failure the walk repeats on the next launch, so a PATH fix is
   picked up without a restart.

## Two execution modes (argv is the discriminator)

| Invocation | Mode | stdin | stdout |
|---|---|---|---|
| `<python> advanced-ruleset.py` (no args) | environment check | closed immediately | `{"ready": bool, "load-rules": bool}` |
| `<python> advanced-ruleset.py route` | routing | one JSON payload, then EOF | bare JSON array (modified candidate list) |

The discriminator is argv, not stdin sniffing (stdin-presence detection in
python is unreliable without timeouts). OS environment variables reach the
script natively (`os.environ`); the server never filters them.

## Env-check gate and latch table (per-process, like the deadlock window)

The env check runs LAZILY at the FIRST `launch_agent` call of the server
process : never at server start; module import stays side-effect-free (house
testing rule). One module-level gate singleton holds the state.

| Env-check result | Gate state after | Effect |
|---|---|---|
| `{"ready": true, "load-rules": false}` | `disabled` (LATCHED) | Ruleset silently inert for the rest of the process; launch/poll payloads byte-identical to the pre-feature shape. No further script executions (and no scaffold recreate) until restart. |
| `{"ready": true, "load-rules": true}` | `enabled` (LATCHED) | Routing mode runs on every subsequent `launch_agent` call. |
| ANY failure: no spawnable interpreter, non-zero exit, timeout, empty / unparseable / non-JSON stdout, missing or non-boolean `ready` / `load-rules` keys, or `ready: false` | stays `unknown` : FAILURE NEVER LATCHES | This `launch_agent` returns the hard-fail message; the NEXT call re-runs the full env check (including the interpreter walk). |

`ready: false` IS a failure: the script self-reports unready, an admin must
fix it, and "unready but continue" has no defined safe behavior. Extra keys in
the env-check JSON are ignored; both required keys must be present booleans.
The key is `"load-rules"` (hyphen) : exactly as the goal spells it.

## Routing mode : when it runs

- Position in the handler: AFTER `routing-table.json` is parsed, the candidate
  list is built for the selected branch, the `noCandidates` error check runs
  (an empty build is an error BEFORE the hook), and cost-efficiency pure-auto
  `slotInsert` adds configured API candidates; BEFORE the attempt loop / silent
  failover. Performance and override modes receive no API slots. No slot
  insertion runs after the ruleset.
- Frequency: exactly ONCE per `launch_agent` call. It is NOT re-run per
  failover attempt : the attempt loop consumes the final list verbatim.
- Scope: ALL selection modes. In `explicit` mode the script receives the
  single user-requested candidate and may override even that.
- Stdin carries the complete candidates plus `context` (`io-contract.md`),
  including any applicable provider `"api"` slot candidates. The branch (cost_efficiency
  vs performance) was already chosen before the hook; the script never learns
  which, nor anything about the deadlock window.
- Routing-mode failure: hard fail for THIS call; the gate state is untouched
  (stays `enabled`), so the next launch re-runs routing mode only : the env
  check is not repeated after it has latched.

## Timeout

`RULESET_TIMEOUT_MS = 120000` (2 minutes), HARDCODED, per execution (each
env check and each routing run). On expiry the child is killed and the
execution counts as a failure → hard fail. The injectable `timeoutMs` option
on the gate factory is a TEST-ONLY seam (tests cannot wait 2 minutes);
production always uses the exported constant, and a unit test asserts its
value.

## Runtime scaffold recreate

Before each execution while the gate is `unknown` or `enabled`, the server
recreates `dist/advanced-ruleset.py` from the embedded scaffold if the file is
absent (`scaffold-and-deployment.md`). A recreate WRITE failure is a ruleset
failure → hard fail. While latched `disabled` nothing runs, so nothing is
recreated until the process restarts.

## Deadlock-window independence

Ruleset failure and ruleset veto NEVER arm, consume, or otherwise touch the
deadlock window, and never latch the gate. Window arming (validation step 7)
and branch selection happen before the hook; window consumption still happens
only on a successful performance-branch launch.

## Negative constraints

- The stdin payload MUST NOT contain deadlock status, branch name, tier, or
  window counters : the server never passes them (opacity invariant,
  `../auto-mode/routing-table-contract.md`).
- Never skip the ruleset silently on failure; never substitute the unmodified
  candidate list after a failure.
- Never insert API slot candidates after the ruleset.
- Never try the next interpreter after one has successfully spawned.
- Never re-run the script per failover attempt or per candidate.
- Never run the env check at server start or on module import.

## When to stop and ask the owner

Exposing branch/deadlock state to the script, changing the timeout value,
appending hints to the hard-fail message, or making any failure latch are all
owner-level contract changes : stop and ask before implementing.
