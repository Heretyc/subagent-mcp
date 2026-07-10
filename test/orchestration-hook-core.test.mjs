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
import { join } from "node:path";

import {
  ANON_CLAIM_TTL_MS,
  cullHookZombies,
  ownerKey,
  runHook,
  REMINDER_PERIOD,
} from "../dist/orchestration/hook-core.js";
import {
  enable,
  markerPath,
  isActive,
  readMarker,
  removeDisable,
  writeDisable,
  writeMarker,
  anonKey,
} from "../dist/orchestration/marker.js";
import {
  readReminder,
  reminderPath,
} from "../dist/orchestration/reminder.js";
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

// Build a temp directives dir and an env that points the resolver at it.
function makeDirectivesEnv({
  withFull = true,
  withShortOn = true,
  withShortOff = true,
  withCarryover = true,
  withReminderOn = true,
  withReminderOff = true,
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
  return { root, env: { PLUGIN_ROOT: root } };
}

// Synthetic adapter with injectable subagent/turn behavior.
function makeAdapter({ subagent = false, turn = 0 } = {}) {
  return {
    isSubagent: () => subagent,
    currentTurn: () => turn,
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

// ---------------------------------------------------------------------------
// OFF: no marker -> per-prompt reminder cadence (the hook emits in BOTH modes)
// ---------------------------------------------------------------------------
test("OFF: prompts 1-4 -> rule carrier, prompt 5 -> LONG OFF block, 6 -> rule carrier, 10 -> LONG", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  const session = `s-off:${cwd}`;
  try {
    assert.equal(isActive(cwd, session), true, "fresh sessions are ON by default");
    writeDisable(session);
    assert.equal(isActive(cwd, session), false, "precondition: session disabled");
    const adapter = makeAdapter();
    const payload = { cwd, session_id: session, transcript_path: undefined };
    for (let prompt = 1; prompt <= 10; prompt++) {
      const out = runHook(payload, env, adapter);
      if (prompt % REMINDER_PERIOD === 0) {
        assert.equal(out, REM_OFF_TEXT, `prompt ${prompt} must emit the LONG OFF block`);
      } else {
        assert.equal(out, SHORT_OFF_TEXT, `prompt ${prompt} must emit the OFF one-line rule carrier`);
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
          assert.equal(out, REM_OFF_TEXT, `${session} round 5 must be its LONG block`);
        } else {
          assert.equal(out, SHORT_OFF_TEXT, `${session} round ${round} must be the OFF rule carrier`);
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
    assert.equal(out, SHORT_OFF_TEXT, "first prompt of a new session emits the OFF rule carrier");
    const counts = readReminder(cwd).counts;
    assert.equal(counts[sessionB], 1, "a new session starts its own count at 1");
    assert.equal(counts[sessionA], 3, "the other session's count is untouched");
  } finally {
    removeDisable(sessionA);
    removeDisable(sessionB);
    cleanup(cwd, root);
  }
});

// ---------------------------------------------------------------------------
// Unclaimed marker -> FULL + ON reminder + baseline written + counter re-based
// ---------------------------------------------------------------------------
test("unclaimed marker -> FULL + ON reminder block AND baseline written", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    const before = readMarker(cwd);
    assert.equal(before.baseline_turn, null, "precondition: unclaimed");

    const out = runHook(
      { cwd, session_id: "sess-X", transcript_path: undefined },
      env,
      makeAdapter({ turn: 4 })
    );
    assert.equal(out, FULL_TEXT + REM_ON_TEXT,
      "the toggle-ON turn emits FULL plus the ON reminder block");

    const after = readMarker(cwd);
    assert.equal(after.baseline_turn, 4, "baseline is stamped at the current turn");
    assert.equal(after.owner_session, "sess-X", "owner_session is claimed from payload");
    assert.equal(readReminder(cwd).counts["sess-X"], 0,
      "the claim turn re-baselines the session's reminder count to 0 (claim IS a LONG turn)");
  } finally {
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
    enable(cwd);
    const adapter = makeAdapter({ turn: 10 });
    const payload = { cwd, session_id: "s", transcript_path: undefined };

    const claim = runHook(payload, env, adapter);
    assert.equal(claim, FULL_TEXT + REM_ON_TEXT, "claim turn is a LONG turn");

    for (let i = 1; i <= 4; i++) {
      const out = runHook(payload, env, adapter);
      assert.equal(out, SHORT_ON_TEXT, `prompt ${i} after claim -> ON rule carrier`);
    }
    const fifth = runHook(payload, env, adapter);
    assert.equal(fifth, REM_ON_TEXT,
      "the 5th prompt after the claim emits the LONG ON block (not FULL)");
    assert.equal(readMarker(cwd).baseline_turn, 10,
      "same-session prompts never re-baseline the marker");
  } finally {
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
    enable(cwd); // marker active, owner_session/baseline_turn both null.
    const out = runHook(
      { cwd, session_id: "sess-now", transcript_path: undefined },
      env,
      makeAdapter({ turn: 2 })
    );
    assert.equal(out, FULL_TEXT + REM_ON_TEXT,
      "a freshly-enabled marker emits FULL + ON reminder (no carryover)");
    assert.ok(!out.includes(CARRYOVER_TEXT), "FRESH must NOT prepend the carryover notice");
    const after = readMarker(cwd);
    assert.equal(after.owner_session, "sess-now", "FRESH claims the current session");
    assert.equal(after.baseline_turn, 2, "FRESH baselines at the current turn");
  } finally {
    cleanup(cwd, root);
  }
});

test("CARRYOVER (owner !== current) -> notice + FULL + ON reminder, re-claims current", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    // Simulate a marker left ON by a PRIOR session.
    writeMarker(cwd, { owner_session: "prev-session", baseline_turn: 99 });

    const out = runHook(
      { cwd, session_id: "current-session", transcript_path: undefined },
      env,
      makeAdapter({ turn: 4 })
    );
    assert.equal(out, CARRYOVER_TEXT + FULL_TEXT + REM_ON_TEXT,
      "an inherited marker emits notice, then FULL, then the ON reminder block");

    const after = readMarker(cwd);
    assert.equal(after.owner_session, "current-session",
      "CARRYOVER re-claims the marker for the current session");
    assert.equal(after.baseline_turn, 4,
      "CARRYOVER re-baselines at the current turn (notice fires once)");
  } finally {
    cleanup(cwd, root);
  }
});

test("CARRYOVER then next same-session turn -> rule carrier, no repeat notice", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    writeMarker(cwd, { owner_session: "prev", baseline_turn: 50 });

    // Turn 7: carryover re-claim + re-baseline at 7.
    const first = runHook({ cwd, session_id: "S", transcript_path: undefined }, env,
      makeAdapter({ turn: 7 }));
    assert.ok(first.includes(CARRYOVER_TEXT), "first foreign-owner turn carries over");

    // Next prompt: same-session -> rule carrier, NO carryover repeat.
    const second = runHook({ cwd, session_id: "S", transcript_path: undefined }, env,
      makeAdapter({ turn: 8 }));
    assert.equal(second, SHORT_ON_TEXT, "next same-session turn is normal ON cadence, not carryover");
    assert.ok(!second.includes(CARRYOVER_TEXT), "the carryover notice fires exactly once");
  } finally {
    cleanup(cwd, root);
  }
});

test("keyless payload resolves to anonymous owner and converges within TTL", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    writeMarker(cwd, { owner_session: "prev", baseline_turn: 12 });
    const owner = anonKey(cwd, "test");
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ turn: 3 }));
    assert.ok(out.includes(CARRYOVER_TEXT),
      "a real prior owner and new anonymous owner is carryover once");
    assert.equal(readMarker(cwd).owner_session, owner);
    assert.equal(readReminder(cwd).counts[owner], 0);
    assert.equal(runHook({ cwd, transcript_path: undefined }, env, makeAdapter({ turn: 4 })), SHORT_ON_TEXT);
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

test("anonymous owner claim re-anchors after TTL and then returns to cadence", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
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
    assert.equal(out, FULL_TEXT + REM_ON_TEXT, "expired anonymous claim re-anchors with FULL");
    assert.equal(readMarker(cwd).owner_session, owner);
    assert.equal(runHook({ cwd, transcript_path: undefined }, env, makeAdapter({ turn: 3 })), SHORT_ON_TEXT);
  } finally {
    cleanup(cwd, root);
  }
});

test("owners map prevents alternating keyed sessions from FULL-thrashing", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    const adapter = makeAdapter({ turn: 0 });
    const firstA = runHook({ cwd, session_id: "A" }, env, adapter);
    const firstB = runHook({ cwd, session_id: "B" }, env, adapter);
    assert.equal(firstA, FULL_TEXT + REM_ON_TEXT);
    assert.equal(firstB, CARRYOVER_TEXT + FULL_TEXT + REM_ON_TEXT);
    for (let i = 0; i < 4; i++) {
      assert.equal(runHook({ cwd, session_id: "A" }, env, adapter), SHORT_ON_TEXT);
      assert.equal(runHook({ cwd, session_id: "B" }, env, adapter), SHORT_ON_TEXT);
    }
    assert.equal(runHook({ cwd, session_id: "A" }, env, adapter), REM_ON_TEXT);
    assert.equal(runHook({ cwd, session_id: "B" }, env, adapter), REM_ON_TEXT);
  } finally {
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
    enable(cwd); // marker ON, but subagent must still suppress.
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
    enable(cwd);
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ turn: 0 }));
    assert.equal(out, "", "unreadable directives yield '' rather than throwing");
    // Baseline is still stamped (claim happened before the read).
    assert.equal(readMarker(cwd).baseline_turn, 0);
  } finally {
    cleanup(cwd, root);
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
      assert.equal(runHook(payload, env, adapter), SHORT_OFF_TEXT);
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

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
