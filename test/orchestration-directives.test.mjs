/**
 * orchestration-directives.test.mjs — Content assertions for the repo-root
 * directive assets (directives/orchestration-claude.md,
 * directives/orchestration-codex.md, and the carryover notices
 * directives/carryover-claude.md, directives/carryover-codex.md).
 *
 * WHY (Rule 9): the disable-governance and carryover-confirm contracts are both
 * provider-split — each variant must name ITS OWN interactive permission tool
 * and ONLY that one. A claude directive that leaked "request-user-input" (or a
 * codex directive that leaked "AskUserQuestion") would route the agent to a tool
 * that does not exist on its provider, silently breaking the permission/confirm
 * gate. These tests fail the moment the variants stop being mutually exclusive
 * on the tool name, or the disable-governance / carryover intent is dropped. The
 * 200-line cap keeps the injected directives lean.
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
const offTurn = readFileSync(join(directivesDir, "off-turn-reminder.md"), "utf8");
const reminderOn = readFileSync(join(directivesDir, "reminder-on.md"), "utf8");
const reminderOffClaude = readFileSync(join(directivesDir, "reminder-off-claude.md"), "utf8");
const reminderOffCodex = readFileSync(join(directivesDir, "reminder-off-codex.md"), "utf8");

const REMINDER_OPEN = "<ORCHESTRATION-REMINDER-INVARIANT>";
const REMINDER_CLOSE = "</ORCHESTRATION-REMINDER-INVARIANT>";

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
// Disable-governance intent present in BOTH variants
//
// WHY (Rule 9): the compressed per-turn reminder still must encode the binding
// disable rule — never self-disable, and only with explicit user permission via
// the provider tool. The regex is intentionally tied to that INTENT (not exact
// wording) so it keeps failing if either half is dropped during recompression.
// ---------------------------------------------------------------------------
test("both directives carry the disable-governance intent (no self-disable, explicit permission)", () => {
  for (const [name, body] of [["claude", claude], ["codex", codex]]) {
    assert.match(body, /never on own initiative/i,
      `${name} variant must forbid disabling on its own initiative`);
    assert.match(body, /propose via (AskUserQuestion|request-user-input) only/i,
      `${name} variant must gate disabling behind a propose-only provider-tool ask`);
  }
});

// ---------------------------------------------------------------------------
// No "ultracode" leakage: the operating-model phrasing is generic workflow
// orchestration. The legacy "ultracode workflow system" wording must not appear
// in any per-turn directive asset (case-insensitive).
// ---------------------------------------------------------------------------
test("no directive file contains 'ultracode' (case-insensitive)", () => {
  for (const [name, body] of [
    ["claude", claude],
    ["codex", codex],
    ["carryover-claude", carryoverClaude],
    ["carryover-codex", carryoverCodex],
    ["off-turn-reminder", offTurn],
    ["reminder-on", reminderOn],
    ["reminder-off-claude", reminderOffClaude],
    ["reminder-off-codex", reminderOffCodex],
  ]) {
    assert.ok(!/ultracode/i.test(body),
      `${name} directive must not reference "ultracode"`);
  }
});

// ---------------------------------------------------------------------------
// Per-prompt reminder blocks: exact tag wrapper + mode-specific content
//
// WHY (Rule 9): the <ORCHESTRATION-REMINDER-INVARIANT> tag is the UNAMBIGUOUS
// callout the one-line pointer references — if the tag drifts (typo, rename,
// missing close), every interceding prompt points at a block that never
// arrives, and the agent free-associates the directive content instead of
// reading it. The OFF variants must each name only THEIR provider's question
// tool (same provider-split invariant as the full directives), and the long
// blocks must carry the 5-call-rule / delegate-default intent they exist for.
// ---------------------------------------------------------------------------
test("reminder blocks are wrapped in exact <ORCHESTRATION-REMINDER-INVARIANT> tags", () => {
  for (const [name, body] of [
    ["reminder-on", reminderOn],
    ["reminder-off-claude", reminderOffClaude],
    ["reminder-off-codex", reminderOffCodex],
  ]) {
    assert.ok(body.includes(REMINDER_OPEN),
      `${name} must open with the exact reminder tag`);
    assert.ok(body.includes(REMINDER_CLOSE),
      `${name} must close the exact reminder tag`);
    assert.ok(body.indexOf(REMINDER_OPEN) < body.indexOf(REMINDER_CLOSE),
      `${name} must open the tag before closing it`);
  }
});

test("reminder-off variants are provider-split on the question tool", () => {
  assert.ok(reminderOffClaude.includes("AskUserQuestion"),
    "reminder-off-claude must name the AskUserQuestion tool");
  assert.ok(!reminderOffClaude.includes("request-user-input"),
    "reminder-off-claude must NOT leak the Codex request-user-input tool");
  assert.ok(reminderOffCodex.includes("request-user-input"),
    "reminder-off-codex must name the request-user-input tool");
  assert.ok(!reminderOffCodex.includes("AskUserQuestion"),
    "reminder-off-codex must NOT leak the Claude AskUserQuestion tool");
  assert.ok(!reminderOn.includes("AskUserQuestion") && !reminderOn.includes("request-user-input"),
    "reminder-on is provider-neutral and names no question tool");
});

test("reminder blocks carry their mode-specific intent", () => {
  for (const [name, body] of [
    ["reminder-off-claude", reminderOffClaude],
    ["reminder-off-codex", reminderOffCodex],
  ]) {
    assert.match(body, /5-CALL RULE/,
      `${name} must state the 5-call rule`);
    assert.match(body, /full-auto routing/i,
      `${name} must advise subagent-mcp full-auto routing while OFF`);
  }
  assert.match(reminderOn, /[Dd]elegate-default/,
    "reminder-on must reinforce delegate-default");
  assert.match(reminderOn, /5-CALL RULE/,
    "reminder-on must state that delegation satisfies the 5-call rule");
});

test("off-turn pointer is a single line referencing the reminder tag", () => {
  const lines = offTurn.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 1,
    "the interceding-prompt pointer must be exactly one non-empty line");
  assert.ok(lines[0].includes("<ORCHESTRATION-REMINDER-INVARIANT>"),
    "the pointer must reference the exact reminder tag");
});

// ---------------------------------------------------------------------------
// Carryover notice: provider-split permission tool (same invariant as above)
//
// WHY (Rule 9): the carryover notice is the ONLY turn that asks the user to
// confirm an auto-activated mode, so it MUST route to the provider's real
// interactive tool. A leaked cross-provider tool name here silently breaks the
// confirm gate exactly when it matters most.
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
  for (const [name, body] of [
    ["claude", claude],
    ["codex", codex],
    ["carryover-claude", carryoverClaude],
    ["carryover-codex", carryoverCodex],
    ["reminder-on", reminderOn],
    ["reminder-off-claude", reminderOffClaude],
    ["reminder-off-codex", reminderOffCodex],
  ]) {
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
