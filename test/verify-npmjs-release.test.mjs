import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BASE_DELAY_MS,
  runVerifier,
} from "../scripts/verify_npmjs_release.mjs";

test("npmjs verifier tolerates propagation beyond the old 8-attempt window", async () => {
  let calls = 0;
  const waits = [];
  const logs = [];
  const targetName = "@heretyc/subagent-mcp";
  const targetVersion = "3.2.4-beta.0";
  const absent = {
    "dist-tags": { beta: targetVersion, latest: "3.2.3" },
    versions: {},
  };
  const present = {
    "dist-tags": { beta: targetVersion, latest: "3.2.3" },
    versions: { [targetVersion]: { dist: { shasum: "abc" } } },
  };

  const ok = await runVerifier({
    targetName,
    targetVersion,
    loadMetadata: async () => (++calls <= 8 ? absent : present),
    sleep: async (ms) => waits.push(ms),
    log: (line) => logs.push(line),
    errorLog: assert.fail,
  });

  assert.equal(ok, true);
  assert.equal(calls, 9);
  assert.deepEqual(waits, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => n * DEFAULT_BASE_DELAY_MS));
  assert.match(logs.at(-1), /npmjs verified: @heretyc\/subagent-mcp@3\.2\.4-beta\.0 is dist-tags\.beta/);
});

test("npmjs verifier rejects invalid retry inputs before loading metadata", async () => {
  const options = {
    targetName: "@heretyc/subagent-mcp",
    targetVersion: "3.2.4",
    loadMetadata: async () => assert.fail("metadata must not load"),
  };

  await assert.rejects(
    runVerifier({ ...options, attempts: Infinity }),
    /attempts must be a positive safe integer/
  );
  await assert.rejects(
    runVerifier({ ...options, baseDelayMs: Infinity }),
    /baseDelayMs must be a non-negative safe integer/
  );
});

test("npmjs verifier exhausts its finite retry budget", async () => {
  let calls = 0;
  const waits = [];
  const logs = [];
  const errors = [];

  const ok = await runVerifier({
    targetName: "@heretyc/subagent-mcp",
    targetVersion: "3.2.4",
    attempts: 3,
    baseDelayMs: 7,
    loadMetadata: async () => {
      calls++;
      throw new Error("registry unavailable");
    },
    sleep: async (ms) => waits.push(ms),
    log: (line) => logs.push(line),
    errorLog: (line) => errors.push(line),
  });

  assert.equal(ok, false);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [7, 14]);
  assert.deepEqual(logs, [
    "npmjs verify attempt 1/3 failed: registry unavailable; retrying in 7ms",
    "npmjs verify attempt 2/3 failed: registry unavailable; retrying in 14ms",
  ]);
  assert.deepEqual(errors, [
    "npmjs verify failed after 3 attempts for @heretyc/subagent-mcp@3.2.4: registry unavailable",
  ]);
});
