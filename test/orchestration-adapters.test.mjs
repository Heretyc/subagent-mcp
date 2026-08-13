/**
 * orchestration-adapters.test.mjs — Unit tests for the Claude and Codex
 * provider adapters (dist/hooks/orchestration-claude.js,
 * dist/hooks/orchestration-codex.js).
 *
 * The entry shims are import-safe (their stdin->stdout main() runs only under
 * an isMain gate), so a test can import the exported adapters without the shim
 * firing. Covers:
 *   - claude currentTurn counts 'user' JSONL lines from a synthetic transcript.
 *   - codex currentTurn counts Codex turn signals.
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
import { claudeAdapter, runClaudeHook } from "../dist/hooks/orchestration-claude.js";
import { codexAdapter, runCodexHook } from "../dist/hooks/orchestration-codex.js";
import {
  markerPath,
  hashKey,
  writeDisable,
  removeDisable,
  readCurrentSession,
  anonKey,
  writeMarker,
} from "../dist/orchestration/marker.js";
import {
  SESSION_HANDOFF_REQUIRED_DIRECTIVE_FILE,
  SUB_ORCHESTRATOR_DIRECTIVE_FILE,
  sessionKey,
} from "../dist/orchestration/hook-core.js";
import {
  buildMeteringRecord,
  meteringPath,
  readMetering,
  writeMetering,
} from "../dist/orchestration/metering.js";
import {
  statuslinePathForSession,
  writeStatuslineRecord,
} from "../dist/orchestration/statusline-state.js";
import { readReminder, reminderPath } from "../dist/orchestration/reminder.js";
import { clearLatch } from "../dist/orchestration/latch.js";
import {
  clearHandoff,
  readHandoff,
  writeHandoff,
} from "../dist/orchestration/handoff.js";

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

function writeFreshMarker(cwd) {
  writeMarker(cwd, {
    owner_session: null,
    baseline_turn: null,
    claimed_at: null,
    owners: {},
    provenance: "user-enabled",
    carryover_ack: false,
  });
}

function lifecycleDirectives(provider) {
  const root = mkdtempSync(join(tmpdir(), "orch-lifecycle-root-"));
  const dir = join(root, "directives");
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of [
    [`orchestration-${provider}.md`, "FULL"],
    ["short-on.md", "SHORT-ON"],
    ["short-off.md", "SHORT-OFF"],
    [`carryover-${provider}.md`, "CARRYOVER"],
    ["reminder-on.md", "REMINDER-ON"],
    [`reminder-off-${provider}.md`, "REMINDER-OFF"],
    [`handoff-${provider}.md`, "HANDOFF-WRITE"],
    [SESSION_HANDOFF_REQUIRED_DIRECTIVE_FILE, "HANDOFF-READ"],
  ]) {
    writeFileSync(join(dir, file), body, "utf8");
  }
  return { root, env: { PLUGIN_ROOT: root, npm_config_prefix: root } };
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
      harnessContextWindow: null,
      longContextHint: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: reads fresh statusline percentage and context window", () => {
  const session = `sl-fresh-${Date.now()}-${Math.random()}`;
  const { dir, file } = writeJsonl([
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
  ]);
  const slPath = statuslinePathForSession(session);
  try {
    writeStatuslineRecord({ session_id: session }, {
      session_id: session,
      used_percentage: 44,
      context_window_size: 1000000,
      usage: { input: 1, output: 2, cache_creation: 3, cache_read: 4 },
      updated_at: Date.now(),
      source: "statusline",
    });
    const lifted = claudeAdapter.liftUsage(
      { cwd: dir, session_id: session },
      {},
      file
    );
    assert.equal(lifted.harnessPercentage, 44);
    assert.equal(lifted.harnessContextWindow, 1000000);
  } finally {
    rmSync(slPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: ignores stale statusline records", () => {
  const session = `sl-stale-${Date.now()}-${Math.random()}`;
  const { dir, file } = writeJsonl([
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
  ]);
  const slPath = statuslinePathForSession(session);
  try {
    writeFileSync(slPath, JSON.stringify({
      session_id: session,
      used_percentage: 88,
      context_window_size: 1000000,
      usage: { input: 1, output: 2, cache_creation: 3, cache_read: 4 },
      updated_at: Date.now() - 25 * 60 * 60 * 1000,
      source: "statusline",
    }), "utf8");
    const lifted = claudeAdapter.liftUsage(
      { cwd: dir, session_id: session },
      {},
      file
    );
    assert.equal(lifted.harnessPercentage, null);
    assert.equal(lifted.harnessContextWindow, null);
  } finally {
    rmSync(slPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: reads transcript-keyed statusline fallback", () => {
  const { dir, file } = writeJsonl([
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
  ]);
  const key = sessionKey({ transcript_path: file });
  const slPath = statuslinePathForSession(key);
  try {
    writeStatuslineRecord({ transcript_path: file }, {
      session_id: null,
      used_percentage: 23,
      context_window_size: null,
      usage: { input: 1, output: 0, cache_creation: 0, cache_read: 0 },
      updated_at: Date.now(),
      source: "statusline",
    });
    assert.equal(hashKey(key).length, 16);
    const lifted = claudeAdapter.liftUsage(
      { cwd: dir, transcript_path: file },
      {},
      file
    );
    assert.equal(lifted.harnessPercentage, 23);
  } finally {
    rmSync(slPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: skips sidechain assistant usage and reads long hint", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-claude-cwd-"));
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(join(cwd, ".claude", "settings.json"), JSON.stringify({
    model: "claude-fable-5[1m]",
  }), "utf8");
  const { dir, file } = writeJsonl([
    {
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 7,
          cache_read_input_tokens: 13,
        },
      },
    },
    {
      type: "assistant",
      isSidechain: true,
      message: {
        model: "gpt-5.5",
        usage: {
          input_tokens: 900000,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ]);
  try {
    assert.deepEqual(claudeAdapter.liftUsage({ cwd }, {}, file), {
      harness: "claude",
      model: "claude-opus-4-8",
      source_ref: file,
      usage: {
        input: 100,
        output: 20,
        cache_creation: 7,
        cache_read: 13,
      },
      harnessPercentage: null,
      harnessContextWindow: null,
      longContextHint: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("claude liftUsage: skips synthetic or missing model rows", () => {
  const { dir, file } = writeJsonl([
    {
      type: "assistant",
      message: {
        model: "claude-fable-5",
        usage: {
          input_tokens: 2,
          output_tokens: 60,
          cache_creation_input_tokens: 6894,
          cache_read_input_tokens: 669235,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "<synthetic>",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    {
      type: "assistant",
      message: {
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ]);
  try {
    const lifted = claudeAdapter.liftUsage({}, {}, file);
    assert.equal(lifted.model, "claude-fable-5");
    assert.deepEqual(lifted.usage, {
      input: 2,
      output: 60,
      cache_creation: 6894,
      cache_read: 669235,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Claude adapter: compaction_generation provenance
// ---------------------------------------------------------------------------
const CLAUDE_UUID_A = "0193f8a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const CLAUDE_UUID_B = "0195aa11-2b33-4c55-8d77-0e1f2a3b4c5d";

function claudeAssistantRow(model = "claude-sonnet-4-5") {
  return {
    type: "assistant",
    message: {
      model,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 7,
        cache_read_input_tokens: 13,
      },
    },
  };
}

test("claude liftUsage: auto compact_boundary with valid uuid -> claude:<uuid>", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow(),
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "auto", preTokens: 12345 },
    },
  ]);
  try {
    assert.deepEqual(claudeAdapter.liftUsage({}, {}, file), {
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: file,
      usage: { input: 100, output: 20, cache_creation: 7, cache_read: 13 },
      harnessPercentage: null,
      harnessContextWindow: null,
      longContextHint: null,
      compaction_generation: `claude:${CLAUDE_UUID_A}`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: manual compact_boundary -> null generation (no inference)", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow(),
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "manual" },
    },
  ]);
  try {
    assert.deepEqual(claudeAdapter.liftUsage({}, {}, file), {
      harness: "claude",
      model: "claude-sonnet-4-5",
      source_ref: file,
      usage: { input: 100, output: 20, cache_creation: 7, cache_read: 13 },
      harnessPercentage: null,
      harnessContextWindow: null,
      longContextHint: null,
      compaction_generation: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: newest auto compact_boundary wins over older auto", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow(),
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "auto" },
    },
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_B,
      compactMetadata: { trigger: "auto" },
    },
  ]);
  try {
    const lifted = claudeAdapter.liftUsage({}, {}, file);
    assert.equal(lifted.compaction_generation, `claude:${CLAUDE_UUID_B}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: newest manual boundary over older auto -> null", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow(),
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "auto" },
    },
    {
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: { trigger: "manual" },
    },
  ]);
  try {
    assert.equal(claudeAdapter.liftUsage({}, {}, file).compaction_generation, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: malformed proof (invalid or missing uuid, no metadata) -> null", () => {
  // Auto trigger but a non-UUID top-level uuid string is not a valid proof.
  const invalid = writeJsonl([
    claudeAssistantRow(),
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: "not-a-real-uuid",
      compactMetadata: { trigger: "auto" },
    },
  ]);
  // compactMetadata entirely absent -> no trigger -> null.
  const missing = writeJsonl([
    claudeAssistantRow(),
    { type: "system", subtype: "compact_boundary", uuid: CLAUDE_UUID_A },
  ]);
  try {
    assert.equal(
      claudeAdapter.liftUsage({}, {}, invalid.file).compaction_generation,
      null,
      "auto trigger with a non-UUID uuid yields null"
    );
    assert.equal(
      claudeAdapter.liftUsage({}, {}, missing.file).compaction_generation,
      null,
      "missing compactMetadata yields null"
    );
  } finally {
    rmSync(invalid.dir, { recursive: true, force: true });
    rmSync(missing.dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: no compaction boundary -> compaction_generation key omitted", () => {
  const { dir, file } = writeJsonl([claudeAssistantRow()]);
  try {
    const lifted = claudeAdapter.liftUsage({}, {}, file);
    assert.equal(
      Object.prototype.hasOwnProperty.call(lifted, "compaction_generation"),
      false,
      "absent boundary must not add the optional field"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: sidechain assistant skipped, main compact_boundary still resolves", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow("claude-opus-4-8"),
    {
      type: "assistant",
      isSidechain: true,
      message: {
        model: "gpt-5.5",
        usage: {
          input_tokens: 900000,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "auto" },
    },
  ]);
  try {
    assert.deepEqual(claudeAdapter.liftUsage({}, {}, file), {
      harness: "claude",
      model: "claude-opus-4-8",
      source_ref: file,
      usage: { input: 100, output: 20, cache_creation: 7, cache_read: 13 },
      harnessPercentage: null,
      harnessContextWindow: null,
      longContextHint: null,
      compaction_generation: `claude:${CLAUDE_UUID_A}`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: newest sidechain auto boundary ignored, newest eligible parent boundary wins", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow(),
    // Eligible parent auto boundary — this is the newest NON-sidechain proof.
    {
      type: "system",
      subtype: "compact_boundary",
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "auto" },
    },
    // Newer, but sidechain: a subagent's own auto boundary must never become
    // the parent's compaction proof, so it is skipped and A still wins.
    {
      type: "system",
      subtype: "compact_boundary",
      isSidechain: true,
      uuid: CLAUDE_UUID_B,
      compactMetadata: { trigger: "auto" },
    },
  ]);
  try {
    assert.equal(
      claudeAdapter.liftUsage({}, {}, file).compaction_generation,
      `claude:${CLAUDE_UUID_A}`,
      "sidechain boundary is skipped; newest eligible parent boundary wins"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude liftUsage: only a sidechain compact_boundary exists -> key omitted (no proof)", () => {
  const { dir, file } = writeJsonl([
    claudeAssistantRow(),
    {
      type: "system",
      subtype: "compact_boundary",
      isSidechain: true,
      uuid: CLAUDE_UUID_A,
      compactMetadata: { trigger: "auto" },
    },
  ]);
  try {
    const lifted = claudeAdapter.liftUsage({}, {}, file);
    assert.equal(
      Object.prototype.hasOwnProperty.call(lifted, "compaction_generation"),
      false,
      "a sidechain-only boundary yields no eligible proof; the optional field is omitted"
    );
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
// Codex adapter: currentTurn counts live Codex turn signals
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

test("codex currentTurn: token_count events keep metering alive when turn_context is frozen", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context" },
    { type: "event_msg", payload: { type: "token_count" } },
    { type: "event_msg", payload: { type: "token_count" } },
    { type: "event_msg", payload: { type: "token_count" } },
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

test("codex liftUsage: uses last_token_usage for current context occupancy", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    {
      type: "token_count",
      info: {
        model_context_window: 258400,
        total_token_usage: {
          input_tokens: 174860000,
          output_tokens: 10739,
          cached_input_tokens: 174800000,
          total_tokens: 174870739,
        },
        last_token_usage: {
          input_tokens: 62000,
          output_tokens: 4000,
          cached_input_tokens: 0,
          total_tokens: 66000,
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
        input: 62000,
        output: 4000,
        cache_creation: 0,
        cache_read: 0,
      },
      harnessPercentage: (66000 / 258400) * 100,
      harnessContextWindow: 258400,
      cumulative: false,
    });
    const pct = codexAdapter.liftUsage({ cwd: dir }, {}, file)?.harnessPercentage ?? 0;
    assert.ok(pct > 25 && pct < 26, "usage must meter about 26%, not clamp to 100%");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Sanitized 155K-used / 258K-window fixture. The harness itself renders this as
// "42% left / 155K used / 258K"; occupancy MUST be computed from
// last_token_usage / model_context_window (about 60% USED, about 40% remaining),
// NOT from the huge cumulative total_token_usage (which would falsely clamp to
// 100%). Do not compare our USED tag to the harness LEFT figure.
test("codex liftUsage: 155K/258K meters ~60% USED via last_token_usage, window_source=harness", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    {
      type: "token_count",
      info: {
        model_context_window: 258400,
        // Cumulative accounting data; cached input dominates. Must be IGNORED
        // for occupancy so it cannot force a false 100%.
        total_token_usage: {
          input_tokens: 174860000,
          output_tokens: 10739,
          cached_input_tokens: 174800000,
          total_tokens: 174870739,
        },
        last_token_usage: {
          input_tokens: 150000,
          output_tokens: 5000,
          cached_input_tokens: 0,
          total_tokens: 155000,
        },
      },
    },
  ]);
  try {
    const lifted = codexAdapter.liftUsage({ cwd: dir }, {}, file);
    assert.equal(lifted.harnessContextWindow, 258400,
      "harness window is forwarded so metering resolves window_source=harness");
    const usedPct = lifted.harnessPercentage;
    assert.ok(usedPct > 59 && usedPct < 61,
      `USED occupancy is ~60% (155000/258400), got ${usedPct}`);
    const remaining = 100 - usedPct;
    assert.ok(remaining > 39 && remaining < 41,
      `remaining context is ~40%, got ${remaining}`);

    // Shared metering must persist window_source="harness" and the exact
    // 258400 window for this fixture, preventing the false-100%/unknown path.
    const record = buildMeteringRecord({
      session_id: "codex-155k",
      harness: lifted.harness,
      model: lifted.model,
      source_ref: lifted.source_ref,
      usage: lifted.usage,
      event: "UserPromptSubmit",
      harnessPercentage: lifted.harnessPercentage,
      harnessContextWindow: lifted.harnessContextWindow,
    });
    assert.equal(record.window_source, "harness");
    assert.equal(record.context_window_size, 258400);
    assert.ok(record.used_percentage > 59 && record.used_percentage < 61,
      `metering used_percentage is ~60%, got ${record.used_percentage}`);
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
        input: 750,
        output: 500,
        cache_creation: 0,
        cache_read: 250,
      },
      harnessPercentage: null,
      harnessContextWindow: null,
      cumulative: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: returns harnessContextWindow when total_tokens is missing", () => {
  // Codex advertises model_context_window and provider usage fields, but
  // total_token_usage.total_tokens is absent -> harnessPercentage cannot be
  // derived, yet the harness window must still be forwarded so metering resolves
  // window_source="harness" instead of falling back to the static map.
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5-codex" },
    {
      type: "token_count",
      info: {
        model_context_window: 272000,
        total_token_usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cached_input_tokens: 250,
          // total_tokens deliberately omitted (non-finite)
        },
      },
    },
  ]);
  try {
    const lifted = codexAdapter.liftUsage({ cwd: dir }, {}, file);
    assert.equal(lifted.harnessPercentage, null);
    assert.equal(lifted.harnessContextWindow, 272000);
    assert.deepEqual(lifted.usage, {
      input: 750,
      output: 500,
      cache_creation: 0,
      cache_read: 250,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: ignores absurd total_token_usage fallback when last usage is absent", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    {
      type: "token_count",
      info: {
        model_context_window: 258400,
        total_token_usage: {
          input_tokens: 174860000,
          output_tokens: 10739,
          cached_input_tokens: 174800000,
          total_tokens: 174870739,
        },
      },
    },
  ]);
  try {
    assert.equal(codexAdapter.liftUsage({ cwd: dir }, {}, file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Codex adapter: compaction_generation provenance
// ---------------------------------------------------------------------------
function codexTokenCountRow() {
  return {
    type: "token_count",
    info: {
      model_context_window: 258400,
      last_token_usage: {
        input_tokens: 62000,
        output_tokens: 4000,
        cached_input_tokens: 0,
        total_tokens: 66000,
      },
    },
  };
}

function codexUsageExpectation(file, extra) {
  return {
    harness: "codex",
    model: "gpt-5",
    source_ref: file,
    usage: { input: 62000, output: 4000, cache_creation: 0, cache_read: 0 },
    harnessPercentage: (66000 / 258400) * 100,
    harnessContextWindow: 258400,
    cumulative: false,
    ...extra,
  };
}

test("codex liftUsage: compacted window_id -> codex:<id> (prefers id over number)", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    codexTokenCountRow(),
    // Envelope form: payload.type==='compacted'. window_id wins over number.
    { payload: { type: "compacted", window_id: "ctx-42", window_number: 9 } },
  ]);
  try {
    assert.deepEqual(
      codexAdapter.liftUsage({ cwd: dir }, {}, file),
      codexUsageExpectation(file, { compaction_generation: "codex:ctx-42" })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: compacted window_number fallback -> codex-window:<n>", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    codexTokenCountRow(),
    // Top-level form, no window_id -> nonnegative integer window_number.
    { type: "compacted", window_number: 7 },
  ]);
  try {
    assert.deepEqual(
      codexAdapter.liftUsage({ cwd: dir }, {}, file),
      codexUsageExpectation(file, { compaction_generation: "codex-window:7" })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: newest compacted wins across interleaved token_count ordering", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    { payload: { type: "compacted", window_id: "earlier" } },
    codexTokenCountRow(),
    { payload: { type: "compacted", window_id: "new" } },
  ]);
  try {
    const lifted = codexAdapter.liftUsage({ cwd: dir }, {}, file);
    assert.equal(lifted.compaction_generation, "codex:new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: malformed compacted proof (empty id, non-integer number) -> null", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    codexTokenCountRow(),
    { type: "compacted", window_id: "   ", window_number: 2.5 },
  ]);
  try {
    assert.equal(codexAdapter.liftUsage({ cwd: dir }, {}, file).compaction_generation, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: negative window_number is not a valid proof -> null", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    codexTokenCountRow(),
    { type: "compacted", window_number: -1 },
  ]);
  try {
    assert.equal(codexAdapter.liftUsage({ cwd: dir }, {}, file).compaction_generation, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex liftUsage: non-'compacted' type is ignored -> key omitted", () => {
  const { dir, file } = writeJsonl([
    { type: "turn_context", model: "gpt-5" },
    codexTokenCountRow(),
    // A similarly-named but non-exact type must never yield a generation.
    { type: "context_compacted", window_id: "nope" },
  ]);
  try {
    const lifted = codexAdapter.liftUsage({ cwd: dir }, {}, file);
    assert.deepEqual(lifted, codexUsageExpectation(file));
    assert.equal(
      Object.prototype.hasOwnProperty.call(lifted, "compaction_generation"),
      false,
      "a non-'compacted' type must not add the optional field"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adapter-to-hook lifecycle ordering
// ---------------------------------------------------------------------------
test("Claude transcript ordering triggers one prepared-handoff read from an exact auto UUID", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-claude-lifecycle-"));
  const session = `claude-lifecycle-${Date.now()}-${Math.random()}`;
  const { root, env } = lifecycleDirectives("claude");
  const rows = [
    { type: "user", text: "first" },
    claudeAssistantRow(),
    { type: "user", text: "second" },
  ];
  const { dir, file } = writeJsonl(rows);
  const payload = { cwd, session_id: session, transcript_path: file };
  const statusPath = statuslinePathForSession(session);
  try {
    writeStatuslineRecord(payload, {
      session_id: session,
      used_percentage: 85,
      context_window_size: 200000,
      usage: { input: 170000, output: 0, cache_creation: 0, cache_read: 0 },
      updated_at: Date.now(),
      source: "statusline",
    });
    assert.match(runClaudeHook(payload, env), /Handoff lifecycle: `write_required`\./);
    assert.equal(readMetering(session).compaction_generation, null,
      "the pre-compaction adapter sample has no generation field");
    writeHandoff(cwd, {
      content: "PREPARED",
      createdBySession: session,
      usedPercentage: 85,
    });

    rows.push(
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: CLAUDE_UUID_A,
        compactMetadata: { trigger: "auto" },
      },
      claudeAssistantRow(),
      { type: "user", text: "after compaction" },
    );
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
    writeStatuslineRecord(payload, {
      session_id: session,
      used_percentage: 40,
      context_window_size: 200000,
      usage: { input: 80000, output: 0, cache_creation: 0, cache_read: 0 },
      updated_at: Date.now(),
      source: "statusline",
    });

    assert.match(runClaudeHook(payload, env), /\nHANDOFF-READ\n/);
    assert.equal(readHandoff(cwd).lifecycle, "resuming");
    assert.doesNotMatch(runClaudeHook(payload, env), /\nHANDOFF-READ\n/,
      "replaying the same UUID proof cannot inject twice");
  } finally {
    clearLatch(session);
    clearHandoff(cwd);
    rmSync(meteringPath(session), { force: true });
    rmSync(statusPath, { force: true });
    rmSync(markerPath(cwd), { force: true });
    rmSync(reminderPath(cwd), { force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex rollout ordering triggers one prepared-handoff read from Practical proof", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-codex-lifecycle-"));
  const session = `codex-lifecycle-${Date.now()}-${Math.random()}`;
  const { root, env } = lifecycleDirectives("codex");
  const tokenCount = (pct) => ({
    type: "token_count",
    info: {
      model_context_window: 258400,
      last_token_usage: {
        input_tokens: 258400 * pct / 100,
        output_tokens: 0,
        cached_input_tokens: 0,
        total_tokens: 258400 * pct / 100,
      },
    },
  });
  const rows = [
    { type: "turn_context", model: "gpt-5" },
    tokenCount(85),
    tokenCount(85),
  ];
  const { dir, file } = writeJsonl(rows);
  const payload = {
    hook_event_name: "UserPromptSubmit",
    cwd,
    session_id: session,
    transcript_path: file,
  };
  try {
    assert.match(runCodexHook(payload, env), /Handoff lifecycle: `write_required`\./);
    assert.equal(readMetering(session).compaction_generation, null,
      "the pre-compaction adapter sample has no generation field");
    writeHandoff(cwd, {
      content: "PREPARED",
      createdBySession: session,
      usedPercentage: 85,
    });

    rows.push(
      { payload: { type: "compacted", window_number: 7 } },
      tokenCount(40),
    );
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

    assert.match(runCodexHook(payload, env), /\nHANDOFF-READ\n/);
    assert.equal(readHandoff(cwd).lifecycle, "resuming");
    assert.doesNotMatch(runCodexHook(payload, env), /\nHANDOFF-READ\n/,
      "replaying the same compacted generation cannot inject twice");
  } finally {
    clearLatch(session);
    clearHandoff(cwd);
    rmSync(meteringPath(session), { force: true });
    rmSync(markerPath(cwd), { force: true });
    rmSync(reminderPath(cwd), { force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Codex adapter: isSubagent signals
// ---------------------------------------------------------------------------
test("codex isSubagent: source object with 'subagent' key -> true (0.131+)", () => {
  assert.equal(codexAdapter.isSubagent({ source: { subagent: "review" } }, {}), true);
});

test("codex isSubagent: source object with subAgent kind keys -> true", () => {
  for (const s of ["subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"]) {
    assert.equal(codexAdapter.isSubagent({ source: { [s]: true } }, {}), true,
      `${s} key marks a subagent`);
  }
});

test("codex isSubagent: source object with subAgent kind/type fields -> true", () => {
  for (const s of ["subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"]) {
    assert.equal(codexAdapter.isSubagent({ source: { kind: s } }, {}), true,
      `${s} kind marks a subagent`);
    assert.equal(codexAdapter.isSubagent({ source: { type: s } }, {}), true,
      `${s} type marks a subagent`);
  }
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

test("codex isSubagent: parent-process marker must be bracketed first line", () => {
  assert.equal(codexAdapter.isSubagent({ prompt: MARKER + "\nDo the thing." }, {}), true);
  assert.equal(codexAdapter.isSubagent({ prompt: "preamble\n" + MARKER }, {}), false);
  assert.equal(
    codexAdapter.isSubagent({ prompt: "please mention this is a request from a parent process" }, {}),
    false
  );
});

test("codex isSubagent: ordinary prompt / unknown source -> false", () => {
  assert.equal(codexAdapter.isSubagent({ prompt: "just a normal user ask" }, {}), false);
  assert.equal(codexAdapter.isSubagent({ source: "interactive" }, {}), false);
  assert.equal(codexAdapter.isSubagent({ source: { type: "user" } }, {}), false);
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
  // Trust the temp plugin root via the install-prefix allowlist.
  const env = { PLUGIN_ROOT: root, npm_config_prefix: root };
  try {
    writeFreshMarker(cwd);
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

test("codex SessionStart: renders persisted USED utilization when a fresh metering record exists", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  const root = mkdtempSync(join(tmpdir(), "orch-cx-root-"));
  const ddir = join(root, "directives");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "orchestration-codex.md"), "CODEX-FULL", "utf8");
  writeFileSync(join(ddir, "reminder-on.md"), "CODEX-REM-ON", "utf8");
  const env = { PLUGIN_ROOT: root, npm_config_prefix: root };
  const owner = anonKey(cwd, "codex");
  try {
    writeFreshMarker(cwd);
    // A prior turn of THIS owner persisted ~60% USED (155K/258K harness window).
    writeMetering(
      owner,
      buildMeteringRecord({
        session_id: owner,
        harness: "codex",
        model: "gpt-5",
        source_ref: "rollout.jsonl",
        usage: { input: 150000, output: 5000, cache_creation: 0, cache_read: 0 },
        event: "UserPromptSubmit",
        harnessPercentage: (155000 / 258400) * 100,
        harnessContextWindow: 258400,
      })
    );
    const out = runCodexHook({ hook_event_name: "SessionStart", cwd }, env);
    // used_percentage ~60% -> utilization="60%", phase="handoff" (>=20),
    // footer Remaining Context=40%. Utilization is USED, footer is REMAINING.
    assert.match(
      out,
      /utilization="60%"/,
      "SessionStart renders the persisted USED percentage, not unknown"
    );
    assert.match(out, /phase="handoff"/, "phaseFor(60) is handoff");
    assert.match(
      out,
      /Remaining Context=40%/,
      "footer shows REMAINING context (100 - used)"
    );
  } finally {
    rmSync(meteringPath(owner), { force: true });
    rmSync(markerPath(cwd), { force: true });
    rmSync(reminderPath(cwd), { force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("codex SessionStart: no persisted metering -> utilization unknown (no lifted stale data)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  const root = mkdtempSync(join(tmpdir(), "orch-cx-root-"));
  const ddir = join(root, "directives");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "orchestration-codex.md"), "CODEX-FULL", "utf8");
  writeFileSync(join(ddir, "reminder-on.md"), "CODEX-REM-ON", "utf8");
  const env = { PLUGIN_ROOT: root, npm_config_prefix: root };
  try {
    writeFreshMarker(cwd);
    const out = runCodexHook({ hook_event_name: "SessionStart", cwd }, env);
    assert.match(
      out,
      /utilization="unknown"/,
      "absent metering keeps turn-0 utilization unknown/null"
    );
    assert.ok(!/Remaining Context=/.test(out), "no footer without a numeric percentage");
  } finally {
    rmSync(markerPath(cwd), { force: true });
    rmSync(reminderPath(cwd), { force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("codex SessionStart: sub-orchestrator emits shared stateless ON directive", () => {
  const cwd = mkdtempSync(join(tmpdir(), "orch-cx-cwd-"));
  const root = mkdtempSync(join(tmpdir(), "orch-cx-root-"));
  const ddir = join(root, "directives");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, SUB_ORCHESTRATOR_DIRECTIVE_FILE), "CODEX-SUB-ORCH", "utf8");
  const env = {
    PLUGIN_ROOT: root,
    npm_config_prefix: root,
    SUBAGENT_MCP_SUBAGENT: "1",
    SUBAGENT_MCP_SUB_ORCHESTRATOR: "1",
  };
  try {
    const out = runCodexHook(
      { hook_event_name: "SessionStart", cwd, source: { subagent: "spawn" } },
      env
    );
    assert.match(
      out,
      /^<subagent-mcp state="on" kind="sub-orchestrator" phase="normal" utilization="unknown">\n/,
      "SessionStart must emit the shared sub-orchestrator tag before subagent suppression"
    );
    assert.ok(out.includes("\nCODEX-SUB-ORCH\n</subagent-mcp>"), "SessionStart must use the shared directive asset");
    assert.equal(readCurrentSession(cwd), undefined, "sub-orchestrator SessionStart must not write cwd session state");
  } finally {
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
    writeFreshMarker(cwd);
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
