import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  countSlots,
  readSlotMetadata,
  reserveSlot,
  slotPathForAgent,
  writeSlotMetadata,
} from "../dist/concurrency.js";

const repo = new URL("..", import.meta.url);

function tmpSlotDir() {
  return join(tmpdir(), `subagent-concurrency-guard-${randomUUID()}`);
}

function seedSlots(dir, count) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `slot-existing-${i}.json`), "{}");
  }
}

function run() {
  const fullDir = tmpSlotDir();
  try {
    seedSlots(fullDir, 2);
    const rejected = reserveSlot("blocked", 2, fullDir);
    assert.equal(rejected.ok, false, "reserveSlot should reject before writing when already at cap");
    assert.equal(rejected.current, 2);
    assert.equal(existsSync(slotPathForAgent(fullDir, "blocked")), false);
    assert.equal(countSlots(fullDir), 2);
  } finally {
    rmSync(fullDir, { recursive: true, force: true });
  }

  const underDir = tmpSlotDir();
  try {
    seedSlots(underDir, 1);
    const accepted = reserveSlot("accepted", 2, underDir);
    assert.equal(accepted.ok, true, "reserveSlot should admit one contender under cap");
    assert.equal(accepted.current, 2, "successful reservation should report the post-write recount");
    assert.equal(countSlots(underDir), 2);
    assert.equal(readSlotMetadata(accepted.slotPath).agent_id, "accepted");
  } finally {
    rmSync(underDir, { recursive: true, force: true });
  }

  const contenderDir = tmpSlotDir();
  try {
    const first = reserveSlot("first", 1, contenderDir);
    const second = reserveSlot("second", 1, contenderDir);
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.current, 1, "failed contender should report a fresh count");
    assert.equal(countSlots(contenderDir), 1);
    assert.equal(readdirSync(contenderDir).filter((f) => f.startsWith("slot-")).length, 1);
    assert.equal(existsSync(slotPathForAgent(contenderDir, "second")), false);
  } finally {
    rmSync(contenderDir, { recursive: true, force: true });
  }

  // Textual invariant: this is a source-level risk note, not runtime behavior.
  const source = readFileSync(new URL("src/concurrency.ts", repo), "utf8");
  assert.match(source, /TOCTOU/);
  assert.match(source, /count->write->recount/);
}

try {
  run();
  console.log("PASS concurrency guard");
} catch (err) {
  console.error(err);
  process.exit(1);
}
