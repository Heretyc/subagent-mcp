import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  slotDir,
} from "../dist/concurrency.js";

import {
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_REPORTS_FILENAME,
  buildProcessTreeKillCommands,
  cullStaleSlots,
  drainJsonl,
  drainZombieIntents,
  drainZombieReports,
  parseSlotMetadata,
  readSlotMetadata,
  slotPathForAgent,
  writeSlotMetadata,
} from "../dist/zombie.js";

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

function tmpSlotDir() {
  return join(tmpdir(), `subagent-zombie-${randomUUID()}`);
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

test("parseSlotMetadata reads enriched slot metadata", () => {
  const metadata = parseSlotMetadata(JSON.stringify({
    schema_version: 1,
    agent_id: "agent-a",
    server_pid: 123,
    child_pid: 456,
    cwd: "/work",
    started_at: "2026-06-25T00:00:00.000Z",
    started_at_ms: 1,
    last_activity_ms: 2,
    status: "processing",
  }), "/tmp/slot-agent-a.json");
  assert.equal(metadata.agent_id, "agent-a");
  assert.equal(metadata.server_pid, 123);
  assert.equal(metadata.child_pid, 456);
  assert.equal(metadata.cwd, "/work");
  assert.equal(metadata.last_activity_ms, 2);
  assert.equal(metadata.status, "processing");
});

test("parseSlotMetadata stays backward compatible with old slot files", () => {
  const metadata = parseSlotMetadata(JSON.stringify({
    pid: 321,
    cwd: "C:/work",
    startedAt: "2026-06-25T00:00:00.000Z",
  }), "C:/slots/slot-old-agent.json");
  assert.equal(metadata.agent_id, "old-agent");
  assert.equal(metadata.server_pid, 321);
  assert.equal(metadata.child_pid, null);
  assert.equal(metadata.cwd, "C:/work");
  assert.equal(metadata.last_activity_ms, Date.parse("2026-06-25T00:00:00.000Z"));
});

test("writeSlotMetadata writes enriched parseable slot metadata", () => {
  const dir = tmpSlotDir();
  try {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "agent-b");
    writeSlotMetadata(slot, {
      agent_id: "agent-b",
      server_pid: 111,
      child_pid: 222,
      cwd: "/tmp/work",
      started_at: "2026-06-25T00:00:00.000Z",
      started_at_ms: 10,
      last_activity_ms: 20,
      status: "stalled",
    });
    const metadata = readSlotMetadata(slot);
    assert.equal(metadata.agent_id, "agent-b");
    assert.equal(metadata.server_pid, 111);
    assert.equal(metadata.child_pid, 222);
    assert.equal(metadata.last_activity_ms, 20);
    assert.equal(metadata.status, "stalled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProcessTreeKillCommands uses tree-aware graceful and force commands", () => {
  assert.deepEqual(buildProcessTreeKillCommands(123, "win32"), {
    graceful: { command: "taskkill", args: ["/PID", "123", "/T"] },
    force: { command: "taskkill", args: ["/PID", "123", "/T", "/F"] },
  });
  assert.deepEqual(buildProcessTreeKillCommands(123, "linux"), {
    graceful: { command: "kill", args: ["-TERM", "-123"] },
    force: { command: "kill", args: ["-KILL", "-123"] },
  });
});

test("drainZombieReports skips corrupt jsonl lines and returns valid records", () => {
  const dir = tmpSlotDir();
  const validA = {
    kind: "zombie_killed",
    agent_id: "agent-jsonl-a",
    child_pid: 101,
    server_pid: null,
    slot_path: "/tmp/slot-agent-jsonl-a.json",
    reason: "stale_live",
    detected_at_ms: 1,
    last_activity_ms: 0,
    message: "first",
  };
  const validB = {
    kind: "zombie_killed",
    agent_id: "agent-jsonl-b",
    child_pid: 202,
    server_pid: null,
    slot_path: "/tmp/slot-agent-jsonl-b.json",
    reason: "stale_live",
    detected_at_ms: 2,
    last_activity_ms: 1,
    message: "second",
  };
  const errors = [];
  const originalError = console.error;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ZOMBIE_REPORTS_FILENAME), [
      JSON.stringify(validA),
      "{not-json",
      JSON.stringify(validB),
      "",
    ].join("\n"));
    console.error = (message) => errors.push(String(message));
    assert.deepEqual(drainZombieReports(dir), [validA, validB]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].includes(ZOMBIE_REPORTS_FILENAME), true);
    assert.deepEqual(drainZombieReports(dir), []);
  } finally {
    console.error = originalError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("drainJsonl returns empty without throwing for unavailable files", () => {
  const dir = tmpSlotDir();
  try {
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(drainJsonl(join(dir, "missing.jsonl")), []);

    const source = join(dir, "blocked.jsonl");
    const claim = join(dir, `blocked.jsonl.${process.pid}.drain`);
    writeFileSync(source, "{\"kind\":\"zombie_killed\"}\n");
    mkdirSync(claim);
    assert.deepEqual(drainJsonl(source), []);
    assert.equal(existsSync(source), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cullStaleSlots kills stale slots, records zombies once, and frees cap slot", () => {
  const now = 1_000_000;
  const childPid = process.pid + 100_000;
  const calls = [];
  const sleeps = [];
  withTemporarySlotBase(({ userDir: dir }) => {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "agent-c");
    writeSlotMetadata(slot, {
      agent_id: "agent-c",
      server_pid: 777,
      child_pid: childPid,
      cwd: "/tmp/work",
      started_at_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    });
    const records = cullStaleSlots(dir, {
      now: () => now,
      platform: "win32",
      runCommand: (command, args) => calls.push({ command, args }),
      sleepMs: (ms) => sleeps.push(ms),
      isProcessAlive: (pid) => pid !== 777,
      isSubagentChildProcess: () => true,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "zombie_killed");
    assert.equal(records[0].message.includes("zombies"), true);
    assert.equal(existsSync(slot), false);
    assert.deepEqual(calls, [
      { command: "taskkill", args: ["/PID", String(childPid), "/T"] },
      { command: "taskkill", args: ["/PID", String(childPid), "/T", "/F"] },
    ]);
    assert.deepEqual(sleeps, [ZOMBIE_FORCE_GRACE_MS]);

    const firstDrain = drainZombieReports(dir);
    assert.equal(firstDrain.length, 1);
    assert.equal(firstDrain[0].agent_id, "agent-c");
    assert.deepEqual(drainZombieReports(dir), []);
    const firstIntentDrain = drainZombieIntents(dir);
    assert.equal(firstIntentDrain.length, 1);
    assert.equal(firstIntentDrain[0].agent_id, "agent-c");
    assert.deepEqual(drainZombieIntents(dir), []);
  });
});

test("cullStaleSlots keeps stale slots owned by a live server", () => {
  const dir = tmpSlotDir();
  const now = 1_000_000;
  try {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "agent-live-owner");
    writeSlotMetadata(slot, {
      agent_id: "agent-live-owner",
      server_pid: 777,
      child_pid: 888,
      cwd: "/tmp/work",
      started_at_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    });
    const records = cullStaleSlots(dir, {
      now: () => now,
      platform: "win32",
      runCommand: () => assert.fail("live owned slot must not be killed"),
      isProcessAlive: (pid) => pid === 777,
      sleepMs: () => assert.fail("live owned slot must not sleep for force grace"),
    });
    assert.equal(records.length, 0);
    assert.equal(existsSync(slot), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cullStaleSlots skips kill when child pid validation fails and still frees stale slot", () => {
  const dir = tmpSlotDir();
  const now = 1_000_000;
  const childPid = process.pid + 100_000;
  const calls = [];
  const sleeps = [];
  try {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "agent-unmanaged");
    writeFileSync(slot, JSON.stringify({
      schema_version: 1,
      agent_id: "agent-unmanaged",
      server_pid: null,
      child_pid: childPid,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    }));
    const records = cullStaleSlots(dir, {
      now: () => now,
      platform: "win32",
      runCommand: (command, args) => calls.push({ command, args }),
      sleepMs: (ms) => sleeps.push(ms),
      isProcessAlive: () => true,
      isSubagentChildProcess: () => false,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].child_pid, childPid);
    assert.equal(existsSync(slot), false);
    assert.deepEqual(calls, []);
    assert.deepEqual(sleeps, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cullStaleSlots ignores fresh slots", () => {
  const dir = tmpSlotDir();
  const now = 1_000_000;
  try {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "agent-d");
    writeSlotMetadata(slot, {
      agent_id: "agent-d",
      server_pid: 777,
      child_pid: 888,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS,
    });
    const records = cullStaleSlots(dir, {
      now: () => now,
      runCommand: () => assert.fail("fresh slot must not be killed"),
    });
    assert.equal(records.length, 0);
    assert.equal(existsSync(slot), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cullStaleSlots frees stale legacy slots without killing server pid", () => {
  const dir = tmpSlotDir();
  const now = Date.parse("2026-06-25T00:10:00.000Z");
  try {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "legacy");
    writeFileSync(slot, JSON.stringify({
      pid: 999,
      cwd: "/tmp/work",
      startedAt: "2026-06-25T00:00:00.000Z",
    }));
    const records = cullStaleSlots(dir, {
      now: () => now,
      isProcessAlive: () => false,
      runCommand: () => assert.fail("legacy server pid must not be killed"),
      sleepMs: () => assert.fail("no child pid means no grace sleep"),
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].server_pid, 999);
    assert.equal(records[0].child_pid, null);
    assert.equal(existsSync(slot), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
