import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
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
const concurrencyModule = new URL("dist/concurrency.js", repo).href;

function tmpSlotDir() {
  return join(tmpdir(), `subagent-concurrency-guard-${randomUUID()}`);
}

function seedSlots(dir, count) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `slot-existing-${i}.json`), "{}");
  }
}

function runWorker(workerScript, dir, startFile, id, max) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerScript, dir, startFile, id, String(max)], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${id} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

async function runLostRaceAttempt() {
  const dir = tmpSlotDir();
  const workerScript = join(dir, "reserve-worker.mjs");
  const startFile = join(dir, "start");
  const max = 2;
  const contenderCount = 24;
  try {
    seedSlots(dir, max - 1);
    for (let i = 0; i < 2000; i++) {
      writeFileSync(join(dir, `filler-${i}.txt`), "");
    }
    writeFileSync(
      workerScript,
      `
import { existsSync } from "node:fs";
import { reserveSlot, slotPathForAgent } from ${JSON.stringify(concurrencyModule)};

const [dir, startFile, id, maxText] = process.argv.slice(2);
const deadline = Date.now() + 5000;
while (!existsSync(startFile)) {
  if (Date.now() > deadline) throw new Error("timed out waiting for start barrier");
}
const result = reserveSlot(id, Number(maxText), dir);
process.stdout.write(JSON.stringify({
  id,
  result,
  slotPath: slotPathForAgent(dir, id),
  slotExistsAfterReturn: existsSync(slotPathForAgent(dir, id))
}));
`,
      "utf8"
    );

    const observedNames = new Set(readdirSync(dir));
    const watcher = watch(dir, (_, filename) => {
      if (filename) observedNames.add(String(filename));
    });
    const poll = setInterval(() => {
      for (const name of readdirSync(dir).filter((entry) => entry.startsWith("slot-"))) {
        observedNames.add(name);
      }
    }, 1);
    const workers = Array.from({ length: contenderCount }, (_, i) =>
      runWorker(workerScript, dir, startFile, `race-${i}`, max)
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    writeFileSync(startFile, "go");
    const results = await Promise.all(workers);
    clearInterval(poll);
    watcher.close();

    const failedAfterWriting = results.find(
      ({ id, result, slotExistsAfterReturn }) =>
        result.ok === false &&
        result.current === max &&
        slotExistsAfterReturn === false &&
        observedNames.has(`slot-${id}.json`)
    );
    return { dir, max, results, failedAfterWriting };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function assertLostRaceRollback() {
  let last;
  for (let attempt = 0; attempt < 20; attempt++) {
    last = await runLostRaceAttempt();
    try {
      if (last.failedAfterWriting) {
        assert.ok(countSlots(last.dir) <= last.max, "lost-race rollback must not exceed the cap");
        assert.equal(existsSync(last.failedAfterWriting.slotPath), false, "loser slot must be unlinked");
        assert.ok(
          readdirSync(last.dir).filter((entry) => entry.startsWith("slot-")).length <= last.max,
          "no more than max live slot files should remain after rollback"
        );
        return;
      }
    } finally {
      rmSync(last.dir, { recursive: true, force: true });
    }
  }
  assert.fail("reserveSlot lost-race rollback branch was not observed after 20 barriered attempts");
}

async function run() {
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

  await assertLostRaceRollback();

  // Textual invariant: this is a source-level risk note, not runtime behavior.
  const source = readFileSync(new URL("src/concurrency.ts", repo), "utf8");
  assert.match(source, /TOCTOU/);
  assert.match(source, /count->write->recount/);
}

try {
  await run();
  console.log("PASS concurrency guard");
} catch (err) {
  console.error(err);
  process.exit(1);
}
