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

import { runHook, REMINDER_PERIOD } from "../dist/orchestration/hook-core.js";
import {
  enable,
  disable,
  isActive,
  readMarker,
  writeMarker,
} from "../dist/orchestration/marker.js";
import {
  readReminder,
  reminderPath,
} from "../dist/orchestration/reminder.js";

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
const OFF_TEXT = "RULE-CARRIER-ONE-LINER";
const CARRYOVER_TEXT = "CARRYOVER-NOTICE-BODY";
const REM_ON_TEXT = "REMINDER-ON-BLOCK";
const REM_OFF_TEXT = "REMINDER-OFF-BLOCK";

// Build a temp directives dir and an env that points the resolver at it.
function makeDirectivesEnv({
  withFull = true,
  withOff = true,
  withCarryover = true,
  withReminderOn = true,
  withReminderOff = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "orch-root-"));
  const dir = join(root, "directives");
  mkdirSync(dir, { recursive: true });
  if (withFull) writeFileSync(join(dir, "full.md"), FULL_TEXT, "utf8");
  if (withOff) writeFileSync(join(dir, "off.md"), OFF_TEXT, "utf8");
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
    fullDirectiveFile: "full.md",
    offTurnFile: "off.md",
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
  disable(cwd);
  rmSync(reminderPath(cwd), { force: true });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// OFF: no marker -> per-prompt reminder cadence (the hook emits in BOTH modes)
// ---------------------------------------------------------------------------
test("OFF: prompts 1-4 -> rule carrier, prompt 5 -> LONG OFF block, 6 -> rule carrier, 10 -> LONG", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    assert.equal(isActive(cwd), false, "precondition: marker absent");
    const adapter = makeAdapter();
    const payload = { cwd, session_id: "s-off", transcript_path: undefined };
    for (let prompt = 1; prompt <= 10; prompt++) {
      const out = runHook(payload, env, adapter);
      if (prompt % REMINDER_PERIOD === 0) {
        assert.equal(out, REM_OFF_TEXT, `prompt ${prompt} must emit the LONG OFF block`);
      } else {
        assert.equal(out, OFF_TEXT, `prompt ${prompt} must emit the one-line rule carrier`);
      }
    }
    assert.equal(readReminder(cwd).counts["s-off"], 10, "counter persisted across prompts");
  } finally {
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
  try {
    const adapter = makeAdapter();
    for (let round = 1; round <= 5; round++) {
      for (const session of ["s-A", "s-B"]) {
        const out = runHook({ cwd, session_id: session, transcript_path: undefined }, env, adapter);
        if (round === 5) {
          assert.equal(out, REM_OFF_TEXT, `${session} round 5 must be its LONG block`);
        } else {
          assert.equal(out, OFF_TEXT, `${session} round ${round} must be the rule carrier`);
        }
      }
    }
    const counts = readReminder(cwd).counts;
    assert.equal(counts["s-A"], 5, "session A keeps its own count");
    assert.equal(counts["s-B"], 5, "session B keeps its own count");
  } finally {
    cleanup(cwd, root);
  }
});

test("OFF: a new session starts its own count without disturbing others", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    const adapter = makeAdapter();
    for (let prompt = 1; prompt <= 3; prompt++) {
      runHook({ cwd, session_id: "s-A", transcript_path: undefined }, env, adapter);
    }
    assert.equal(readReminder(cwd).counts["s-A"], 3);
    const out = runHook({ cwd, session_id: "s-B", transcript_path: undefined }, env, adapter);
    assert.equal(out, OFF_TEXT, "first prompt of a new session emits the rule carrier");
    const counts = readReminder(cwd).counts;
    assert.equal(counts["s-B"], 1, "a new session starts its own count at 1");
    assert.equal(counts["s-A"], 3, "the other session's count is untouched");
  } finally {
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
      assert.equal(out, OFF_TEXT, `prompt ${i} after claim -> rule carrier`);
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
    assert.equal(second, OFF_TEXT, "next same-session turn is normal cadence, not carryover");
    assert.ok(!second.includes(CARRYOVER_TEXT), "the carryover notice fires exactly once");
  } finally {
    cleanup(cwd, root);
  }
});

test("CARRYOVER null-safety: real owner + undefined current -> carryover", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    writeMarker(cwd, { owner_session: "prev", baseline_turn: 12 });
    // No session_id on the payload: cannot confirm same-session -> CARRYOVER.
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ turn: 3 }));
    assert.ok(out.includes(CARRYOVER_TEXT),
      "a real owner with an undefined current session is treated as carryover");
    assert.equal(readMarker(cwd).owner_session, null,
      "re-claim with an undefined current session stores null");
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
  try {
    const adapter = makeAdapter();
    const payload = { cwd, session_id: "s", transcript_path: undefined };
    for (let prompt = 1; prompt <= 4; prompt++) {
      assert.equal(runHook(payload, env, adapter), OFF_TEXT);
    }
    assert.equal(runHook(payload, env, adapter), "",
      "a missing LONG asset degrades to '' on its turn, never a throw");
  } finally {
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
