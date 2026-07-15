import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";

import {
  clampCap,
  countSlots,
  ensureFirstRunPermissionCeiling,
  parsePermissionsCeilingConfig,
  parseCheckForUpdatesConfig,
  parseConcurrencyConfig,
  readSlotMetadata,
  releaseSlot,
  reserveSlot,
  slotDir,
  slotPathForAgent,
  stripJsoncComments,
  writeSlotMetadata,
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
} from "../dist/concurrency.js";

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function sink() {
  return new Writable({ write(_chunk, _enc, cb) { cb(); } });
}

function tmpSlotDir() {
  return join(tmpdir(), `subagent-global-cap-${randomUUID()}`);
}

function seedSlots(dir, count) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `slot-fake-${i}.json`), "{}");
  }
}

function withTemporarySlotBase(fn) {
  const base = tmpSlotDir();
  const previous = process.env.SUBAGENT_SLOT_DIR;
  process.env.SUBAGENT_SLOT_DIR = base;
  try {
    return fn({ base, userDir: slotDir() });
  } finally {
    if (previous === undefined) delete process.env.SUBAGENT_SLOT_DIR;
    else process.env.SUBAGENT_SLOT_DIR = previous;
    rmSync(base, { recursive: true, force: true });
  }
}

let releaseFixture = null;

test("clampCap applies the forced validation table", () => {
  assert.equal(clampCap(1), 10);
  assert.equal(clampCap(5), 10);
  assert.equal(clampCap(9), 10);
  assert.equal(clampCap(10), 10);
  assert.equal(clampCap(20), 20);
  assert.equal(clampCap(25), 25);
  assert.equal(clampCap(0), 20);
  assert.equal(clampCap(-3), 20);
  assert.equal(clampCap(undefined), 20);
  assert.equal(clampCap(null), 20);
  assert.equal(clampCap(3.5), 20);
  assert.equal(clampCap(NaN), 20);
  assert.equal(clampCap("20"), 20);
});

test("parseConcurrencyConfig handles shipped template, clamp, missing, malformed, and comments", () => {
  const template = readFileSync("dist/global-concurrency.jsonc", "utf8");
  assert.equal(parseConcurrencyConfig(template), 20);
  assert.equal(parseConcurrencyConfig('{"globalConcurrentSubagents":4}'), 10);
  assert.equal(parseConcurrencyConfig("{}"), 20);
  assert.equal(parseConcurrencyConfig("{not json"), 20);
  assert.equal(parseConcurrencyConfig('// c\n{"globalConcurrentSubagents":50}'), 50);
  assert.equal(parseConcurrencyConfig('{"globalConcurrentSubagents":50 // inline\n}'), 50);
  assert.equal(parseConcurrencyConfig('/* block */{"globalConcurrentSubagents":50}'), 50);
  const stripped = stripJsoncComments('{"url":"https://example.test/a/*b*/c//d"} // trailing');
  assert.equal(JSON.parse(stripped).url, "https://example.test/a/*b*/c//d");
});

test("parseCheckForUpdatesConfig defaults true unless explicitly false", () => {
  const template = readFileSync("dist/global-concurrency.jsonc", "utf8");
  assert.equal(parseCheckForUpdatesConfig(template), true);
  assert.equal(parseCheckForUpdatesConfig("{}"), true);
  assert.equal(parseCheckForUpdatesConfig("{not json"), true);
  assert.equal(parseCheckForUpdatesConfig('{"checkForUpdates":"false"}'), true);
  assert.equal(parseCheckForUpdatesConfig('{"checkForUpdates":false}'), false);
});

await asyncTest("first-run ceiling prompts on absent config and writes manual", async () => {
  const dir = tmpSlotDir();
  const file = join(dir, "global-subagent-mcp-config.jsonc");
  const lines = [];
  try {
    const result = await ensureFirstRunPermissionCeiling({
      path: file,
      isTTY: true,
      input: Readable.from(["3\n"]),
      output: sink(),
      log: (line) => lines.push(line),
    });
    assert.equal(result, "manual");
    assert.equal(parsePermissionsCeilingConfig(readFileSync(file, "utf8")), "manual");
    assert.deepEqual(lines, [
      "Choose permission ceiling for first run:",
      "  1. Yolo   - preserve historical bypass/danger-full-access except config self-protection.",
      "  2. Auto   - shared engine gates unsafe/residue actions. (Recommended)",
      "  3. Manual - ask for human approval for residue; danger is denied.",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await asyncTest("first-run ceiling non-TTY writes auto without prompting", async () => {
  const dir = tmpSlotDir();
  const file = join(dir, "global-subagent-mcp-config.jsonc");
  const lines = [];
  try {
    const result = await ensureFirstRunPermissionCeiling({ path: file, isTTY: false, log: (line) => lines.push(line) });
    assert.equal(result, "auto");
    assert.equal(parsePermissionsCeilingConfig(readFileSync(file, "utf8")), "auto");
    assert.deepEqual(lines, ["Permission ceiling: non-TTY first run, defaulting to auto."]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await asyncTest("first-run ceiling skips existing config", async () => {
  const dir = tmpSlotDir();
  const file = join(dir, "global-subagent-mcp-config.jsonc");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{"permissionsCeiling":"yolo"}', "utf8");
    const result = await ensureFirstRunPermissionCeiling({
      path: file,
      isTTY: true,
      input: Readable.from(["3\n"]),
      output: sink(),
      log: () => assert.fail("existing config must not prompt"),
    });
    assert.equal(result, null);
    assert.equal(parsePermissionsCeilingConfig(readFileSync(file, "utf8")), "yolo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reserveSlot rejects at cap and rolls back its own marker", () => {
  const dir = tmpSlotDir();
  const max = 3;
  try {
    seedSlots(dir, max);
    const result = reserveSlot("x", max, dir);
    assert.equal(result.ok, false);
    assert.equal(result.current, max);
    assert.equal(existsSync(slotPathForAgent(dir, "x")), false);
    assert.equal(countSlots(dir), max);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reserveSlot backs out the loser when contenders exceed max one", () => {
  const dir = tmpSlotDir();
  const max = 1;
  try {
    const first = reserveSlot("first", max, dir);
    const second = reserveSlot("second", max, dir);
    const results = [first, second];
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.equal(countSlots(dir), max);
    assert.equal(readdirSync(dir).filter((f) => f.startsWith("slot-")).length, max);
    assert.equal(existsSync(slotPathForAgent(dir, "second")), false);
    assert.equal(second.ok, false);
    assert.equal(second.current, max);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reserveSlot succeeds under cap and creates a new slot file", () => {
  const dir = tmpSlotDir();
  const max = 3;
  seedSlots(dir, max - 1);
  const result = reserveSlot("y", max, dir);
  assert.equal(result.ok, true);
  assert.equal(existsSync(result.slotPath), true);
  const metadata = readSlotMetadata(result.slotPath);
  assert.equal(metadata.agent_id, "y");
  assert.equal(metadata.server_pid, process.pid);
  assert.equal(typeof metadata.last_activity_ms, "number");
  assert.equal(countSlots(dir), max);
  releaseFixture = { dir, slotPath: result.slotPath, max };
});

test("slotDir namespaces default slots per user and ignores legacy flat files", () => {
  withTemporarySlotBase(({ base, userDir }) => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "slot-foreign.json"), "{}");
    assert.notEqual(userDir, base);

    const result = reserveSlot("namespaced", 3);
    assert.equal(result.ok, true);
    assert.equal(result.slotPath.startsWith(userDir), true);
    assert.equal(countSlots(), 1);
    assert.equal(countSlots(base), 1);
  });
});

test("reserveSlot rejects when slot directory cannot be created", () => {
  const dir = tmpSlotDir();
  const max = 3;
  writeFileSync(dir, "not a directory");
  try {
    const result = reserveSlot("blocked", max, dir);
    assert.equal(result.ok, false);
    assert.equal(result.current, -1);
    assert.equal(result.max, max);
    assert.match(result.error, /EEXIST|not a directory|file already exists/i);
  } finally {
    rmSync(dir, { force: true });
  }
});

test("reserveSlot can cull stale slots without blocking for force grace", () => {
  const max = 1;
  const now = 1_000_000;
  const calls = [];
  const scheduled = [];
  withTemporarySlotBase(({ userDir: dir }) => {
    mkdirSync(dir, { recursive: true });
    const stale = slotPathForAgent(dir, "stale");
    writeSlotMetadata(stale, {
      agent_id: "stale",
      server_pid: 777,
      child_pid: 1234,
      started_at_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    });
    const result = reserveSlot("new", max, dir, {
      now: () => now,
      platform: "win32",
      runCommand: (command, args) => calls.push({ command, args }),
      sleepMs: () => assert.fail("reserveSlot server path must not block for force grace"),
      isProcessAlive: (pid) => pid !== 777,
      isSubagentChildProcess: () => true,
      scheduleForceKill: (ms, kill) => scheduled.push({ ms, kill }),
    });
    assert.equal(result.ok, true);
    assert.equal(existsSync(stale), false);
    assert.deepEqual(calls, [{ command: "taskkill", args: ["/PID", "1234", "/T"] }]);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].ms, ZOMBIE_FORCE_GRACE_MS);
    scheduled[0].kill();
    assert.deepEqual(calls, [
      { command: "taskkill", args: ["/PID", "1234", "/T"] },
      { command: "taskkill", args: ["/PID", "1234", "/T", "/F"] },
    ]);
  });
});

test("releaseSlot drops the reserved slot count and is idempotent", () => {
  assert.ok(releaseFixture, "reserve under cap test must provide a slotPath");
  try {
    releaseSlot(releaseFixture.slotPath);
    assert.equal(countSlots(releaseFixture.dir), releaseFixture.max - 1);
    assert.doesNotThrow(() => releaseSlot(releaseFixture.slotPath));
  } finally {
    rmSync(releaseFixture.dir, { recursive: true, force: true });
    releaseFixture = null;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
