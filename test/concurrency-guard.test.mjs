import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

function run() {
  const source = readFileSync(join(repo, "src", "concurrency.ts"), "utf8");
  const reserveSlot = source.match(/export function reserveSlot\([\s\S]*?\r?\n}\r?\n\r?\nexport function releaseSlot/);

  assert.ok(reserveSlot, "reserveSlot source should be present");

  const body = reserveSlot[0];
  const beforeIndex = body.indexOf("const before = countSlots(dir);");
  const rejectIndex = body.indexOf("if (before >= max)");
  const writeIndex = body.indexOf("writeSlotMetadata(slotPath, { agent_id: agentId });");
  const afterIndex = body.indexOf("const after = countSlots(dir);");
  const lostRaceIndex = body.indexOf("if (after > max)");
  const unlinkIndex = body.indexOf("unlinkSync(slotPath);");
  const rejectedCurrentIndex = body.indexOf("return { ok: false, current: countSlots(dir), max };");
  const successCurrentIndex = body.indexOf("return { ok: true, slotPath, current: after, max };");

  assert.ok(beforeIndex !== -1, "reserveSlot should count existing slots before writing");
  assert.ok(rejectIndex > beforeIndex, "reserveSlot should reject at max before writing");
  assert.ok(writeIndex > rejectIndex, "reserveSlot should write only after pre-count admission");
  assert.ok(afterIndex > writeIndex, "reserveSlot should recount after writing");
  assert.ok(lostRaceIndex > afterIndex, "reserveSlot should check the post-write recount");
  assert.ok(unlinkIndex > lostRaceIndex, "reserveSlot should unlink its slot on a lost race");
  assert.ok(rejectedCurrentIndex > unlinkIndex, "lost-race rejection should return a fresh count");
  assert.ok(successCurrentIndex > afterIndex, "successful reservation should return the recount");
  assert.match(
    body,
    /ponytail: count->write->recount narrows the TOCTOU; a cross-process lock would close it fully/
  );
}

try {
  run();
  console.log("PASS concurrency guard");
} catch (err) {
  console.error(err);
  process.exit(1);
}
