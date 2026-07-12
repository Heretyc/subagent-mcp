/**
 * orchestration-directives.test.mjs — Content assertions for the repo-root
 * directive assets (directives/*.md), MIGRATED to the schema=3 redesign.
 *
 * WHY (Rule 9): two protective contracts survive the redesign and are encoded
 * here against INTENT, not wording, so they keep failing if a recompression
 * drops a half:
 *   1. Provider-split permission tool — each variant must name ITS OWN
 *      interactive tool and ONLY that one. A claude directive that leaked
 *      "request-user-input" (or a codex directive that leaked
 *      "AskUserQuestion") would route the agent to a tool that does not exist
 *      on its provider, silently breaking the permission/confirm gate.
 *   2. Single-tag authority — every directive now carries exactly one
 *      <subagent-mcp state=... kind=...> tag. The legacy split tags
 *      (<ORCHESTRATION-INVARIANT>, <ORCHESTRATION-CARRYOVER>,
 *      <SUB-AGENT-INVARIANT>, ...-REMINDER-INVARIANT) are REMOVED; their
 *      reappearance would give agents competing authority labels and break the
 *      machine-checkable per-turn line. The deleted 5-call rule must stay gone.
 * The 200-line cap keeps the injected directives lean.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const directivesDir = join(__dirname, "..", "directives");
const srcDir = join(__dirname, "..", "src");

const claude = readFileSync(join(directivesDir, "orchestration-claude.md"), "utf8");
const codex = readFileSync(join(directivesDir, "orchestration-codex.md"), "utf8");
const carryoverClaude = readFileSync(join(directivesDir, "carryover-claude.md"), "utf8");
const carryoverCodex = readFileSync(join(directivesDir, "carryover-codex.md"), "utf8");
const shortOn = readFileSync(join(directivesDir, "short-on.md"), "utf8");
const shortOff = readFileSync(join(directivesDir, "short-off.md"), "utf8");
const reminderOn = readFileSync(join(directivesDir, "reminder-on.md"), "utf8");
const reminderOffClaude = readFileSync(join(directivesDir, "reminder-off-claude.md"), "utf8");
const reminderOffCodex = readFileSync(join(directivesDir, "reminder-off-codex.md"), "utf8");
const initSource = readFileSync(join(srcDir, "init.ts"), "utf8");
const indexSource = readFileSync(join(srcDir, "index.ts"), "utf8");

// Hook-owned authority tags are injected at runtime as their OWN wrapper lines:
// an opening `<subagent-mcp state=...>` line and a closing `</subagent-mcp>`
// line. In-body prose references (e.g. "follow the MOST RECENT <subagent-mcp
// state="off"> tag") are legitimate routing cues, NOT file-resident wrappers, so
// these regexes match ONLY wrapper-SHAPED lines (a whole line that is the tag),
// never mid-sentence mentions.
const WRAPPER_OPEN_LINE_RE = /^\s*<subagent-mcp\s+state="(?:on|off)"[^>]*>\s*$/;
const WRAPPER_CLOSE_LINE_RE = /^\s*<\/subagent-mcp>\s*$/;

// Legacy constructs the redesign intentionally removed — these must be ABSENT.
const LEGACY_TAGS = [
  "ORCHESTRATION-" + "INVARIANT",
  "ORCHESTRATION-" + "CARRYOVER",
  "SUB-" + "AGENT-INVARIANT",
  "ORCHESTRATION-" + "REMINDER-INVARIANT",
];

const ALL = [
  ["orchestration-claude", claude, "on", "directive"],
  ["orchestration-codex", codex, "on", "directive"],
  ["carryover-claude", carryoverClaude, "on", "carryover"],
  ["carryover-codex", carryoverCodex, "on", "carryover"],
  ["reminder-on", reminderOn, "on", "reminder"],
  ["reminder-off-claude", reminderOffClaude, "off", "reminder"],
  ["reminder-off-codex", reminderOffCodex, "off", "reminder"],
  ["short-on", shortOn, "on", "carrier"],
  ["short-off", shortOff, "off", "carrier"],
];

const REQUEST_USER_INPUT_RE = /request[-_]user[-_]input/;

const BANNED_ORCHESTRATION_LEXICON_RE = new RegExp(
  "co-" + "supreme|maximally " + "critical",
  "i",
);

function sourceRange(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start marker must exist`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} end marker must exist`);
  return source.slice(start, end);
}

const DIRECTIVE_FILES = readdirSync(directivesDir)
  .filter((entry) => entry.endsWith(".md"))
  .map((entry) => [entry, readFileSync(join(directivesDir, entry), "utf8")]);

const CANONICAL_INSTRUCTION_SOURCES = [
  ["src/init.ts INIT_BLOCK", sourceRange(initSource, "export const INIT_BLOCK =", "function detectEol", "INIT_BLOCK")],
  ["src/index.ts ORCHESTRATION_INSTRUCTIONS", sourceRange(indexSource, "const ORCHESTRATION_INSTRUCTIONS =", "const SUBAGENT_INSTRUCTIONS =", "ORCHESTRATION_INSTRUCTIONS")],
];

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

// ---------------------------------------------------------------------------
// Provider-split permission tool: each variant names ONLY its own tool
// ---------------------------------------------------------------------------
test("claude directive names AskUserQuestion and NOT request-user-input", () => {
  assert.ok(claude.includes("AskUserQuestion"),
    "claude variant must name the AskUserQuestion tool");
  assert.ok(!claude.includes("request-user-input"),
    "claude variant must NOT leak the Codex request-user-input tool");
});

test("codex directive names request-user-input and NOT AskUserQuestion", () => {
  assert.ok(codex.includes("request-user-input"),
    "codex variant must name the request-user-input tool");
  assert.ok(!codex.includes("AskUserQuestion"),
    "codex variant must NOT leak the Claude AskUserQuestion tool");
});

// ---------------------------------------------------------------------------
// Disable-governance intent present in BOTH long ON directives
//
// WHY (Rule 9): the binding disable rule — never self-disable — must survive
// recompression. Tied to INTENT, not exact wording.
// ---------------------------------------------------------------------------
test("both ON directives forbid self-disable", () => {
  for (const [name, body] of [["claude", claude], ["codex", codex]]) {
    assert.match(body, /never on your own initiative/i,
      `${name} variant must forbid disabling on its own initiative`);
  }
});

// ---------------------------------------------------------------------------
// No "ultracode" leakage in any directive asset (case-insensitive).
// ---------------------------------------------------------------------------
test("no directive file contains 'ultracode' (case-insensitive)", () => {
  for (const [name, body] of ALL) {
    assert.ok(!/ultracode/i.test(body),
      `${name} directive must not reference "ultracode"`);
  }
});

test("no directive or canonical instruction source contains banned orchestration lexicon", () => {
  for (const [name, body] of [...DIRECTIVE_FILES, ...CANONICAL_INSTRUCTION_SOURCES]) {
    assert.ok(!BANNED_ORCHESTRATION_LEXICON_RE.test(body),
      `${name} must not contain banned orchestration lexicon`);
  }
});

// ---------------------------------------------------------------------------
// Single authority tag + NO legacy tags + NO deleted 5-call rule
//
// WHY (Rule 9): every surface now carries exactly one schema=3 tag with the
// correct state/kind. Any legacy split tag or any "5-call" cue reappearing is
// the regression this guards against.
// ---------------------------------------------------------------------------
test("directive bodies contain zero literal hook authority tags", () => {
  for (const [name, body] of DIRECTIVE_FILES) {
    if (name === "tag-template.md") continue;
    const lines = body.split(/\r?\n/);
    const openWrapperLines = lines.filter((l) => WRAPPER_OPEN_LINE_RE.test(l));
    const closeWrapperLines = lines.filter((l) => WRAPPER_CLOSE_LINE_RE.test(l));
    assert.equal(openWrapperLines.length, 0,
      `${name} must not contain a file-resident <subagent-mcp state=...> wrapper line`);
    assert.equal(closeWrapperLines.length, 0,
      `${name} must not contain a file-resident </subagent-mcp> wrapper line`);
  }
});

test("no directive keeps a legacy authority tag", () => {
  for (const [name, body] of ALL) {
    for (const legacy of LEGACY_TAGS) {
      assert.ok(!body.includes(legacy),
        `${name} must not keep the legacy "${legacy}" tag`);
    }
  }
});

test("the deleted 5-call rule appears in NO directive", () => {
  for (const [name, body] of ALL) {
    assert.ok(!/5[ -]?call/i.test(body),
      `${name} must not reference the deleted 5-call rule`);
  }
});

// ---------------------------------------------------------------------------
// First-line sub-agent exemption present in every directive (the ONLY
// automatic suppressor of the regime).
// ---------------------------------------------------------------------------
test("every directive carries the first-line parent-process exemption", () => {
  for (const [name, body] of ALL) {
    assert.match(body, /<this is a request from a parent process>/,
      `${name} must carry the sub-agent first-line exemption`);
  }
});

// ---------------------------------------------------------------------------
// OFF reminders encode the NEW upgrade trigger: cumulative >200-line context
// footprint, asked every qualifying turn (replaces the deleted 5-call trigger).
// ---------------------------------------------------------------------------
test("OFF reminders mention the 15% latch doctrine", () => {
  for (const [name, body] of [
    ["reminder-off-claude", reminderOffClaude],
    ["reminder-off-codex", reminderOffCodex],
  ]) {
    assert.match(body, /15%|latch/i,
      `${name} must state the 15% latch replacement doctrine`);
    assert.match(body, /subagent-mcp/i,
      `${name} must preserve the subagent-mcp routing cue while OFF`);
  }
});

test("latch and handoff directives carry provider-specific coaching counts", () => {
  const latchClaude = readFileSync(join(directivesDir, "latch-claude.md"), "utf8");
  const latchCodex = readFileSync(join(directivesDir, "latch-codex.md"), "utf8");
  const handoffClaude = readFileSync(join(directivesDir, "handoff-claude.md"), "utf8");
  const handoffCodex = readFileSync(join(directivesDir, "handoff-codex.md"), "utf8");

  assert.match(latchClaude, /EXACTLY 5/i, "latch-claude must require exactly 5 questions");
  assert.match(latchClaude, /AskUserQuestion/, "latch-claude must name AskUserQuestion");
  assert.ok(!REQUEST_USER_INPUT_RE.test(latchClaude), "latch-claude must not name the Codex question tool");

  assert.match(latchCodex, /EXACTLY 5/i, "latch-codex must require exactly 5 questions");
  assert.match(latchCodex, REQUEST_USER_INPUT_RE, "latch-codex must name the Codex question tool");
  assert.ok(!latchCodex.includes("AskUserQuestion"), "latch-codex must not name AskUserQuestion");

  for (const [name, body] of [["handoff-claude", handoffClaude], ["handoff-codex", handoffCodex]]) {
    assert.match(body, /handoff-write[\s\S]{0,160}10/i,
      `${name} must mention 10 questions near handoff-write`);
    assert.match(body, /handoff-read[\s\S]{0,160}5/i,
      `${name} must mention 5 questions near handoff-read`);
  }

  assert.match(handoffClaude, /AskUserQuestion/, "handoff-claude must name AskUserQuestion");
  assert.ok(!REQUEST_USER_INPUT_RE.test(handoffClaude), "handoff-claude must not name the Codex question tool");
  assert.match(handoffCodex, REQUEST_USER_INPUT_RE, "handoff-codex must name the Codex question tool");
  assert.ok(!handoffCodex.includes("AskUserQuestion"), "handoff-codex must not name AskUserQuestion");
});

// ---------------------------------------------------------------------------
// reminder-on: delegate-default intent + pointer to the full MCP governance.
// ---------------------------------------------------------------------------
test("reminder-on reinforces delegate-default and points at MCP governance", () => {
  assert.match(reminderOn, /delegate/i,
    "reminder-on must reinforce delegate-default");
  assert.match(reminderOn, /server MCP/,
    "reminder-on must point at the full MCP governance");
  // reminder-on is provider-NEUTRAL: it names BOTH question tools (so it works
  // on either host) rather than committing to one — unlike the *-claude/*-codex
  // splits which must name exactly one.
  assert.ok(reminderOn.includes("AskUserQuestion") && reminderOn.includes("request-user-input"),
    "reminder-on must remain provider-neutral by naming both question tools");
});

// ---------------------------------------------------------------------------
// short carriers: single-line state-aware pointers to the MOST RECENT tag.
// ---------------------------------------------------------------------------
test("short carriers are state-aware pointers to the most recent tag", () => {
  for (const [name, body, state] of [
    ["short-on", shortOn, "ON"],
    ["short-off", shortOff, "OFF"],
  ]) {
    const lines = body.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 1,
      `${name} must be exactly one non-empty line`);
    assert.match(body, new RegExp(`Orchestration ${state}`),
      `${name} must state the orchestration state`);
    assert.match(body, /MOST RECENT <subagent-mcp/,
      `${name} must point at the most recent schema=3 tag`);
  }
});

// ---------------------------------------------------------------------------
// Carryover notice: provider-split permission tool (same invariant as above)
// ---------------------------------------------------------------------------
test("carryover-claude names AskUserQuestion and NOT request-user-input", () => {
  assert.ok(carryoverClaude.includes("AskUserQuestion"),
    "carryover-claude must name the AskUserQuestion tool");
  assert.ok(!carryoverClaude.includes("request-user-input"),
    "carryover-claude must NOT leak the Codex request-user-input tool");
});

test("carryover-codex names request-user-input and NOT AskUserQuestion", () => {
  assert.ok(carryoverCodex.includes("request-user-input"),
    "carryover-codex must name the request-user-input tool");
  assert.ok(!carryoverCodex.includes("AskUserQuestion"),
    "carryover-codex must NOT leak the Claude AskUserQuestion tool");
});

// ---------------------------------------------------------------------------
// Carryover notice: notify + ask + advise intent present in BOTH variants
// ---------------------------------------------------------------------------
test("both carryover notices carry the notify/ask/advise intent", () => {
  for (const [name, body] of [["claude", carryoverClaude], ["codex", carryoverCodex]]) {
    assert.match(body, /carried over/i,
      `${name} carryover must state the mode carried over from a prior session`);
    assert.match(body, /enabled:false/,
      `${name} carryover must point at the enabled:false disable path`);
  }
});

// ---------------------------------------------------------------------------
// Lean-directive cap: every directive file stays <= 200 lines
// ---------------------------------------------------------------------------
test("all directive files stay <= 200 lines", () => {
  for (const [name, body] of DIRECTIVE_FILES) {
    const lineCount = body.split("\n").length;
    assert.ok(lineCount <= 200,
      `${name} directive must stay <= 200 lines (was ${lineCount})`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
