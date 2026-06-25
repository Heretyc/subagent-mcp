import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  buildProcessTreeKillCommands,
  cullStaleSlots,
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

test("cullStaleSlots kills stale slots, records zombies once, and frees cap slot", () => {
  const dir = tmpSlotDir();
  const now = 1_000_000;
  const calls = [];
  const sleeps = [];
  try {
    mkdirSync(dir, { recursive: true });
    const slot = slotPathForAgent(dir, "agent-c");
    writeSlotMetadata(slot, {
      agent_id: "agent-c",
      server_pid: 777,
      child_pid: 888,
      cwd: "/tmp/work",
      started_at_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    });
    const records = cullStaleSlots(dir, {
      now: () => now,
      platform: "win32",
      runCommand: (command, args) => calls.push({ command, args }),
      sleepMs: (ms) => sleeps.push(ms),
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "zombie_killed");
    assert.equal(records[0].message.includes("zombies"), true);
    assert.equal(existsSync(slot), false);
    assert.deepEqual(calls, [
      { command: "taskkill", args: ["/PID", "888", "/T"] },
      { command: "taskkill", args: ["/PID", "888", "/T", "/F"] },
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
