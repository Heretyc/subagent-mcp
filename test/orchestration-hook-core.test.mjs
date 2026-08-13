/**
 * orchestration-hook-core.test.mjs — Unit tests for the provider-agnostic hook
 * core (dist/orchestration/hook-core.js).
 *
 * Covers the cadence + gating contract that the whole feature rests on:
 *   - OFF (no marker) -> per-prompt reminder cadence: LONG OFF-variant block on
 *     every REMINDER_PERIOD-th prompt, one-line rule carrier between (the hook
 *     emits in BOTH marker states).
 *   - unclaimed marker -> FULL + ON reminder block AND baseline written; the
 *     reminder counter re-baselines so the claim turn is a LONG turn.
 *   - ON cadence: 4 rule-carrier prompts after a LONG turn, then the LONG ON block.
 *   - persistence/carryover: FRESH (owner null) -> FULL + ON reminder only;
 *     CARRYOVER (foreign owner) -> carryover notice prepended + re-claim;
 *     SAME-SESSION (owner === current) -> reminder cadence; notice fires once.
 *   - session change resets the reminder counter (per-session cadence).
 *   - subagent adapter -> '' AND the counter does not advance.
 *   - sub-orchestrator (BOTH env markers) -> stateless ON emission decided
 *     before the subagent bail, writing no state at all.
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
  existsSync,
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
  SESSION_HANDOFF_REQUIRED_DIRECTIVE_FILE,
  SUB_ORCHESTRATOR_DIRECTIVE_FILE,
} from "../dist/orchestration/hook-core.js";
import {
  markerPath,
  isActive,
  readCurrentSession,
  readMarker,
  removeEnable,
  removeDisable,
  writeCurrentSession,
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
  readHandoff,
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
const HANDOFF_DIRECTIVE_TEXT = "HANDOFF-DIRECTIVE-BODY";
const SUB_ORCH_TEXT = "SUB-ORCHESTRATOR-ON-BODY";
const LIFECYCLE_TEXT = "SESSION-HANDOFF-READ-BODY";

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
  withSubOrch = true,
  withSessionHandoff = true,
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
  if (withHandoff) {
    writeFileSync(join(dir, "handoff-test.md"), HANDOFF_DIRECTIVE_TEXT, "utf8");
  }
  // The sub-orchestrator and session-handoff-required asset names are fixed in
  // production (provider-neutral), so the fixture writes them under their real
  // names rather than adapter fields.
  if (withSubOrch) {
    writeFileSync(join(dir, SUB_ORCHESTRATOR_DIRECTIVE_FILE), SUB_ORCH_TEXT, "utf8");
  }
  if (withSessionHandoff) {
    writeFileSync(join(dir, SESSION_HANDOFF_REQUIRED_DIRECTIVE_FILE), LIFECYCLE_TEXT, "utf8");
  }
  // Mark the temp plugin root trusted by pointing the install-prefix allowlist
  // (npm_config_prefix) at it; the resolver's trust gate then accepts it.
  return { root, env: { PLUGIN_ROOT: root, npm_config_prefix: root } };
}

// ---------------------------------------------------------------------------
// Coaching-setting seam.
//
// Tests that set contextCoaching redirect the config home to a temp directory.
// ---------------------------------------------------------------------------
const coachingHomes = [];
let savedConfigHome;
let savedConfigHomeSet = false;

function withCoachingSettings(env, settings) {
  const home = mkdtempSync(join(tmpdir(), "orch-coach-home-"));
  coachingHomes.push(home);
  writeFileSync(join(home, "settings.json"), JSON.stringify(settings), "utf8");
  if (!savedConfigHomeSet) {
    savedConfigHome = process.env.SUBAGENT_CONFIG_HOME;
    savedConfigHomeSet = true;
  }
  process.env.SUBAGENT_CONFIG_HOME = home;
  return { ...env, SUBAGENT_CONFIG_HOME: home };
}

function withCoachingOff(env) {
  return withCoachingSettings(env, { contextCoaching: false });
}

function restoreCoaching() {
  if (!savedConfigHomeSet) return;
  if (savedConfigHome === undefined) delete process.env.SUBAGENT_CONFIG_HOME;
  else process.env.SUBAGENT_CONFIG_HOME = savedConfigHome;
  savedConfigHomeSet = false;
}

process.on("exit", () => {
  for (const home of coachingHomes) rmSync(home, { recursive: true, force: true });
});

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
// Sub-orchestrator (BOTH env markers) -> stateless per-turn ON emission.
//
// WHY (Rule 9): a child launched with `sub-orchestrator: true` is a subagent by
// env, so without this branch the isSubagent bail would silently un-govern it.
// It runs in the PARENT orchestrator's cwd, so the branch must decide before the
// bail AND write nothing: one writeCurrentSession here would hand the cwd
// session pointer (orchestration-mode / handoff-*) to the child.
// ---------------------------------------------------------------------------
const SUB_ORCH_ENV = {
  SUBAGENT_MCP_SUBAGENT: "1",
  SUBAGENT_MCP_SUB_ORCHESTRATOR: "1",
};

test("sub-orchestrator env pair -> ON emission tagged kind=sub-orchestrator", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    const out = runHook(
      { cwd, session_id: `sub-orch:${cwd}`, transcript_path: undefined },
      { ...env, ...SUB_ORCH_ENV },
      makeAdapter({ subagent: true, turn: 3 })
    );
    assertTagged(out, { state: "on", kind: "sub-orchestrator", body: SUB_ORCH_TEXT });
  } finally {
    cleanup(cwd, root);
  }
});

test("sub-orchestrator turns are STATELESS: pointer, marker, counter, metering untouched", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const parentSession = `parent-of-sub-orch:${cwd}`;
  const session = `sub-orch-stateless:${cwd}`;
  try {
    // The parent orchestrator owns this cwd's session pointer.
    writeCurrentSession(cwd, parentSession);
    const payload = { cwd, session_id: session, transcript_path: "synthetic" };
    const adapter = makeAdapter({ subagent: true, turn: 9, liftUsage: usageAtPct(80) });
    const first = runHook(payload, { ...env, ...SUB_ORCH_ENV }, adapter);
    const second = runHook(payload, { ...env, ...SUB_ORCH_ENV }, adapter);
    assert.ok(first.includes(SUB_ORCH_TEXT), "precondition: the directive is injected");
    assert.equal(second, first, "the emission is stateless: every turn is identical");
    assert.equal(readCurrentSession(cwd), parentSession,
      "a sub-orchestrator never steals the parent cwd's session pointer");
    assert.equal(existsSync(markerPath(cwd)), false, "no marker is written");
    assert.equal(existsSync(reminderPath(cwd)), false, "the reminder counter never advances");
    assert.equal(readMetering(session) ?? null, null, "no metering record is persisted");
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
  }
});

test("sub-orchestrator emission is provider-agnostic and precedes the subagent bail", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const payload = { cwd, session_id: `sub-orch-both:${cwd}`, transcript_path: undefined };
  const subEnv = { ...env, ...SUB_ORCH_ENV };
  try {
    // Both hook paths share this runHook; the adapters' own isSubagent (true for
    // any child) must not be able to suppress the emission on either provider.
    const claudeLike = { ...makeAdapter({ subagent: true }), anonScope: "claude" };
    const codexLike = { ...makeAdapter({ subagent: true }), anonScope: "codex" };
    const fromClaude = runHook(payload, subEnv, claudeLike);
    const fromCodex = runHook(payload, subEnv, codexLike);
    assertTagged(fromClaude, { state: "on", kind: "sub-orchestrator", body: SUB_ORCH_TEXT });
    assert.equal(fromCodex, fromClaude, "both provider paths emit the same string");
  } finally {
    cleanup(cwd, root);
  }
});

test("plain subagent env (no sub-orchestrator marker) still bails to ''", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    writeFreshMarker(cwd);
    const out = runHook(
      { cwd, session_id: `plain-child:${cwd}`, transcript_path: undefined },
      { ...env, SUBAGENT_MCP_SUBAGENT: "1" },
      makeAdapter({ subagent: true, turn: 0 })
    );
    assert.equal(out, "", "the second marker is required; a plain child stays exempt");
    assert.equal(readMarker(cwd).baseline_turn, null, "no claim happens on a child turn");
  } finally {
    cleanup(cwd, root);
  }
});

test("missing sub-orchestrator asset -> '' (fail-safe: never a hollow tag)", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv({ withSubOrch: false });
  try {
    const out = runHook(
      { cwd, session_id: `sub-orch-missing:${cwd}`, transcript_path: undefined },
      { ...env, ...SUB_ORCH_ENV },
      makeAdapter({ subagent: true, turn: 0 })
    );
    assert.equal(out, "", "an unresolvable directive injects nothing and never throws");
    assert.equal(existsSync(markerPath(cwd)), false, "the fail-safe path writes no state either");
  } finally {
    cleanup(cwd, root);
  }
});

test("the shipped repo directives dir carries the sub-orchestrator asset", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(
    existsSync(join(repoRoot, "directives", SUB_ORCHESTRATOR_DIRECTIVE_FILE)),
    true,
    "an installed layout must resolve the asset the hook reads"
  );
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

// ---------------------------------------------------------------------------
// Context thresholds: voluntary handoff unlock at 20%; mandatory write at 80%.
// ---------------------------------------------------------------------------

// claude-sonnet-4-5 -> 200000-token window, so used_percentage === input / 2000.
// The optional `generation` supplies the provider proof fingerprint; omitted, it
// persists as null so no compaction is ever detected (the default for the
// utilization/coaching cases that do not exercise the detector).
function usageAtPct(pct, generation) {
  return () => ({
    harness: "claude",
    model: "claude-sonnet-4-5",
    source_ref: "synthetic-transcript",
    usage: { input: pct * 2000, output: 0, cache_creation: 0, cache_read: 0 },
    harnessPercentage: null,
    compaction_generation: generation ?? null,
  });
}

test("the 20% unlock reports the handoff phase without the mandatory directive", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-meter-handoff-unlocked:${cwd}`;
  const adapter = makeAdapter({ turn: 2, liftUsage: usageAtPct(20) });
  try {
    const claim = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(claim, {
      state: "on",
      kind: "directive",
      phase: "handoff",
      utilization: "20%",
      body: `${FULL_TEXT}\n${REM_ON_TEXT}`,
      remaining: 80,
    });
    assert.ok(!claim.includes(HANDOFF_DIRECTIVE_TEXT));
    const short = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
    assertTagged(short, {
      state: "on",
      kind: "carrier",
      phase: "handoff",
      utilization: "20%",
      body: SHORT_ON_TEXT,
      remaining: 80,
    });
    assert.ok(!short.includes(HANDOFF_DIRECTIVE_TEXT));
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
  }
});

test("utilization below 80 never emits the mandatory handoff-write directive", () => {
  for (const pct of [20, 50, 60, 79]) {
    const cwd = makeCwd();
    const { root, env } = makeDirectivesEnv();
    const session = `s-no-winddown-${pct}:${cwd}`;
    const adapter = makeAdapter({ turn: 2, liftUsage: usageAtPct(Math.min(pct, 100)) });
    try {
      // Exercise a full cadence cycle so both carrier and LONG reminder turns are covered.
      for (let i = 0; i < REMINDER_PERIOD + 1; i++) {
        const out = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, env, adapter);
        assert.ok(!out.includes(HANDOFF_DIRECTIVE_TEXT),
          `utilization ${pct}% must not require a handoff write`);
      }
    } finally {
      clearLatch(session);
      cleanup(cwd, root);
    }
  }
});

test("runHook derives write_required at 80 and a prepared handoff ends the injection", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-write-required-boundary:${cwd}`;
  let pct = 79;
  const adapter = makeAdapter({ turn: 2, liftUsage: () => usageAtPct(pct)() });
  const payload = { cwd, session_id: session, transcript_path: "synthetic" };
  try {
    assert.ok(!runHook(payload, env, adapter).includes(HANDOFF_DIRECTIVE_TEXT));

    pct = 80;
    assertTagged(runHook(payload, env, adapter), {
      state: "on",
      kind: "lifecycle",
      phase: "handoff",
      utilization: "80%",
      body: `Handoff lifecycle: \`write_required\`.\n${HANDOFF_DIRECTIVE_TEXT}`,
      remaining: 20,
    });

    const prepared = writeHandoff(cwd, {
      content: "PREPARED-HANDOFF",
      createdBySession: session,
      usedPercentage: 80,
    });
    assert.equal(prepared.record.lifecycle, "prepared");
    assert.ok(!runHook(payload, env, adapter).includes(HANDOFF_DIRECTIVE_TEXT));
  } finally {
    clearLatch(session);
    clearHandoff(cwd);
    cleanup(cwd, root);
  }
});

test("write_required injection remains active with contextCoaching:false", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-write-required-coaching-off:${cwd}`;
  const offEnv = withCoachingOff(env);
  try {
    const out = runHook(
      { cwd, session_id: session, transcript_path: "synthetic" },
      offEnv,
      makeAdapter({ turn: 2, liftUsage: usageAtPct(80) })
    );
    assertTagged(out, {
      state: "on",
      kind: "lifecycle",
      phase: "handoff",
      utilization: "80%",
      body: `Handoff lifecycle: \`write_required\`.\n${HANDOFF_DIRECTIVE_TEXT}`,
      remaining: 20,
    });
  } finally {
    clearLatch(session);
    clearHandoff(cwd);
    cleanup(cwd, root);
    restoreCoaching();
  }
});

// ---------------------------------------------------------------------------
// contextCoaching = false: mutes ONLY coaching prose. It must NOT gate the 15%
// latch coaching body, the 20% handoff unlock / handoff phase, or (per the
// mandatory-lifecycle isolation rule) any mandatory lifecycle injection.
// ---------------------------------------------------------------------------
test("coaching OFF still fires the 15% latch coaching and still force-enables orchestration", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-coach-off-latch:${cwd}`;
  const adapter = makeAdapter({ turn: 2, liftUsage: usageAtPct(15) });
  const offEnv = withCoachingOff(env);
  try {
    const out = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, offEnv, adapter);
    assertTagged(out, {
      state: "on",
      kind: "directive",
      phase: "plan",
      utilization: "15%",
      body: LATCH_TEXT,
      remaining: 85,
    });
    assert.ok(isActive(cwd), "the 15% latch must force-enable orchestration even with coaching OFF");
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
    restoreCoaching();
  }
});

test("coaching OFF still reports the handoff phase at the 20% unlock", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-coach-off-unlock:${cwd}`;
  const adapter = makeAdapter({ turn: 2, liftUsage: usageAtPct(20) });
  const offEnv = withCoachingOff(env);
  try {
    const claim = runHook({ cwd, session_id: session, transcript_path: "synthetic" }, offEnv, adapter);
    assertTagged(claim, {
      state: "on",
      kind: "directive",
      phase: "handoff",
      utilization: "20%",
      body: `${FULL_TEXT}\n${REM_ON_TEXT}`,
      remaining: 80,
    });
    const record = readMetering(session);
    assert.equal(record.used_percentage, 20,
      "metering still records utilization with coaching OFF");
  } finally {
    clearLatch(session);
    cleanup(cwd, root);
    restoreCoaching();
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
      kind: "lifecycle",
      phase: "handoff",
      utilization: "100%",
      body: `Handoff lifecycle: \`write_required\`.\n${HANDOFF_DIRECTIVE_TEXT}`,
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
// End-to-end mandatory lifecycle read injection.
//
// Two adjacent metering samples through runHook (85% -> 40%) with a prepared
// handoff record present prove the full path: the detected compaction moves the
// writer's prepared record to session_handoff_required, the next turn injects the
// mandatory read directive tagged kind="lifecycle" for EXACTLY one turn, claims it
// (-> resuming), and does not re-inject. It is directive-only (no tool gate) and
// coaching-independent. The pre-compaction sample omits generation; turn B
// carries the fresh proof, and turn C repeats it so nothing re-fires.
// ---------------------------------------------------------------------------
function driveCompactionLifecycle(cwd, env, session) {
  const payload = { cwd, session_id: session, transcript_path: "synthetic" };
  // Turn A: establish a >= 80% baseline sample with no compaction generation.
  runHook(payload, env, makeAdapter({ turn: 2, liftUsage: usageAtPct(85) }));
  // A prepared handoff authored by THIS session (>= H), the only record a
  // detected compaction may transition.
  const prepared = writeHandoff(cwd, {
    content: "PREPARED-HANDOFF",
    createdBySession: session,
    usedPercentage: 85,
  });
  assert.equal(prepared.record.lifecycle, "prepared", "precondition: prepared record exists");
  // Turn B: a >= 10-point drop across the adjacent sample AND a NEW generation
  // fingerprint (g1 != g0) -> detected compaction.
  const out = runHook(payload, env, makeAdapter({ turn: 3, liftUsage: usageAtPct(40, "gen-1") }));
  // Turn C: identical follow-up (same generation g1); the mandated read must NOT
  // re-inject and no new compaction is detected.
  const out3 = runHook(payload, env, makeAdapter({ turn: 4, liftUsage: usageAtPct(40, "gen-1") }));
  return { out, out3 };
}

test("end-to-end: a detected compaction injects the mandatory read once, then transitions to resuming", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-compaction-e2e:${cwd}`;
  try {
    const { out, out3 } = driveCompactionLifecycle(cwd, env, session);
    assertTagged(out, {
      state: "on",
      kind: "lifecycle",
      phase: "handoff",
      utilization: "40%",
      body: LIFECYCLE_TEXT,
      remaining: 60,
    });
    assert.equal(readHandoff(cwd)?.lifecycle, "resuming",
      "claiming the mandated read moves the prepared record to resuming");
    assert.ok(!out3.includes(LIFECYCLE_TEXT),
      "the mandated read injects for EXACTLY one turn (claimed once per generation)");
    assert.equal(readHandoff(cwd)?.lifecycle, "resuming",
      "no re-transition after the single claim");
  } finally {
    clearLatch(session);
    clearHandoff(cwd);
    cleanup(cwd, root);
  }
});

test("end-to-end compaction read injection fires even with contextCoaching:false", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-compaction-coach-off:${cwd}`;
  const offEnv = withCoachingOff(env);
  try {
    const { out, out3 } = driveCompactionLifecycle(cwd, offEnv, session);
    assertTagged(out, {
      state: "on",
      kind: "lifecycle",
      phase: "handoff",
      utilization: "40%",
      body: LIFECYCLE_TEXT,
      remaining: 60,
    });
    assert.ok(!out3.includes(LIFECYCLE_TEXT),
      "the mandatory lifecycle injection is coaching-independent AND still exactly-once");
    assert.equal(readHandoff(cwd)?.lifecycle, "resuming");
  } finally {
    clearLatch(session);
    clearHandoff(cwd);
    cleanup(cwd, root);
    restoreCoaching();
  }
});

// A >= 10-point drop from >= 80% that carries NO new generation proof (the
// resume/clear-shaped case: same or absent fingerprint) must NOT be treated as a
// compaction — the mandated read never injects and the prepared handoff stays
// prepared. This is the practical-proof gate exercised end-to-end through runHook.
test("a qualifying drop WITHOUT a new generation proof never injects the mandated read", () => {
  for (const [label, genA, genB] of [
    ["absent proof", undefined, undefined],
    ["null proof", null, null],
    ["unchanged proof", "gen-same", "gen-same"],
  ]) {
    const cwd = makeCwd();
    const { root, env } = makeDirectivesEnv();
    const session = `s-no-proof-${label.replace(/\s+/g, "-")}:${cwd}`;
    try {
      const payload = { cwd, session_id: session, transcript_path: "synthetic" };
      runHook(payload, env, makeAdapter({ turn: 2, liftUsage: usageAtPct(85, genA) }));
      const prepared = writeHandoff(cwd, {
        content: "PREPARED-HANDOFF",
        createdBySession: session,
        usedPercentage: 85,
      });
      assert.equal(prepared.record.lifecycle, "prepared", `${label}: precondition prepared record`);
      const out = runHook(payload, env, makeAdapter({ turn: 3, liftUsage: usageAtPct(40, genB) }));
      assert.ok(!out.includes(LIFECYCLE_TEXT),
        `${label}: a drop without a new generation proof must not inject the mandated read`);
      assert.equal(readHandoff(cwd)?.lifecycle, "prepared",
        `${label}: the prepared handoff is not transitioned without proof`);
    } finally {
      clearLatch(session);
      clearHandoff(cwd);
      cleanup(cwd, root);
    }
  }
});

test("the shipped repo directives dir carries the session-handoff-required asset", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(
    existsSync(join(repoRoot, "directives", SESSION_HANDOFF_REQUIRED_DIRECTIVE_FILE)),
    true,
    "an installed layout must resolve the mandatory-read asset the hook reads"
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
