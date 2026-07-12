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

import { MARKER, hasParentMarker } from "../dist/launch-prompt.js";
import { claudeAdapter } from "../dist/hooks/orchestration-claude.js";
import { codexAdapter, runCodexHook } from "../dist/hooks/orchestration-codex.js";
import {
  enable,
  markerPath,
  writeDisable,
  removeDisable,
  readCurrentSession,
  anonKey,
} from "../dist/orchestration/marker.js";
import { readReminder, reminderPath } from "../dist/orchestration/reminder.js";

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

test("claude liftUsage: extracts latest assistant usage with one-turn lag", () => {
  const { dir, file } = writeJsonl([
    { type: "user", text: "first" },
    {
      type: "assistant",
      message: {
        model: "claude-sonnet-4-5",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 7,
          cache_read_input_tokens: 13,
        },
      },
    },
    { type: "user", text: "current prompt after the completed assistant turn" },
  ]);
  try {
    assert.equal(typeof claudeAdapter.liftUsage, "function");
    assert.deepEqual(claudeAdapter.liftUsage({}, {}, file), {
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: file,
      usage: {
        input: 100,
        output: 20,
        cache_creation: 7,
        cache_read: 13,
      },
      harnessPercentage: null,
    });
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

test("shared parent marker predicate is exact, anchored, and BOM/CRLF tolerant", () => {
  const positives = [
    MARKER,
    MARKER + "\nbody",
    MARKER + "\r\nbody",
    "\ufeff" + MARKER + "\nbody",
  ];
  for (const prompt of positives) {
    assert.equal(hasParentMarker(prompt), true, JSON.stringify(prompt));
    assert.equal(claudeAdapter.isSubagent({ prompt }, {}), true);
    assert.equal(codexAdapter.isSubagent({ prompt }, {}), true);
  }

  const negatives = [
    "\n" + MARKER,
    "preamble\n" + MARKER,
    "x " + MARKER,
    "this is a request from a parent process",
    "<THIS IS A REQUEST FROM A PARENT PROCESS>",
    42,
  ];
  for (const prompt of negatives) {
    assert.equal(hasParentMarker(prompt), false, String(prompt));
    assert.equal(claudeAdapter.isSubagent({ prompt }, {}), false);
    assert.equal(codexAdapter.isSubagent({ prompt }, {}), false);
  }
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

test("codex liftUsage: prefers harness percentage when model_context_window is present", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    {
      type: "token_count",
      info: {
        model_context_window: 1000,
        total_token_usage: {
          input_tokens: 200,
          output_tokens: 50,
          cached_input_tokens: 25,
          total_tokens: 300,
        },
      },
    },
  ]);
  try {
    assert.equal(typeof codexAdapter.liftUsage, "function");
    assert.deepEqual(codexAdapter.liftUsage({ cwd: dir }, {}, file), {
      harness: "codex",
      model: "gpt-5",
      source_ref: file,
      usage: {
        input: 200,
        output: 50,
        cache_creation: 0,
        cache_read: 25,
      },
      harnessPercentage: 30,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: returns static-map-computable usage without harness percentage", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5-codex" },
    {
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cached_input_tokens: 250,
            total_tokens: 1750,
          },
        },
      },
    },
  ]);
  try {
    assert.equal(typeof codexAdapter.liftUsage, "function");
    assert.deepEqual(codexAdapter.liftUsage({ cwd: dir }, {}, file), {
      harness: "codex",
      model: "gpt-5-codex",
      source_ref: file,
      usage: {
        input: 1000,
        output: 500,
        cache_creation: 0,
        cache_read: 250,
      },
      harnessPercentage: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("codex isSubagent: exact parent-process prompt marker -> true", () => {
  const prompt = MARKER + "\nDo the thing.";
  assert.equal(codexAdapter.isSubagent({ prompt }, {}), true,
    "the exact parent-process handoff marker marks a subagent");
});

test("codex isSubagent: ordinary prompt / unknown source -> false", () => {
  assert.equal(codexAdapter.isSubagent({ prompt: "just a normal user ask" }, {}), false);
  assert.equal(codexAdapter.isSubagent({ source: "interactive" }, {}), false);
  assert.equal(codexAdapter.isSubagent({}, {}), false);
});

// ---------------------------------------------------------------------------
// Codex SessionStart dispatch (turn-0 coverage)
// ---------------------------------------------------------------------------
test("codex SessionStart: active + not subagent -> FULL + ON reminder, counter re-based", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  // Point the resolver at a temp directives dir with known bodies.
  const root = mkdtempSync(join(tmpdir(), "orch-cx-root-"));
  const ddir = join(root, "directives");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "orchestration-codex.md"), "CODEX-FULL", "utf8");
  writeFileSync(join(ddir, "reminder-on.md"), "CODEX-REM-ON", "utf8");
  const env = { PLUGIN_ROOT: root };
  try {
    enable(cwd);
    const out = runCodexHook({ hook_event_name: "SessionStart", cwd }, env);
    assert.match(
      out,
      /^<subagent-mcp state="on" kind="directive" phase="normal" utilization="unknown">\n/,
      "SessionStart emits the templated ON tag when active (turn 0)"
    );
    assert.ok(
      out.includes("\nCODEX-FULL\nCODEX-REM-ON\n</subagent-mcp>"),
      "SessionStart body is FULL plus the ON reminder block");
    const owner = anonKey(cwd, "codex");
    assert.equal(readReminder(cwd).counts[owner], 0,
      "SessionStart re-baselines the session's reminder count to 0 (claim IS a LONG turn)");
    assert.equal(readCurrentSession(cwd), owner, "SessionStart writes the resolved owner pointer");
  } finally {
    rmSync(markerPath(cwd), { force: true });
    rmSync(reminderPath(cwd), { force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("codex SessionStart: disabled session key -> ''", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  const session = `disabled-${cwd}`;
  try {
    writeDisable(session);
    const out = runCodexHook(
      { hook_event_name: "SessionStart", cwd, session_id: session },
      { PLUGIN_ROOT: cwd }
    );
    assert.equal(out, "", "SessionStart checks the session-keyed disable before injecting");
  } finally {
    removeDisable(session);
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
    rmSync(markerPath(cwd), { force: true });
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
