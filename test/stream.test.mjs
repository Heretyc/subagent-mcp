import assert from "node:assert/strict";
import {
  parseVisibleStream,
  retainLastN,
  consumeStreamChunk,
  flushStream,
  isNonVisibleStreamLine,
} from "../dist/stream-helpers.js";

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

// --- Codex JSONL visible-stream parsing ---
// WHY: poll_agent surfaces what a human sees in the CLI (agent messages, item
// output) and must NOT surface provider-internal reasoning blocks.

test("codex: agent_message is a visible item", () => {
  const chunk = JSON.stringify({ type: "agent_message", message: "hello" });
  const items = parseVisibleStream("codex", chunk);
  assert.deepEqual(items, [{ type: "agent_message", text: "hello" }]);
});

test("codex: item.completed agent_message text is visible", () => {
  const chunk = JSON.stringify({
    type: "item.completed",
    item: { item_type: "agent_message", text: "done" },
  });
  const items = parseVisibleStream("codex", chunk);
  assert.deepEqual(items, [{ type: "agent_message", text: "done" }]);
});

test("codex: reasoning events are not surfaced in recent_stream", () => {
  const chunk = [
    JSON.stringify({ type: "agent_reasoning", text: "reasoning output" }),
    JSON.stringify({ type: "item.completed", item: { item_type: "reasoning", text: "more reasoning" } }),
    JSON.stringify({ type: "agent_message", message: "public answer" }),
  ].join("\n");
  const items = parseVisibleStream("codex", chunk);
  assert.deepEqual(items, [{ type: "agent_message", text: "public answer" }]);
});

// --- Claude stream-json visible-stream parsing ---

test("claude: assistant text block is visible", () => {
  const chunk = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "the answer" }] },
  });
  const items = parseVisibleStream("claude", chunk);
  assert.deepEqual(items, [{ type: "text", text: "the answer" }]);
});

test("claude: thinking/redacted_thinking blocks are not surfaced in recent_stream", () => {
  const chunk = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "provider reasoning" },
        { type: "redacted_thinking", data: "xxx" },
        { type: "text", text: "visible reply" },
        { type: "tool_use", name: "Read", input: {} },
      ],
    },
  });
  const items = parseVisibleStream("claude", chunk);
  assert.deepEqual(items, [
    { type: "text", text: "visible reply" },
    { type: "tool_use", text: "Read" },
  ]);
});

test("claude: buffered-json result object is a visible item", () => {
  const chunk = JSON.stringify({ type: "result", result: "final" });
  const items = parseVisibleStream("claude", chunk);
  assert.deepEqual(items, [{ type: "result", text: "final" }]);
});

// --- robustness: never throws on malformed / partial lines ---

test("malformed and empty lines are skipped, never throw", () => {
  const chunk = "not json\n\n{partial\n" + JSON.stringify({ type: "agent_message", message: "ok" });
  const items = parseVisibleStream("codex", chunk);
  assert.deepEqual(items, [{ type: "agent_message", text: "ok" }]);
});

test("empty chunk returns []", () => {
  assert.deepEqual(parseVisibleStream("codex", ""), []);
  assert.deepEqual(parseVisibleStream("claude", ""), []);
});

// --- retainLastN: poll_agent keeps exactly the last 3 items ---
// WHY: poll_agent returns the last 3 parsed visible stream items, no more.

test("retainLastN keeps only the last 3 across multiple appends", () => {
  let buf = [];
  buf = retainLastN(buf, [{ type: "t", text: "1" }], 3);
  buf = retainLastN(buf, [{ type: "t", text: "2" }, { type: "t", text: "3" }], 3);
  buf = retainLastN(buf, [{ type: "t", text: "4" }, { type: "t", text: "5" }], 3);
  assert.equal(buf.length, 3);
  assert.deepEqual(buf.map((i) => i.text), ["3", "4", "5"]);
});

test("retainLastN with no new items returns buffer unchanged", () => {
  const buf = [{ type: "t", text: "1" }];
  assert.equal(retainLastN(buf, [], 3), buf);
});

// --- consumeStreamChunk: per-agent line buffering across stdout chunks ---
// WHY: provider JSONL events can be split across stdout `data` reads. Parsing
// each raw chunk in isolation would drop the halves and miss heartbeats /
// completion markers. The buffer must reassemble the line, parse it once, and
// never emit on a partial fragment.

test("consumeStreamChunk: event split across two chunks is parsed exactly once", () => {
  const full = JSON.stringify({ type: "agent_message", message: "split me" });
  const a = full.slice(0, 10);
  const b = full.slice(10) + "\n";

  const r1 = consumeStreamChunk("codex", "", a);
  assert.deepEqual(r1.items, [], "no item until the line is complete");
  assert.equal(r1.pending, a, "incomplete fragment is carried over");

  const r2 = consumeStreamChunk("codex", r1.pending, b);
  assert.deepEqual(r2.items, [{ type: "agent_message", text: "split me" }]);
  assert.equal(r2.pending, "", "completed line clears the buffer");
});

test("consumeStreamChunk: multiple complete lines in one chunk, trailing partial held", () => {
  const l1 = JSON.stringify({ type: "agent_message", message: "one" });
  const l2 = JSON.stringify({ type: "agent_message", message: "two" });
  const partial = '{"type":"agent_mess';
  const r = consumeStreamChunk("codex", "", `${l1}\n${l2}\n${partial}`);
  assert.deepEqual(r.items.map((i) => i.text), ["one", "two"]);
  assert.equal(r.pending, partial, "trailing partial line is retained");
  assert.equal(r.lines.length, 2, "only complete lines are reported");
});

test("consumeStreamChunk: turn.completed marker split across chunks matches on reassembly", () => {
  const full = JSON.stringify({ type: "turn.completed" }) + "\n";
  const a = full.slice(0, 12);
  const b = full.slice(12);

  const r1 = consumeStreamChunk("codex", "", a);
  assert.ok(
    !r1.lines.some((l) => l.includes('"type":"turn.completed"')),
    "partial fragment must NOT match the completion marker"
  );

  const r2 = consumeStreamChunk("codex", r1.pending, b);
  assert.ok(
    r2.lines.some((l) => l.includes('"type":"turn.completed"')),
    "reassembled complete line matches the completion marker"
  );
});

test("flushStream: trailing line with no terminating newline is parsed on close", () => {
  const partial = JSON.stringify({ type: "agent_message", message: "last" });
  const r = consumeStreamChunk("codex", "", partial); // no newline
  assert.deepEqual(r.items, [], "no item while the line is still buffered");
  assert.equal(r.pending, partial);

  const f = flushStream("codex", r.pending);
  assert.deepEqual(f.items, [{ type: "agent_message", text: "last" }]);
  assert.equal(f.pending, "");
});

test("flushStream: empty/whitespace buffer yields nothing", () => {
  assert.deepEqual(flushStream("codex", "").items, []);
  assert.deepEqual(flushStream("claude", "  ").items, []);
});

// --- isNonVisibleStreamLine: parser behavior tests ---
// WHY: provider-internal reasoning blocks must produce no visible stream items
// and must not refresh the heartbeat. These tests prove the classifier is
// correct for every relevant record shape.

test("isNonVisibleStreamLine: claude pure thinking block is non-visible", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: "reasoning" }] },
  });
  assert.equal(isNonVisibleStreamLine("claude", line), true);
});

test("isNonVisibleStreamLine: claude pure redacted_thinking block is non-visible", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "redacted_thinking", data: "xxx" }] },
  });
  assert.equal(isNonVisibleStreamLine("claude", line), true);
});

test("isNonVisibleStreamLine: claude mixed thinking+text yields visible items", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "reasoning" },
        { type: "text", text: "visible reply" },
      ],
    },
  });
  assert.equal(isNonVisibleStreamLine("claude", line), false);
});

test("isNonVisibleStreamLine: claude assistant text-only block is visible", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "answer" }] },
  });
  assert.equal(isNonVisibleStreamLine("claude", line), false);
});

test("isNonVisibleStreamLine: claude result record is visible", () => {
  const line = JSON.stringify({ type: "result", result: "done" });
  assert.equal(isNonVisibleStreamLine("claude", line), false);
});

test("isNonVisibleStreamLine: codex reasoning type is non-visible", () => {
  const line = JSON.stringify({ type: "agent_reasoning", text: "reasoning" });
  assert.equal(isNonVisibleStreamLine("codex", line), true);
});

test("isNonVisibleStreamLine: codex item.completed with reasoning item_type is non-visible", () => {
  const line = JSON.stringify({
    type: "item.completed",
    item: { item_type: "reasoning", text: "reasoning" },
  });
  assert.equal(isNonVisibleStreamLine("codex", line), true);
});

test("isNonVisibleStreamLine: codex agent_message is visible", () => {
  const line = JSON.stringify({ type: "agent_message", message: "public" });
  assert.equal(isNonVisibleStreamLine("codex", line), false);
});

test("isNonVisibleStreamLine: non-JSON line is visible (not provider reasoning)", () => {
  assert.equal(isNonVisibleStreamLine("codex", "plain progress text"), false);
  assert.equal(isNonVisibleStreamLine("claude", "not json"), false);
});

test("isNonVisibleStreamLine: reasoning-only line produces no visible items (no heartbeat)", () => {
  // Proves reasoning-only lines produce no items → heartbeat not refreshed.
  const reasoningLine = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: "reasoning" }] },
  });
  const items = parseVisibleStream("claude", reasoningLine);
  assert.equal(items.length, 0, "reasoning-only line must produce zero visible items");
  assert.equal(isNonVisibleStreamLine("claude", reasoningLine), true);
});

test("isNonVisibleStreamLine: visible line produces items AND is not classified as non-visible", () => {
  const visible = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "answer" }] },
  });
  const items = parseVisibleStream("claude", visible);
  assert.ok(items.length > 0, "visible line must produce at least one item");
  assert.equal(isNonVisibleStreamLine("claude", visible), false);
});

test("consumeStreamChunk: claude assistant event split across chunks", () => {
  const full = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "buffered answer" }] },
  });
  const mid = Math.floor(full.length / 2);
  const r1 = consumeStreamChunk("claude", "", full.slice(0, mid));
  const r2 = consumeStreamChunk("claude", r1.pending, full.slice(mid) + "\n");
  assert.deepEqual(r2.items, [{ type: "text", text: "buffered answer" }]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
