# Global Concurrent-Subagent Cap — Contract

Normative. The authoritative contract for the machine-global cap on **live**
subagents. Defines the shared-state mechanism and its never-over-admit proof,
the machine-global slot directory per OS, the slot lifecycle and its release
sites, crash / no-reaper semantics, the `global-concurrency.jsonc` config and
its forced validation, retention across updates, the single enforcement point
and its verbatim reject error, the fail-open policy, and the unit tests. Where
this contract and the implementation disagree, this contract wins; change the
contract first.

---

## §0 — Overview and scope

A single **machine-global** cap on the number of subagents that may be ALIVE
AT ONCE. It is enforced across all sessions, all processes, and all users on
the host — not per session and not per provider. The per-provider in-memory
cap inside `tryLaunchCandidate` is a separate, unchanged mechanism (§7).

- **Counts the whole recursive descendant tree as ONE number.** A subagent
  that itself launches subagents adds to the same machine-wide total, and other
  active agentic sessions count too. There is no PID-tree walk and no liveness
  probe.
- **Descendant counting is emergent, not computed.** Every descendant runs its
  own MCP server and therefore its own `launch_agent`, and each `launch_agent`
  reserves a slot into the SAME shared directory. The tree-wide live count is
  simply the number of marker files in that directory; the recursion falls out
  of every node reserving into one shared place.
- **Slots free as agents finish.** A reserved slot is released when the agent's
  driver process terminates, on `kill_agent`, or when every launch candidate
  fails (§3). The count therefore tracks live agents, not lifetime launches.
- **At cap, `launch_agent` is REJECTED — never queued.** The cap is a safety
  valve, not a scheduler. No slot frees itself by waiting; the caller must free
  one with `list_agents` + `kill_agent` and retry (§7).

Two distinct locations, never conflated: the **config** travels with the
package (the install/dist dir, §5); the **live count** travels with the machine
(the slot dir, §2).

---

## §1 — Shared-state mechanism and never-over-admit proof

**Mechanism: a lock-free directory of per-agent UUID marker files, counted by
`readdir`, reserved by optimistic create-then-recount-then-rollback.** The live
count is the number of files whose name starts with `slot-`. A slot is reserved
by writing the marker FIRST, then recounting; if the post-write count exceeds
the cap, the just-written marker is unlinked and the launch is rejected.

```
DEFAULT_CAP = 20, MIN_CAP = 10

countSlots(dir = slotDir()): number
  try   { return readdirSync(dir).filter(f => f.startsWith("slot-")).length }
  catch { return 0 }                       // fail-OPEN: unreadable shared state never blocks work

reserveSlot(agentId: string, max: number, dir = slotDir()): {ok, current, max, slotPath}
  try {
    mkdirSync(dir, { recursive: true, mode: 0o1777 })          // sticky; mode ignored on win32
    const slotPath = join(dir, `slot-${agentId}.json`)
    writeFileSync(slotPath, JSON.stringify({ pid: process.pid, cwd: process.cwd(), startedAt: new Date().toISOString() }),
                  { mode: 0o600 })          // CREATE OUR MARKER FIRST
    const n = countSlots(dir)               // THEN recount (includes our own file)
    if (n > max) { try { unlinkSync(slotPath) } catch {}; return { ok:false, current: n - 1, max } }   // ROLLBACK
    return { ok:true, slotPath, current: n, max }
  } catch (e) {
    console.error(`[concurrency] reserve failed, failing open: ${e}`)
    return { ok:true, current: 0, max, slotPath: null }      // fail-OPEN on ANY FS error
  }

releaseSlot(slotPath): void                 // idempotent, fail-safe
  if (!slotPath) return
  try { unlinkSync(slotPath) } catch {}      // ENOENT fine (already gone / crashed)
```

### Never-over-admit proof

Survivors = markers never rolled back. Let `s*` be the survivor whose recount
ran last among survivors. Every other survivor created its file before its own
recount, hence before `s*`'s recount, and never removed it — so all `M`
survivor files exist at `s*`'s recount instant, giving `s*` a recount of at
least `M`. `s*` survived, so it saw a count of at most `max`. Therefore
`M ≤ max`. ∎

Under contention the algorithm may **over-reject** (two racers both recount
high, both roll back), which is conservative and correct for a safety valve;
the caller simply retries one of the racers. It never **over-admits**.

### Why no lock

An `O_EXCL` spinlock was rejected: a stuck `.lock` (a crash mid-critical
section) wedges EVERY machine-wide launch, which is strictly worse than a stale
marker that over-counts by one — a stale marker only makes the cap reject
slightly early, never deadlocks the machine. Also rejected: a single counter
file (read-modify-write race), an OS named semaphore (no portable Node API, not
enumerable), and SQLite (a native dependency on a zero-native-dependency
package).

---

## §2 — Machine-global path and permissions

`os.tmpdir()` is per-user on both Windows and macOS, so it cannot back a
machine-global cap. The slot directory is resolved to a fixed machine-global
base per OS:

```
slotDir():
  if (process.platform === "win32")
    base = process.env.ProgramData || process.env.ALLUSERSPROFILE || "C:\\ProgramData"
    return join(base, "subagent-mcp", "slots")     // C:\ProgramData\subagent-mcp\slots
  else
    return "/tmp/subagent-mcp/slots"
```

**POSIX `/tmp`, not `/var/tmp`.** This cap governs **live** agents only, so a
reboot SHOULD clear leaked or orphaned slots and let the machine self-recover
from crashes with no manual cleanup. `/var/tmp` persists across reboots —
exactly the wrong property here, since a reboot kills the processes but would
leave their markers counted forever. `/tmp` is the canonical machine-global,
world-writable, sticky (`1777`) directory on Linux and macOS (`/tmp` →
`/private/tmp`); its reboot-clearing behavior is the deciding factor.

- **mkdir mode `0o1777`** — sticky + world-writable, so any local user may add
  or list a marker, and the sticky bit lets a user unlink only their own
  markers. On Windows the mode argument is ignored; the `%ProgramData%` default
  ACL grants `Users` / `Authenticated Users` create rights, and all users can
  `readdir`.
- **file mode `0o600`.**
- **filename pattern `slot-<uuid>.json`** (`uuid = randomUUID()`). The count is
  **filename-based** (`startsWith("slot-")`); the file content is NEVER parsed.
  Filenames carry no cwd or pid, so a cross-user listing leaks nothing about
  other users' projects.
- **file contents (debug / manual-cleanup only)** `{ pid, cwd, startedAt }` —
  written for a human clearing stale slots by hand, never read by the cap.

---

## §3 — Slot lifecycle and the three release sites

A slot is reserved exactly **once per `launch_agent` call**, immediately before
the candidate attempt loop (§7). The reserved `slotPath` is recorded on the
agent's state (`AgentState.slotPath`) when a candidate wins, so the later
release sites can find and unlink the right marker.

A "live entry" is a driver process that has not yet terminated. The slot is
held until that REAL process exit — it is NOT freed when an agent merely stalls
or when an interactive agent "finishes" a turn but keeps its process alive.

The slot is released at exactly three sites:

1. **Driver close/exit handler** — on the driver process's terminal exit, the
   close/exit handler calls `releaseSlot(agentState.slotPath)`. This is the
   normal path and the reason release is tied to true process death.
2. **`kill_agent`** — after the `taskkill` / `SIGKILL`, `kill_agent` calls
   `releaseSlot(agent.slotPath)` so a manually terminated agent frees its slot
   immediately.
3. **All-candidates-failed** — if every launch candidate fails so no driver
   process is ever established, a `finally` around the attempt loop calls
   `releaseSlot(slot.slotPath)` (guarded by a `launched` flag) to give the
   reserved slot back.

`releaseSlot` is idempotent and fail-safe: a null path is a no-op, and an
`ENOENT` unlink (already gone, or the process crashed) is swallowed, so no
release site can double-free or throw.

---

## §4 — Crash and no-reaper semantics

There is **NO automatic cleanup and NO zombie reaping.** If a server process
crashes without running its release site, its marker stays orphaned and
**counted** until a human clears it — either via `kill_agent` for an agent the
session still tracks, or by deleting the stale `slot-*.json` file by hand.

This is acceptable by design: a stale marker only makes the live count **higher
than reality**, so its sole effect is to REJECT a launch slightly early. It can
never cause an over-spawn, because the count is only ever compared against the
cap to decide whether to reject. Freeing leaked slots is the orchestrator's
manual responsibility, not the server's.

Reboot self-recovery applies on POSIX, where `/tmp` is cleared on reboot (§2),
so a crash followed by a reboot leaves zero orphaned markers. On Windows,
`%ProgramData%\subagent-mcp\slots` persists across reboots, so stale markers
there must be deleted manually; the config template (§5) names both paths for
that purpose.

---

## §5 — Config file and forced validation

The cap value lives in a NEW dedicated config file — **not** in
`advanced-ruleset.py`.

- **Filename:** `global-concurrency.jsonc` (the `.jsonc` extension signals the
  inline comments).
- **Canonical source:** `src/global-concurrency.jsonc`, tracked in git, the
  single source of truth.
- **Install-dir resolution:**
  `fileURLToPath(new URL("./global-concurrency.jsonc", import.meta.url))` →
  `dist/global-concurrency.jsonc`, the dist sibling of the compiled module —
  the same pattern as `defaultTablePath()` / `defaultScaffoldPath()`. Global
  install: `$(npm root -g)/@heretyc/subagent-mcp/dist/global-concurrency.jsonc`.
- **Key:** `globalConcurrentSubagents`. **Default 20, minimum valid 10.**
- **NO environment-variable override** — the file is the sole source of truth.
- **Re-read on EVERY `launch_agent` call, no cache** — a live edit takes effect
  on the next launch with no server restart. The per-call cost is one
  `readFileSync` of a ~20-line file plus a `JSON.parse`, negligible against the
  spawn work `launch_agent` already does.
- **Format JSONC:** whole-line `//` comments are stripped before `JSON.parse`.
  The only value is an integer, so no string ever contains `//` and the
  whole-line stripper is provably safe for this flat one-key file.

### Forced validation table

The number is forcibly normalized — an invalid or out-of-range value is never
an error, it is coerced:

| Configured value | Result | Rule |
|---|---|---|
| missing / unset / `null` / non-integer / float / `NaN` / string | `20` | invalid → default |
| `0` or negative | `20` | invalid → default |
| `1`–`9` | `10` | pinned UP to the minimum |
| `10` or greater | used as-is | honored |

```
const DEFAULT_CAP = 20, MIN_CAP = 10

clampCap(raw: unknown): number              // the whole forced-validation table
  if (!Number.isInteger(raw)) return DEFAULT_CAP   // unset/undefined/null/float/NaN/string/Infinity
  const v = raw as number
  if (v <= 0)      return DEFAULT_CAP              // 0 and negatives invalid
  if (v < MIN_CAP) return MIN_CAP                  // 1..9 pinned UP to 10
  return v                                          // >=10 honored

stripJsoncComments(text: string): string
  return text.replace(/^\s*\/\/.*$/gm, "")         // strip whole-line // comments ONLY

parseConcurrencyConfig(text: string): number
  let raw: unknown = undefined
  try { raw = (JSON.parse(stripJsoncComments(text)) as any)?.globalConcurrentSubagents }
  catch { /* raw stays undefined -> clampCap returns default */ }
  return clampCap(raw)

readGlobalCap(path = defaultConfigPath()): number
  try { ensureConcurrencyConfig(path); return parseConcurrencyConfig(readFileSync(path, "utf8")) }
  catch { return DEFAULT_CAP }                      // fail-safe to default
```

### Commented template — VERBATIM (`src/global-concurrency.jsonc`, ship byte-for-byte)

```jsonc
// subagent-mcp — Global Concurrent Subagent Cap
// ------------------------------------------------------------------
// SOLE source of truth for the machine-wide limit on how many subagents
// may be ALIVE AT ONCE across EVERY session, process, and user on this
// machine. There is NO environment-variable override.
//
// The whole recursive descendant tree counts toward this ONE number: a
// subagent that itself launches subagents adds to the same machine-wide
// total, and OTHER active agentic sessions count too.
//
// RE-READ on every launch_agent call — edits take effect immediately, no
// server restart required.
//
// Value rules (forcibly applied to the number below):
//   - missing / unset / non-integer / 0 / negative  -> reset to default 20
//   - 1 through 9                                    -> forced UP to minimum 10
//   - 10 or greater                                 -> used as-is
//
// When the cap is reached, launch_agent is REJECTED (never queued). Free a
// slot with list_agents + kill_agent, then retry.
//
// Slots free automatically as agents finish or are killed. There is NO
// zombie reaping. If a server process CRASHES, its slots stay counted until
// you delete the stale slot files by hand:
//   Windows:      %ProgramData%\subagent-mcp\slots
//   macOS/Linux:  /tmp/subagent-mcp/slots
{
  "globalConcurrentSubagents": 20
}
```

---

## §6 — Retention across package updates

The config is preserved across updates by the **identical mechanism** that
protects `advanced-ruleset.py`: the same three-site backup/restore bracket, the
same runtime recreate-if-absent default, and the same gen-scaffold +
copy-provider hard-fail build chain. The file is user-editable and a package
update must NEVER overwrite a user-edited `global-concurrency.jsonc`. See
`../advanced-ruleset/scaffold-and-deployment.md` for the canonical description
of this bracket; the cap config adds a parallel copy of it.

### Three retention sites

1. **CLI self-update** (`src/index.ts`) — a second bracket beside the ruleset
   one. BEFORE `npm install -g`, if `<install>/dist/global-concurrency.jsonc`
   exists, read it into memory and write a safety copy to
   `join(tmpdir(), "global-concurrency.jsonc.bak-update-<Date.now()>")` (in
   tmpdir, NEVER the install root — npm wipes that dir). AFTER a code-0 install,
   if the shipped file differs from the saved one, write the saved one back and
   log `restored user global-concurrency.jsonc (package update never overwrites
   user edits)`. On backup-write failure, `console.error` + `process.exit(1)`
   to refuse the update — same strictness as the ruleset bracket.
2. **Installer** (`skills/subagent-mcp-installer/scripts/deploy.mjs`) — a
   parallel snapshot/restore bracket for
   `live = join(install, "dist", "global-concurrency.jsonc")`: snapshot to
   `join(os.tmpdir(), "global-concurrency.jsonc.bak-deploy-<ts>")`, restore
   after install if it differs from the freshly shipped file, and add
   `dist/global-concurrency.jsonc` to the `verify()` `need[]` array. The
   installer SKILL.md names `global-concurrency.jsonc` as a shipped,
   preserve-on-update part.
3. **Runtime recreate-if-absent** — `ensureConcurrencyConfig(path)` in
   `src/concurrency.ts`, the analog of `ensureScaffold()`: it writes
   `CONCURRENCY_SCAFFOLD` to the dist path ONLY when that file is absent; an
   existing file is NEVER touched.

### Build / packaging chain (faithful mirror)

- **`scripts/gen-ruleset-scaffold.mjs`** is EXTENDED to also emit the
  git-ignored `src/config-scaffold.ts`
  (`export const CONCURRENCY_SCAFFOLD: string = <JSON.stringify of the .jsonc
  bytes>`), hard-failing the build if `src/global-concurrency.jsonc` is
  missing. It runs before `tsc` so the import in `src/concurrency.ts` resolves.
  One gen script emits both scaffolds.
- **`scripts/copy-provider.mjs`** also copies `src/global-concurrency.jsonc` →
  `dist/`, and **HARD-FAILS** (exit 1) if the source is missing — the same
  strictness as the `.py` copy, NOT the routing-table warn-and-skip, because it
  is a verified shipped part.
- **`src/setup.ts` `verifyInstall()`** adds `dist/global-concurrency.jsonc` to
  its required `need[]` list (existence-only; a restored user file satisfies
  it).
- **`.gitignore`** adds `src/config-scaffold.ts`.
- **`package.json` `files`** is unchanged — the whole `dist` dir already ships,
  so the jsonc travels in the tarball.

---

## §7 — Enforcement

The cap is enforced by **one check per `launch_agent` call**, placed
immediately BEFORE the candidate attempt loop (`for (const candidate of
candidates)` in `src/index.ts`, ~`:766`). It runs AFTER validation, the
model-selection-mode gate, the routing-table build, and the advanced-ruleset
hook, and BEFORE any spawn attempt. The check is provider-agnostic — exactly
one reservation per call regardless of how many candidates the loop will try.

The per-provider in-memory cap inside `tryLaunchCandidate` is a separate
mechanism and is left exactly as-is; this machine-global cap sits in front of
the whole loop, the per-provider cap inside each attempt.

```typescript
// --- global machine-wide concurrency cap (docs/spec/global-concurrency/) ---
const cap = readGlobalCap();
const slot = reserveSlot(reservationId, cap);
if (!slot.ok) {
  return errorResult(globalCapMessage(slot.current, cap, defaultConfigPath()));
}
let launched = false;
try {
  for (const candidate of candidates) {
    // ...existing loop... on the winning candidate: agentState.slotPath = slot.slotPath; launched = true;
  }
} finally {
  if (!launched) releaseSlot(slot.slotPath);   // all candidates failed -> give the slot back
}
```

### Reject error string — VERBATIM

Returned via the existing `errorResult(text)`, which yields
`{content:[{type:"text",text}],isError:true}`.
`globalCapMessage(current, max, configPath = defaultConfigPath())` interpolates
`<current>`, `<max>`, and `<configPath>`:

```
Global concurrent-subagent limit reached: <current> of <max> live subagents are already running across all sessions on this machine. This global count includes agents started by OTHER active agentic sessions and the ENTIRE recursive descendant tree, not just this session's direct children. launch_agent was REJECTED — this cap never queues or blocks; no slot frees itself by waiting. Free a slot manually first: call list_agents to see live agents, then kill_agent to terminate ones you no longer need, and retry. The limit is "globalConcurrentSubagents" in <configPath> (default 20, minimum 10).
```

The message satisfies every required clause: current vs max; that OTHER
sessions and the ENTIRE recursive descendant tree also count; that the launch
was REJECTED and the cap never queues; the `list_agents` → `kill_agent` remedy;
and where the config lives.

---

## §8 — Fail-open policy

**ANY filesystem error in the cap path fails OPEN — allow the launch and warn
to stderr.** Bricking every machine-wide launch because the shared state dir
glitched is strictly worse than a transient over-admit. Concretely:

- `countSlots` returns `0` on any `readdir` error.
- `reserveSlot` returns `{ ok: true, slotPath: null }` on any `mkdir` / `write`
  / `readdir` error, after a `console.error` warning. A null `slotPath` flows
  through `releaseSlot` harmlessly.
- `readGlobalCap` returns `DEFAULT_CAP` on any read or parse error.

This matches the pervasive fail-safe discipline in `marker.ts`. The cap is a
best-effort safety valve, never a hard gate that a filesystem hiccup can use to
wedge the machine.

---

## §9 — Tests

Unit tests live in `test/global-concurrency-cap.test.mjs`, in the repo style:
`.mjs`, `node:assert/strict`, a local `test(name, fn)` runner, importing the
BUILT `../dist/concurrency.js`. Helpers `tmpFile(content?)` and `tmpDir()` use
`node:os` tmpdir + `randomUUID`. Every function is exercised against a
throwaway temp dir/file with no real process spawn. Add
`node test/global-concurrency-cap.test.mjs` to the `package.json` `test` chain.

Cases:

- **Clamp table (pure, no FS).** `clampCap(1)===10`, `(5)===10`, `(9)===10`
  (1–9 → 10); `(10)===10`, `(20)===20`, `(25)===25` (≥10 passthrough);
  `(0)===20`, `(-3)===20`, `(undefined)===20`, `(null)===20`, `(3.5)===20`,
  `(NaN)===20`, `("20")===20` (0 / unset / negative / float / NaN / string →
  20).
- **Template parses → 20.** `parseConcurrencyConfig(<verbatim §5 template>)
  ===20`; a commented file with value `4` → `10`; a missing key → `20`;
  malformed JSON → `20`.
- **Reject at cap.** Pre-seed a temp dir with `cap` fake `slot-*.json` files →
  `reserveSlot(cap, {}, tmp).ok===false`, `.current===cap`, and the file count
  is unchanged (rollback verified).
- **Reserve under cap succeeds.** Seed `cap-1` files →
  `reserveSlot(cap, {}, tmp).ok===true`, a new `slot-*.json` appears, and
  `countSlots(tmp)===cap`.
- **Release drops count and is idempotent.** `releaseSlot` the new path → the
  count drops by 1; calling `releaseSlot` twice or on a nonexistent path never
  throws.
