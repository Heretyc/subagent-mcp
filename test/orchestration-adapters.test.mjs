/**
 * orchestration-adapters.test.mjs — Unit tests for the Claude and Codex
 * provider adapters (dist/hooks/orchestration-claude.js,
 * dist/hooks/orchestration-codex.js).
 *
 * The entry shims are import-safe (their stdin->stdout main() runs only under
 * an isMain gate), so a test can import the exported adapters without the shim
 * firing. Covers:
 *   - claude currentTurn counts 'user' JSONL lines from a synthetic transcript.
 *   - codex currentTurn counts 'turn_context' JSONL lines.
 *   - each provider's isSubagent signals.
 *   - codex SessionStart dispatch emits FULL when active (turn-0 coverage).
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claudeAdapter } from "../dist/hooks/orchestration-claude.js";
import { codexAdapter, runCodexHook } from "../dist/hooks/orchestration-codex.js";
import { enable, disable } from "../dist/orchestration/marker.js";

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

function writeJsonl(lines) {
  const dir = mkdtempSync(join(tmpdir(), "orch-tx-"));
  const file = join(dir, "transcript.jsonl");
  writeFileSync(file, lines.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
  return { dir, file };
}

// ---------------------------------------------------------------------------
// Claude adapter: currentTurn counts 'user' lines
// ---------------------------------------------------------------------------
test("claude currentTurn: counts JSONL lines with type==='user'", () => {
  const { dir, file } = writeJsonl([
    { type: "user", text: "hi" },
    { type: "assistant", text: "hello" },
    { type: "user", text: "again" },
    { type: "system", text: "noise" },
    { type: "user", text: "third" },
  ]);
  try {
    assert.equal(claudeAdapter.currentTurn(file), 3,
      "exactly the three user lines are counted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude currentTurn: missing/undefined transcript -> 0 (fail-safe FULL)", () => {
  assert.equal(claudeAdapter.currentTurn(undefined), 0);
  assert.equal(claudeAdapter.currentTurn(join(tmpdir(), "does-not-exist-xyz.jsonl")), 0);
});

test("claude currentTurn: skips blank and unparseable lines without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "orch-tx-"));
  const file = join(dir, "t.jsonl");
  writeFileSync(file, '\n{"type":"user"}\nnot-json\n\n{"type":"user"}\n', "utf8");
  try {
    assert.equal(claudeAdapter.currentTurn(file), 2,
      "two valid user lines counted; junk lines ignored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Claude adapter: isSubagent signals
// ---------------------------------------------------------------------------
test("claude isSubagent: truthy agent_id -> true", () => {
  assert.equal(claudeAdapter.isSubagent({ agent_id: "abc" }, {}), true);
});

test("claude isSubagent: subagent entrypoint env -> true", () => {
  for (const ep of ["local-agent", "sdk-cli", "sdk-ts", "sdk-py"]) {
    assert.equal(
      claudeAdapter.isSubagent({}, { CLAUDE_CODE_ENTRYPOINT: ep }),
      true,
      `${ep} is a subagent entrypoint`
    );
  }
});

test("claude isSubagent: top-level entrypoints -> false (these SHOULD inject)", () => {
  for (const ep of ["cli", "mcp", "claude-vscode"]) {
    assert.equal(
      claudeAdapter.isSubagent({}, { CLAUDE_CODE_ENTRYPOINT: ep }),
      false,
      `${ep} is a top-level entrypoint and must inject`
    );
  }
  // No agent_id, no entrypoint -> not a subagent.
  assert.equal(claudeAdapter.isSubagent({}, {}), false);
});

// ---------------------------------------------------------------------------
// Codex adapter: currentTurn counts 'turn_context' lines
// ---------------------------------------------------------------------------
test("codex currentTurn: counts JSONL lines with type==='turn_context'", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context" },
    { type: "message" },
    { type: "turn_context" },
    { type: "turn_context" },
  ]);
  try {
    assert.equal(codexAdapter.currentTurn(file), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex currentTurn: unreadable transcript -> 0", () => {
  assert.equal(codexAdapter.currentTurn(undefined), 0);
});

// ---------------------------------------------------------------------------
// Codex adapter: isSubagent signals
// ---------------------------------------------------------------------------
test("codex isSubagent: source object with 'subagent' key -> true (0.131+)", () => {
  assert.equal(codexAdapter.isSubagent({ source: { subagent: "review" } }, {}), true);
});

test("codex isSubagent: source string enum -> true", () => {
  for (const s of ["subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"]) {
    assert.equal(codexAdapter.isSubagent({ source: s }, {}), true, `${s} marks a subagent`);
  }
});

test("codex isSubagent: parent-process prompt sentinel -> true", () => {
  const prompt = "<this is a request from a parent process>\nDo the thing.";
  assert.equal(codexAdapter.isSubagent({ prompt }, {}), true,
    "the parent-process handoff sentinel marks a subagent");
});

test("codex isSubagent: ordinary prompt / unknown source -> false", () => {
  assert.equal(codexAdapter.isSubagent({ prompt: "just a normal user ask" }, {}), false);
  assert.equal(codexAdapter.isSubagent({ source: "interactive" }, {}), false);
  assert.equal(codexAdapter.isSubagent({}, {}), false);
});

// ---------------------------------------------------------------------------
// Codex SessionStart dispatch (turn-0 coverage)
// ---------------------------------------------------------------------------
test("codex SessionStart: active + not subagent -> FULL directive", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  // Point the resolver at a temp directives dir with a known FULL body.
  const root = mkdtempSync(join(tmpdir(), "orch-cx-root-"));
  const ddir = join(root, "directives");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "orchestration-codex.md"), "CODEX-FULL", "utf8");
  const env = { PLUGIN_ROOT: root };
  try {
    enable(cwd);
    const out = runCodexHook({ hook_event_name: "SessionStart", cwd }, env);
    assert.equal(out, "CODEX-FULL", "SessionStart emits FULL when active (turn 0)");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("codex SessionStart: inactive cwd -> '' (no marker, no injection)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  try {
    const out = runCodexHook({ hook_event_name: "SessionStart", cwd }, { PLUGIN_ROOT: cwd });
    assert.equal(out, "", "SessionStart on an inactive cwd emits nothing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("codex SessionStart: subagent -> '' even when active", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  const root = mkdtempSync(join(tmpdir(), "orch-cx-root-"));
  const ddir = join(root, "directives");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "orchestration-codex.md"), "CODEX-FULL", "utf8");
  try {
    enable(cwd);
    const out = runCodexHook(
      { hook_event_name: "SessionStart", cwd, source: { subagent: "spawn" } },
      { PLUGIN_ROOT: root }
    );
    assert.equal(out, "", "a subagent SessionStart emits nothing");
  } finally {
    disable(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
