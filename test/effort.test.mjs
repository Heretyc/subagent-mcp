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

// 9. (codex, gpt-5.5, xhigh): app-server launch validates effort but carries it later in turn/start
test("(codex,gpt-5.5,xhigh) uses app-server stdio, not exec prompt args", () => {
  const result = buildCommand("codex", "gpt-5.5", "xhigh", "test", process.cwd());
  assert.deepEqual(result.args, ["app-server", "--stdio"]);
  assert.ok(!result.args.includes("exec"), "codex must not use one-shot exec");
  assert.ok(!result.args.includes("--json"), "codex prompt must not be passed as a CLI arg");
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

// --- Interactive-only launch args ---
// WHY: provider drivers own the conversation protocol. buildCommand must never
// construct the old one-shot Claude print-mode or Codex exec prompt paths.

function assertInteractiveClaudeArgs(args, label) {
  assert.ok(args.includes("--model"), `${label}: args should include --model`);
  assert.ok(args.includes("--permission-mode"), `${label}: args should preserve permissions`);
  assert.ok(!args.includes("-p"), `${label}: Claude must not use one-shot print mode`);
  assert.ok(!args.includes("--output-format"), `${label}: Claude SDK owns stream transport`);
  assert.ok(!args.includes("stream-json"), `${label}: raw CLI stream-json path is superseded`);
  assert.ok(!args.includes("--verbose"), `${label}: raw print-mode verbose flag is superseded`);
}

// 12. (claude, sonnet, high): normal path is SDK-compatible, not print mode
test("(claude,sonnet,high) uses interactive SDK-compatible args", () => {
  const result = buildCommand("claude", "sonnet", "high", "test", process.cwd());
  assertInteractiveClaudeArgs(result.args, "normal");
});

// 13. (claude, opus, ultracode): ultracode path is also not print mode
test("(claude,opus,ultracode) uses interactive SDK-compatible args", () => {
  const result = buildCommand("claude", "opus", "ultracode", "test", process.cwd());
  assertInteractiveClaudeArgs(result.args, "ultracode");
  unlinkSync(result.ucSettingsPath);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
