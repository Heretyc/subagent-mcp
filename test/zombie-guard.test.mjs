import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  currentUserSlotNamespace,
  slotDir,
} from "../dist/concurrency.js";

import {
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_REPORTS_FILENAME,
  cullStaleSlots,
  drainZombieReports,
  slotPathForAgent,
  writeSlotMetadata,
} from "../dist/zombie.js";

function tmpSlotDir() {
  return join(tmpdir(), `subagent-zombie-guard-${randomUUID()}`);
}

function run() {
  const jsonlDir = tmpSlotDir();
  try {
    mkdirSync(jsonlDir, { recursive: true });
    const valid = {
      kind: "zombie_killed",
      agent_id: "agent-jsonl",
      child_pid: 101,
      server_pid: null,
      slot_path: "/tmp/slot-agent-jsonl.json",
      reason: "stale_live",
      detected_at_ms: 2,
      last_activity_ms: 1,
      message: "valid",
    };
    writeFileSync(join(jsonlDir, ZOMBIE_REPORTS_FILENAME), `${JSON.stringify(valid)}\n{bad-json\n`);
    const errors = [];
    const originalError = console.error;
    console.error = (message) => errors.push(String(message));
    try {
      assert.deepEqual(drainZombieReports(jsonlDir), [valid]);
      assert.equal(errors.length, 1, "corrupt jsonl lines should be skipped, not fatal");
      assert.match(errors[0], /skipped corrupt jsonl line/);
      assert.deepEqual(drainZombieReports(jsonlDir), []);
    } finally {
      console.error = originalError;
    }
  } finally {
    rmSync(jsonlDir, { recursive: true, force: true });
  }

  const liveOwnerDir = tmpSlotDir();
  try {
    const now = 1_000_000;
    mkdirSync(liveOwnerDir, { recursive: true });
    const slot = slotPathForAgent(liveOwnerDir, "live-owner");
    writeSlotMetadata(slot, {
      agent_id: "live-owner",
      server_pid: 777,
      child_pid: 888,
      started_at_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    });
    const records = cullStaleSlots(liveOwnerDir, {
      now: () => now,
      isProcessAlive: (pid) => pid === 777 || pid === 888,
      runCommand: () => assert.fail("live owner must spare its child"),
      sleepMs: () => assert.fail("live owner must not enter force-grace kill path"),
    });
    assert.deepEqual(records, []);
    assert.equal(existsSync(slot), true);
  } finally {
    rmSync(liveOwnerDir, { recursive: true, force: true });
  }

  const orphanDir = tmpSlotDir();
  const previousSlotBase = process.env.SUBAGENT_SLOT_DIR;
  try {
    process.env.SUBAGENT_SLOT_DIR = orphanDir;
    const now = 1_000_000;
    const childPid = process.pid + 100_000;
    const calls = [];
    const userDir = slotDir();
    assert.equal(userDir, join(orphanDir, currentUserSlotNamespace()));
    mkdirSync(userDir, { recursive: true });
    const slot = slotPathForAgent(userDir, "orphan");
    writeSlotMetadata(slot, {
      agent_id: "orphan",
      server_pid: 777,
      child_pid: childPid,
      started_at_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
      last_activity_ms: now - ZOMBIE_LIVE_IDLE_MS - 1000,
    });
    const records = cullStaleSlots(userDir, {
      now: () => now,
      platform: "win32",
      isProcessAlive: (pid) => pid !== 777,
      isSubagentChildProcess: () => true,
      runCommand: (command, args) => calls.push({ command, args }),
      sleepMs: () => {},
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].agent_id, "orphan");
    assert.equal(existsSync(slot), false);
    assert.deepEqual(calls[0], { command: "taskkill", args: ["/PID", String(childPid), "/T"] });
  } finally {
    if (previousSlotBase === undefined) delete process.env.SUBAGENT_SLOT_DIR;
    else process.env.SUBAGENT_SLOT_DIR = previousSlotBase;
    rmSync(orphanDir, { recursive: true, force: true });
  }
}

try {
  run();
  console.log("PASS zombie guard");
} catch (err) {
  console.error(err);
  process.exit(1);
}
