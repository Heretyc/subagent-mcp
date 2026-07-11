/**
 * orchestration-template.test.mjs - Unit tests for orchestration tag/footer templates.
 */
import assert from "node:assert/strict";

import {
  FOOTER_TEMPLATE,
  TAG_TEMPLATE,
  composeFooter,
  composeTag,
  renderTemplate,
} from "../dist/orchestration/template.js";

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

test("renderTemplate substitutes all provided variables", () => {
  assert.equal(
    renderTemplate("{{greeting}}, {{name}}. {{greeting}} again.", {
      greeting: "hello",
      name: "agent",
    }),
    "hello, agent. hello again.",
  );
});

test("renderTemplate throws on a missing token variable", () => {
  assert.throws(
    () => renderTemplate("hello {{name}}", {}),
    /Missing template variable: name/,
  );
});

test("renderTemplate throws when rendered output still contains an unresolved token", () => {
  assert.throws(
    () => renderTemplate("hello {{name}}", { name: "{{later}}" }),
    /Rendered template contains unresolved placeholder/,
  );
});

test("composeTag uses exact Section 1.4 format for a full variable set", () => {
  assert.equal(
    TAG_TEMPLATE,
    '<subagent-mcp state="{{state}}" kind="{{kind}}" phase="{{phase}}" utilization="{{utilization}}">',
  );
  assert.equal(
    composeTag({
      state: "on",
      kind: "latch-coach",
      phase: "plan",
      utilization: "15%",
    }),
    '<subagent-mcp state="on" kind="latch-coach" phase="plan" utilization="15%">',
  );
});

test("composeFooter returns empty string for null input", () => {
  assert.equal(composeFooter(null), "");
});

test("composeFooter uses exact Section 1.5 format and Math.round", () => {
  assert.equal(FOOTER_TEMPLATE, "Remaining Context={{remaining}}%");
  assert.equal(composeFooter(33.4), "Remaining Context=33%");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
