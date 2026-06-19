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
test("provider_model filter: claude+sonnet returns only sonnet pairings", () => {
  const result = buildCandidates(fixtureTable, "architecture", {
    provider: "claude",
    model: "sonnet",
  }, "performance");
  assert.equal(result.mode, "provider_model", "mode must be 'provider_model'");
  assert.ok(result.candidates.length > 0, "architecture has a sonnet pairing");
  for (const c of result.candidates) {
    assert.equal(c.model, "sonnet",
      "every returned candidate must be model=sonnet");
    assert.equal(c.provider, "claude",
      "every returned candidate must have provider=claude");
  }
});

// ---------------------------------------------------------------------------
// 4. effort normalization
//    WHY: un-normalized efforts would cause buildCommand/resolveEffort to throw,
//    which must never reach the spawn path for auto/partial modes.
//
//    a) gpt-5.5@max in "coding" fixture -> must normalize to "xhigh"
//       (codex has no max; passing max to resolveEffort throws)
//    b) sonnet@ultracode in "coding" fixture -> must normalize to "xhigh"
//       (ultracode is opus-only; passing ultracode to resolveEffort for sonnet throws)
//    c) opus-4-8@ultracode -> stays "ultracode" (valid on opus); tested directly
//       via normalizeEffort (the fixture has no opus-4-8@ultracode pairing).
//    d) haiku@none -> effort is ignored; resolver reports "none" as placeholder
// ---------------------------------------------------------------------------
test("effort normalization: gpt-5.5@max clamps to xhigh (codex has no max)", () => {
  // Codex max is invalid — normalizing prevents a resolveEffort throw at spawn time
  const result = normalizeEffort("codex", "gpt-5.5", "max");
  assert.equal(result, "xhigh",
    "gpt-5.5@max must be clamped to xhigh so buildCommand does not throw");
});

test("effort normalization: sonnet@ultracode clamps to xhigh (ultracode is opus-only)", () => {
  const result = normalizeEffort("claude", "sonnet", "ultracode");
  assert.equal(result, "xhigh",
    "sonnet@ultracode must clamp to xhigh; only opus-4-8 accepts ultracode");
});

test("effort normalization: opus-4-8@ultracode stays ultracode", () => {
  const result = normalizeEffort("claude", "opus-4-8", "ultracode");
  assert.equal(result, "ultracode",
    "opus-4-8 is the one model that accepts ultracode; must pass through unchanged");
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

test("effort normalization: codex@ultracode clamps to xhigh", () => {
  const result = normalizeEffort("codex", "gpt-5.5", "ultracode");
  assert.equal(result, "xhigh",
    "codex has no ultracode; must clamp to xhigh");
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
  assert.equal(mapModelToProvider("claude-sonnet-4-6"), "claude");
  assert.equal(mapModelToProvider("claude-haiku-4-5"), "claude");
});

test("mapModelToProvider: gpt-5.5 -> 'codex'", () => {
  assert.equal(mapModelToProvider("gpt-5.5"), "codex");
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

test("full model id claude-sonnet-4-6 maps to short launch id sonnet", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const sonnetCandidate = result.candidates.find((c) => c.model === "sonnet");
  assert.ok(sonnetCandidate,
    "claude-sonnet-4-6 in table must map to short id sonnet for buildCommand");
});

test("full model id claude-haiku-4-5 maps to short launch id haiku", () => {
  const result = buildCandidates(fixtureTable, "architecture", {}, "performance");
  const haikuCandidate = result.candidates.find((c) => c.model === "haiku");
  assert.ok(haikuCandidate,
    "claude-haiku-4-5 in table must map to short id haiku for buildCommand");
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

// ---------------------------------------------------------------------------
// 16. bug_005: model:"opus" must match claude-opus-4-8 pairings
//     WHY: "opus" is a documented alias for claude-opus-4-8. Filtering by
//     provider:"claude",model:"opus" must return the Opus candidates, not
//     noCandidates. Explicit mode already handles this via mapModel.
// ---------------------------------------------------------------------------
test("provider_model filter: claude+opus returns opus-4-8 pairings (opus alias)", () => {
  // architecture fixture has claude-opus-4-8@high as rank-1 entry.
  // Filtering by model:"opus" must match the "claude-opus-4-8" table entry.
  const result = buildCandidates(fixtureTable, "architecture", {
    provider: "claude",
    model: "opus",
  }, "performance");
  assert.ok(result.candidates.length > 0,
    "provider_model filter with model:'opus' must return candidates (opus is a valid alias)");
  assert.equal(result.mode, "provider_model", "mode must be 'provider_model'");
  for (const c of result.candidates) {
    // The returned model should be the canonical short id (opus-4-8), not the user's input.
    assert.ok(["opus", "opus-4-8"].includes(c.model),
      "returned model must be opus or opus-4-8 (canonical alias)");
    assert.equal(c.provider, "claude",
      "every returned candidate must have provider=claude");
  }
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
// Print summary and fail if any test failed
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
