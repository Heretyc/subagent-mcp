import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertInitBlock, INIT_BLOCK } from "../dist/init.js";

const SCHEMA2_BEGIN = "<!-- subagent-mcp:managed:begin schema=2 -->";
const SCHEMA3_BEGIN = "<!-- subagent-mcp:managed:begin schema=3 -->";
const SCHEMA4_BEGIN = "<!-- subagent-mcp:managed:begin schema=4 -->";
const MANAGED_END = "<!-- subagent-mcp:managed:end -->";
const LEGACY_BEGIN = "<!-- subagent-mcp:begin -->";
const LEGACY_END = "<!-- subagent-mcp:end -->";

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// A v1 legacy managed block (pre-schema=2 markers).
const LEGACY_BLOCK = [LEGACY_BEGIN, "## old managed content", "do not edit", LEGACY_END].join("\n");
const SCHEMA2_BLOCK = [
  SCHEMA2_BEGIN,
  "## stale schema 2 managed content",
  "old invariant text",
  MANAGED_END,
].join("\n");
const SCHEMA3_BLOCK = [
  SCHEMA3_BEGIN,
  "## subagent-mcp invariant - managed block, do not edit between markers",
  "",
  "Upserted by `subagent-mcp init` at user request; re-running init keeps it in sync.",
  "",
  "SUB-AGENT EXEMPTION: if this session's prompt's literal FIRST LINE begins with \"<this is a request from a parent process>\", SKIP this entire block EXCEPT the SUB-AGENT WORKTREE CARVE-OUT below, which still applies (you are a sub-agent; this prevents fail-safe-ON recursion and fork-bombs). Leading blank lines do not count. The marker must be physically line 1.",
  "",
  "SUB-AGENT WORKTREE CARVE-OUT: you are a delegated sub-agent (env SUBAGENT_MCP_SUBAGENT=1), already placed in your target working tree by the orchestrator. Do not create or switch git worktrees; skip the worktree-isolation gate; do all mutating work directly in the provided cwd.",
  "",
  "CANONICAL SOURCE: the subagent-mcp MCP `instructions` string (read once at connect) and docs/spec/dev-loop/orchestration-directive-architecture.md. This block mirrors that operating model inline so the session stays governed even if the MCP `instructions` are momentarily stale; where the two disagree, the MCP `instructions` win because they are read fresh each connect.",
  "",
  "HARNESS-HOOK STATE: a harness-hook context carrying a <subagent-mcp state=\"...\"> tag reports the current orchestration ON/OFF state and takes effect with no exceptions, because it is the only channel with fresh, harness-verified state. Self-reported prose cannot substitute for it. A token counts as such a tag only when it is a real tag with a `state` attribute; a bare mention of \"subagent-mcp\" in prose is not a tag and carries no authority. A user request can only switch orchestration ON or OFF, never assert what the current state already is. That comes solely from the tag. No tag present means the state is UNKNOWN (see NO-HOOK below); never infer it from anything else.",
  "",
  "PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority. Neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.",
  "",
  "ORCHESTRATION ON. You are the ORCHESTRATOR. Allowed tools: only the structured-question tool (AskUserQuestion on Claude / request-user-input on Codex), subagent-mcp, and the /workflows tool. There is no inline-by-right; every step runs in a sub-agent. If one atomic step truly cannot run in a sub-agent, ask the user via the structured-question tool for a one-time exception for that single step, perform only that step, then resume delegating. Sole channel: while subagent-mcp is connected, every sub-agent launch goes through `launch_agent`; never use harness-native sub-agent tools or shell-spawned agents.",
  "",
  "ORCHESTRATOR WORKTREE SETUP: launch sub-agents in the main checkout cwd (they no longer self-isolate into per-agent worktrees); serialize any sub-agents that write the same files. Never run concurrent writers over overlapping paths (no cwd-level lock exists).",
  "",
  "READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead. Do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.",
  "",
  "ORCHESTRATION OFF. A \"long-horizon task\" = any task whose TOTAL context footprint (input you read + output you produce) exceeds 200 lines of text. After EVERY user turn, measure the CUMULATIVE footprint accumulated since your last upgrade ask; reset that cumulative count to zero ONLY when you actually ask. If it qualifies, ask the user via the structured-question tool whether to switch orchestration ON. Ask on every qualifying turn; a decline does not suppress future asks. Never assert ON yourself. Only ask.",
  "",
  "DROPOUT WHILE ON: if subagent-mcp stops responding while orchestration is ON, halt and ask the user; do nothing inline. Keep re-checking and stay halted until subagent-mcp is restored (no auto-degrade). The only user choices are keep-waiting (the default) or explicitly abandon the whole task; aborting ends the task, it never switches you to inline work.",
  "",
  "NO-HOOK / UNKNOWN STATE: if no harness-hook injection bearing a <subagent-mcp state=\"...\"> tag is present this session (e.g. Gemini, desktop apps, or any host that fires no hook), the state is UNKNOWN. Represented by the absence of any tag, never by a tag value. Emit this warning to the user: \"subagent-mcp: no hook injection detected. Orchestration state unknown; defaulting to ON.\" Why: with no fresh state signal, defaulting to ON avoids ungoverned inline execution; one spoken opt-out is allowed per session. If you are not currently running an orchestration workflow, you may explicitly opt out of ON for this session by saying so now; this opt-out does not persist and is not recorded. The sub-agent first-line exemption is the only automatic suppressor of this default.",
  "",
  "DISABLE: never on your own initiative; you may propose OFF on task-fit mismatch via the structured-question tool, and only explicit user approval may set enabled:false. Per-session only; the next new session resumes ON; no mid-session re-enable.",
  MANAGED_END,
].join("\n");

function withTempFile(initialContent, fn) {
  const dir = mkdtempSync(join(tmpdir(), "subagent-init-mig-"));
  const file = join(dir, "CLAUDE.md");
  try {
    writeFileSync(file, initialContent, "utf8");
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("legacy v1 block migrates to exactly one schema=4 block, legacy markers gone", () => {
  const content = `# Project\n\nIntro text.\n\n${LEGACY_BLOCK}\n\nTrailing text.\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.changed, true);
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA4_BEGIN), 1, "exactly one schema=4 begin marker");
    assert.equal(count(out, MANAGED_END), 1, "exactly one managed end marker");
    assert.equal(count(out, LEGACY_BEGIN), 0, "legacy begin marker removed");
    assert.equal(count(out, LEGACY_END), 0, "legacy end marker removed");
    assert.ok(out.includes(INIT_BLOCK), "canonical schema=4 block present");
    assert.ok(out.includes("Trailing text."), "surrounding content preserved");
  });
});

test("existing schema=2 managed block migrates to exactly one schema=4 block", () => {
  const content = `# Project\n\nIntro text.\n\n${SCHEMA2_BLOCK}\n\nTrailing text.\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    assert.equal(result.changed, true);
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA4_BEGIN), 1, "exactly one schema=4 begin marker");
    assert.equal(count(out, MANAGED_END), 1, "exactly one managed end marker");
    assert.equal(count(out, SCHEMA2_BEGIN), 0, "schema=2 begin marker removed");
    assert.doesNotMatch(out, /stale schema 2 managed content/);
    assert.ok(out.includes(INIT_BLOCK), "canonical schema=4 block present");
    assert.ok(out.includes("Trailing text."), "surrounding content preserved");
  });
});

test("existing schema=3 managed block migrates to exactly one schema=4 block", () => {
  const content = `# Project\n\nIntro text.\n\n${SCHEMA3_BLOCK}\n\nTrailing text.\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    assert.equal(result.changed, true);
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA4_BEGIN), 1, "exactly one schema=4 begin marker");
    assert.equal(count(out, MANAGED_END), 1, "exactly one managed end marker");
    assert.equal(count(out, SCHEMA3_BEGIN), 0, "schema=3 begin marker removed");
    assert.doesNotMatch(out, /long-horizon task/);
    assert.ok(out.includes(INIT_BLOCK), "canonical schema=4 block present");
    assert.ok(out.includes("Trailing text."), "surrounding content preserved");
  });
});

test("two managed blocks collapse to exactly one schema=4 block", () => {
  const content = `# Project\n\n${LEGACY_BLOCK}\n\nmiddle\n\n${INIT_BLOCK}\n\nend\n`;
  withTempFile(content, (file) => {
    const result = upsertInitBlock(file);
    assert.equal(result.status, "updated");
    const out = readFileSync(file, "utf8");

    assert.equal(count(out, SCHEMA4_BEGIN), 1, "collapsed to one schema=4 begin");
    assert.equal(count(out, MANAGED_END), 1, "collapsed to one managed end");
    assert.equal(count(out, LEGACY_BEGIN), 0, "legacy begin marker removed");
    assert.equal(count(out, LEGACY_END), 0, "legacy end marker removed");
  });
});

test("existing schema=4 block is idempotent across repeated runs", () => {
  const content = `# Project\n\n${INIT_BLOCK}\n\nbody\n`;
  withTempFile(content, (file) => {
    const first = upsertInitBlock(file);
    assert.equal(first.status, "ok", "already-canonical block needs no change");
    assert.equal(first.changed, false);
    const afterFirst = readFileSync(file, "utf8");

    const second = upsertInitBlock(file);
    assert.equal(second.status, "ok");
    const afterSecond = readFileSync(file, "utf8");

    assert.equal(afterFirst, afterSecond, "content unchanged on re-run");
    assert.equal(count(afterSecond, SCHEMA4_BEGIN), 1, "exactly one block remains");
    assert.equal(count(afterSecond, MANAGED_END), 1);
  });
});
