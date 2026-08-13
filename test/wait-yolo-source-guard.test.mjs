/**
 * wait-yolo-source-guard.test.mjs — source-fidelity guard for Issue #372.
 *
 * `settleYoloPermissions` and the wait attention filters are an inline closure
 * in src/index.ts, so the behavioral suite in wait-yolo-auto-allow.test.mjs
 * necessarily drives a PORT of that loop. This guard pins the port to the
 * shipped source: it scans BOTH src/index.ts and dist/index.js and fails loudly
 * if the real invariants drift away from what the behavioral tests assume.
 *
 * WHY (mirrors no-five-call.test.mjs / native-suppression style): a behavioral
 * port could keep passing while the shipped code changed. This test encodes the
 * actual intent — the exact diagnostic phrase/fields, the snapshot-only
 * authority, the dual pre_wait/in_loop settle calls, and the yolo attention
 * exclusion filter — against the real source and compiled output.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.stack ?? e.message}`);
    failed++;
  }
}

const SRC = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const DIST = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
const SOURCES = { "src/index.ts": SRC, "dist/index.js": DIST };

function eachSource(fn) {
  for (const [name, text] of Object.entries(SOURCES)) fn(name, text);
}

test("settleYoloPermissions exists and is invoked at pre_wait AND in_loop", () => {
  eachSource((name, text) => {
    assert.ok(text.includes("const settleYoloPermissions"), `${name}: settle fn defined`);
    assert.ok(text.includes('settleYoloPermissions("pre_wait")'), `${name}: pre_wait call`);
    assert.ok(text.includes('settleYoloPermissions("in_loop")'), `${name}: in_loop call`);
  });
});

test("authority is the LAUNCH snapshot only (permissionSnapshot.ceiling === yolo)", () => {
  eachSource((name, text) => {
    assert.ok(
      text.includes('agent.permissionSnapshot.ceiling !== "yolo"'),
      `${name}: settle guards on launch-snapshot ceiling`
    );
    // The yolo settle decision must NOT consult record.permission_ceiling or a
    // freshly-read current config. Extract the settle function body and check.
    const start = text.indexOf("const settleYoloPermissions");
    assert.ok(start !== -1, `${name}: settle body found`);
    const body = text.slice(start, text.indexOf("Step 1", start));
    assert.ok(
      !body.includes("permission_ceiling") && !body.includes("readPermissionsCeiling"),
      `${name}: settle must not consult record.permission_ceiling / current config`
    );
  });
});

test("wait attention selection excludes yolo-snapshot permission requests at BOTH sites", () => {
  eachSource((name, text) => {
    const matches = text.match(/permissionSnapshot\.ceiling !== "yolo"/g) ?? [];
    // 1 occurrence in the settle guard + 2 in the pre-wait / in-loop filters.
    assert.ok(
      matches.length >= 3,
      `${name}: expected >=3 yolo-ceiling checks, found ${matches.length}`
    );
    // Whitespace-insensitive: src wraps the call across lines, dist inlines it.
    const collapsed = text.replace(/\s+/g, " ");
    const filterMatches =
      collapsed.match(
        /selectUnreportedPermissionRequested\([^)]*\)\.filter\(\(a\) => a\.permissionSnapshot\.ceiling !== "yolo"\)/g
      ) ?? [];
    assert.ok(
      filterMatches.length >= 2,
      `${name}: expected the yolo attention filter at both wait sites, found ${filterMatches.length}`
    );
  });
});

test("diagnostic phrase and all sanitized fields are present in shipped code", () => {
  eachSource((name, text) => {
    assert.ok(
      text.includes("[wait][yolo] decision recorded and handed to driver"),
      `${name}: exact diagnostic phrase`
    );
    for (const field of [
      "agent_id=",
      "request_id=",
      "harness_channel=",
      "tool_or_method=",
      "rule=",
      "launch_ceiling=",
      "phase=",
      "age_ms=",
      "outcome=",
    ]) {
      assert.ok(text.includes(field), `${name}: diagnostic field ${field}`);
    }
  });
});

test("diagnostic emits sanitized record metadata only (no action/input/command/path)", () => {
  eachSource((name, text) => {
    const anchor = text.indexOf("decision recorded and handed to driver");
    assert.ok(anchor !== -1);
    // The console.error template runs from the phrase to the closing backtick.
    const tmpl = text.slice(anchor, text.indexOf("`", anchor + 10) + 1);
    for (const forbidden of ["request.action", ".input", "command=", "path=", "payload"]) {
      assert.ok(!tmpl.includes(forbidden), `${name}: diagnostic must not include ${forbidden}`);
    }
  });
});

test("actionable non-prompt error result is present (isError + poll_agent guidance)", () => {
  eachSource((name, text) => {
    assert.ok(
      text.includes("could not record auto-allow for yolo agent"),
      `${name}: actionable error text`
    );
    assert.ok(text.includes("Do not respond_permission"), `${name}: not-a-prompt guidance`);
    assert.ok(
      text.includes("a yolo ") && text.includes("agent must not be prompted for permission"),
      `${name}: prompt-forbidden guidance`
    );
    assert.ok(/isError:\s*true/.test(text), `${name}: isError:true error result`);
  });
});

test("vanished-race recheck + benign-race log are present", () => {
  eachSource((name, text) => {
    assert.ok(text.includes("benign race: request already settled"), `${name}: benign race log`);
    assert.ok(
      text.includes("stillPending") || text.includes("still pending"),
      `${name}: pending recheck`
    );
  });
});

console.log(`\nwait-yolo-source-guard results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
