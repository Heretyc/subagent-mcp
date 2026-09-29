/**
 * Unit tests for src/routing.ts (compiled to dist/routing.js).
 *
 * These tests target the PURE resolver layer — no spawning, no real CLIs.
 * The fixture at test/fixtures/routing-table.fixture.json is hand-authored so
 * tests are profiler-independent and deterministic.
 *
 * Why each case matters is encoded in the assertion comment. Rule 9: tests
 * verify intent, not just behavior.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Import from compiled output — the run order is: build, then test.
import {
  loadRoutingTable,
  buildCandidates,
  mapModelToProvider,
  normalizeEffort,
  validatePresence,
} from "../dist/routing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "routing-table.fixture.json");

// Load the fixture table once; inject into buildCandidates directly.
// loadRoutingTable() itself is tested in isolation (cases 7 + missing).
const fixtureTable = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

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
// 1. auto ordering — all pairings sorted rank asc (best→worst); non-launchable
//    pairings (gpt-5.5-pro, claude-opus-4-7, unknown-model-xyz) are SKIPPED.
//    WHY: the point of auto mode is to serve the best launchable candidate
//    first; un-launchable ids must never reach the spawn path.
// ---------------------------------------------------------------------------
test("auto mode: pairings ordered rank asc; non-launchable pairings skipped", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  assert.equal(result.mode, "auto", "mode must be 'auto' when no overrides given");

  const ids = result.candidates.map((c) => c.model);
  // Launchable models in rank order: opus-4-8(1), gpt-5.5(2), sonnet(3), haiku(4).
  // gpt-5.5-pro(5), claude-opus-4-7(6), unknown-model-xyz(7) must be absent.
  assert.ok(ids.includes("opus-4-8") || ids.includes("claude-opus-4-8"),
    "opus-4-8 must appear (rank 1 launchable)");
  assert.ok(!ids.some(id => id === "gpt-5.5-pro"),
    "gpt-5.5-pro must be skipped — it is not in the launch enum");
  assert.ok(!ids.some(id => id === "claude-opus-4-7"),
    "claude-opus-4-7 must be skipped — it is not in the launch enum");
  assert.ok(!ids.some(id => id === "unknown-model-xyz"),
    "unknown-model-xyz must be skipped — completely unrecognised id");

  // First candidate is rank-1 launchable
  const first = result.candidates[0];
  assert.equal(first.provider, "claude",
    "opus-4-8 maps to claude provider");
  assert.equal(first.model, "opus-4-8",
    "first candidate must be the short launch id opus-4-8");
});

// ---------------------------------------------------------------------------
// 2. provider filter — provider:"codex" yields only codex-mapped pairings in
//    rank order.
//    WHY: the provider override must restrict candidates to the requested
//    provider; mixing providers would defeat the constraint.
// ---------------------------------------------------------------------------
test("provider filter: codex returns only codex-provider pairings in rank order", () => {
  const result = buildCandidates(fixtureTable, "architecture", { provider: "codex" }, "performance");
  assert.equal(result.mode, "provider", "mode must be 'provider'");
  assert.ok(result.candidates.length > 0, "architecture has a gpt-5.5 pairing");
  for (const c of result.candidates) {
    assert.equal(c.provider, "codex",
      "every returned candidate must have provider=codex");
  }
  // architecture fixture has exactly one codex-launchable pairing: gpt-5.5@xhigh
  assert.equal(result.candidates[0].model, "gpt-5.5",
    "first and only codex candidate must be gpt-5.5 (gpt-5.5-pro is skipped)");
});

// ---------------------------------------------------------------------------
// 3. provider_model filter — provider:"claude",model:"sonnet" yields only
//    sonnet pairings.
//    WHY: the provider+model override must identify exactly the model the
//    caller wants; other claude models must not bleed in.
// ---------------------------------------------------------------------------
test("provider_model filter: claude+sonnet-4-6 returns only sonnet-4-6 pairings", () => {
  const result = buildCandidates(fixtureTable, "architecture", {
    provider: "claude",
    model: "sonnet-4-6",
  }, "performance");
  assert.equal(result.mode, "provider_model", "mode must be 'provider_model'");
  assert.ok(result.candidates.length > 0, "architecture has a sonnet-4-6 pairing");
  for (const c of result.candidates) {
    assert.equal(c.model, "sonnet-4-6",
      "every returned candidate must be model=sonnet-4-6");
    assert.equal(c.provider, "claude",
      "every returned candidate must have provider=claude");
  }
});

// ---------------------------------------------------------------------------
// 4. effort normalization
//    WHY: an unsupported (model, effort) pairing must be REJECTED (null=skip),
//    never clamped or silently substituted. The attempt loop then advances to
//    the next ranked pairing; if none remain the handler emits ERR_NO_CANDIDATES.
//    Clamping would launch a different effort than the table ranked (and the
//    payload would misreport it), so it is banned.
//
//    a) gpt-5.5@max -> null (codex gpt-5.5 has no max; gpt-6-astra alone does)
//    b) sonnet@ultracode -> null (ultracode is Opus 4.8 only)
//    c) opus-4-8@ultracode -> stays "ultracode" (the one ultracode-capable model)
//    d) generic opus@ultracode -> null (generic opus is GA Opus 5.5, NOT ultracode)
//    e) gpt-6-astra@max -> stays "max" (astra is the sole Codex model with max)
//    f) haiku@none -> effort is ignored; resolver reports "none" as placeholder
// ---------------------------------------------------------------------------
test("effort normalization: gpt-5.5@max is REJECTED (codex gpt-5.5 has no max; never clamped)", () => {
  const result = normalizeEffort("codex", "gpt-5.5", "max");
  assert.equal(result, null,
    "gpt-5.5@max must be rejected (null=skip), never silently clamped to xhigh");
});

test("effort normalization: sonnet@ultracode is REJECTED (ultracode is Opus 4.8 only)", () => {
  const result = normalizeEffort("claude", "sonnet", "ultracode");
  assert.equal(result, null,
    "sonnet@ultracode must be rejected (null=skip); only opus-4-8 accepts ultracode — no clamp to xhigh");
});

test("effort normalization: fable@ultracode is REJECTED (ultracode is Opus 4.8 only)", () => {
  const result = normalizeEffort("claude", "fable", "ultracode");
  assert.equal(result, null,
    "fable@ultracode must be rejected (null=skip); ultracode stays Opus-4-8-only, never clamped");
});

test("effort normalization: opus-4-8@ultracode stays ultracode", () => {
  const result = normalizeEffort("claude", "opus-4-8", "ultracode");
  assert.equal(result, "ultracode",
    "opus-4-8 is the one model that accepts ultracode; must pass through unchanged");
});

test("effort normalization: generic opus@ultracode is REJECTED (generic opus is GA Opus 5.5, not ultracode-capable)", () => {
  const result = normalizeEffort("claude", "opus", "ultracode");
  assert.equal(result, null,
    "generic opus resolves to Opus 5.5 and must NOT be deemed ultracode-capable; reject, never clamp");
});

test("effort normalization: opus-5-5@ultracode is REJECTED (only opus-4-8 accepts ultracode)", () => {
  const result = normalizeEffort("claude", "opus-5-5", "ultracode");
  assert.equal(result, null,
    "pinned opus-5-5 is not ultracode-capable; only opus-4-8 is");
});

test("effort normalization: gpt-6-astra@max stays max (astra is the sole Codex model with max)", () => {
  const result = normalizeEffort("codex", "gpt-6-astra", "max");
  assert.equal(result, "max",
    "gpt-6-astra keeps its max tier unchanged; it must NOT be clamped or rejected");
});

test("effort normalization: opus-5-5@max stays max (Claude flag models accept max)", () => {
  const result = normalizeEffort("claude", "opus-5-5", "max");
  assert.equal(result, "max",
    "opus-5-5 accepts the max flag tier like the other Claude flag models");
});

test("effort normalization: haiku@none returns 'none' sentinel (effort ignored by buildCommand)", () => {
  // haiku ignores effort; the resolver should return a sentinel that signals
  // the success payload should report 'none' rather than a launch enum value.
  const result = normalizeEffort("claude", "haiku", "none");
  // The contract says haiku effort is 'ignored' — normalizeEffort returns "none"
  // (or a placeholder constant), never null/undefined (which would mean 'skip').
  assert.ok(result !== null, "haiku@none must not produce a skip-candidate null");
  // The spec says report 'none' for haiku effort in the success payload
  assert.equal(result, "none",
    "haiku@none must normalize to 'none' sentinel so the success payload reports it accurately");
});

test("effort normalization: codex@ultracode is REJECTED (codex has no ultracode; never clamped)", () => {
  const result = normalizeEffort("codex", "gpt-5.5", "ultracode");
  assert.equal(result, null,
    "codex has no ultracode tier; the pairing must be rejected (null=skip), never clamped to xhigh");
});

test("effort normalization: unknown effort tier returns null (skip candidate)", () => {
  // An unrecognised effort string must never be guessed; returning null signals
  // the attempt loop to skip that candidate.
  const result = normalizeEffort("claude", "sonnet", "supersonic-tier");
  assert.equal(result, null,
    "unknown effort tier must return null to signal skip; guessing would silently corrupt the launch");
});

// ---------------------------------------------------------------------------
// 5. model→provider map (mapModelToProvider)
//    WHY: the table uses full model ids; the resolver must derive the correct
//    provider for filtering and the correct short model id for buildCommand.
//    Wrong mappings would launch the wrong CLI or send the wrong --model flag.
// ---------------------------------------------------------------------------
test("mapModelToProvider: full claude ids -> 'claude'", () => {
  assert.equal(mapModelToProvider("claude-opus-4-8"), "claude");
  assert.equal(mapModelToProvider("claude-opus-5-5"), "claude");
  assert.equal(mapModelToProvider("claude-sonnet-4-6"), "claude");
  assert.equal(mapModelToProvider("claude-haiku-4-5"), "claude");
  assert.equal(mapModelToProvider("claude-fable-5"), "claude");
  assert.equal(mapModelToProvider("claude-fable-5-1"), "claude");
});

test("mapModelToProvider: claude short-id passthroughs (incl. pinned aliases) -> 'claude'", () => {
  for (const m of ["fable", "fable-5", "fable-5-1", "opus", "opus-4-8", "opus-5-5"]) {
    assert.equal(mapModelToProvider(m), "claude", `${m} must map to claude for the provider filter`);
  }
});

test("mapModelToProvider: gpt-5.5 -> 'codex'", () => {
  assert.equal(mapModelToProvider("gpt-5.5"), "codex");
});

test("mapModelToProvider: gpt-6-astra -> 'codex'", () => {
  assert.equal(mapModelToProvider("gpt-6-astra"), "codex",
    "gpt-6-astra is a Codex-family model and must map to the codex provider");
});

test("mapModelToProvider: gpt-5.6-sol -> 'codex'", () => {
  assert.equal(mapModelToProvider("gpt-5.6-sol"), "codex");
});

test("mapModelToProvider: gpt-5.5-pro -> 'codex' (but non-launchable; not in launch enum)", () => {
  // Even non-launchable codex siblings must map to 'codex' so the filter logic
  // works correctly (they are then skipped at the launch-enum step, not here).
  assert.equal(mapModelToProvider("gpt-5.5-pro"), "codex");
});

test("mapModelToProvider: unknown id returns null (skip signal)", () => {
  assert.equal(mapModelToProvider("unknown-model-xyz"), null,
    "completely unknown ids must return null — never coerce to a real provider");
});

// ---------------------------------------------------------------------------
// 6. empty category
//    WHY: ERR_NO_CANDIDATES must fire when a category exists but has no pairings.
//    Silently falling through to a default would defeat the fail-loud principle.
// ---------------------------------------------------------------------------
test("empty category: buildCandidates signals no-candidates (not an error throw)", () => {
  const result = buildCandidates(fixtureTable, "debugging", {}, "performance");
  // The resolver must return a value (not throw); the handler converts it to ERR_NO_CANDIDATES.
  // The no-candidates signal is either noCandidates:true OR an empty candidates array.
  const hasNoCandidatesFlag = result && result.noCandidates === true;
  const hasEmptyArray = result && Array.isArray(result.candidates) && result.candidates.length === 0;
  assert.ok(hasNoCandidatesFlag || hasEmptyArray,
    "empty category must signal no-candidates (noCandidates:true or empty candidates[]) so handler emits ERR_NO_CANDIDATES");
});

// ---------------------------------------------------------------------------
// 7. missing table
//    WHY: loadRoutingTable must never throw; it returns null so the handler can
//    emit ERR_TABLE_MISSING. A throw would crash the server.
// ---------------------------------------------------------------------------
test("loadRoutingTable: missing file returns null (never throws)", () => {
  const result = loadRoutingTable("/nonexistent/path/that/does/not/exist.json");
  assert.equal(result, null,
    "missing routing-table must return null; throwing would crash the MCP server");
});

test("loadRoutingTable: valid fixture path returns an object with performance branch", () => {
  const result = loadRoutingTable(FIXTURE_PATH);
  assert.ok(result !== null, "valid fixture must parse successfully");
  assert.ok(typeof result === "object", "parsed result must be an object");
  assert.ok("performance" in result,
    "loaded table must have a performance branch for the resolver to consume");
});

// ---------------------------------------------------------------------------
// 8. unknown model skip
//    WHY: unknown-model-xyz in the fixture must be excluded from candidates,
//    not coerced to a known model. Silent coercion would launch the wrong model.
// ---------------------------------------------------------------------------
test("unknown model id in table is skipped, not coerced", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const ids = result.candidates.map((c) => c.model);
  assert.ok(!ids.includes("unknown-model-xyz"),
    "unknown-model-xyz must not appear in candidates; coercing it would silently launch the wrong model");
  // Confirm it's also not coerced to 'gpt-5.5' or any other model
  const rawCount = fixtureTable.performance.architecture.length;
  const launchableCount = result.candidates.length;
  assert.ok(launchableCount < rawCount,
    "launchable count must be less than raw pairing count because non-launchable pairings are filtered");
});

// ---------------------------------------------------------------------------
// 9. explicit mode
//    WHY: explicit mode must NOT consult the table — the caller has specified
//    exactly what they want. Passing null/empty table must still return the
//    triple. This preserves backward compatibility for fully-specified launches.
// ---------------------------------------------------------------------------
test("explicit mode: returns single triple without reading table (null table works)", () => {
  // null table simulates the case where dist/routing-table.json is absent
  const result = buildCandidates(null, "architecture", {
    provider: "claude",
    model: "opus-4-8",
    effort: "high",
  });
  assert.equal(result.mode, "explicit",
    "all three overrides present must produce explicit mode");
  assert.equal(result.candidates.length, 1,
    "explicit mode must return exactly one candidate — no fallback list");
  const c = result.candidates[0];
  assert.equal(c.provider, "claude");
  assert.equal(c.model, "opus-4-8");
  assert.equal(c.effort, "high");
});

test("explicit mode with fable: null table works, single candidate returned", () => {
  const result = buildCandidates(null, "debugging", {
    provider: "claude",
    model: "fable",
    effort: "max",
  });
  assert.equal(result.mode, "explicit");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].provider, "claude");
  assert.equal(result.candidates[0].model, "fable");
  assert.equal(result.candidates[0].effort, "max");
});

test("explicit mode with codex: null table works, single candidate returned", () => {
  const result = buildCandidates(null, "coding", {
    provider: "codex",
    model: "gpt-5.5",
    effort: "xhigh",
  });
  assert.equal(result.mode, "explicit");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].provider, "codex");
  assert.equal(result.candidates[0].model, "gpt-5.5");
});

// ---------------------------------------------------------------------------
// 10. ERR_NO_CANDIDATES: category with ONLY non-launchable pairings
//     WHY: if every pairing in a category is non-launchable, the resolver must
//     signal no-candidates. Attempting to launch gpt-5.5-pro would fail with a
//     confusing "not in launch enum" error rather than a clear ERR_NO_CANDIDATES.
// ---------------------------------------------------------------------------
test("all-non-launchable category: buildCandidates signals no-candidates", () => {
  // 'only_nonlaunchable' contains only gpt-5.5-pro, claude-opus-4-7, unknown-model-xyz
  const result = buildCandidates(fixtureTable, "only_nonlaunchable", {}, "performance");
  const hasNoCandidatesFlag = result && result.noCandidates === true;
  const hasEmptyArray = result && Array.isArray(result.candidates) && result.candidates.length === 0;
  assert.ok(hasNoCandidatesFlag || hasEmptyArray,
    "a category whose only pairings are non-launchable must signal no-candidates (noCandidates:true or empty candidates[])");
});

// ---------------------------------------------------------------------------
// 11. codex sibling skip in auto/provider mode
//     WHY: gpt-5.5-pro is a valid real model id but not in the launch enum.
//     It must be skipped silently, not treated as gpt-5.5.
// ---------------------------------------------------------------------------
test("gpt-5.5-pro sibling is skipped in auto mode (not coerced to gpt-5.5)", () => {
  // architecture fixture has gpt-5.5-pro at rank 5
  const result = buildCandidates(fixtureTable, "architecture", { provider: "codex" }, "performance");
  // Only gpt-5.5 should appear; gpt-5.5-pro must be absent
  for (const c of result.candidates) {
    assert.notEqual(c.model, "gpt-5.5-pro",
      "gpt-5.5-pro must never appear in candidates — it is not in the launch model enum");
  }
});

test("claude-opus-4-7 sibling is skipped in auto mode (not coerced to opus-4-8)", () => {
  const result = buildCandidates(fixtureTable, "architecture", { provider: "claude" }, "performance");
  for (const c of result.candidates) {
    assert.notEqual(c.model, "claude-opus-4-7",
      "claude-opus-4-7 must never appear; coercing it to opus-4-8 would misrepresent the ranked choice");
  }
});

// ---------------------------------------------------------------------------
// 12. candidates_skipped-related: buildCandidates returns all launchable
//     candidates in rank order so the attempt loop can count skipped ones.
//     WHY: the success payload must accurately report candidates_skipped.
//     If candidates are pre-filtered without tracking, the count is wrong.
// ---------------------------------------------------------------------------
test("auto mode: returned candidate list has correct launchable count for architecture", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  // architecture has: opus-4-8(launchable), gpt-5.5(launchable), sonnet(launchable),
  // haiku(launchable), gpt-5.5-pro(skip), claude-opus-4-7(skip), unknown-model-xyz(skip)
  assert.equal(result.candidates.length, 4,
    "must have exactly 4 launchable candidates; accurate count enables correct candidates_skipped in payload");
});

// ---------------------------------------------------------------------------
// 13. haiku pairing in auto mode gets 'none' effort
//     WHY: the success payload must report effort 'none' for haiku so the caller
//     knows buildCommand did not receive an effort argument.
// ---------------------------------------------------------------------------
test("haiku pairing in auto mode produces effort 'none' in candidate triple", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const haikuCandidate = result.candidates.find((c) => c.model === "haiku");
  assert.ok(haikuCandidate,
    "architecture fixture must include a haiku pairing");
  assert.equal(haikuCandidate.effort, "none",
    "haiku candidate effort must be 'none' so the success payload accurately reports it");
});

// ---------------------------------------------------------------------------
// 14. table model id to short launch id mapping
//     WHY: the table uses FULL ids (claude-opus-4-8, claude-sonnet-4-6,
//     claude-haiku-4-5); buildCommand expects SHORT ids (opus-4-8, sonnet,
//     haiku, gpt-5.5). Wrong mapping causes 'model not found' in the CLI.
// ---------------------------------------------------------------------------
test("full model id claude-opus-4-8 maps to short launch id opus-4-8", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const opusCandidate = result.candidates.find(
    (c) => c.model === "opus-4-8"
  );
  assert.ok(opusCandidate,
    "claude-opus-4-8 in table must be mapped to short id opus-4-8 for buildCommand");
});

test("full model id claude-sonnet-4-6 maps to short launch id sonnet-4-6 (legacy pin)", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const sonnetCandidate = result.candidates.find((c) => c.model === "sonnet-4-6");
  assert.ok(sonnetCandidate,
    "claude-sonnet-4-6 in table must map to pinned short id sonnet-4-6 for buildCommand");
});

test("full model id claude-haiku-4-5 maps to short launch id haiku", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const haikuCandidate = result.candidates.find((c) => c.model === "haiku");
  assert.ok(haikuCandidate,
    "claude-haiku-4-5 in table must map to short id haiku for buildCommand");
});

test("fable family: full ids pin — claude-fable-5-1 -> 'fable-5-1'; claude-fable-5 -> 'fable-5' (no silent advance)", () => {
  // A routing-table row pinned to an explicit full id must launch as its PINNED
  // short id: claude-fable-5-1 -> 'fable-5-1' (NOT generic 'fable', which tracks
  // GA and could advance if the alias moves) and claude-fable-5 -> 'fable-5'.
  const result = buildCandidates(fixtureTable, "fable_family", { provider: "claude" }, "performance");
  assert.deepEqual(
    result.candidates.map((c) => `${c.provider}/${c.model}@${c.effort}`),
    ["claude/fable-5-1@high", "claude/fable-5@xhigh"],
    "explicit full ids stay version-pinned: claude-fable-5-1 -> 'fable-5-1', claude-fable-5 -> 'fable-5' — neither follows the generic 'fable' alias forward"
  );
});

// ---------------------------------------------------------------------------
// 14b. full-id pinning roundtrip (the review fix): an explicit full Claude id in
//      a table row must decode to its PINNED short id in auto/provider mode, so a
//      later move of the generic 'opus'/'fable' alias can never silently advance
//      a row that was pinned to a specific version. A user model-filter of the
//      generic alias still reports the generic (tracks current GA).
// ---------------------------------------------------------------------------
test("full-id pinning: claude-opus-5-5 row decodes to pinned 'opus-5-5' (auto/provider, no user filter)", () => {
  const result = buildCandidates(fixtureTable, "opus_family", { provider: "claude" }, "performance");
  const opus55 = result.candidates[0];
  assert.equal(opus55.model, "opus-5-5",
    "claude-opus-5-5 must decode to the pinned 'opus-5-5', never generic 'opus' which could silently advance");
});

test("full-id pinning: claude-fable-5-1 row decodes to pinned 'fable-5-1' (auto/provider, no user filter)", () => {
  const result = buildCandidates(fixtureTable, "fable_family", { provider: "claude" }, "performance");
  const fable51 = result.candidates.find((c) => c.effort === "high");
  assert.ok(fable51, "claude-fable-5-1@high pairing must be present");
  assert.equal(fable51.model, "fable-5-1",
    "claude-fable-5-1 must decode to the pinned 'fable-5-1', never generic 'fable' which could silently advance");
});

test("generic user filter still tracks GA: model:'fable' matches the claude-fable-5-1 row and reports 'fable'", () => {
  // Counterpart to the pinning tests: when the USER explicitly asks for the
  // generic alias, the candidate reports that generic alias (resolves to current
  // GA at launch), NOT the pinned id — so user inputs keep tracking verified GA.
  const result = buildCandidates(fixtureTable, "fable_family", {
    provider: "claude",
    model: "fable",
  }, "performance");
  assert.equal(result.candidates.length, 1,
    "model:'fable' must match ONLY the claude-fable-5-1 row (claude-fable-5 pins to 'fable-5')");
  assert.equal(result.candidates[0].model, "fable",
    "a generic user filter reports the generic alias so it tracks current GA, unlike the pinned full-id decode");
});

// ---------------------------------------------------------------------------
// 15. bug_002 replacement: codex@none must be rejected.
//     WHY: gpt-5.5 supports selectable effort settings. Letting "none" pass
//     through masks bad routing data by launching high while reporting none.
// ---------------------------------------------------------------------------
test("effort normalization: codex@none returns null (skip invalid effort-capable pairing)", () => {
  const result = normalizeEffort("codex", "gpt-5.5", "none");
  assert.equal(result, null,
    "codex@none must be skipped because gpt-5.5 has selectable effort settings");
});

test("auto mode with gpt-5.5@xhigh: candidate retained with concrete selectable effort", () => {
  // math_proof category has gpt-5.5@xhigh as rank-1 entry.
  const result = buildCandidates(fixtureTable, "math_proof", {}, "performance");
  assert.ok(result.candidates.length > 0, "math_proof has gpt-5.5@xhigh pairing");
  const gpt55Candidate = result.candidates[0];
  assert.equal(gpt55Candidate.provider, "codex",
    "gpt-5.5 must map to codex provider");
  assert.equal(gpt55Candidate.model, "gpt-5.5",
    "gpt-5.5 table entry must produce gpt-5.5 launch model");
  assert.equal(gpt55Candidate.effort, "xhigh",
    "gpt-5.5 must retain its concrete selectable effort instead of a no-effort sentinel");
});

test("broken Claude routing row is skipped and next usable Claude model is retained", () => {
  const result = buildCandidates(fixtureTable, "broken_claude", { provider: "claude" }, "performance");
  assert.equal(result.noCandidates, undefined);
  assert.deepEqual(
    result.candidates.map((c) => `${c.provider}/${c.model}@${c.effort}`),
    ["claude/fable-5@high"],
    "claude-sonnet-4-6@none is invalid routing data and must not block fallback; claude-fable-5 maps to the pinned fable-5 (never the generic fable/5.1)"
  );
});

test("broken Codex routing row is skipped and gpt-5.6-sol maps to public gpt-5.6", () => {
  const result = buildCandidates(fixtureTable, "broken_codex", {
    provider: "codex",
    model: "gpt-5.6",
  }, "performance");
  assert.equal(result.noCandidates, undefined);
  assert.deepEqual(
    result.candidates.map((c) => `${c.provider}/${c.model}@${c.effort}`),
    ["codex/gpt-5.6@high"],
    "gpt-5.5@none is invalid and gpt-5.6-sol must resolve to the gpt-5.6 launch alias"
  );
});

// ---------------------------------------------------------------------------
// 16. opus alias taxonomy: generic model:"opus" tracks GA Opus 5.5, the pinned
//     model:"opus-4-8" tracks only claude-opus-4-8.
//     WHY: generic `opus` now resolves to claude-opus-5-5; it must NOT match the
//     pinned claude-opus-4-8 row (that would misroute a launch), and the pinned
//     opus-4-8 filter must NOT bleed into the 5.5 row.
// ---------------------------------------------------------------------------
test("provider_model filter: claude+opus matches claude-opus-5-5 (generic tracks GA Opus 5.5), not opus-4-8", () => {
  // opus_family fixture: claude-opus-5-5@high (rank1), claude-opus-4-8@high (rank2).
  const result = buildCandidates(fixtureTable, "opus_family", {
    provider: "claude",
    model: "opus",
  }, "performance");
  assert.equal(result.mode, "provider_model", "mode must be 'provider_model'");
  assert.equal(result.candidates.length, 1,
    "model:'opus' must match ONLY the claude-opus-5-5 row, never the pinned claude-opus-4-8 row");
  assert.equal(result.candidates[0].model, "opus",
    "generic opus canonical short id is 'opus' (resolves to claude-opus-5-5 at launch)");
  assert.equal(result.candidates[0].provider, "claude");
});

test("provider_model filter: claude+opus-4-8 matches only the pinned claude-opus-4-8 row", () => {
  const result = buildCandidates(fixtureTable, "opus_family", {
    provider: "claude",
    model: "opus-4-8",
  }, "performance");
  assert.equal(result.candidates.length, 1,
    "model:'opus-4-8' must match ONLY the pinned claude-opus-4-8 row, not the generic 5.5 row");
  assert.equal(result.candidates[0].model, "opus-4-8");
});

// ---------------------------------------------------------------------------
// 17. branch routing — default reads cost_efficiency
//     WHY: the default branch changed from performance to cost_efficiency.
//     cost_efficiency.architecture ranks haiku first; performance ranks opus-4-8
//     first. If the default silently stayed performance, this test catches it.
// ---------------------------------------------------------------------------
test("branch default: no branch arg reads cost_efficiency; architecture rank-1 is haiku not opus", () => {
  const result = buildCandidates(fixtureTable, "architecture", {});
  assert.equal(result.mode, "auto");
  assert.ok(result.candidates.length > 0, "cost_efficiency.architecture must have pairings");
  assert.equal(
    result.candidates[0].model,
    "haiku",
    "cost_efficiency.architecture rank-1 is haiku; if opus-4-8 appears the default is still reading performance branch"
  );
});

test("branch explicit 'cost_efficiency' produces identical list to default (no branch arg)", () => {
  // WHY: explicit and implicit cost_efficiency must be identical; divergence
  // would mean the default is reading a different branch than declared.
  const resultDefault = buildCandidates(fixtureTable, "architecture", {});
  const resultExplicit = buildCandidates(fixtureTable, "architecture", {}, "cost_efficiency");
  assert.deepEqual(
    resultExplicit.candidates.map((c) => `${c.model}@${c.effort}`),
    resultDefault.candidates.map((c) => `${c.model}@${c.effort}`),
    "explicit 'cost_efficiency' must produce identical candidate list to the no-branch-arg default"
  );
});

test("branch default: missing cost_efficiency in table → no-candidates (no silent fallback to performance)", () => {
  // WHY: if cost_efficiency branch is absent, the resolver must NOT fall back to
  // performance. Silent fallback would produce candidates from the wrong ranking,
  // defeating the cost_efficiency-default invariant.
  const tableNoEfficiencyBranch = {
    performance: {
      architecture: [
        {
          model: "claude-opus-4-8",
          effort: "high",
          rank: 1,
          score: 0.95,
          cost_figure_used: 0.000015,
          interpolated: false,
          confidence: "measured",
          basis: ["[MEASURED]"],
        },
      ],
    },
  };
  const result = buildCandidates(tableNoEfficiencyBranch, "architecture", {});
  const hasNoCandidatesFlag = result && result.noCandidates === true;
  const hasEmptyArray =
    result && Array.isArray(result.candidates) && result.candidates.length === 0;
  assert.ok(
    hasNoCandidatesFlag || hasEmptyArray,
    "missing cost_efficiency branch must signal no-candidates; if opus-4-8 appears, the resolver fell back to performance silently"
  );
});

// ---------------------------------------------------------------------------
// 18. composite categories
//     WHY: composite-inferred categories are first-class routing keys at
//     runtime. The resolver must read them like normal branch arrays; it should
//     not special-case or fall back to parent categories.
// ---------------------------------------------------------------------------
test("composite category: prompt_engineering reads branch array like a normal category", () => {
  const result = buildCandidates(fixtureTable, "prompt_engineering", {}, "performance");
  assert.equal(result.mode, "auto");
  assert.ok(result.candidates.length > 0,
    "prompt_engineering fixture must produce launchable candidates");
  assert.equal(result.candidates[0].model, "gpt-5.5",
    "prompt_engineering must use its own composite-inferred ranking, not architecture or fallback ordering");
  assert.equal(result.candidates[0].effort, "xhigh",
    "composite category entries must flow through the same effort normalization path");
});

test("strict table shape: object with pairings wrapper signals no-candidates", () => {
  const malformedWrappedTable = {
    performance: {
      architecture: {
        pairings: [
          {
            model: "claude-opus-4-8",
            effort: "high",
            rank: 1,
          },
        ],
      },
    },
    cost_efficiency: {
      architecture: {
        pairings: [
          {
            model: "claude-haiku-4-5",
            effort: "none",
            rank: 1,
          },
        ],
      },
    },
  };

  const result = buildCandidates(malformedWrappedTable, "architecture", {}, "performance");
  assert.equal(result.mode, "auto");
  assert.equal(result.noCandidates, true,
    "category values must be direct arrays; a { pairings: [...] } wrapper must not be silently unwrapped");
  assert.equal(result.candidates.length, 0,
    "malformed wrapped categories must lead to ERR_NO_CANDIDATES at the handler layer");
});

// ---------------------------------------------------------------------------
// 19. new-model auto-mode routing: gpt-6-astra keeps its max tier; an unsupported
//     gpt-5.5@max sibling is rejected (skipped), never clamped to xhigh.
// ---------------------------------------------------------------------------
test("auto mode: gpt-6-astra@max retained at max; gpt-5.5@max rejected (never clamped)", () => {
  const result = buildCandidates(fixtureTable, "astra_family", {}, "performance");
  assert.deepEqual(
    result.candidates.map((c) => `${c.provider}/${c.model}@${c.effort}`),
    ["codex/gpt-6-astra@max"],
    "gpt-6-astra keeps max; gpt-5.5@max is unsupported and dropped, not clamped to xhigh"
  );
});

// ---------------------------------------------------------------------------
// 20. validatePresence: exact allow-lists synced to the launch_agent zod enum,
//     unsupported effort/model combinations rejected EARLY (no clamp, no defer).
//     WHY: a pinned launch must fail loudly at the validation boundary — before
//     any candidate/launch/failover — with a clear message, per the refresh.
// ---------------------------------------------------------------------------
test("validatePresence: claude accepts the pinned aliases opus-5-5 and fable-5-1", () => {
  assert.equal(
    validatePresence({ task_category: "coding", provider: "claude", model: "opus-5-5", effort: "high" }),
    null, "claude+opus-5-5 is a valid explicit override");
  assert.equal(
    validatePresence({ task_category: "coding", provider: "claude", model: "fable-5-1", effort: "high" }),
    null, "claude+fable-5-1 is a valid explicit override");
});

test("validatePresence: codex accepts gpt-6-astra, and gpt-6-astra@max is NOT rejected (astra has max)", () => {
  assert.equal(
    validatePresence({ task_category: "coding", provider: "codex", model: "gpt-6-astra", effort: "high" }),
    null, "codex+gpt-6-astra is a valid explicit override");
  assert.equal(
    validatePresence({ task_category: "coding", provider: "codex", model: "gpt-6-astra", effort: "max" }),
    null, "gpt-6-astra@max must pass early validation — astra is the Codex model that carries max");
});

test("validatePresence: unknown same-family aliases are rejected (exact allow-list, not prefix)", () => {
  const claudeMsg = validatePresence({ task_category: "coding", provider: "claude", model: "opus-9-9", effort: "high" });
  assert.ok(claudeMsg && claudeMsg.startsWith("Error: Claude provider only supports"),
    "an unlisted claude alias (opus-9-9) must be rejected, never accepted by family prefix");
  const codexMsg = validatePresence({ task_category: "coding", provider: "codex", model: "gpt-7-nova", effort: "high" });
  assert.ok(codexMsg && codexMsg.startsWith("Error: Codex provider only supports"),
    "an unlisted codex alias (gpt-7-nova) must be rejected, never accepted by family prefix");
});

test("validatePresence: ultracode is rejected for every model except opus-4-8", () => {
  assert.equal(
    validatePresence({ task_category: "coding", provider: "claude", model: "opus-4-8", effort: "ultracode" }),
    null, "opus-4-8 is the sole ultracode-capable model");
  for (const model of ["opus", "opus-5-5", "sonnet", "fable", "fable-5-1"]) {
    const msg = validatePresence({ task_category: "coding", provider: "claude", model, effort: "ultracode" });
    assert.ok(msg && msg.startsWith("Error: ultracode effort is only available on Opus 4.8"),
      `generic/other claude model ${model}@ultracode must be rejected early — generic opus is GA Opus 5.5, not ultracode-capable`);
  }
});

test("validatePresence: codex gpt-5.5/gpt-5.6 @max are rejected early (no max tier)", () => {
  for (const model of ["gpt-5.5", "gpt-5.6"]) {
    const msg = validatePresence({ task_category: "coding", provider: "codex", model, effort: "max" });
    assert.ok(msg && msg.startsWith("Error: max effort is not valid for"),
      `${model}@max must be rejected early; only gpt-6-astra carries max within Codex`);
  }
});

// ---------------------------------------------------------------------------
// Print summary and fail if any test failed
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
