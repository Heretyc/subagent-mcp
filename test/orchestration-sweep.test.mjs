import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashKey } from "../dist/orchestration/marker.js";
import { LATCH_REV } from "../dist/orchestration/latch.js";
import {
  SWEEP_INTERVAL_MS,
  sweepHookState,
} from "../dist/orchestration/state-sweep.js";

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

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj), "utf8");
}

test("sweep deletes obsolete latch and stale ctx/sl while preserving other state", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-sweep-"));
  const now = Date.now();
  const old = now - 25 * 60 * 60 * 1000;
  const missingRevLatch = join(dir, `latch-${hashKey("missing")}.json`);
  const oldRevLatch = join(dir, `latch-${hashKey("old")}.json`);
  const freshLatch = join(dir, `latch-${hashKey("fresh")}.json`);
  const staleCtx = join(dir, `ctx-${hashKey("stale-ctx")}.json`);
  const staleSl = join(dir, `sl-${hashKey("stale-sl")}.json`);
  const staleCwdSl = join(dir, `sl-cwd-${hashKey("stale-cwd")}.json`);
  const mtimeCtx = join(dir, `ctx-${hashKey("mtime-ctx")}.json`);
  const freshCtx = join(dir, `ctx-${hashKey("fresh-ctx")}.json`);
  const orch = join(dir, `orch-${hashKey("cwd")}.flag`);
  const model = join(dir, `model-${hashKey("model")}.json`);
  try {
    writeJson(missingRevLatch, { latched: true });
    writeJson(oldRevLatch, { rev: LATCH_REV - 1 });
    writeJson(freshLatch, { rev: LATCH_REV });
    writeJson(staleCtx, { updated_at: old });
    writeJson(staleSl, { updated_at: old });
    writeJson(staleCwdSl, { updated_at: old });
    writeJson(mtimeCtx, {});
    writeJson(freshCtx, { updated_at: now });
    writeJson(orch, {});
    writeJson(model, {});
    const oldSeconds = old / 1000;
    utimesSync(mtimeCtx, oldSeconds, oldSeconds);

    sweepHookState(dir, now);

    assert.equal(existsSync(missingRevLatch), false);
    assert.equal(existsSync(oldRevLatch), false);
    assert.equal(existsSync(staleCtx), false);
    assert.equal(existsSync(staleSl), false);
    assert.equal(existsSync(staleCwdSl), false);
    assert.equal(existsSync(mtimeCtx), false);
    assert.equal(existsSync(freshLatch), true);
    assert.equal(existsSync(freshCtx), true);
    assert.equal(existsSync(orch), true);
    assert.equal(existsSync(model), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweep respects one-hour stamp throttle", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-sweep-"));
  const now = Date.now();
  const old = now - 25 * 60 * 60 * 1000;
  const staleCtx = join(dir, `ctx-${hashKey("throttle-ctx")}.json`);
  const stamp = join(dir, "sweep.stamp");
  try {
    writeJson(staleCtx, { updated_at: old });
    writeFileSync(stamp, "recent", "utf8");
    const recent = (now - SWEEP_INTERVAL_MS + 1000) / 1000;
    utimesSync(stamp, recent, recent);

    sweepHookState(dir, now);

    assert.equal(existsSync(staleCtx), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
