/**
 * orchestration-hook-core.test.mjs — Unit tests for the provider-agnostic hook
 * core (dist/orchestration/hook-core.js).
 *
 * Covers the cadence + gating contract that the whole feature rests on:
 *   - OFF (no marker) -> per-prompt reminder cadence: LONG OFF-variant block on
 *     every REMINDER_PERIOD-th prompt, one-line rule carrier between (the hook now
 *     emits in BOTH marker states).
 *   - unclaimed marker -> FULL + ON reminder block AND baseline written; the
 *     reminder counter re-baselines so the claim turn is a LONG turn.
 *   - ON cadence: 4 rule-carrier prompts after a LONG turn, then the LONG ON block.
 *   - persistence/carryover: FRESH (owner null) -> FULL + ON reminder only;
 *     CARRYOVER (foreign owner) -> carryover notice prepended + re-claim;
 *     SAME-SESSION (owner === current) -> reminder cadence; notice fires once.
 *   - session change resets the reminder counter (per-session cadence).
 *   - subagent adapter -> '' AND the counter does not advance.
 *   - missing directive file -> '' for that asset (fail-safe read).
 *
 * Directive contents are controlled via PLUGIN_ROOT pointing at a temp
 * directives dir, so the test does not depend on the real (separately owned)
 * repo directives/ assets. A synthetic adapter injects isSubagent/currentTurn
 * deterministically (no real transcript parsing here — that lives in the
 * adapters test).
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANON_CLAIM_TTL_MS,
  cullHookZombies,
  ownerKey,
  resolveDirectivesDir,
  runHook,
  REMINDER_PERIOD,
  sessionKey,
} from "../dist/orchestration/hook-core.js";
import {
  markerPath,
  isActive,
  readMarker,
  removeEnable,
  removeDisable,
  writeEnable,
  writeDisable,
  writeMarker,
  anonKey,
} from "../dist/orchestration/marker.js";
import {
  advance,
  rebase,
  readReminder,
  reminderPath,
} from "../dist/orchestration/reminder.js";
import { clearLatch } from "../dist/orchestration/latch.js";
import { readMetering } from "../dist/orchestration/metering.js";
import {
  clearHandoff,
  markRead,
  writeHandoff,
} from "../dist/orchestration/handoff.js";
import {
  drainZombieReports,
  slotPathForAgent,
  writeSlotMetadata,
  ZOMBIE_LIVE_IDLE_MS,
} from "../dist/zombie.js";
import { slotDir as currentSlotDir } from "../dist/concurrency.js";

const ORIGINAL_SUBAGENT_SLOT_DIR = process.env.SUBAGENT_SLOT_DIR;
const TEST_SUBAGENT_SLOT_DIR = mkdtempSync(join(tmpdir(), "orch-hook-default-slots-"));
process.env.SUBAGENT_SLOT_DIR = TEST_SUBAGENT_SLOT_DIR;
process.on("exit", () => {
  if (ORIGINAL_SUBAGENT_SLOT_DIR === undefined) delete process.env.SUBAGENT_SLOT_DIR;
  else process.env.SUBAGENT_SLOT_DIR = ORIGINAL_SUBAGENT_SLOT_DIR;
  rmSync(TEST_SUBAGENT_SLOT_DIR, { recursive: true, force: true });
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

const FULL_TEXT = "FULL-DIRECTIVE-BODY";
const SHORT_ON_TEXT = "SHORT-ON-RULE-CARRIER";
const SHORT_OFF_TEXT = "SHORT-OFF-RULE-CARRIER";
const CARRYOVER_TEXT = "CARRYOVER-NOTICE-BODY";
const REM_ON_TEXT = "REMINDER-ON-BLOCK";
const REM_OFF_TEXT = "REMINDER-OFF-BLOCK";
const LATCH_TEXT = "LATCH-COACH-BODY";
const HANDOFF_TEXT = "HANDOFF-WINDDOWN-BODY";

// Build a temp directives dir and an env that points the resolver at it.
function makeDirectivesEnv({
  withFull = true,
  withShortOn = true,
  withShortOff = true,
  withCarryover = true,
  withReminderOn = true,
  withReminderOff = true,
  withLatch = true,
  withHandoff = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "orch-root-"));
  const dir = join(root, "directives");
  mkdirSync(dir, { recursive: true });
  if (withFull) writeFileSync(join(dir, "full.md"), FULL_TEXT, "utf8");
  if (withShortOn) writeFileSync(join(dir, "short-on.md"), SHORT_ON_TEXT, "utf8");
  if (withShortOff) writeFileSync(join(dir, "short-off.md"), SHORT_OFF_TEXT, "utf8");
  if (withCarryover) writeFileSync(join(dir, "carryover.md"), CARRYOVER_TEXT, "utf8");
  if (withReminderOn) writeFileSync(join(dir, "rem-on.md"), REM_ON_TEXT, "utf8");
  if (withReminderOff) writeFileSync(join(dir, "rem-off.md"), REM_OFF_TEXT, "utf8");
  if (withLatch) writeFileSync(join(dir, "latch-test.md"), LATCH_TEXT, "utf8");
  if (withHandoff) writeFileSync(join(dir, "handoff-test.md"), HANDOFF_TEXT, "utf8");
  // Mark the temp plugin root trusted by pointing the install-prefix allowlist
  // (npm_config_prefix) at it; the resolver's trust gate then accepts it.
  return { root, env: { PLUGIN_ROOT: root, npm_config_prefix: root } };
}

// Synthetic adapter with injectable subagent/turn behavior.
function makeAdapter({ subagent = false, turn = 0, liftUsage = () => null } = {}) {
  return {
    isSubagent: () => subagent,
    currentTurn: () => turn,
    liftUsage,
    anonScope: "test",
    fullDirectiveFile: "full.md",
    shortOnFile: "short-on.md",
    shortOffFile: "short-off.md",
    carryoverDirectiveFile: "carryover.md",
    reminderOnFile: "rem-on.md",
    reminderOffFile: "rem-off.md",
  };
}

// A unique temp cwd per test keeps marker AND reminder state isolated.
function makeCwd() {
  return mkdtempSync(join(tmpdir(), "orch-hc-cwd-"));
}

function writeFreshMarker(cwd) {
  writeMarker(cwd, {
    owner_session: null,
    baseline_turn: null,
    claimed_at: null,
    owners: {},
    provenance: "user-enabled",
    carryover_ack: false,
  });
}

function cleanup(cwd, root) {
  rmSync(markerPath(cwd), { force: true });
  rmSync(reminderPath(cwd), { force: true });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

function withSlotDir(fn) {
  const previous = process.env.SUBAGENT_SLOT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "orch-hook-slots-"));
  process.env.SUBAGENT_SLOT_DIR = dir;
  try {
    const userDir = currentSlotDir();
    mkdirSync(userDir, { recursive: true });
    return fn(userDir);
  } finally {
    if (previous === undefined) delete process.env.SUBAGENT_SLOT_DIR;
    else process.env.SUBAGENT_SLOT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertTagged(out, {
  state,
  kind,
  phase = "normal",
  utilization = "unknown",
  body,
  remaining = null,
}) {
  assert.match(out, new RegExp(`^<subagent-mcp state="${state}" kind="${kind}" phase="${phase}" utilization="${utilization}">\\n`));
  assert.ok(out.includes(`\n${body}\n</subagent-mcp>`), `body must include ${JSON.stringify(body)}`);
  if (remaining === null) {
    assert.doesNotMatch(out, /Remaining Context=/);
  } else {
    assert.ok(out.endsWith(`Remaining Context=${remaining}%`));
  }
}

// ---------------------------------------------------------------------------
// OFF: no marker -> per-prompt reminder cadence (the hook emits in BOTH modes)
// ---------------------------------------------------------------------------
test("OFF: prompts 1-4 -> rule carrier, prompt 5 -> LONG OFF block, 6 -> rule carrier, 10 -> LONG", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-off:${cwd}`;
  try {
    assert.equal(isActive(cwd, session), false, "fresh keyed sessions are OFF by default");
    writeDisable(session);
    assert.equal(isActive(cwd, session), false, "precondition: session disabled");
    const adapter = makeAdapter();
    const payload = { cwd, session_id: session, transcript_path: undefined };
    for (let prompt = 1; prompt <= 10; prompt++) {
      const out = runHook(payload, env, adapter);
      if (prompt % REMINDER_PERIOD === 0) {
        assertTagged(out, { state: "off", kind: "reminder", body: REM_OFF_TEXT });
      } else {
        assertTagged(out, { state: "off", kind: "carrier", body: SHORT_OFF_TEXT });
      }
    }
    assert.equal(readReminder(cwd).counts[session], 10, "counter persisted across prompts");
  } finally {
    removeDisable(session);
    cleanup(cwd, root);
  }
});

// WHY (Rule 9): counts are PER OWNER so two interleaved sessions in one cwd
// each keep their own cadence — a shared counter that resets on owner change
// would NEVER reach the LONG block under strict A,B,A,B alternation, leaving
// every prompt stuck on the compact carrier without a LONG refresh.
test("OFF: interleaved sessions each keep their own cadence (LONG on each 5th)", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const sessions = [`s-A:${cwd}`, `s-B:${cwd}`];
  try {
    const adapter = makeAdapter();
    for (const session of sessions) {
      writeDisable(session);
      assert.equal(isActive(cwd, session), false, `${session} precondition: session disabled`);
    }
    for (let round = 1; round <= 5; round++) {
      for (const session of sessions) {
        const out = runHook({ cwd, session_id: session, transcript_path: undefined }, env, adapter);
        if (round === 5) {
          assertTagged(out, { state: "off", kind: "reminder", body: REM_OFF_TEXT });
        } else {
          assertTagged(out, { state: "off", kind: "carrier", body: SHORT_OFF_TEXT });
        }
      }
    }
    const counts = readReminder(cwd).counts;
    assert.equal(counts[sessions[0]], 5, "session A keeps its own count");
    assert.equal(counts[sessions[1]], 5, "session B keeps its own count");
  } finally {
    for (const session of sessions) removeDisable(session);
    cleanup(cwd, root);
  }
});

test("OFF: a new session starts its own count without disturbing others", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const sessionA = `s-A:${cwd}`;
  const sessionB = `s-B:${cwd}`;
  try {
    const adapter = makeAdapter();
    writeDisable(sessionA);
    writeDisable(sessionB);
    assert.equal(isActive(cwd, sessionA), false, "session A precondition: disabled");
    assert.equal(isActive(cwd, sessionB), false, "session B precondition: disabled");
    for (let prompt = 1; prompt <= 3; prompt++) {
      runHook({ cwd, session_id: sessionA, transcript_path: undefined }, env, adapter);
    }
    assert.equal(readReminder(cwd).counts[sessionA], 3);
    const out = runHook({ cwd, session_id: sessionB, transcript_path: undefined }, env, adapter);
    assertTagged(out, { state: "off", kind: "carrier", body: SHORT_OFF_TEXT });
    const counts = readReminder(cwd).counts;
    assert.equal(counts[sessionB], 1, "a new session starts its own count at 1");
    assert.equal(counts[sessionA], 3, "the other session's count is untouched");
  } finally {
    removeDisable(sessionA);
    removeDisable(sessionB);
    cleanup(cwd, root);
  }
});

test("reminder owner cap evicts one prior owner, not the whole counts map", () => {
  const cwd = makeCwd();
  try {
    for (let i = 0; i < 8; i++) {
      const r = advance(cwd, `owner-${i}`);
      assert.equal(r.persisted, true);
    }
    let counts = readReminder(cwd).counts;
    assert.equal(Object.keys(counts).length, 8, "precondition: cap is full");

    const added = advance(cwd, "owner-8");
    assert.equal(added.persisted, true);
    counts = readReminder(cwd).counts;
    assert.equal(Object.keys(counts).length, 8, "overflow keeps the map capped");
    assert.equal(counts["owner-0"], undefined, "one prior owner is evicted");
    assert.equal(counts["owner-1"], 1, "other prior owners are preserved");
    assert.equal(counts["owner-8"], 1, "new owner is counted");

    rebase(cwd, "owner-9", 0);
    counts = readReminder(cwd).counts;
    assert.equal(Object.keys(counts).length, 8, "rebase overflow also keeps the map capped");
    assert.equal(counts["owner-9"], 0, "rebased owner is retained");
    assert.equal(counts["owner-1"], undefined, "rebase evicts one additional prior owner");
    assert.equal(counts["owner-8"], 1, "unrelated owners are not wiped");
  } finally {
    rmSync(reminderPath(cwd), { force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unclaimed marker -> FULL + ON reminder + baseline written + counter re-based
// ---------------------------------------------------------------------------
test("unclaimed marker -> FULL + ON reminder block AND baseline written", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeEnable("sess-X");
    const before = readMarker(cwd);
    assert.equal(before.baseline_turn, null, "precondition: unclaimed");

    const out = runHook(
      { cwd, session_id: "sess-X", transcript_path: undefined },
      env,
      makeAdapter({ turn: 4 })
    );
    assertTagged(out, {
      state: "on",
      kind: "directive",
      body: `${FULL_TEXT}\n${REM_ON_TEXT}`,
    });

    const after = readMarker(cwd);
    assert.equal(after.baseline_turn, 4, "baseline is stamped at the current turn");
    assert.equal(after.owner_session, "sess-X", "owner_session is claimed from payload");
    assert.equal(readReminder(cwd).counts["sess-X"], 0,
      "the claim turn re-baselines the session's reminder count to 0 (claim IS a LONG turn)");
  } finally {
    removeEnable("sess-X");
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// ON cadence: 4 rule-carrier prompts after the claim, then the LONG ON block
// ---------------------------------------------------------------------------
test("ON cadence: claim -> 4 rule carriers -> LONG ON block on the 5th prompt after", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeEnable("s");
    const adapter = makeAdapter({ turn: 10 });
    const payload = { cwd, session_id: "s", transcript_path: undefined };

    const claim = runHook(payload, env, adapter);
    assertTagged(claim, { state: "on", kind: "directive", body: `${FULL_TEXT}\n${REM_ON_TEXT}` });

    for (let i = 1; i <= 4; i++) {
      const out = runHook(payload, env, adapter);
      assertTagged(out, { state: "on", kind: "carrier", body: SHORT_ON_TEXT });
    }
    const fifth = runHook(payload, env, adapter);
    assertTagged(fifth, { state: "on", kind: "reminder", body: REM_ON_TEXT });
    assert.equal(readMarker(cwd).baseline_turn, 10,
      "same-session prompts never re-baseline the marker");
  } finally {
    removeEnable("s");
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Persistence + session-start carryover (owner_session classification)
//
// WHY (Rule 9): the marker PERSISTS across sessions, so the SAME active marker
// can be seen by the session that enabled it (FRESH/SAME) or by a later session
// that inherited it (CARRYOVER). Misclassifying CARRYOVER would either drop the
// one-time notify/confirm notice or replay it every turn. These encode that the
// notice fires exactly once, on re-claim, for a foreign owner only.
// ---------------------------------------------------------------------------
test("FRESH (owner_session null) -> FULL + ON reminder, no carryover, claims current", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeEnable("sess-now");
    const out = runHook(
      { cwd, session_id: "sess-now", transcript_path: undefined },
      env,
      makeAdapter({ turn: 2 })
    );
    assertTagged(out, { state: "on", kind: "directive", body: `${FULL_TEXT}\n${REM_ON_TEXT}` });
    assert.ok(!out.includes(CARRYOVER_TEXT), "FRESH must NOT prepend the carryover notice");
    const after = readMarker(cwd);
    assert.equal(after.owner_session, "sess-now", "FRESH claims the current session");
    assert.equal(after.baseline_turn, 2, "FRESH baselines at the current turn");
  } finally {
    removeEnable("sess-now");
    cleanup(cwd, root);
  }
});

test("CARRYOVER (owner !== current) -> notice + FULL + ON reminder, re-claims current", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeEnable("current-session");
    // Simulate a marker left ON by a PRIOR session.
    writeMarker(cwd, { owner_session: "prev-session", baseline_turn: 99 });

    const out = runHook(
      { cwd, session_id: "current-session", transcript_path: undefined },
      env,
      makeAdapter({ turn: 4 })
    );
    assertTagged(out, {
      state: "on",
      kind: "carryover",
      body: `${CARRYOVER_TEXT}\n${FULL_TEXT}\n${REM_ON_TEXT}`,
    });

    const after = readMarker(cwd);
    assert.equal(after.owner_session, "current-session",
      "CARRYOVER re-claims the marker for the current session");
    assert.equal(after.baseline_turn, 4,
      "CARRYOVER re-baselines at the current turn (notice fires once)");
  } finally {
    removeEnable("current-session");
    cleanup(cwd, root);
  }
});

test("CARRYOVER then next same-session turn -> rule carrier, no repeat notice", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeEnable("S");
    writeMarker(cwd, { owner_session: "prev", baseline_turn: 50 });

    // Turn 7: carryover re-claim + re-baseline at 7.
    const first = runHook({ cwd, session_id: "S", transcript_path: undefined }, env,
      makeAdapter({ turn: 7 }));
    assert.ok(first.includes(CARRYOVER_TEXT), "first foreign-owner turn carries over");

    // Next prompt: same-session -> rule carrier, NO carryover repeat.
    const second = runHook({ cwd, session_id: "S", transcript_path: undefined }, env,
      makeAdapter({ turn: 8 }));
    assertTagged(second, { state: "on", kind: "carrier", body: SHORT_ON_TEXT });
    assert.ok(!second.includes(CARRYOVER_TEXT), "the carryover notice fires exactly once");
  } finally {
    removeEnable("S");
    cleanup(cwd, root);
  }
});

test("keyless payload resolves to anonymous owner and converges within TTL", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeMarker(cwd, { owner_session: "prev", baseline_turn: 12 });
    const owner = anonKey(cwd, "test");
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ turn: 3 }));
    assert.ok(out.includes(CARRYOVER_TEXT),
      "a real prior owner and new anonymous owner is carryover once");
    assert.equal(readMarker(cwd).owner_session, owner);
    assert.equal(readReminder(cwd).counts[owner], 0);
    assertTagged(
      runHook({ cwd, transcript_path: undefined }, env, makeAdapter({ turn: 4 })),
      { state: "on", kind: "carrier", body: SHORT_ON_TEXT }
    );
  } finally {
    cleanup(cwd, root);
  }
});

test("identity ladder is total: session_id > transcript_path > anon", () => {
  const cwd = makeCwd();
  try {
    const adapter = makeAdapter();
    assert.equal(
      ownerKey({ cwd, session_id: "s1", transcript_path: "t1" }, cwd, adapter),
      "s1"
    );
    assert.match(
      ownerKey({ cwd, session_id: "", transcript_path: "C:/tmp/transcript.jsonl" }, cwd, adapter),
      /^tp-[0-9a-f]{16}$/
    );
    assert.equal(ownerKey({ cwd }, cwd, adapter), anonKey(cwd, "test"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("transcript_path fallback normalizes slash and case variants before hashing", () => {
  const cwd = makeCwd();
  try {
    const adapter = makeAdapter();
    const lower = "C:/tmp/subagent/transcript.jsonl";
    const slashVariant = "C:\\tmp\\subagent\\transcript.jsonl";
    const caseVariant = "c:/TMP/subagent/TRANSCRIPT.jsonl";

    // Slash normalization is platform-independent: backslashes collapse to
    // forward slashes on every OS, so these must always hash equal.
    assert.equal(sessionKey({ transcript_path: lower }), sessionKey({ transcript_path: slashVariant }));
    // Case-insensitive normalization applies only on Windows, where the
    // filesystem is case-insensitive. POSIX paths are case-sensitive, so the
    // production code (correctly) lowercases only on win32 and the case variant
    // must hash differently there.
    if (process.platform === "win32") {
      assert.equal(sessionKey({ transcript_path: lower }), sessionKey({ transcript_path: caseVariant }));
    } else {
      assert.notEqual(sessionKey({ transcript_path: lower }), sessionKey({ transcript_path: caseVariant }));
    }
    assert.equal(
      ownerKey({ cwd, session_id: "host-session", transcript_path: caseVariant }, cwd, adapter),
      "host-session",
      "host session_id remains preferred over transcript_path fallback"
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("anonymous owner claim re-anchors after TTL and then returns to cadence", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    const owner = anonKey(cwd, "test");
    writeMarker(cwd, {
      owner_session: owner,
      baseline_turn: 1,
      claimed_at: Date.now() - ANON_CLAIM_TTL_MS - 1,
      owners: {
        [owner]: {
          baseline_turn: 1,
          claimed_at: Date.now() - ANON_CLAIM_TTL_MS - 1,
        },
      },
      provenance: null,
      carryover_ack: false,
    });
    const out = runHook({ cwd, transcript_path: undefined }, env, makeAdapter({ turn: 2 }));
    assertTagged(out, { state: "on", kind: "directive", body: `${FULL_TEXT}\n${REM_ON_TEXT}` });
    assert.equal(readMarker(cwd).owner_session, owner);
    assertTagged(
      runHook({ cwd, transcript_path: undefined }, env, makeAdapter({ turn: 3 })),
      { state: "on", kind: "carrier", body: SHORT_ON_TEXT }
    );
  } finally {
    cleanup(cwd, root);
  }
});

test("owners map prevents alternating keyed sessions from FULL-thrashing", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeEnable("A");
    writeEnable("B");
    const adapter = makeAdapter({ turn: 0 });
    const firstA = runHook({ cwd, session_id: "A" }, env, adapter);
    const firstB = runHook({ cwd, session_id: "B" }, env, adapter);
    assertTagged(firstA, { state: "on", kind: "directive", body: `${FULL_TEXT}\n${REM_ON_TEXT}` });
    assertTagged(firstB, {
      state: "on",
      kind: "carryover",
      body: `${CARRYOVER_TEXT}\n${FULL_TEXT}\n${REM_ON_TEXT}`,
    });
    for (let i = 0; i < 4; i++) {
      assertTagged(runHook({ cwd, session_id: "A" }, env, adapter), { state: "on", kind: "carrier", body: SHORT_ON_TEXT });
      assertTagged(runHook({ cwd, session_id: "B" }, env, adapter), { state: "on", kind: "carrier", body: SHORT_ON_TEXT });
    }
    assertTagged(runHook({ cwd, session_id: "A" }, env, adapter), { state: "on", kind: "reminder", body: REM_ON_TEXT });
    assertTagged(runHook({ cwd, session_id: "B" }, env, adapter), { state: "on", kind: "reminder", body: REM_ON_TEXT });
  } finally {
    removeEnable("A");
    removeEnable("B");
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Subagent -> emit nothing, counter untouched
// ---------------------------------------------------------------------------
test("subagent adapter -> '' AND the reminder counter does not advance", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeFreshMarker(cwd);
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ subagent: true, turn: 0 }));
    assert.equal(out, "", "subagent sessions emit nothing even when active");
    // And neither marker nor counter may have been touched by a subagent turn.
    assert.equal(readMarker(cwd).baseline_turn, null,
      "subagent suppression happens before any marker claim");
    assert.equal(Object.keys(readReminder(cwd).counts).length, 0,
      "subagent prompts never advance the reminder counter");
  } finally {
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Missing directive file -> '' for that asset (fail-safe)
// ---------------------------------------------------------------------------
test("missing directive files -> '' (fail-safe read, never throws)", () => {
  const cwd = makeCwd();
  // Directives dir exists but FULL and the ON reminder are absent.
  const { root, env } = makeDirectivesEnv({ withFull: false, withReminderOn: false });
  try {
    writeFreshMarker(cwd);
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ turn: 0 }));
    assert.equal(out, "", "unreadable directives yield '' rather than throwing");
    assert.equal(readMarker(cwd).baseline_turn, null,
      "claim state is not mutated before a readable directive body exists");
    assert.equal(Object.keys(readReminder(cwd).counts).length, 0,
      "claim failure does not re-baseline the reminder counter");
  } finally {
    cleanup(cwd, root);
  }
});

test("invalid directives root -> '' from runHook instead of escaping readDirective", () => {
  const cwd = makeCwd();
  // A trusted plugin root (npm_config_prefix marks it under the install
  // allowlist) whose directives dir exists but is empty: every directive read
  // fail-safes to '' without the resolver escaping or claiming the marker.
  const badRoot = mkdtempSync(join(tmpdir(), "orch-root-empty-directives-"));
  mkdirSync(join(badRoot, "directives"), { recursive: true });
  try {
    writeFreshMarker(cwd);
    const out = runHook(
      { cwd, session_id: "sess-bad-root", transcript_path: undefined },
      { PLUGIN_ROOT: badRoot, npm_config_prefix: badRoot },
      makeAdapter({ turn: 0 })
    );
    assert.equal(out, "", "resolver errors are contained by readDirective");
    assert.equal(readMarker(cwd).baseline_turn, null,
      "failed directive resolution does not claim the marker");
  } finally {
    cleanup(cwd, badRoot);
  }
});

test("env directives root outside trusted install prefixes is rejected by falling back", () => {
  const outsideRoot = mkdtempSync(join(tmpdir(), "orch-untrusted-root-"));
  const outsideDirectives = join(outsideRoot, "directives");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  mkdirSync(outsideDirectives, { recursive: true });
  try {
    assert.equal(
      resolveDirectivesDir({ PLUGIN_ROOT: outsideRoot }),
      join(repoRoot, "directives")
    );
  } finally {
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("env directives root under npm prefix is accepted", () => {
  const prefix = mkdtempSync(join(tmpdir(), "orch-trusted-prefix-"));
  const pluginRoot = join(prefix, "node_modules", "@heretyc", "subagent-mcp");
  const directivesDir = join(pluginRoot, "directives");
  mkdirSync(directivesDir, { recursive: true });
  try {
    assert.equal(
      resolveDirectivesDir({ PLUGIN_ROOT: pluginRoot, npm_config_prefix: prefix }),
      directivesDir
    );
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("missing OFF reminder asset -> '' on the LONG OFF prompt (fail-safe)", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv({ withReminderOff: false });
  const session = `s-missing-off:${cwd}`;
  try {
    const adapter = makeAdapter();
    writeDisable(session);
    assert.equal(isActive(cwd, session), false, "precondition: session disabled");
    const payload = { cwd, session_id: session, transcript_path: undefined };
    for (let prompt = 1; prompt <= 4; prompt++) {
      assertTagged(runHook(payload, env, adapter), { state: "off", kind: "carrier", body: SHORT_OFF_TEXT });
    }
    assert.equal(runHook(payload, env, adapter), "",
      "a missing LONG asset degrades to '' on its turn, never a throw");
  } finally {
    removeDisable(session);
    cleanup(cwd, root);
  }
});

test("hook culls stale slots silently and preserves server report", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-hook-zombie:${cwd}`;
  try {
    withSlotDir((slotDir) => {
      const agentId = "agent-hook";
      writeSlotMetadata(slotPathForAgent(slotDir, agentId), {
        agent_id: agentId,
        server_pid: 123,
        child_pid: process.pid,
        last_activity_ms: Date.now() - ZOMBIE_LIVE_IDLE_MS - 1000,
        status: "processing",
      });
      writeDisable(session);
      const payload = { cwd, session_id: session, transcript_path: undefined };
      const first = runHook(payload, env, makeAdapter());
      assert.match(first, /SHORT-OFF-RULE-CARRIER/);
      assert.doesNotMatch(first, /zombies: agent-hook/);

      const second = runHook(payload, env, makeAdapter());
      assert.doesNotMatch(second, /zombies: agent-hook/,
        "a second hook with no stale slot must not duplicate the hook report");

      const reports = drainZombieReports(slotDir);
      assert.equal(reports.length, 1,
        "hook must leave the server-side report for the next MCP response");
      assert.equal(reports[0].agent_id, agentId);
    });
  } finally {
    removeDisable(session);
    cleanup(cwd, root);
  }
});

test("hook culler blocks through force-after-grace instead of unref scheduling", () => {
  withSlotDir((slotDir) => {
    const now = 10_000_000;
    const calls = [];
    const sleeps = [];
    const agentId = "agent-hook-blocking";
    writeSlotMetadata(slotPathForAgent(slotDir, agentId), {
      agent_id: agentId,
      server_pid: 123,
      child_pid: 424242,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      status: "processing",
    });
    const records = cullHookZombies({
      now: () => now,
      platform: "win32",
      forceGraceMs: () => 7,
      runCommand: (command, args) => calls.push({ command, args }),
      sleepMs: (ms) => sleeps.push(ms),
      isProcessAlive: (pid) => pid !== 123,
      isSubagentChildProcess: () => true,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].agent_id, agentId);
    assert.deepEqual(sleeps, [7]);
    assert.deepEqual(calls, [
      { command: "taskkill", args: ["/PID", "424242", "/T"] },
      { command: "taskkill", args: ["/PID", "424242", "/T", "/F"] },
    ]);
  });
});

test("metering lift at turn >=2 renders plan utilization and trips latch at exactly 15%", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-meter-plan:${cwd}`;
  const adapter = makeAdapter({
    turn: 2,
    liftUsage: () => ({
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: "synthetic-transcript",
      usage: {
        input: 30000,
        output: 0,
        cache_creation: 0,
        cache_read: 0,
      },
      harnessPercentage: null,
    }),
  });
  try {
    const out = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(out, {
      state: "on",
      kind: "directive",
      phase: "plan",
      utilization: "15%",
      body: LATCH_TEXT,
      remaining: 85,
    });
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
  }
});

test("plan latch persists but the one-time latch coaching body does not re-fire", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-meter-latch-steady:${cwd}`;
  const adapter = makeAdapter({
    turn: 2,
    liftUsage: () => ({
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: "synthetic-transcript",
      usage: { input: 30000, output: 0, cache_creation: 0, cache_read: 0 },
      harnessPercentage: null,
    }),
  });
  try {
    const first = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assert.ok(first.includes(LATCH_TEXT), "precondition: first plan turn coaches once");
    const second = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(second, {
      state: "on",
      kind: "carrier",
      phase: "plan",
      utilization: "15%",
      body: SHORT_ON_TEXT,
      remaining: 85,
    });
    assert.ok(!second.includes(LATCH_TEXT), "steady-state plan turns do not re-fire latch coaching");
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
  }
});

test("handoff phase appends handoff body on both short and long cadence turns", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-meter-handoff:${cwd}`;
  const adapter = makeAdapter({
    turn: 2,
    liftUsage: () => ({
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: "synthetic-transcript",
      usage: { input: 100000, output: 0, cache_creation: 0, cache_read: 0 },
      harnessPercentage: null,
    }),
  });
  try {
    const claim = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assert.ok(claim.includes(HANDOFF_TEXT), "handoff claim turn includes wind-down body");
    const short = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(short, {
      state: "on",
      kind: "carrier",
      phase: "handoff",
      utilization: "50%",
      body: `${SHORT_ON_TEXT}\n${HANDOFF_TEXT}`,
      remaining: 50,
    });
    for (let i = 0; i < 3; i++) {
      runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    }
    const long = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(long, {
      state: "on",
      kind: "reminder",
      phase: "handoff",
      utilization: "50%",
      body: `${REM_ON_TEXT}\n${HANDOFF_TEXT}`,
      remaining: 50,
    });
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
  }
});

test("metering-undetectable fail-safe does not override an explicit session disable", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-meter-undetectable-disabled:${cwd}`;
  const adapter = makeAdapter({
    turn: 2,
    liftUsage: () => null,
  });
  try {
    writeDisable(session);
    const out = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(out, {
      state: "off",
      kind: "carrier",
      phase: "normal",
      utilization: "unknown",
      body: SHORT_OFF_TEXT,
    });
  } finally {
    removeDisable(session);
    clearLatch(session);
    cleanup(cwd, root);
  }
});

test("metering contradiction writes clamped numeric record", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-meter-contradiction:${cwd}`;
  const adapter = makeAdapter({
    turn: 2,
    liftUsage: () => ({
      harness: "claude",
      model: "claude-haiku-4-5",
      source_ref: "synthetic-transcript",
      usage: { input: 250000, output: 1, cache_creation: 0, cache_read: 0 },
      harnessPercentage: null,
      longContextHint: true,
    }),
  });
  try {
    const out = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(out, {
      state: "on",
      kind: "directive",
      phase: "handoff",
      utilization: "100%",
      body: `${FULL_TEXT}\n${REM_ON_TEXT}\n${HANDOFF_TEXT}`,
      remaining: 0,
    });
    const record = readMetering(session);
    assert.equal(record?.context_window_size, 200000);
    assert.equal(record?.used_percentage, 100);
    assert.equal(record?.window_source, "contradiction");
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Template-error fail-safe (mission item 5 / S37): if composeTag throws while
// building the tag, the ENTIRE turn's injection is suppressed (inject nothing),
// never a partial/malformed tag. The SUBAGENT_MCP_TEST_TAG_TEMPLATE seam forces
// composeTag to render a malformed (unresolved-placeholder) template so the
// throw path is reachable from runHook's public surface.
// ---------------------------------------------------------------------------
test("template error while composing the tag -> '' (inject nothing, never a partial tag)", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-tag-throw:${cwd}`;
  try {
    writeEnable(session);
    // A template carrying a placeholder that hook-core never supplies makes
    // renderTemplate throw inside composeTag -> runHook's fail-safe returns ''.
    process.env.SUBAGENT_MCP_TEST_TAG_TEMPLATE = '<subagent-mcp {{unresolved}}>';
    const out = runHook(
      { cwd, session_id: session, transcript_path: undefined },
      env,
      makeAdapter({ turn: 0 })
    );
    assert.equal(out, "", "a throwing tag template suppresses the whole injection");
  } finally {
    delete process.env.SUBAGENT_MCP_TEST_TAG_TEMPLATE;
    removeEnable(session);
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Reader-session handoff re-append fires on EVERY LONG reminder, including the
// OFF cadence (spec: every LONG reminder for the reading session, not just ON).
// ---------------------------------------------------------------------------
test("reader session re-appends handoff content on OFF-cadence LONG reminders", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-off-reader:${cwd}`;
  const HANDOFF_SAVED = "HANDOFF-SAVED-CONTENT";
  try {
    // OFF session (no enable/latch/metering) that has already read a handoff.
    writeHandoff(cwd, { content: HANDOFF_SAVED, createdBySession: "prev" });
    markRead(cwd, session);
    const adapter = makeAdapter();
    const payload = { cwd, session_id: session, transcript_path: undefined };
    let longOut = "";
    for (let prompt = 1; prompt <= REMINDER_PERIOD; prompt++) {
      const out = runHook(payload, env, adapter);
      if (prompt < REMINDER_PERIOD) {
        assert.ok(
          !out.includes(HANDOFF_SAVED),
          "carrier (non-LONG) OFF turns do not re-append handoff content"
        );
      } else {
        longOut = out;
      }
    }
    assertTagged(longOut, {
      state: "off",
      kind: "reminder",
      body: `${REM_OFF_TEXT}\n${HANDOFF_SAVED}`,
    });
  } finally {
    clearHandoff(cwd);
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// carryover_ack must burn ONLY on the turn the CARRYOVER notice actually emits,
// even when a just-tripped latch also selects a FULL-body override that turn.
// ---------------------------------------------------------------------------
test("carryover + just-tripped latch: notice emits AND carryover_ack burns together", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-carry-latch:${cwd}`;
  try {
    writeEnable(session);
    // Marker left ON by a PRIOR session -> this turn is a CARRYOVER claim.
    writeMarker(cwd, { owner_session: "prev-session", baseline_turn: 99 });
    const adapter = makeAdapter({
      turn: 2,
      liftUsage: () => ({
        harness: "claude",
        model: "claude-sonnet-4-5",
        source_ref: "synthetic",
        usage: { input: 30000, output: 0, cache_creation: 0, cache_read: 0 },
        harnessPercentage: null,
      }),
    });
    const out = runHook(
      { cwd, session_id: session, transcript_path: "synthetic" },
      env,
      adapter
    );
    // Both the carryover notice AND the just-tripped latch body must appear.
    assertTagged(out, {
      state: "on",
      kind: "carryover",
      phase: "plan",
      utilization: "15%",
      body: `${CARRYOVER_TEXT}\n${LATCH_TEXT}`,
      remaining: 85,
    });
    assert.equal(
      readMarker(cwd).carryover_ack,
      true,
      "carryover_ack is set on the turn the notice actually emits"
    );
  } finally {
    removeEnable(session);
    clearLatch(session);
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
