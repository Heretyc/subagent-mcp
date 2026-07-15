import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const hookRegistrationFiles = [
  "src/setup.ts",
  "scripts/postinstall.mjs",
  "hooks/hooks.json",
];

function read(path) {
  return readFileSync(path, "utf8");
}

test("install paths do not register PostToolUse hooks", () => {
  for (const path of hookRegistrationFiles) {
    assert.doesNotMatch(read(path), /\bPostToolUse\b/, `${path} must not register PostToolUse`);
  }
});

test("hooks manifest contains no output-adjacent PostToolUse hook", () => {
  const manifest = JSON.parse(read("hooks/hooks.json"));
  assert.ok(manifest && typeof manifest === "object");
  assert.ok(manifest.hooks && typeof manifest.hooks === "object");
  assert.equal(Object.hasOwn(manifest.hooks, "PostToolUse"), false);
});

test("hooks manifest uses stable ids and bare node commands", () => {
  const manifest = JSON.parse(read("hooks/hooks.json"));
  const pretool = manifest.hooks.PreToolUse[0].hooks[0];
  const prompt = manifest.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(pretool.id, "subagent-mcp-pretool");
  assert.equal(prompt.id, "subagent-mcp-orchestration-claude");
  assert.match(pretool.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\//);
  assert.match(prompt.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\//);
  assert.doesNotMatch(JSON.stringify(manifest), /\bsh\s+-c\b/);
});

test("install paths do not target poll_agent or wait from hook registration", () => {
  const outputAdjacent = /\bPostToolUse\b[\s\S]{0,400}\b(?:poll_agent|wait|stdout_tail|stderr_tail|final_output)\b|\b(?:poll_agent|wait|stdout_tail|stderr_tail|final_output)\b[\s\S]{0,400}\bPostToolUse\b/;
  for (const path of hookRegistrationFiles) {
    assert.doesNotMatch(read(path), outputAdjacent, `${path} must not add output-adjacent hooks`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
