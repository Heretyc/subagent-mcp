import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteFile, atomicWriteJson } from "../dist/orchestration/atomic-write.js";

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

function tmpSiblings(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

test("atomicWriteFile writes intact content and leaves no temp sibling", () => {
  const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
  const path = join(dir, "state.json");
  try {
    atomicWriteFile(path, "before", { encoding: "utf8", mode: 0o600 });
    atomicWriteFile(path, "after", { encoding: "utf8", mode: 0o600 });
    assert.equal(readFileSync(path, "utf8"), "after");
    assert.deepEqual(tmpSiblings(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("atomicWriteJson preserves json content and requested owner-only mode where supported", () => {
  const dir = mkdtempSync(join(tmpdir(), "atomic-write-json-"));
  const path = join(dir, "state.json");
  try {
    atomicWriteJson(path, { ok: true }, { encoding: "utf8", mode: 0o600 });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { ok: true });
    assert.deepEqual(tmpSiblings(dir), []);
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("atomicWriteFile cleans temp file after failed write", () => {
  const dir = mkdtempSync(join(tmpdir(), "atomic-write-fail-"));
  const path = join(dir, "missing", "state.json");
  try {
    assert.throws(() => atomicWriteFile(path, "data", { encoding: "utf8", mode: 0o600 }));
    assert.equal(existsSync(path), false);
    assert.deepEqual(tmpSiblings(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audited orchestration state modules route writes through atomic helper", () => {
  const modules = ["marker.ts", "reminder.ts", "model-mode.ts", "liveness.ts"];
  for (const name of modules) {
    const source = readFileSync(join(process.cwd(), "src", "orchestration", name), "utf8");
    assert.match(source, /atomicWrite(?:File|Json)/, `${name} should use atomic helper`);
    assert.doesNotMatch(source, /\bwriteFileSync\b/, `${name} must not write state directly`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
