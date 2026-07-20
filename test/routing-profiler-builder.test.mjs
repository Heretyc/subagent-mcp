import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/build_routing_table.mjs", import.meta.url), "utf8");

assert.doesNotMatch(source, /\bPERF_RANK_PINS\b|\bperfPinned\b|performance_rank_pin/);
assert.match(source, /const ALLOW_GAP_STUBBED\s*=/);
assert.match(source, /gap_stub_override:\s*GAP_STUB_OVERRIDE/);
assert.match(source, /function gapEntryWithCoverage\(category, gap\)/);
assert.match(source, /function supportsFleetProvider\(model\)/);
assert.match(source, /SKIPPING UNSUPPORTED DATASET MODELS/);
assert.match(source, /skipped_models:\s*SKIPPED_MODELS/);
assert.match(source, /NEWA-PROFILER-RERUN/);
assert.match(source, /filter\(\(e\) => isLaunchableModel\(e\.model\)\)/);
assert.match(source, /rank:\s*i \+ 1/);
assert.match(source, /COMPOSITE_PARENT_CATEGORIES/);
assert.match(source, /_meanParentRank/);
assert.match(source, /function rowIsProxyEvidence\(row\)/);
assert.match(source, /assumed\/inferred rows cannot outrank measured data/);

const signalFn = source.match(/function categoryHasMeasuredSignal\(category\) \{[\s\S]*?\n\}/)?.[0] || "";
assert.match(signalFn, /categoryMeasuredStats\(category\)\.measured_pairings > 0/);
assert.doesNotMatch(signalFn, /\bUNIVERSE\b/);

const statsFn = source.match(/function categoryMeasuredStats\(category\) \{[\s\S]*?\n\}/)?.[0] || "";
assert.match(statsFn, /const catUniverse = categoryUniverse\(category\)/);
assert.match(statsFn, /for \(const p of catUniverse\)/);
assert.doesNotMatch(statsFn, /for \(const p of UNIVERSE\)/);

console.log("routing-profiler-builder: PASS");
