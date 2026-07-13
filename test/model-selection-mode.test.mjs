/**
 * model-selection-mode.test.mjs — Unit tests for the per-project model-selection
 * mode lifecycle (dist/orchestration/model-mode.js).
 *
 * Exercises the REAL compiled module. Each test uses a fresh mkdtemp cwd and
 * passes explicit `now` (ms) so time is deterministic — no reliance on wall
 * clock. Covers the binding lifecycle invariants:
 *   (a) mode switch both directions
 *   (b) smart mode rejects selectors with the exact rejection message
 *   (c) 30-min window lazily reverts on the next call after expiry
 *   (d) mode + remaining window persist across a "restart" (file-based, no cache)
 *   (e) re-enabling an already-active window does NOT extend it
 *
 * WHY (Rule 9): smart mode is the default safety policy — selectors MUST be
 * rejected unless the user explicitly grants a TIME-BOXED override that cannot
 * be silently refreshed. A test that can't fail when the gate/window logic
 * regresses is worthless, so every assertion pins a specific value/reason.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  modelModePath,
  resolveMode,
  setMode,
  gateLaunch,
  SELECTOR_REJECTION_MESSAGE,
} from "../dist/orchestration/model-mode.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  const dir = mkdtempSync(join(tmpdir(), "model-mode-"));
  try {
    fn(dir);
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WINDOW_MS = 30 * 60 * 1000;
const t0 = 1_000_000_000_000; // fixed deterministic epoch ms

// ---------------------------------------------------------------------------
// (a) MODE SWITCH BOTH DIRECTIONS
// ---------------------------------------------------------------------------
test("(a) default (no state) resolves to smart; switch to overrides and back", (cwd) => {
  // No state file written yet -> default must be the SAFE mode.
  assert.equal(resolveMode(cwd, t0).mode, "smart",
    "absence of state MUST mean smart (the default safety policy)");

  setMode(cwd, "user-approved-overrides", t0);
  assert.equal(resolveMode(cwd, t0).mode, "user-approved-overrides",
    "after explicit grant the project is in user-approved-overrides");

  setMode(cwd, "smart", t0 + 60_000);
  assert.equal(resolveMode(cwd, t0 + 60_000).mode, "smart",
    "switching back to smart must take effect (override revoked)");
});

// ---------------------------------------------------------------------------
// (b) SMART REJECTS SELECTORS w/ correct message; overrides allows them
// ---------------------------------------------------------------------------
test("(b) smart mode rejects each selector with the exact message; overrides allows", (cwd) => {
  // Default smart mode.
  const prov = gateLaunch(cwd, { provider: "claude" }, t0);
  assert.equal(prov.allowed, false, "smart must reject a provider selector");
  assert.equal(prov.message, SELECTOR_REJECTION_MESSAGE,
    "rejection must carry the canonical rejection message verbatim");

  const model = gateLaunch(cwd, { model: "opus" }, t0);
  assert.equal(model.allowed, false, "smart must reject a model selector");
  assert.equal(model.message, SELECTOR_REJECTION_MESSAGE,
    "model rejection uses the same canonical message");

  const effort = gateLaunch(cwd, { effort: "high" }, t0);
  assert.equal(effort.allowed, false, "smart must reject an effort selector");
  assert.equal(effort.message, SELECTOR_REJECTION_MESSAGE,
    "effort rejection uses the same canonical message");

  const emptyModel = gateLaunch(cwd, { model: "" }, t0);
  assert.equal(emptyModel.allowed, false,
    "smart must reject a present-but-empty model selector");
  assert.equal(emptyModel.message, SELECTOR_REJECTION_MESSAGE,
    "empty-string selector rejection uses the same canonical message");

  // No selectors -> allowed even in smart (smart only blocks MANUAL selection).
  const none = gateLaunch(cwd, {}, t0);
  assert.equal(none.allowed, true, "smart must allow a launch with no selectors");

  // Grant overrides -> all three selectors together are allowed.
  setMode(cwd, "user-approved-overrides", t0);
  const all = gateLaunch(cwd, { provider: "claude", model: "opus", effort: "high" }, t0);
  assert.equal(all.allowed, true,
    "user-approved-overrides must allow provider+model+effort together");
  assert.equal(all.mode, "user-approved-overrides", "gate reports the active mode");
});

// ---------------------------------------------------------------------------
// (c) 30-MIN LAZY REVERT on next call after expiry
// ---------------------------------------------------------------------------
test("(c) override lazily reverts to smart just past 30:00; exactly 30:00 still active", (cwd) => {
  setMode(cwd, "user-approved-overrides", t0);

  // Exactly 30:00 — boundary is INCLUSIVE (revert only when STRICTLY past).
  const boundary = gateLaunch(cwd, { provider: "claude" }, t0 + WINDOW_MS);
  assert.equal(boundary.mode, "user-approved-overrides",
    "at exactly 30:00 the window is still active");
  assert.equal(boundary.allowed, true,
    "at exactly 30:00 selectors are still permitted");

  // 30:00 + 1ms — the next call must lazily revert and reject the selector.
  const expired = gateLaunch(cwd, { provider: "claude" }, t0 + WINDOW_MS + 1);
  assert.equal(expired.reverted, true, "past-expiry call must report a lazy revert");
  assert.equal(expired.mode, "smart", "after revert the mode is smart");
  assert.equal(expired.allowed, false, "after revert the selector is rejected again");
  assert.equal(expired.message, SELECTOR_REJECTION_MESSAGE,
    "post-revert rejection uses the canonical message");

  // The revert was PERSISTED to disk: a later resolve (real now) still sees smart.
  assert.equal(resolveMode(cwd).mode, "smart",
    "lazy revert must be written to disk, not just returned");
});

// ---------------------------------------------------------------------------
// (d) RESTART PERSISTENCE of mode + remaining window
// ---------------------------------------------------------------------------
test("(d) mode and remaining window survive a simulated restart (file-based state)", (cwd) => {
  setMode(cwd, "user-approved-overrides", t0);

  // "Restart": no in-memory cache exists — resolveMode re-reads the file.
  const r = resolveMode(cwd, t0 + 10 * 60 * 1000);
  assert.equal(r.mode, "user-approved-overrides",
    "mode must persist across restart (state is on disk)");
  assert.ok(Math.abs(r.window_remaining_ms - 20 * 60 * 1000) <= 1000,
    `remaining window must be ~20min after 10min elapsed, got ${r.window_remaining_ms}`);

  // The state file lives in the shared subagent-mcp tmp state dir.
  assert.ok(modelModePath(cwd).includes("subagent-mcp"),
    "state file must live under the subagent-mcp tmp dir");
});

// ---------------------------------------------------------------------------
// (e) RE-ENABLE DOES NOT EXTEND WINDOW
// ---------------------------------------------------------------------------
test("(e) re-enabling an active override does NOT reset the 30-min window", (cwd) => {
  setMode(cwd, "user-approved-overrides", t0);
  const reEnabled = setMode(cwd, "user-approved-overrides", t0 + 10 * 60 * 1000);

  // enabled_at must remain the ORIGINAL t0 (not bumped to t0+10min).
  assert.equal(reEnabled.enabled_at, t0,
    "re-enable must keep the original enable timestamp (no refresh)");

  const r = resolveMode(cwd, t0 + 10 * 60 * 1000);
  assert.ok(Math.abs(r.window_remaining_ms - 20 * 60 * 1000) <= 1000,
    `window must still be ~20min (NOT reset to 30min), got ${r.window_remaining_ms}`);
  assert.equal(r.enabled_at, t0, "enabled_at unchanged after re-enable");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
