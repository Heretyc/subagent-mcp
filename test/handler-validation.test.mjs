/**
 * Handler param-presence validation tests for launch_agent.
 *
 * Drives every presence combination from
 * docs/spec/auto-mode/resolution-matrix.md against the REAL exported
 * validatePresence() in src/routing.ts (compiled to dist/routing.js) — not a
 * re-implementation. Asserts the exact outcome enum AND the verbatim error
 * message text (including AUTO_HINT / SPLIT_HINT presence + ordering), so the
 * contentious model+effort-without-provider row (matrix row 33) and the exact
 * strings cannot silently regress (Rule 9: tests verify intent).
 *
 * Imports from dist/routing.js ONLY — the pure, side-effect-free presence layer.
 * It NEVER imports dist/index.js: that entry module opens the stdio transport
 * (under an isMain gate) and registers a reconcile timer, which would keep the
 * test's event loop alive. This test process must exit cleanly.
 */

import assert from "node:assert/strict";

import { validatePresence } from "../dist/routing.js";

// Verbatim hint blocks (resolution-matrix.md). Asserted by substring so a hint
// edit in src/index.ts surfaces here.
const AUTO_HINT =
  "Tip: omit provider/model/effort entirely and the server auto-selects the best provider/model/effort for this task_category, with automatic silent fallback.";
const SPLIT_HINT =
  "If unsure which category fits, do NOT pass one big amorphous task: break the work into smaller atomic steps that each map to a single task_category, and launch one agent per step.";

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
// Valid presence combinations (matrix rows 28-31) — validatePresence returns
// null (no error); the mode/candidate logic is exercised by routing tests.
// WHY: a false-positive error here would block every legitimate launch.
// ---------------------------------------------------------------------------
test("auto mode (category only) passes validation -> null", () => {
  assert.equal(validatePresence({ task_category: "architecture" }), null,
    "category-only input is the primary auto-mode path; must never error");
});

test("provider mode (category + provider) passes -> null", () => {
  assert.equal(
    validatePresence({ task_category: "coding", provider: "claude" }),
    null,
    "provider-only override is a valid mode");
});

test("provider_model mode (category + provider + model) passes -> null", () => {
  assert.equal(
    validatePresence({ task_category: "coding", provider: "claude", model: "sonnet" }),
    null,
    "provider+model override is a valid mode");
});

test("explicit mode (category + provider + model + effort) passes -> null", () => {
  assert.equal(
    validatePresence({
      task_category: "coding",
      provider: "claude",
      model: "opus-4-8",
      effort: "ultracode",
    }),
    null,
    "fully-explicit launch is valid");
});

test("explicit codex mode passes -> null", () => {
  assert.equal(
    validatePresence({
      task_category: "debugging",
      provider: "codex",
      model: "gpt-5.5",
      effort: "xhigh",
    }),
    null,
    "fully-explicit codex launch is valid");
});

// ---------------------------------------------------------------------------
// ERR_BAD_CATEGORY (matrix row 36) — category absent or unknown, validated
// FIRST (before P/M/E rules). Renders `Got: <none>` when absent, else the value.
// WHY: category drives the whole resolver; a bad/missing one must fail loud
// with the full valid-list + both hints, regardless of P/M/E.
// ---------------------------------------------------------------------------
test("ERR_BAD_CATEGORY: absent category -> exact text with 'Got: <none>' + both hints", () => {
  const msg = validatePresence({});
  assert.ok(msg, "absent category must produce an error");
  assert.ok(
    msg.startsWith(
      "Error: task_category is required and must be one of: math_proof, security_review, debugging, quality_review, architecture, agentic_execution, data_analysis, coding, knowledge_synthesis, mechanical, fallback_default. Got: <none>."
    ),
    "absent category renders 'Got: <none>.' and lists all 11 categories verbatim");
  assert.ok(msg.includes(SPLIT_HINT), "ERR_BAD_CATEGORY must include SPLIT_HINT");
  assert.ok(msg.includes(AUTO_HINT), "ERR_BAD_CATEGORY must include AUTO_HINT");
  // SPLIT_HINT precedes AUTO_HINT per the message template.
  assert.ok(msg.indexOf(SPLIT_HINT) < msg.indexOf(AUTO_HINT),
    "SPLIT_HINT must appear before AUTO_HINT in ERR_BAD_CATEGORY");
});

test("ERR_BAD_CATEGORY: unknown category interpolates the offending value", () => {
  const msg = validatePresence({ task_category: "not_a_real_category" });
  assert.ok(msg && msg.includes("Got: not_a_real_category."),
    "unknown category must echo the offending value, not '<none>'");
});

test("ERR_BAD_CATEGORY: validated FIRST even with provider/model/effort present", () => {
  // Bad category WITH a full explicit triple must still be ERR_BAD_CATEGORY,
  // not a P/M/E error — category is step 1.
  const msg = validatePresence({
    task_category: "bogus",
    provider: "claude",
    model: "opus-4-8",
    effort: "high",
  });
  assert.ok(msg && msg.startsWith("Error: task_category is required"),
    "category validation must precede P/M/E checks (resolution-matrix.md step 1)");
});

// ---------------------------------------------------------------------------
// ERR_MODEL_NEEDS_PROVIDER (matrix row 32) — model present, provider absent,
// effort absent.
// WHY: a model without a provider cannot select a CLI; must fail loud.
// ---------------------------------------------------------------------------
test("ERR_MODEL_NEEDS_PROVIDER: model without provider (no effort) -> exact text + AUTO_HINT only", () => {
  const msg = validatePresence({ task_category: "coding", model: "sonnet" });
  assert.ok(msg, "model without provider must error");
  assert.ok(
    msg.startsWith(
      "Error: provider is required when model is given. You passed model=sonnet without provider. Either also pass provider, or omit both."
    ),
    "ERR_MODEL_NEEDS_PROVIDER exact text with interpolated model");
  assert.ok(msg.includes(AUTO_HINT), "ERR_MODEL_NEEDS_PROVIDER must include AUTO_HINT");
  assert.ok(!msg.includes(SPLIT_HINT),
    "ERR_MODEL_NEEDS_PROVIDER must NOT include SPLIT_HINT (AUTO_HINT only)");
});

// ---------------------------------------------------------------------------
// ERR_EFFORT_NEEDS_BOTH (matrix rows 33, 34, 35) — effort present without a
// complete provider+model. CONTENTIOUS ROW 33: model + effort, NO provider.
// resolution-matrix.md row 33 and the numbered Validation order (effort rule
// step 2, BEFORE the model rule step 3) and param-contract.md's Net rule all
// agree the effort rule fires FIRST. This test pins that ordering so the
// historical spec ambiguity cannot silently regress to ERR_MODEL_NEEDS_PROVIDER.
// ---------------------------------------------------------------------------
test("ERR_EFFORT_NEEDS_BOTH: effort alone (row 34) -> exact text + AUTO_HINT only", () => {
  const msg = validatePresence({ task_category: "coding", effort: "high" });
  assert.ok(msg, "effort alone must error");
  assert.ok(
    msg.startsWith(
      "Error: effort requires both provider and model. You passed effort=high without a complete provider+model. Either pass provider+model+effort for a fully explicit launch, or omit all three."
    ),
    "ERR_EFFORT_NEEDS_BOTH exact text with interpolated effort");
  assert.ok(msg.includes(AUTO_HINT), "ERR_EFFORT_NEEDS_BOTH must include AUTO_HINT");
  assert.ok(!msg.includes(SPLIT_HINT), "ERR_EFFORT_NEEDS_BOTH must NOT include SPLIT_HINT");
});

test("ERR_EFFORT_NEEDS_BOTH: provider + effort, no model (row 35)", () => {
  const msg = validatePresence({ task_category: "coding", provider: "claude", effort: "high" });
  assert.ok(msg && msg.startsWith("Error: effort requires both provider and model."),
    "provider+effort without model is ERR_EFFORT_NEEDS_BOTH");
});

test("ROW 33 (contentious): model + effort, NO provider -> ERR_EFFORT_NEEDS_BOTH, NOT ERR_MODEL_NEEDS_PROVIDER", () => {
  const msg = validatePresence({ task_category: "coding", model: "sonnet", effort: "high" });
  assert.ok(msg, "model+effort without provider must error");
  // The effort rule (Validation order step 2) is checked BEFORE the model rule
  // (step 3). resolution-matrix.md row 33 + param-contract.md Net rule agree.
  assert.ok(
    msg.startsWith("Error: effort requires both provider and model."),
    "row 33 MUST be ERR_EFFORT_NEEDS_BOTH (effort rule checked first), NOT ERR_MODEL_NEEDS_PROVIDER");
  assert.ok(
    !msg.startsWith("Error: provider is required when model is given."),
    "row 33 must NOT resolve to ERR_MODEL_NEEDS_PROVIDER — that is the divergence this test guards");
});

// ---------------------------------------------------------------------------
// Explicit provider↔model match rule (resolution-matrix.md step 4) — reuses the
// existing constraint message verbatim.
// WHY: the explicit triple must still satisfy the provider/model pairing rule;
// these messages have NO AUTO_HINT (they predate auto-mode and are unchanged).
// ---------------------------------------------------------------------------
test("explicit mismatch: claude + gpt-5.5 -> Claude constraint message", () => {
  const msg = validatePresence({
    task_category: "coding",
    provider: "claude",
    model: "gpt-5.5",
    effort: "high",
  });
  assert.equal(
    msg,
    "Error: Claude provider only supports haiku, sonnet, opus, or opus-4-8. Got: gpt-5.5",
    "claude+gpt-5.5 returns the existing Claude-constraint message verbatim");
});

test("explicit mismatch: codex + sonnet -> Codex constraint message", () => {
  const msg = validatePresence({
    task_category: "coding",
    provider: "codex",
    model: "sonnet",
    effort: "high",
  });
  assert.equal(
    msg,
    "Error: Codex provider only supports gpt-5.5. Got: sonnet",
    "codex+sonnet returns the existing Codex-constraint message verbatim");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
