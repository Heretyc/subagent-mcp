import assert from "node:assert/strict";
import {
  LAUNCHABLE_TABLE_MODELS,
  NON_LAUNCHABLE_TABLE_MODELS,
  isLaunchableModel,
  isLaunchablePairingKey,
} from "../scripts/lib/launchable-models.mjs";
// Production exports only — no test-only framework or production API is added
// just for this test. dist/* is the compiled source (build runs before tests).
import {
  buildCandidates,
  CLAUDE_LAUNCH_MODELS,
  CODEX_LAUNCH_MODELS,
  DEFAULT_BRANCH,
  HAIKU_EFFORT,
} from "../dist/routing.js";
import { mapModel, CLAUDE_NO_EFFORT_MODELS } from "../dist/effort.js";

// ---------------------------------------------------------------------------
// ISS-325 — independent PIPELINE regression (replaces the earlier audit-file
// test, which was circular: it read src/routing-table-audit.json and asserted
// the allowlist against the same projected universe). Here we instead derive
// the canonical model ids straight from the PUBLIC launch rosters through the
// production mapModel, build in-memory single-row tables, and assert the whole
// runtime path independently of any tracked artifact.
//
// The two failure modes are caught INDEPENDENTLY:
//   * a missing LAUNCHABLE_TABLE_MODELS (helper) entry  -> isLaunchableModel()
//     assertion fails even though buildCandidates might still map the row; and
//   * a missing FULL_TO_SHORT (runtime) mapping         -> buildCandidates drops
//     the row (noCandidates) even though the helper allowlist might still list
//     it.
// Neither assertion depends on the other, so a regression in either the helper
// set OR the routing map is caught on its own.
// ---------------------------------------------------------------------------

const CATEGORY = "coding";
const BRANCH = DEFAULT_BRANCH; // cost_efficiency — exercises the no-effort case.

// Explicit-override-ONLY selectors: publicly selectable but unsupported/
// unreachable for account launches, so they are NOT launchable canonical table
// ids (absent from FULL_TO_SHORT). ISS-325: claude-sonnet-5 must stay dropped.
const EXPLICIT_OVERRIDE_ONLY = new Set(["sonnet-5"]);

// Roster short id -> launch provider. fable-5 is routable/mappable but not in
// the public CLAUDE_LAUNCH_MODELS enum, so add it explicitly.
const CLAUDE_SHORTS = [...CLAUDE_LAUNCH_MODELS, "fable-5"];
const CODEX_SHORTS = [...CODEX_LAUNCH_MODELS];

// Derive canonical ids by pushing every launchable short alias through the
// production mapModel, then DEDUPLICATE aliases (generic `opus`/`sonnet`/`fable`
// and the pinned GA snapshot collapse to one canonical id; codex `gpt-5.6`
// collapses to gpt-5.6-sol). A no-effort model is flagged from its short alias
// (only haiku / sonnet-4-5 qualify, each reached by a single short).
const canonical = new Map(); // canonicalId -> { provider, noEffort }
for (const [provider, shorts] of [["claude", CLAUDE_SHORTS], ["codex", CODEX_SHORTS]]) {
  for (const short of shorts) {
    if (EXPLICIT_OVERRIDE_ONLY.has(short)) continue;
    const id = mapModel(provider, short);
    const noEffort = provider === "claude" && CLAUDE_NO_EFFORT_MODELS.has(short);
    const prev = canonical.get(id);
    // A canonical id is no-effort only if EVERY alias reaching it is no-effort.
    canonical.set(id, { provider, noEffort: prev ? prev.noEffort && noEffort : noEffort });
  }
}

assert.ok(canonical.size > 0, "launch rosters must derive at least one canonical id");

for (const [id, { provider, noEffort }] of canonical) {
  // (1) HELPER eligibility — independent of the runtime map. A dropped
  //     LAUNCHABLE_TABLE_MODELS entry silently drops this model's benchmark
  //     rows at build_routing_table's lean isLaunchableModel projection.
  assert.ok(
    isLaunchableModel(id),
    `${id}: must be an eligible launchable table id (missing LAUNCHABLE_TABLE_MODELS entry drops its rows at the lean projection)`,
  );
  // Respect no-effort Sonnet 4.5 / Haiku: their rows carry a null/none effort;
  // effort-capable models use a universally-valid performance floor (high is in
  // every Claude ladder and valid for every Codex model).
  const effort = noEffort ? null : "high";
  assert.ok(
    isLaunchablePairingKey(`${id}@${effort ?? "none"}`),
    `${id}: model@effort universe key must survive the lean projection`,
  );

  // (2) RUNTIME survival — independent of the helper set. A missing FULL_TO_SHORT
  //     mapping makes buildCandidates skip the row (noCandidates) regardless of
  //     the allowlist. Single-row in-memory table under the cost_efficiency
  //     branch (the proper no-effort case for haiku / sonnet-4-5).
  const table = { [BRANCH]: { [CATEGORY]: [{ model: id, effort, rank: 1 }] } };
  const result = buildCandidates(table, CATEGORY, {}, BRANCH);
  assert.ok(
    !result.noCandidates && Array.isArray(result.candidates) && result.candidates.length === 1,
    `${id}: single launchable row must survive buildCandidates (missing FULL_TO_SHORT mapping would drop it)`,
  );
  const cand = result.candidates[0];
  assert.equal(cand.provider, provider, `${id}: candidate provider must be ${provider}`);

  // (3) FINAL canonical identity — the surviving short id must round-trip back
  //     through mapModel to the SAME canonical id, so a pinned row can never
  //     silently follow a generic alias forward to a different GA model.
  assert.equal(
    mapModel(cand.provider, cand.model),
    id,
    `${id}: surviving candidate short id (${cand.model}) must map back to the same canonical id`,
  );

  // No-effort models report the HAIKU_EFFORT sentinel; effort-capable models
  // keep the requested floor (no silent downgrade/upgrade).
  assert.equal(
    cand.effort,
    noEffort ? HAIKU_EFFORT : "high",
    `${id}: ${noEffort ? "no-effort model must report the HAIKU_EFFORT sentinel" : "effort-capable model must keep the requested floor"}`,
  );
}

// Explicit ISS-325 assertions for the account-verified GA ids that were being
// dropped, so the regression is legible even if the roster derivation changes.
for (const id of [
  "claude-opus-4-7",
  "claude-opus-5",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20250929",
]) {
  assert.ok(isLaunchableModel(id), `${id}: ISS-325 GA id must now be a launchable table id`);
  assert.ok(canonical.has(id), `${id}: must be reachable from the public launch rosters via mapModel`);
  assert.ok(
    !NON_LAUNCHABLE_TABLE_MODELS.has(id),
    `${id}: is account-launchable and must not be listed as non-launchable`,
  );
}

// The unsupported/unreachable sonnet-5 must stay dropped by BOTH gates: not a
// launchable table id, and dropped by buildCandidates (single-row -> none).
{
  const sonnet5 = mapModel("claude", "sonnet-5"); // claude-sonnet-5
  assert.ok(!isLaunchableModel(sonnet5), `${sonnet5}: unreachable model must not be a launchable table id`);
  const table = { [BRANCH]: { [CATEGORY]: [{ model: sonnet5, effort: "high", rank: 1 }] } };
  const result = buildCandidates(table, CATEGORY, {}, BRANCH);
  const dropped = result.noCandidates === true || result.candidates.length === 0;
  assert.ok(dropped, `${sonnet5}: must be dropped by buildCandidates (absent from FULL_TO_SHORT)`);
}

// Structural invariants (non-circular): the two sets are disjoint, the allowlist
// holds only canonical FULL ids (never a bare short alias), the generic
// compatibility alias gpt-5.6 stays out, and the residual non-launchable ids
// stay non-launchable.
for (const model of LAUNCHABLE_TABLE_MODELS) {
  assert.ok(!NON_LAUNCHABLE_TABLE_MODELS.has(model), `${model} cannot be both launchable and non-launchable`);
  assert.match(model, /^(claude-|gpt-)/, `${model} must be a canonical FULL table id, not a short alias`);
}
assert.ok(!LAUNCHABLE_TABLE_MODELS.has("gpt-5.6"), "generic gpt-5.6 compatibility alias is not a canonical table id");
for (const model of ["gpt-5.5-pro", "gpt-5.4-mini"]) {
  assert.ok(
    NON_LAUNCHABLE_TABLE_MODELS.has(model) && !isLaunchableModel(model),
    `${model} must stay a non-launchable id`,
  );
}

console.log("launchable-models: PASS");
