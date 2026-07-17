import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendUpdateNotice,
  checkForNpmUpdate,
  clearUpdateNoticeState,
  compareNumericVersions,
  readUpdateCheckStatus,
  readPendingUpdateNotice,
  readUpdateNoticeEmitRecord,
  UPDATE_CHECK_INTERVAL_MS,
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

function metadataFetch(latest, publishedAt, provenance = false) {
  return async () => ({
    ok: true,
    json: async () => ({
      "dist-tags": { latest },
      time: publishedAt ? { [latest]: publishedAt } : {},
      versions: provenance ? { [latest]: { dist: { attestations: [{ provenance: true }] } } } : {},
    }),
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
  home,
  spawn,
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
      home,
      spawn,
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

test("NO_UPDATE_NOTIFIER, CI, and NODE_ENV=test disable check", async () => {
  for (const env of [{ NO_UPDATE_NOTIFIER: "1" }, { CI: "true" }, { NODE_ENV: "test" }]) {
    clearUpdateNoticeState();
    let calls = 0;
    await runCheck({
      env,
      fetch: async () => {
        calls++;
        return { ok: true, json: async () => ({ "dist-tags": { latest: "9.9.9" } }) };
      },
    });
    assert.equal(calls, 0);
  }
});

test("registry checks are daily and record last check time", async () => {
  clearUpdateNoticeState();
  let calls = 0;
  await runCheck({
    latest: "2.12.1",
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => ({ "dist-tags": { latest: "2.12.1" } }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(readUpdateCheckStatus()?.checked_at, new Date(1_700_000_000_000).toISOString());
  await runCheck({ latest: "9.9.9", now: 1_700_000_000_000 + UPDATE_CHECK_INTERVAL_MS - 1 });
  assert.equal(readPendingUpdateNotice(), undefined);
});

test("auto-update requires opt-in, 48h age, and npm provenance", async () => {
  clearUpdateNoticeState();
  const root = mkdtempSync(join(tmpdir(), "update-check-home-"));
  const home = join(root, "home");
  mkdirSync(join(home, ".subagent-mcp"), { recursive: true });
  writeFileSync(join(home, ".subagent-mcp", "init-registry.json"), '{"autoUpdate":true,"entries":[]}\n', "utf8");
  const now = 1_700_000_000_000;
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push([cmd, args]);
    return {
      on(event, cb) {
        if (event === "exit") cb(0);
        return this;
      },
      unref() {},
    };
  };
  try {
    await runCheck({
      latest: "2.12.2",
      installed: "2.12.1",
      fetch: metadataFetch("2.12.2", new Date(now - 47 * 60 * 60 * 1000).toISOString()),
      home,
      now,
      spawn: fakeSpawn,
    });
    assert.equal(calls.length, 0);

    clearUpdateNoticeState();
    await runCheck({
      latest: "2.12.2",
      installed: "2.12.1",
      fetch: metadataFetch("2.12.2", new Date(now - 49 * 60 * 60 * 1000).toISOString()),
      home,
      now,
      spawn: fakeSpawn,
    });
    assert.equal(calls.length, 0);
    assert.match(appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, now), /skipped auto-update: no provenance/);

    clearUpdateNoticeState();
    await runCheck({
      latest: "2.12.2",
      installed: "2.12.1",
      fetch: metadataFetch("2.12.2", new Date(now - 49 * 60 * 60 * 1000).toISOString(), true),
      home,
      now,
      spawn: fakeSpawn,
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1].slice(-2), ["update", "--quiet"]);
    assert.match(appendUpdateNotice("TAG", "2.12.1", "sess-A", {}, now), /auto-updated 2\.12\.1->2\.12\.2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
