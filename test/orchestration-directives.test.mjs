/**
 * orchestration-directives.test.mjs — Content assertions for the repo-root
 * directive assets (directives/*.md), MIGRATED to the schema=2 redesign.
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const directivesDir = join(__dirname, "..", "directives");

const claude = readFileSync(join(directivesDir, "orchestration-claude.md"), "utf8");
const codex = readFileSync(join(directivesDir, "orchestration-codex.md"), "utf8");
const carryoverClaude = readFileSync(join(directivesDir, "carryover-claude.md"), "utf8");
const carryoverCodex = readFileSync(join(directivesDir, "carryover-codex.md"), "utf8");
const shortOn = readFileSync(join(directivesDir, "short-on.md"), "utf8");
const shortOff = readFileSync(join(directivesDir, "short-off.md"), "utf8");
const reminderOn = readFileSync(join(directivesDir, "reminder-on.md"), "utf8");
const reminderOffClaude = readFileSync(join(directivesDir, "reminder-off-claude.md"), "utf8");
const reminderOffCodex = readFileSync(join(directivesDir, "reminder-off-codex.md"), "utf8");

// The single authority tag of the schema=2 design.
const TAG_OPEN_RE = /<subagent-mcp state="(on|off)" kind="(directive|reminder|carryover|carrier)">/;
const TAG_CLOSE = "</subagent-mcp>";

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

// ---------------------------------------------------------------------------
// Single authority tag + NO legacy tags + NO deleted 5-call rule
//
// WHY (Rule 9): every surface now carries exactly one schema=2 tag with the
// correct state/kind. Any legacy split tag or any "5-call" cue reappearing is
// the regression this guards against.
// ---------------------------------------------------------------------------
test("every directive carries exactly one schema=2 <subagent-mcp> tag with correct state/kind", () => {
  for (const [name, body, state, kind] of ALL) {
    const m = body.match(TAG_OPEN_RE);
    assert.ok(m, `${name} must open with the single <subagent-mcp state=... kind=...> tag`);
    assert.equal(m[1], state, `${name} must declare state="${state}"`);
    assert.equal(m[2], kind, `${name} must declare kind="${kind}"`);
    // Exactly one STRUCTURAL (kind-bearing) open tag; inline bare-tag
    // references like "the MOST RECENT <subagent-mcp state=\"on\">" don't count.
    assert.equal((body.match(/<subagent-mcp state="(?:on|off)" kind="/g) ?? []).length, 1,
      `${name} must contain exactly one structural open tag`);
    assert.equal((body.match(/<\/subagent-mcp>/g) ?? []).length, 1,
      `${name} must contain exactly one close tag`);
    assert.ok(body.indexOf("<subagent-mcp ") < body.indexOf(TAG_CLOSE),
      `${name} must open the tag before closing it`);
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
test("OFF reminders carry the 200-line footprint upgrade trigger", () => {
  for (const [name, body] of [
    ["reminder-off-claude", reminderOffClaude],
    ["reminder-off-codex", reminderOffCodex],
  ]) {
    assert.match(body, /200 lines/,
      `${name} must state the 200-line footprint threshold`);
    assert.match(body, /EVERY qualifying turn/i,
      `${name} must ask on every qualifying turn`);
    assert.match(body, /subagent-mcp/i,
      `${name} must preserve the subagent-mcp routing cue while OFF`);
  }
});

test("OFF reminders are provider-split on the question tool", () => {
  assert.ok(reminderOffClaude.includes("AskUserQuestion"),
    "reminder-off-claude must name the AskUserQuestion tool");
  assert.ok(!reminderOffClaude.includes("request-user-input"),
    "reminder-off-claude must NOT leak the Codex request-user-input tool");
  assert.ok(reminderOffCodex.includes("request-user-input"),
    "reminder-off-codex must name the request-user-input tool");
  assert.ok(!reminderOffCodex.includes("AskUserQuestion"),
    "reminder-off-codex must NOT leak the Claude AskUserQuestion tool");
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
      `${name} must point at the most recent schema=2 tag`);
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
  for (const [name, body] of ALL) {
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
