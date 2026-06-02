import assert from "node:assert/strict";
import { extractFinalTurn } from "../dist/output-helpers.js";

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

// --- claude: object with string `result` field ---
// WHY: `claude -p --output-format json` emits a single JSON object whose
// `result` field is the final assistant message; that is what callers want.

test("claude object-with-result returns the result string", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    result: "The final answer is 42.",
    is_error: false,
  });
  assert.equal(extractFinalTurn("claude", stdout), "The final answer is 42.");
});

// --- claude: array form, last element with type result ---
// WHY: some output-format variants emit an array of events; the final
// assistant message is the last `result`-bearing element.

test("claude array form returns last result element", () => {
  const stdout = JSON.stringify([
    { type: "assistant", text: "thinking..." },
    { type: "result", result: "earlier result" },
    { type: "result", result: "final result" },
  ]);
  assert.equal(extractFinalTurn("claude", stdout), "final result");
});

// --- codex: event stream, last assistant message wins ---
// WHY: codex `exec --json` is newline-delimited; the agent's last
// assistant-message event carries the turn text.

test("codex event-stream returns last agent_message text", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({
      type: "item.completed",
      item: { item_type: "agent_message", text: "partial" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { item_type: "agent_message", text: "the final codex answer" },
    }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");
  assert.equal(extractFinalTurn("codex", stdout), "the final codex answer");
});

test("codex agent_message envelope shape is matched", () => {
  const stdout = [
    JSON.stringify({ type: "task_started" }),
    JSON.stringify({ type: "agent_message", message: "hello from codex" }),
  ].join("\n");
  assert.equal(extractFinalTurn("codex", stdout), "hello from codex");
});

// --- fallback: malformed JSON returns raw stdout, trimmed ---
// WHY: the helper must never throw; on any parse failure it returns the raw
// captured output so callers still get something useful.

test("claude malformed JSON falls back to raw stdout trimmed", () => {
  const stdout = "  not json at all {oops  ";
  assert.equal(extractFinalTurn("claude", stdout), "not json at all {oops");
});

test("codex with no assistant-message events falls back to raw stdout", () => {
  const stdout = "garbage line\nanother line";
  assert.equal(extractFinalTurn("codex", stdout), "garbage line\nanother line");
});

// --- empty stdout returns empty string ---

test("empty stdout returns empty string (claude)", () => {
  assert.equal(extractFinalTurn("claude", ""), "");
});

test("empty stdout returns empty string (codex)", () => {
  assert.equal(extractFinalTurn("codex", ""), "");
});

// --- unknown provider falls back to raw stdout ---

test("unknown provider falls back to raw stdout trimmed", () => {
  assert.equal(extractFinalTurn("gemini", "  some output  "), "some output");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
