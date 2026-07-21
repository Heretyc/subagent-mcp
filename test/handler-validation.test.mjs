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

import { TASK_CATEGORIES, validatePresence } from "../dist/routing.js";

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

test("provider_model mode accepts claude+fable -> null", () => {
  assert.equal(
    validatePresence({ task_category: "debugging", provider: "claude", model: "fable" }),
    null,
    "fable is a first-class Claude launch model");
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

test("fallback_default explicit mode passes -> null", () => {
  assert.equal(
    validatePresence({
      task_category: "fallback_default",
      provider: "claude",
      model: "sonnet",
      effort: "high",
    }),
    null,
    "fallback_default is allowed only for fully-explicit launches");
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
      `Error: task_category is required and must be one of: ${TASK_CATEGORIES.join(", ")}. Got: <none>.`
    ),
    "absent category renders 'Got: <none>.' and lists all task categories verbatim");
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
// ---------------------------------------------------------------------------
// ERR_FALLBACK_DEFAULT (matrix rows 39-41): fallback_default is a split hint
// sentinel, not a launchable routing-table category. Only explicit mode can
// pass because it does not read the table.
// ---------------------------------------------------------------------------
const FALLBACK_DEFAULT_ERROR =
  "Error: fallback_default is a split hint sentinel, not a launchable routing-table category.\n" +
  SPLIT_HINT + "\n" +
  AUTO_HINT;

test("ERR_FALLBACK_DEFAULT: category only -> exact text + SPLIT_HINT then AUTO_HINT", () => {
  const msg = validatePresence({ task_category: "fallback_default" });
  assert.equal(
    msg,
    FALLBACK_DEFAULT_ERROR,
    "fallback_default auto mode must return split guidance instead of validating as launchable");
});

test("ERR_FALLBACK_DEFAULT: provider override -> exact text", () => {
  const msg = validatePresence({ task_category: "fallback_default", provider: "claude" });
  assert.equal(
    msg,
    FALLBACK_DEFAULT_ERROR,
    "fallback_default provider mode must return ERR_FALLBACK_DEFAULT");
});

test("ERR_FALLBACK_DEFAULT: provider+model override -> exact text", () => {
  const msg = validatePresence({
    task_category: "fallback_default",
    provider: "codex",
    model: "sonnet",
  });
  assert.equal(
    msg,
    FALLBACK_DEFAULT_ERROR,
    "fallback_default provider_model mode must return ERR_FALLBACK_DEFAULT even when provider/model would otherwise mismatch");
});

test("explicit mismatch: claude + gpt-5.5 -> Claude constraint message", () => {
  const msg = validatePresence({
    task_category: "coding",
    provider: "claude",
    model: "gpt-5.5",
    effort: "high",
  });
  assert.equal(
    msg,
    "Error: Claude provider only supports haiku, sonnet, opus, opus-4-8, or fable. Got: gpt-5.5",
    "claude+gpt-5.5 returns the existing Claude-constraint message verbatim");
});

test("explicit mismatch: codex + fable -> Codex constraint message", () => {
  const msg = validatePresence({
    task_category: "coding",
    provider: "codex",
    model: "fable",
    effort: "high",
  });
  assert.equal(
    msg,
    "Error: Codex provider only supports gpt-5.5 or gpt-5.6. Got: fable",
    "codex+fable must be rejected because fable is Claude-only");
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
    "Error: Codex provider only supports gpt-5.5 or gpt-5.6. Got: sonnet",
    "codex+sonnet returns the existing Codex-constraint message verbatim");
});

// ---------------------------------------------------------------------------
// Override-provider guard (root-cause of the model-override regression).
// Only "claude"/"codex" are selectable as explicit/manual overrides. "api" is
// INTERNAL auto-slot routing (slotInsert), never an override. The public zod
// enum already omits "api"; this guards the runtime/internal boundary against a
// stale or enum-bypassed "api" reaching buildCandidates. Bypassing the enum by
// calling validatePresence directly is exactly the "stale/bypassed" scenario.
// WHY: before this guard, provider:"api"+model+effort passed validation, built
// an explicit candidate with NO apiProvider metadata, failed permanent, and
// silently failed over to a CLI provider (the live regression).
// ---------------------------------------------------------------------------
const API_OVERRIDE_ERROR =
  "Error: provider override must be claude or codex. Got: api. " +
  "The api provider is internal auto-slot routing only and cannot be selected explicitly.\n" +
  AUTO_HINT;

test("stale/bypassed provider:api + fable + xhigh is REJECTED before candidate construction", () => {
  // The exact live-failure triple. Must return the guard error (not null), so
  // buildCandidates is never reached and no candidate/launch/failover occurs.
  const msg = validatePresence({
    task_category: "coding",
    provider: "api",
    model: "fable",
    effort: "xhigh",
  });
  assert.equal(
    msg,
    API_OVERRIDE_ERROR,
    "stale api override must be rejected at the validation boundary, before failover");
  assert.ok(!msg.includes(SPLIT_HINT), "api-override rejection carries AUTO_HINT only");
});

test("authorized provider:claude + fable + xhigh passes validation -> null", () => {
  // The authorized override the regression must not disturb: fable => Claude.
  assert.equal(
    validatePresence({
      task_category: "debugging",
      provider: "claude",
      model: "fable",
      effort: "xhigh",
    }),
    null,
    "claude+fable+xhigh is a valid explicit override and must proceed to launch");
});

// ---------------------------------------------------------------------------
// Deadlock validation (rule 2: after category, BEFORE effort-needs-both)
// WHY: deadlock=true triggers the deadlock window; combining it with any
// override is always wrong. The rule must fire before the effort rule so the
// caller receives one clear fix message, not an effort message that hides the
// deadlock constraint.
// ---------------------------------------------------------------------------
const DEADLOCK_ERROR =
  "Error: deadlock cannot be combined with provider, model, or effort. From the 3rd attempt for the same atomic task, deadlock outranks capability overrides: drop provider/model/effort and retry.\n" +
  AUTO_HINT;

test("deadlock+provider → exact deadlock error text", () => {
  const msg = validatePresence({ task_category: "coding", deadlock: true, provider: "claude" });
  assert.equal(
    msg,
    DEADLOCK_ERROR,
    "deadlock+provider must return exact deadlock error; wrong text means auto-hint suffix was dropped or message changed"
  );
});

test("deadlock+provider+model → exact deadlock error text", () => {
  const msg = validatePresence({
    task_category: "coding",
    deadlock: true,
    provider: "claude",
    model: "sonnet",
  });
  assert.equal(
    msg,
    DEADLOCK_ERROR,
    "deadlock+provider+model must return exact deadlock error, not ERR_PROVIDER_MODEL or null"
  );
});

test("deadlock+provider+model+effort → exact deadlock error text", () => {
  const msg = validatePresence({
    task_category: "coding",
    deadlock: true,
    provider: "claude",
    model: "opus-4-8",
    effort: "high",
  });
  assert.equal(
    msg,
    DEADLOCK_ERROR,
    "deadlock+full explicit triple must return exact deadlock error, not pass through to explicit mode"
  );
});

test("deadlock rule fires BEFORE effort-needs-both when both conditions hold", () => {
  // deadlock=true + effort=high (no provider): both deadlock rule (rule 2) and
  // effort-needs-both rule (rule 3) would fire. Rule 2 is checked first.
  // WHY: if effort fires first, the caller must fix two separate issues instead
  // of one, and the deadlock constraint remains hidden.
  const msg = validatePresence({ task_category: "coding", deadlock: true, effort: "high" });
  assert.ok(msg, "deadlock=true + effort must produce an error");
  assert.equal(
    msg,
    DEADLOCK_ERROR,
    "deadlock rule must fire before effort-needs-both; if ERR_EFFORT_NEEDS_BOTH appears, the rule order is wrong"
  );
});

test("deadlock:true alone (no overrides) → valid (null error)", () => {
  // WHY: deadlock:true without any override IS the correct usage — the window
  // arms on successful validation in index.ts. Rejecting it here would make
  // the deadlock window feature completely unusable.
  const msg = validatePresence({ task_category: "coding", deadlock: true });
  assert.equal(
    msg,
    null,
    "deadlock:true with no overrides must pass validation; the window arms on success in index.ts"
  );
});

test("deadlock:false with overrides → existing validation behavior (no deadlock error)", () => {
  // WHY: deadlock:false is explicitly identical to omitting deadlock; it must
  // not trigger rule 2, so provider+model with false must remain valid.
  const msg = validatePresence({
    task_category: "coding",
    deadlock: false,
    provider: "claude",
    model: "sonnet",
  });
  assert.equal(
    msg,
    null,
    "deadlock:false must behave identically to omitting deadlock; existing override combos must still be valid"
  );
});

test("deadlock:false does not suppress other validation errors (normal path preserved)", () => {
  // Verify deadlock:false does not short-circuit subsequent validation rules.
  const msg = validatePresence({ task_category: "coding", deadlock: false, effort: "high" });
  assert.ok(
    msg && msg.startsWith("Error: effort requires both provider and model."),
    "deadlock:false must not suppress ERR_EFFORT_NEEDS_BOTH; other validation rules must still fire"
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
