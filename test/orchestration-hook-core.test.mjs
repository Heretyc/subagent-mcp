/**
 * orchestration-hook-core.test.mjs — Unit tests for the provider-agnostic hook
 * core (dist/orchestration/hook-core.js).
 *
 * Covers the cadence + gating contract that the whole feature rests on:
 *   - OFF (no marker) -> '' (zero emission).
 *   - unclaimed marker -> FULL directive AND baseline written at this turn.
 *   - rel % 5 cadence: baseline -> FULL, baseline+1 -> OFF-turn, baseline+5 -> FULL.
 *   - persistence/carryover: FRESH (owner null) -> FULL only; CARRYOVER (owner
 *     is a foreign session) -> carryover notice prepended to FULL + re-claim;
 *     SAME-SESSION (owner === current) -> normal cadence; the notice fires once.
 *   - subagent adapter -> '' (a subagent is never nagged to delegate).
 *   - missing directive file -> '' (fail-safe read).
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

import { runHook } from "../dist/orchestration/hook-core.js";
import {
  enable,
  disable,
  isActive,
  readMarker,
  writeMarker,
} from "../dist/orchestration/marker.js";

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
const OFF_TEXT = "OFF-TURN-ONE-LINER";
const CARRYOVER_TEXT = "CARRYOVER-NOTICE-BODY";

// Build a temp directives dir and an env that points the resolver at it.
function makeDirectivesEnv({ withFull = true, withOff = true, withCarryover = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "orch-root-"));
  const dir = join(root, "directives");
  mkdirSync(dir, { recursive: true });
  if (withFull) writeFileSync(join(dir, "full.md"), FULL_TEXT, "utf8");
  if (withOff) writeFileSync(join(dir, "off.md"), OFF_TEXT, "utf8");
  if (withCarryover) writeFileSync(join(dir, "carryover.md"), CARRYOVER_TEXT, "utf8");
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
  };
}

// A unique temp cwd per test keeps marker state isolated.
function makeCwd() {
  return mkdtempSync(join(tmpdir(), "orch-hc-cwd-"));
}

// ---------------------------------------------------------------------------
// OFF: no marker -> emit nothing
// ---------------------------------------------------------------------------
test("OFF (no marker) -> '' (zero emission)", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    assert.equal(isActive(cwd), false, "precondition: marker absent");
    const out = runHook({ cwd, transcript_path: undefined }, env, makeAdapter({ turn: 3 }));
    assert.equal(out, "", "no marker must mean zero emission");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unclaimed marker -> FULL + baseline written
// ---------------------------------------------------------------------------
test("unclaimed marker -> FULL directive AND baseline written (turn 0)", () => {
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
    assert.equal(out, FULL_TEXT, "the toggle-ON turn emits the FULL directive");

    const after = readMarker(cwd);
    assert.equal(after.baseline_turn, 4, "baseline is stamped at the current turn");
    assert.equal(after.owner_session, "sess-X", "owner_session is claimed from payload");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// rel % 5 cadence
// ---------------------------------------------------------------------------
test("cadence: rel 0 (baseline) -> FULL, rel 1 -> OFF-turn, rel 5 -> FULL", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    // First call at turn=10 claims + baselines at 10 -> rel 0 -> FULL. The SAME
    // session_id is passed on every turn so the follow-ups stay SAME-SESSION
    // (a different/absent session_id would be a CARRYOVER, not normal cadence).
    const t0 = runHook({ cwd, session_id: "s", transcript_path: undefined }, env,
      makeAdapter({ turn: 10 }));
    assert.equal(t0, FULL_TEXT, "rel 0 (baseline turn) -> FULL");
    assert.equal(readMarker(cwd).baseline_turn, 10);

    // turn 11 -> rel 1 -> OFF-turn one-liner.
    const t1 = runHook({ cwd, session_id: "s", transcript_path: undefined }, env,
      makeAdapter({ turn: 11 }));
    assert.equal(t1, OFF_TEXT, "rel 1 -> off-turn reminder");

    // turn 15 -> rel 5 -> FULL again.
    const t5 = runHook({ cwd, session_id: "s", transcript_path: undefined }, env,
      makeAdapter({ turn: 15 }));
    assert.equal(t5, FULL_TEXT, "rel 5 -> FULL (every 5th relative turn)");

    // turn 14 -> rel 4 -> OFF-turn (guards against off-by-one).
    const t4 = runHook({ cwd, session_id: "s", transcript_path: undefined }, env,
      makeAdapter({ turn: 14 }));
    assert.equal(t4, OFF_TEXT, "rel 4 -> off-turn");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Persistence + session-start carryover (owner_session classification)
//
// WHY (Rule 9): the marker now PERSISTS across sessions, so the SAME active
// marker can be seen by the session that enabled it (FRESH/SAME) or by a later
// session that inherited it (CARRYOVER). Misclassifying CARRYOVER would either
// drop the one-time notify/confirm notice or replay it every turn. These encode
// that the notice fires exactly once, on re-claim, for a foreign owner only.
// ---------------------------------------------------------------------------
test("FRESH (owner_session null) -> FULL only, no carryover, claims current", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd); // marker active, owner_session/baseline_turn both null.
    const out = runHook(
      { cwd, session_id: "sess-now", transcript_path: undefined },
      env,
      makeAdapter({ turn: 2 })
    );
    assert.equal(out, FULL_TEXT, "a freshly-enabled marker emits FULL only (no carryover)");
    assert.ok(!out.includes(CARRYOVER_TEXT), "FRESH must NOT prepend the carryover notice");
    const after = readMarker(cwd);
    assert.equal(after.owner_session, "sess-now", "FRESH claims the current session");
    assert.equal(after.baseline_turn, 2, "FRESH baselines at the current turn");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("CARRYOVER (owner !== current) -> carryover notice + FULL, re-claims current", () => {
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
    assert.ok(out.includes(CARRYOVER_TEXT),
      "an inherited marker emits the carryover notice");
    assert.ok(out.includes(FULL_TEXT),
      "the carryover notice is prepended to (not instead of) FULL");
    assert.ok(out.startsWith(CARRYOVER_TEXT),
      "carryover notice comes first, then FULL");

    const after = readMarker(cwd);
    assert.equal(after.owner_session, "current-session",
      "CARRYOVER re-claims the marker for the current session");
    assert.equal(after.baseline_turn, 4,
      "CARRYOVER re-baselines at the current turn (notice fires once)");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("CARRYOVER then next same-session turn -> cadence, no repeat notice", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    writeMarker(cwd, { owner_session: "prev", baseline_turn: 50 });

    // Turn 7: carryover re-claim + re-baseline at 7.
    const first = runHook({ cwd, session_id: "S", transcript_path: undefined }, env,
      makeAdapter({ turn: 7 }));
    assert.ok(first.includes(CARRYOVER_TEXT), "first foreign-owner turn carries over");

    // Turn 8: rel 1 same-session -> off-turn, NO carryover repeat.
    const second = runHook({ cwd, session_id: "S", transcript_path: undefined }, env,
      makeAdapter({ turn: 8 }));
    assert.equal(second, OFF_TEXT, "next same-session turn is normal cadence, not carryover");
    assert.ok(!second.includes(CARRYOVER_TEXT), "the carryover notice fires exactly once");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
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
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("SAME-SESSION (owner === current) -> cadence, never carryover", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd);
    // Already claimed by THIS session at baseline 20.
    writeMarker(cwd, { owner_session: "me", baseline_turn: 20 });

    // rel 0 -> FULL (not carryover).
    const t0 = runHook({ cwd, session_id: "me", transcript_path: undefined }, env,
      makeAdapter({ turn: 20 }));
    assert.equal(t0, FULL_TEXT, "same-session rel 0 -> FULL, no carryover");

    // rel 1 -> off-turn.
    const t1 = runHook({ cwd, session_id: "me", transcript_path: undefined }, env,
      makeAdapter({ turn: 21 }));
    assert.equal(t1, OFF_TEXT, "same-session rel 1 -> off-turn");

    // rel 5 -> FULL.
    const t5 = runHook({ cwd, session_id: "me", transcript_path: undefined }, env,
      makeAdapter({ turn: 25 }));
    assert.equal(t5, FULL_TEXT, "same-session rel 5 -> FULL");

    // Baseline must be unchanged (no re-claim on same-session turns).
    assert.equal(readMarker(cwd).baseline_turn, 20,
      "same-session turns do not re-baseline");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Subagent -> emit nothing
// ---------------------------------------------------------------------------
test("subagent adapter -> '' (a subagent is never nagged)", () => {
  const cwd = makeCwd();
  const { root, env } = makeDirectivesEnv();
  try {
    enable(cwd); // marker ON, but subagent must still suppress.
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ subagent: true, turn: 0 }));
    assert.equal(out, "", "subagent sessions emit nothing even when active");
    // And the baseline must NOT have been claimed by a subagent turn.
    assert.equal(readMarker(cwd).baseline_turn, null,
      "subagent suppression happens before any marker claim");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Missing directive file -> '' (fail-safe)
// ---------------------------------------------------------------------------
test("missing directive file -> '' (fail-safe read)", () => {
  const cwd = makeCwd();
  // Directives dir exists but the FULL file is absent.
  const { root, env } = makeDirectivesEnv({ withFull: false });
  try {
    enable(cwd);
    const out = runHook({ cwd, transcript_path: undefined }, env,
      makeAdapter({ turn: 0 }));
    assert.equal(out, "", "an unreadable directive yields '' rather than throwing");
    // Baseline is still stamped (claim happened before the read).
    assert.equal(readMarker(cwd).baseline_turn, 0);
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
