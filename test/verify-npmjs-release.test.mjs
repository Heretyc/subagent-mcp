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
