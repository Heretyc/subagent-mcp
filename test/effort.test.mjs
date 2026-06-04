import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { mapModel, resolveEffort, buildCommand } from "../dist/effort.js";

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

// 1. mapModel: opus and opus-4-8 both -> "claude-opus-4-8"
test("mapModel opus -> claude-opus-4-8", () => {
  assert.equal(mapModel("claude", "opus"), "claude-opus-4-8");
});
test("mapModel opus-4-8 -> claude-opus-4-8", () => {
  assert.equal(mapModel("claude", "opus-4-8"), "claude-opus-4-8");
});

// 2. (claude, opus, ultracode) buildCommand: args include "--settings"; file exists with {"ultracode":true}; no "--effort"
test("(claude,opus,ultracode) buildCommand has --settings, no --effort, file contains ultracode:true", () => {
  const result = buildCommand("claude", "opus", "ultracode", "test", process.cwd());
  assert.ok(result.ucSettingsPath, "ucSettingsPath should be set");
  const settingsIdx = result.args.indexOf("--settings");
  assert.ok(settingsIdx !== -1, "args should include --settings");
  assert.equal(result.args[settingsIdx + 1], result.ucSettingsPath, "--settings arg should be the ucSettingsPath");
  assert.ok(existsSync(result.ucSettingsPath), "temp settings file should exist");
  const contents = JSON.parse(readFileSync(result.ucSettingsPath, "utf-8"));
  assert.deepEqual(contents, { ultracode: true }, "file should contain {ultracode:true}");
  assert.ok(!result.args.includes("--effort"), "args should NOT include --effort");
  unlinkSync(result.ucSettingsPath);
});

// 3. (claude, opus-4-8, ultracode): same as #2
test("(claude,opus-4-8,ultracode) buildCommand has --settings, no --effort, file contains ultracode:true", () => {
  const result = buildCommand("claude", "opus-4-8", "ultracode", "test", process.cwd());
  assert.ok(result.ucSettingsPath, "ucSettingsPath should be set");
  const settingsIdx = result.args.indexOf("--settings");
  assert.ok(settingsIdx !== -1, "args should include --settings");
  assert.ok(existsSync(result.ucSettingsPath), "temp settings file should exist");
  const contents = JSON.parse(readFileSync(result.ucSettingsPath, "utf-8"));
  assert.deepEqual(contents, { ultracode: true }, "file should contain {ultracode:true}");
  assert.ok(!result.args.includes("--effort"), "args should NOT include --effort");
  unlinkSync(result.ucSettingsPath);
});

// 4. (codex, gpt-5.5, ultracode): throws, message contains "Opus 4.8+"
test("(codex,gpt-5.5,ultracode) throws with 'Opus 4.8+' in message", () => {
  assert.throws(
    () => buildCommand("codex", "gpt-5.5", "ultracode", "test", process.cwd()),
    (err) => {
      assert.ok(err.message.includes("Opus 4.8+"), `Expected 'Opus 4.8+' in: ${err.message}`);
      return true;
    }
  );
});

// 5. (claude, haiku, ultracode): throws
test("(claude,haiku,ultracode) throws", () => {
  assert.throws(() => buildCommand("claude", "haiku", "ultracode", "test", process.cwd()));
});

// 6. (claude, sonnet, ultracode): throws
test("(claude,sonnet,ultracode) throws", () => {
  assert.throws(() => buildCommand("claude", "sonnet", "ultracode", "test", process.cwd()));
});

// 7. (claude, opus, max): args include "--effort","max"
test("(claude,opus,max) args include --effort max", () => {
  const result = buildCommand("claude", "opus", "max", "test", process.cwd());
  const effortIdx = result.args.indexOf("--effort");
  assert.ok(effortIdx !== -1, "args should include --effort");
  assert.equal(result.args[effortIdx + 1], "max", "--effort value should be max");
});

// 8. (codex, gpt-5.5, max): throws, message contains "not valid for gpt-5.5"
test("(codex,gpt-5.5,max) throws with 'not valid for gpt-5.5' in message", () => {
  assert.throws(
    () => buildCommand("codex", "gpt-5.5", "max", "test", process.cwd()),
    (err) => {
      assert.ok(err.message.includes("not valid for gpt-5.5"), `Expected 'not valid for gpt-5.5' in: ${err.message}`);
      return true;
    }
  );
});

// 9. (codex, gpt-5.5, xhigh): args include model_reasoning_effort="xhigh"
test("(codex,gpt-5.5,xhigh) args include model_reasoning_effort=\"xhigh\"", () => {
  const result = buildCommand("codex", "gpt-5.5", "xhigh", "test", process.cwd());
  const hasEffortConfig = result.args.some(arg => arg.includes('model_reasoning_effort="xhigh"'));
  assert.ok(hasEffortConfig, `Expected model_reasoning_effort="xhigh" in args: ${result.args.join(" ")}`);
});

// 10. (claude, sonnet, xhigh): args include "--effort","xhigh"
test("(claude,sonnet,xhigh) args include --effort xhigh", () => {
  const result = buildCommand("claude", "sonnet", "xhigh", "test", process.cwd());
  const effortIdx = result.args.indexOf("--effort");
  assert.ok(effortIdx !== -1, "args should include --effort");
  assert.equal(result.args[effortIdx + 1], "xhigh", "--effort value should be xhigh");
});

// 11. (claude, haiku, high): args do NOT include "--effort"
test("(claude,haiku,high) args do NOT include --effort", () => {
  const result = buildCommand("claude", "haiku", "high", "test", process.cwd());
  assert.ok(!result.args.includes("--effort"), "args should NOT include --effort for haiku");
});

// --- Claude output format: stream-json drives the visible-stream heartbeat ---
// WHY: poll_agent's heartbeat + recent_stream parse Claude's per-line
// `stream-json` events. A single buffered `--output-format json` blob would
// arrive as one chunk at the end, defeating live heartbeats; the CLI also
// requires `--verbose` alongside `stream-json` in print mode.

function assertStreamJson(args, label) {
  const i = args.indexOf("--output-format");
  assert.ok(i !== -1, `${label}: args should include --output-format`);
  assert.equal(args[i + 1], "stream-json", `${label}: --output-format should be stream-json`);
  assert.ok(!args.includes("json"), `${label}: stale buffered "json" value must be gone`);
  assert.ok(args.includes("--verbose"), `${label}: stream-json print mode requires --verbose`);
}

// 12. (claude, sonnet, high): normal path uses stream-json --verbose
test("(claude,sonnet,high) uses --output-format stream-json --verbose", () => {
  const result = buildCommand("claude", "sonnet", "high", "test", process.cwd());
  assertStreamJson(result.args, "normal");
});

// 13. (claude, opus, ultracode): ultracode path ALSO uses stream-json --verbose
test("(claude,opus,ultracode) uses --output-format stream-json --verbose", () => {
  const result = buildCommand("claude", "opus", "ultracode", "test", process.cwd());
  assertStreamJson(result.args, "ultracode");
  unlinkSync(result.ucSettingsPath);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
