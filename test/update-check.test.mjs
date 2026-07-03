import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendUpdateNotice,
  checkForNpmUpdate,
  clearUpdateNoticeState,
  compareNumericVersions,
  readPendingUpdateNotice,
  readUpdateNoticeEmitRecord,
  UPDATE_NOTICE_INTERVAL_MS,
  UPDATE_NOTICE_TEXT,
  writePendingUpdateNotice,
} from "../dist/orchestration/update-check.js";

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tempConfig(text = '{"globalConcurrentSubagents":20,"checkForUpdates":true}') {
  const dir = mkdtempSync(join(tmpdir(), "update-check-config-"));
  const path = join(dir, "global-concurrency.jsonc");
  writeFileSync(path, text, "utf8");
  return { dir, path };
}

function metadataFetch(latest) {
  return async () => ({
    ok: true,
    json: async () => ({ "dist-tags": { latest } }),
  });
}

function httpFailFetch() {
  return async () => ({ ok: false, status: 500, json: async () => ({}) });
}

function timeoutFetch() {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
}

async function runCheck({
  latest = "2.12.2",
  installed = "2.12.1",
  fetch = metadataFetch(latest),
  configText,
  env = {},
  now = 1_700_000_000_000,
} = {}) {
  const { dir, path } = tempConfig(configText);
  try {
    await checkForNpmUpdate({
      fetch,
      registryBaseUrl: "https://registry.example.test",
      timeoutMs: 1,
      now: () => now,
      configPath: path,
      env,
      packageInfo: () => ({ name: "@heretyc/subagent-mcp", version: installed }),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("numeric version compare uses x.y.z ordering", () => {
  assert.equal(compareNumericVersions("2.12.1", "2.12.2"), -1);
  assert.equal(compareNumericVersions("2.13.0", "2.12.9"), 1);
  assert.equal(compareNumericVersions("3.0.0", "3.0.0"), 0);
  assert.equal(compareNumericVersions("bad", "3.0.0"), 0);
});

test("offline, timeout, and HTTP failures silently skip persistence", async () => {
  clearUpdateNoticeState();
  await runCheck({ fetch: async () => { throw new Error("offline"); } });
  assert.equal(readPendingUpdateNotice(), undefined);
  await runCheck({ fetch: timeoutFetch() });
  assert.equal(readPendingUpdateNotice(), undefined);
  await runCheck({ fetch: httpFailFetch() });
  assert.equal(readPendingUpdateNotice(), undefined);
});

test("pending notice persists only when installed version is older", async () => {
  clearUpdateNoticeState();
  await runCheck({ latest: "2.12.2", installed: "2.12.1" });
  assert.equal(readPendingUpdateNotice()?.latest_version, "2.12.2");

  clearUpdateNoticeState();
  await runCheck({ latest: "2.12.1", installed: "2.12.1" });
  assert.equal(readPendingUpdateNotice(), undefined);

  clearUpdateNoticeState();
  await runCheck({ latest: "2.12.1", installed: "2.12.2" });
  assert.equal(readPendingUpdateNotice(), undefined);
});

test("append emits exact notice as suffix and records session", () => {
  clearUpdateNoticeState();
  writePendingUpdateNotice("2.12.2", 1000);
  const out = appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, 2000);
  assert.equal(out, `TAG\n${UPDATE_NOTICE_TEXT}`);
  assert.equal(readUpdateNoticeEmitRecord()?.session_id, "sess-A");
});

test("append suppresses within 12h and for the same session", () => {
  clearUpdateNoticeState();
  writePendingUpdateNotice("2.12.2", 1000);
  assert.match(appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, 2000), /Notice:/);
  assert.equal(
    appendUpdateNotice("TAG", "2.12.1", "sess-B", {}, 2000 + UPDATE_NOTICE_INTERVAL_MS - 1),
    "TAG"
  );
  assert.equal(
    appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, 2000 + UPDATE_NOTICE_INTERVAL_MS + 1),
    "TAG"
  );
});

test("append emits again for a new session after 12h", () => {
  clearUpdateNoticeState();
  writePendingUpdateNotice("2.12.2", 1000);
  assert.match(appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, 2000), /Notice:/);
  assert.match(
    appendUpdateNotice("TAG", "2.12.1", "sess-B", {}, 2000 + UPDATE_NOTICE_INTERVAL_MS + 1),
    /Notice:/
  );
  assert.equal(readUpdateNoticeEmitRecord()?.session_id, "sess-B");
});

test("append without session id falls back to timestamp-only throttling", () => {
  clearUpdateNoticeState();
  writePendingUpdateNotice("2.12.2", 1000);
  assert.match(appendUpdateNotice("TAG", "2.12.1", undefined, {}, 2000), /Notice:/);
  assert.equal(readUpdateNoticeEmitRecord()?.session_id, undefined);
  assert.equal(
    appendUpdateNotice("TAG", "2.12.1", undefined, {}, 2000 + UPDATE_NOTICE_INTERVAL_MS - 1),
    "TAG"
  );
  assert.match(
    appendUpdateNotice("TAG", "2.12.1", undefined, {}, 2000 + UPDATE_NOTICE_INTERVAL_MS + 1),
    /Notice:/
  );
});

test("stale pending notice is ignored and cleaned", () => {
  clearUpdateNoticeState();
  writePendingUpdateNotice("2.12.1", 1000);
  assert.equal(appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, 2000), "TAG");
  assert.equal(readPendingUpdateNotice(), undefined);
});

test("settings false disables check and notice", async () => {
  clearUpdateNoticeState();
  let calls = 0;
  await runCheck({
    configText: '{"globalConcurrentSubagents":20,"checkForUpdates":false}',
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => ({ "dist-tags": { latest: "9.9.9" } }) };
    },
  });
  assert.equal(calls, 0);
  assert.equal(readPendingUpdateNotice(), undefined);

  writePendingUpdateNotice("9.9.9", 1000);
  const { dir, path } = tempConfig('{"globalConcurrentSubagents":20,"checkForUpdates":false}');
  try {
    assert.equal(appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, 2000, path), "TAG");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SUBAGENT_UPDATE_CHECK=0 or false disables check and notice", async () => {
  clearUpdateNoticeState();
  let calls = 0;
  await runCheck({
    env: { SUBAGENT_UPDATE_CHECK: "0" },
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => ({ "dist-tags": { latest: "9.9.9" } }) };
    },
  });
  assert.equal(calls, 0);

  writePendingUpdateNotice("9.9.9", 1000);
  assert.equal(
    appendUpdateNotice("TAG", "2.12.1", "sess-A", { SUBAGENT_UPDATE_CHECK: "false" }, 2000),
    "TAG"
  );
});

for (const { name, fn } of tests) {
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

{
  clearUpdateNoticeState();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}
