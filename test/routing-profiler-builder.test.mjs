import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
// F3: categoryMeasuredStats is computed exactly ONCE (was called twice for measured + inferred).
assert.match(signalFn, /const s = categoryMeasuredStats\(category\);/);
assert.doesNotMatch(signalFn, /categoryMeasuredStats\(category\)[\s\S]*categoryMeasuredStats\(category\)/);
// Direct coverage is always signal; inferred coverage is signal ONLY under the explicit opt-in
// (no silent weakening of the DATA_MISSING gate / no auto gap-stub).
assert.match(signalFn, /s\.measured_pairings > 0 \|\| \(PROXY_SYNTHESIS_ENABLED && s\.inferred_pairings > 0\)/);
assert.doesNotMatch(signalFn, /\bUNIVERSE\b/);

const statsFn = source.match(/function categoryMeasuredStats\(category\) \{[\s\S]*?\n\}/)?.[0] || "";
assert.match(statsFn, /const catUniverse = categoryUniverse\(category\)/);
assert.match(statsFn, /for \(const p of catUniverse\)/);
assert.doesNotMatch(statsFn, /for \(const p of UNIVERSE\)/);

// ---- issue #325: XCAT-PROXY-1 generalized cross-category proxy synthesis (source shape) -----
// Source-invariant checks pin the block's shape (the builder writes artifacts on import); the
// executable behavioral section (F2) below exercises the exact algorithm without importing it.
const proxyBlock = source.match(/XCAT-PROXY-1: generalized cross-category proxy synthesis[\s\S]*?^};/m)?.[0] || "";
assert.notEqual(proxyBlock, "", "XCAT-PROXY-1 proxy block must be present");

// The declarative gap maps (proxy-coverage-plan + final reconciliation). No composite parent; no
// fallback_default. issue #325 final: coding fills from debugging+agentic_execution; debugging is
// itself a target filled from agentic_execution.
assert.match(source, /const PROXY_PARENTS = Object\.freeze\(\{/);
const mapBody = source.match(/const PROXY_PARENTS = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] || "";
for (const t of ["security_review", "quality_review", "architecture", "data_analysis", "coding", "knowledge_synthesis", "mechanical", "debugging"]) {
  assert.match(mapBody, new RegExp(`\\b${t}:`), `PROXY_PARENTS must declare target ${t}`);
}
assert.match(mapBody, /mechanical: \["agentic_execution"\]/); // 18:02 plan revision (TB4 keyed once)
// Final reconciliation minimal-missing map targets:
assert.match(mapBody, /coding: \["debugging", "agentic_execution"\]/); // coding <- debugging + agentic_execution
assert.match(mapBody, /debugging: \["agentic_execution"\]/); // debugging <- agentic_execution (original direct)
assert.doesNotMatch(mapBody, /fallback_default|prompt_engineering|vulnerability_research|molecular_biology|ml_accelerator_design/);

// Explicit dataset opt-in (no unconditional new policy): no synthesis and no gate change without it.
assert.match(source, /const PROXY_SYNTHESIS_ENABLED = PROXY_SYNTHESIS\?\.enabled === true;/);
assert.match(proxyBlock, /if \(PROXY_SYNTHESIS_ENABLED\)/);

// Immutable frozen snapshot + admissibility filter; parents read ONLY from directCap0 (no
// proxy-to-proxy recursion), never from the live (being-filled) perfScores.
assert.match(proxyBlock, /const directCap0 = new Map\(\);/);
assert.match(proxyBlock, /d\.score !== null && Number\.isFinite\(d\.score\) && d\.thinBasis !== true/);
assert.match(proxyBlock, /directCap0\.get\(parent\)\?\.get\(p\.id\)/);
assert.doesNotMatch(proxyBlock, /perfScores\.get\(parent\)/);

// Direct precedence, finite availability (no truthiness), all-missing null, no re-processing,
// cost outside the proxy, inferred_low.
assert.match(proxyBlock, /if \(cur && cur\.score !== null\) \{ directMeasured\+\+; continue; \}/);
assert.match(proxyBlock, /pd && pd\.score !== null && Number\.isFinite\(pd\.score\)/);
assert.doesNotMatch(proxyBlock, /filter\(Boolean\)|if \(pd\.score\)/);
assert.match(proxyBlock, /available\.reduce\(\(sum, a\) => sum \+ a\.score, 0\) \/ available\.length/);
assert.match(proxyBlock, /if \(available\.length === 0\) \{ unresolved\+\+; continue; \}/);
assert.doesNotMatch(proxyBlock, /applyEffortInterpolation\(|applyVersionPromotion\(|enforceEffortMonotonicity\(/);
assert.doesNotMatch(proxyBlock, /powerScore\(|COST_NORM|COST\.get\(/);
assert.match(proxyBlock, /confidence: "inferred_low"/);
assert.match(proxyBlock, /uncalibrated: true/);

// Coverage separation (honest): inferred counted apart, inferred-parent propagates to composites.
assert.match(source, /inferred_pairings > 0/);
assert.match(source, /CATEGORY_COMPLETENESS\[composite\] = "inferred_parent"/);
// Distinct provenance surfaced in the audit metadata, keyed per target.
assert.match(source, /cross_category_inference: CROSS_CATEGORY_INFERENCE/);
assert.match(source, /by_target: PROXY_INFERENCE_BY_TARGET/);

// ---- issue #325 F2: EXECUTABLE behavioral coverage (reuses qr-independent-scratch harness) ---
// Mirrors the builder's EXACT generalized fill + admissibility algorithm and drives it with
// synthetic perfScores (no builder import -> no artifact writes). Asserts real numeric behavior.
const PROXY_PARENTS_T = {
  security_review: ["debugging", "math_proof", "agentic_execution"],
  quality_review: ["debugging", "knowledge_synthesis", "math_proof", "security_review"],
  architecture: ["math_proof", "agentic_execution"],
  data_analysis: ["math_proof"],
  coding: ["debugging", "agentic_execution"],
  knowledge_synthesis: ["math_proof", "data_analysis"],
  mechanical: ["agentic_execution"],
  debugging: ["agentic_execution"],
};
const parentStatusT = (pd) => pd.versionPromoted ? "version_promoted" : (pd.interpolated ? "effort_interpolated" : "measured");
function runProxyT(perfScores, universe) {
  // 1. freeze admissibility-filtered directCap0 BEFORE any fill (thin / null excluded).
  const parentCats = new Set(Object.values(PROXY_PARENTS_T).flat());
  const directCap0 = new Map();
  for (const cat of parentCats) {
    const src = perfScores.get(cat);
    const snap = new Map();
    if (src) for (const [id, d] of src) {
      const eligible = d && d.score !== null && Number.isFinite(d.score) && d.thinBasis !== true;
      snap.set(id, { score: eligible ? d.score : null, status: d ? parentStatusT(d) : "measured" });
    }
    directCap0.set(cat, snap);
  }
  // 2. single fill-null loop reading only the frozen snapshot.
  const byTarget = {};
  for (const [target, parents] of Object.entries(PROXY_PARENTS_T)) {
    const scores = perfScores.get(target);
    let directMeasured = 0, inferred = 0, unresolved = 0;
    if (scores) for (const p of universe) {
      const cur = scores.get(p.id);
      if (cur && cur.score !== null) { directMeasured++; continue; }
      const available = [], missing = [];
      for (const parent of parents) {
        const pd = directCap0.get(parent)?.get(p.id);
        if (pd && pd.score !== null && Number.isFinite(pd.score)) available.push({ category: parent, score: pd.score, status: pd.status });
        else missing.push(parent);
      }
      if (available.length === 0) { unresolved++; continue; }
      const mean = available.reduce((s, a) => s + a.score, 0) / available.length;
      scores.set(p.id, {
        score: mean, confidence: "inferred_low",
        crossCategoryInference: {
          coverage_weight: Math.round((available.length / parents.length) * 10000) / 10000,
          source_categories: available.map((a) => a.category), missing_categories: missing, parents: available,
        },
      });
      inferred++;
    }
    byTarget[target] = { directMeasured, inferred, unresolved };
  }
  return byTarget;
}
const cat0 = (entries) => new Map(Object.entries(entries));
const mk = (score, extra = {}) => ({ score, ...extra });

// B1: direct finite-0 wins (never proxied); null cell filled; a finite-0 PARENT counts (not missing).
{
  const perf = new Map();
  perf.set("data_analysis", cat0({ "m@high": mk(0), "m@max": mk(null) }));
  perf.set("math_proof", cat0({ "m@high": mk(0.9), "m@max": mk(0) }));
  const bt = runProxyT(perf, [{ id: "m@high", model: "m", effort: "high" }, { id: "m@max", model: "m", effort: "max" }]);
  assert.equal(perf.get("data_analysis").get("m@high").score, 0, "direct finite-0 preserved");
  assert.ok(!perf.get("data_analysis").get("m@high").crossCategoryInference, "direct-0 not proxied");
  assert.equal(perf.get("data_analysis").get("m@max").score, 0, "null filled from finite-0 parent (0 is valid)");
  assert.notEqual(perf.get("data_analysis").get("m@max").interpolated, true, "proxy fill is inferred, not effort-interpolated");
  assert.equal(bt.data_analysis.directMeasured, 1);
  assert.equal(bt.data_analysis.inferred, 1);
}
// B2: all parents missing -> stays null sentinel, never a fabricated 0.
{
  const perf = new Map();
  perf.set("coding", cat0({ "m@high": mk(null) }));
  perf.set("debugging", cat0({ "m@high": mk(null) }));
  const bt = runProxyT(perf, [{ id: "m@high", model: "m", effort: "high" }]);
  assert.equal(perf.get("coding").get("m@high").score, null, "all-missing stays null");
  assert.equal(bt.coding.unresolved, 1);
  assert.equal(bt.coding.inferred, 0);
}
// B3: same model@effort join only (no cross-effort borrow).
{
  const perf = new Map();
  perf.set("coding", cat0({ "m@max": mk(null) }));
  perf.set("debugging", cat0({ "m@high": mk(0.9) }));
  const bt = runProxyT(perf, [{ id: "m@max", model: "m", effort: "max" }]);
  assert.equal(perf.get("coding").get("m@max").score, null, "no cross-effort borrow");
  assert.equal(bt.coding.unresolved, 1);
}
// B4: NO proxy-to-proxy recursion. quality_review lists security_review + knowledge_synthesis as
// parents; both are themselves targets. They must be read as their FROZEN (null) direct value, so
// quality_review never consumes their fills — it uses debugging + math_proof only.
{
  const perf = new Map();
  perf.set("security_review", cat0({ "m@high": mk(null) }));
  perf.set("knowledge_synthesis", cat0({ "m@high": mk(null) }));
  perf.set("quality_review", cat0({ "m@high": mk(null) }));
  perf.set("debugging", cat0({ "m@high": mk(0.4) }));
  perf.set("math_proof", cat0({ "m@high": mk(0.8) }));
  perf.set("agentic_execution", cat0({ "m@high": mk(0.6) }));
  perf.set("data_analysis", cat0({ "m@high": mk(null) }));
  runProxyT(perf, [{ id: "m@high", model: "m", effort: "high" }]);
  assert.equal(perf.get("security_review").get("m@high").score, (0.4 + 0.8 + 0.6) / 3, "security_review filled");
  const qr = perf.get("quality_review").get("m@high");
  assert.equal(qr.score, (0.4 + 0.8) / 2, "QR uses frozen directs only; no proxy-to-proxy recursion");
  assert.deepEqual(qr.crossCategoryInference.source_categories.slice().sort(), ["debugging", "math_proof"]);
  assert.deepEqual(qr.crossCategoryInference.missing_categories.slice().sort(), ["knowledge_synthesis", "security_review"]);
}
// B5: admissibility filter — a thinBasis (neutralized single-observation / non-ranking) parent is
// excluded from directCap0 and contributes no numeric value.
{
  const perf = new Map();
  perf.set("data_analysis", cat0({ "m@high": mk(null) }));
  perf.set("math_proof", cat0({ "m@high": mk(0.5, { thinBasis: true }) }));
  const bt = runProxyT(perf, [{ id: "m@high", model: "m", effort: "high" }]);
  assert.equal(perf.get("data_analysis").get("m@high").score, null, "thin parent excluded -> unresolved");
  assert.equal(bt.data_analysis.unresolved, 1);
}
// B6: NEW minimal-missing targets (final reconciliation) + no proxy-to-proxy. debugging is itself a
// target filled from agentic_execution. coding lists debugging + agentic_execution, but debugging's
// ORIGINAL direct is null (frozen), so coding's available mean is agentic_execution ALONE — coding
// NEVER consumes debugging's proxy fill (parents read the frozen snapshot, not the live fill).
{
  const perf = new Map();
  perf.set("agentic_execution", cat0({ "m@high": mk(0.6) }));
  perf.set("debugging", cat0({ "m@high": mk(null) })); // no admissible direct signal for this pairing
  perf.set("coding", cat0({ "m@high": mk(null) }));
  perf.set("math_proof", cat0({ "m@high": mk(null) }));
  const bt = runProxyT(perf, [{ id: "m@high", model: "m", effort: "high" }]);
  // debugging filled from ORIGINAL direct agentic_execution.
  assert.equal(perf.get("debugging").get("m@high").score, 0.6, "debugging filled from agentic_execution");
  assert.equal(bt.debugging.inferred, 1);
  // coding uses the FROZEN debugging null + agentic_execution -> agentic_execution only (no recursion).
  const coding = perf.get("coding").get("m@high");
  assert.equal(coding.score, 0.6, "coding mean = agentic_execution only (debugging frozen null, not its fill)");
  assert.deepEqual(coding.crossCategoryInference.source_categories, ["agentic_execution"], "coding source = agentic only");
  assert.deepEqual(coding.crossCategoryInference.missing_categories, ["debugging"], "coding missing = debugging (frozen null)");
  assert.equal(coding.crossCategoryInference.coverage_weight, 0.5, "coding coverage_weight = 1 of 2 parents");
}

// ---- issue #325 F2: opt-in DISABLES cross-model SOP-1 version-promotion before composition ----
// The perfScores build gates applyVersionPromotion behind the opt-in switch: legacy (opt-in off)
// still promotes; opt-in on never promotes, so no cross-model predecessor value enters the snapshot
// (blocks a direct win AND a proxy anchor, and prevents a thin predecessor bypassing the filter).
assert.match(source, /if \(!PROXY_SYNTHESIS_ENABLED\) \{\s*scores = applyVersionPromotion\(category, scores\);/);
// The opt-in flag is hoisted ABOVE the perfScores build loop so the same switch decides promotion.
const flagIdxT = source.indexOf("const PROXY_SYNTHESIS_ENABLED = PROXY_SYNTHESIS?.enabled === true;");
const promoGateIdxT = source.indexOf("if (!PROXY_SYNTHESIS_ENABLED) {");
const perfLoopIdxT = source.indexOf("const perfScores = new Map();");
assert.ok(flagIdxT !== -1 && flagIdxT < perfLoopIdxT, "PROXY_SYNTHESIS_ENABLED hoisted before perfScores build");
assert.ok(promoGateIdxT !== -1 && flagIdxT < promoGateIdxT, "promotion gate references the hoisted flag");
// Only ONE flag definition survives (no duplicate const after the hoist).
assert.equal(source.split("const PROXY_SYNTHESIS_ENABLED = PROXY_SYNTHESIS?.enabled === true;").length - 1, 1);
// Actual policy is recorded in the audit metadata.
assert.match(source, /version_promotion_policy: PROXY_SYNTHESIS_ENABLED/);
assert.match(source, /disabled_under_opt_in/);

// Behavioral mirror of the gated per-category build: SOP-1 promotion runs ONLY when opt-in is off.
function buildCatT(rawScores, enabled) {
  const scores = new Map(rawScores);
  // mirror applyVersionPromotion for a 2-member lineage (vOld listed, vNew wholly absent):
  if (!enabled) {
    const vOld = scores.get("old@high");
    if (vOld && vOld.score !== null && scores.get("new@high") && scores.get("new@high").score === null) {
      scores.set("new@high", { score: vOld.score, versionPromoted: true, interpolated: true });
    }
  }
  return scores;
}
{
  // legacy (opt-in off): the newer version is promoted from the older MODEL ID (cross-model copy).
  const legacy = buildCatT(cat0({ "old@high": mk(0.7), "new@high": mk(null) }), false);
  assert.equal(legacy.get("new@high").score, 0.7, "legacy: cross-model version-promotion still applies");
  assert.equal(legacy.get("new@high").versionPromoted, true, "legacy: promoted status preserved");
  // opt-in on: promotion is skipped -> the cell stays a null sentinel...
  const optin = buildCatT(cat0({ "old@high": mk(0.7), "new@high": mk(null) }), true);
  assert.equal(optin.get("new@high").score, null, "opt-in: no cross-model version-promotion");
  // ...so it can neither win a direct cell NOR be admitted as a proxy anchor.
  const perf = new Map();
  perf.set("data_analysis", cat0({ "new@high": mk(null) }));
  perf.set("math_proof", optin); // math_proof's new@high is the un-promoted null
  const bt = runProxyT(perf, [{ id: "new@high", model: "new", effort: "high" }]);
  assert.equal(perf.get("data_analysis").get("new@high").score, null, "un-promoted cross-model cell not a proxy anchor");
  assert.equal(bt.data_analysis.unresolved, 1, "no anchor -> null sentinel (never a fabricated cross-model borrow)");
}
// Guard: a thin predecessor that WOULD promote forward (dropping thinBasis) can never re-enter as an
// anchor under the opt-in, because promotion itself is disabled — the thin value stays null-filtered.
{
  const optin = buildCatT(cat0({ "old@high": mk(0.5, { thinBasis: true }), "new@high": mk(null) }), true);
  assert.equal(optin.get("new@high").score, null, "opt-in: thin predecessor is not promoted forward");
}

// ---- pricing: numeric tokenizer-inflation multiplier (executable + source) ------------------
// Mirror resolveTokenizerInflation exactly: numeric verbatim; legacy boolean -> 1.35 [ASSUMPTION];
// falsy -> 1.0; non-finite / non-positive -> hard error.
function resolveTokT(model, tf) {
  if (typeof tf === "number") {
    if (!Number.isFinite(tf) || tf <= 0) throw new Error(`bad ${model} ${tf}`);
    return { value: tf, basis: "dataset_numeric" };
  }
  if (tf === true) return { value: 1.35, basis: "legacy_boolean_assumption" };
  return { value: 1.0, basis: "none" };
}
assert.deepEqual(resolveTokT("x", 1.30), { value: 1.30, basis: "dataset_numeric" }, "numeric 1.30 used verbatim");
assert.deepEqual(resolveTokT("x", true), { value: 1.35, basis: "legacy_boolean_assumption" }, "legacy true -> 1.35 [ASSUMPTION]");
assert.deepEqual(resolveTokT("x", undefined), { value: 1.0, basis: "none" }, "undefined -> 1.0");
assert.deepEqual(resolveTokT("x", false), { value: 1.0, basis: "none" }, "false -> 1.0");
assert.throws(() => resolveTokT("x", 0), /bad/, "zero rejected");
assert.throws(() => resolveTokT("x", -1), /bad/, "negative rejected");
assert.throws(() => resolveTokT("x", NaN), /bad/, "NaN rejected");
assert.throws(() => resolveTokT("x", Infinity), /bad/, "Infinity rejected");
// Source: helper exists, numeric branch verbatim, legacy boolean back-compat, fail-loud, and used.
assert.match(source, /function resolveTokenizerInflation\(model, tf\)/);
assert.match(source, /if \(typeof tf === "number"\)/);
assert.match(source, /tokenizer_inflation must be a finite positive number/);
assert.match(source, /if \(tf === true\) return \{ value: OPUS_INFLATION, basis: "legacy_boolean_assumption" \}/);
assert.match(source, /resolveTokenizerInflation\(model, spec\.tokenizer_inflation\)/);

// ---- stale-basis fix: audit basis reports the ACTUAL applied tokenizer multiplier ---------------
// The old code hardcoded "[ASSUMPTION] tokenizer_inflation 1.35x worst-case" even when a NUMERIC
// dataset multiplier (fresh 1.30) was applied — a stale mismatch. The fix reports the real figure:
// the dataset numeric verbatim (interpolated), and the legacy boolean path still records
// OPUS_INFLATION (1.35) [ASSUMPTION] (constant unchanged — no arbitrary OPUS change).
assert.doesNotMatch(source, /basis\.push\(`\[ASSUMPTION\] tokenizer_inflation 1\.35x worst-case \(SOP-2; 1\.4x deprecated\)`\)/,
  "hardcoded stale 1.35 basis literal removed");
assert.match(source, /tokInflationBasis === "dataset_numeric"/, "numeric-basis branch present");
assert.match(source, /\[ASSUMPTION\] tokenizer_inflation \$\{_tok\.tokInflation\}x \(dataset numeric multiplier/,
  "numeric branch interpolates the ACTUAL applied multiplier");
assert.match(source, /tokInflationBasis === "legacy_boolean_assumption"/, "legacy-boolean branch preserved");
assert.match(source, /\[ASSUMPTION\] tokenizer_inflation \$\{OPUS_INFLATION\}x worst-case legacy boolean/,
  "legacy boolean path still records OPUS_INFLATION (1.35) [ASSUMPTION]");
assert.match(source, /const OPUS_INFLATION = 1\.35;/, "OPUS_INFLATION constant unchanged (no arbitrary change)");

// ---- issue #325: owner-authorized inferred-ranking coverage gate (source + executable) ----------
// DEFAULT gate is measured-only (unchanged). The opt-in + owner authorization gate applies the SAME
// 0.30 minimum to SIGNAL coverage (measured + audited inferred, counted apart); never counts
// inferred as measured; never sets a gap_stub_override; keeps completeness_state honest (thin).
assert.match(source, /const OWNER_AUTHORIZED_INFERRED_RANKING = PROXY_SYNTHESIS\?\.owner_authorized_inferred_ranking === true;/);
assert.match(source, /const INFERRED_RANKING_POLICY_ACTIVE = PROXY_SYNTHESIS_ENABLED && OWNER_AUTHORIZED_INFERRED_RANKING;/);
assert.match(source, /signal_pairing_ratio:/, "overall signal_pairing_ratio surfaced");
assert.match(source, /if \(INFERRED_RANKING_POLICY_ACTIVE\) \{/, "gate branches on the active policy");
assert.match(source, /CROSS_CATEGORY_INFERENCE\.coverage_gate = COVERAGE_GATE;/, "coverage gate attached to audit metadata");
assert.match(source, /inferred_counted_as_measured: false/, "gate records inferred is NOT measured");
// completeness_state derives from MEASURED coverage only (never upgraded to full by inferred).
assert.match(source, /_overallMeasuredRatio < COVERAGE_BLOCK_THRESHOLD\s*\?\s*"thin_coverage"/);

// Executable mirror of the gate decision (measured stays honest; inferred counted apart).
function gateBlockReasonsT({ enabled, authorized, dataMissing, measuredRatio, signalRatio, threshold }) {
  const active = enabled && authorized;
  const reasons = [];
  if (active) {
    if (dataMissing > 0) reasons.push("required-category-null");
    if (signalRatio < threshold) reasons.push("signal-below-threshold");
  } else {
    if (dataMissing > 0) reasons.push("data-missing");
    if (measuredRatio < threshold) reasons.push("measured-below-threshold");
  }
  return reasons;
}
const TH = 0.30;
// valid proxy coverage: opt-in + authorized, no null category, signal>=0.30 while MEASURED stays
// honestly below the floor (0.115) — the run proceeds and measured is never relabeled up.
{
  const r = gateBlockReasonsT({ enabled: true, authorized: true, dataMissing: 0, measuredRatio: 0.115, signalRatio: 0.394, threshold: TH });
  assert.deepEqual(r, [], "authorized signal>=0.30 allows the run while measured stays 0.115 (honest)");
}
// coverage below threshold: authorized but signal < 0.30 -> reject.
{
  const r = gateBlockReasonsT({ enabled: true, authorized: true, dataMissing: 0, measuredRatio: 0.115, signalRatio: 0.2, threshold: TH });
  assert.deepEqual(r, ["signal-below-threshold"], "authorized but signal<0.30 blocks");
}
// missing authorization: opt-in enabled but NOT authorized -> default measured-only gate blocks at 0.115.
{
  const r = gateBlockReasonsT({ enabled: true, authorized: false, dataMissing: 0, measuredRatio: 0.115, signalRatio: 0.394, threshold: TH });
  assert.deepEqual(r, ["measured-below-threshold"], "no owner authorization -> measured-only gate still blocks");
}
// default (no opt-in) gate preserved: measured-only regardless of signal.
{
  const r = gateBlockReasonsT({ enabled: false, authorized: false, dataMissing: 0, measuredRatio: 0.115, signalRatio: 0.9, threshold: TH });
  assert.deepEqual(r, ["measured-below-threshold"], "opt-in off -> measured-only gate");
}
// a required category with no signal blocks even the authorized gate.
{
  const r = gateBlockReasonsT({ enabled: true, authorized: true, dataMissing: 1, measuredRatio: 0.4, signalRatio: 0.5, threshold: TH });
  assert.deepEqual(r, ["required-category-null"], "authorized gate still requires every category non-null");
}

// ---- issue #325: audit validator inference-provenance checks (generalized, per target) -------
const auditValidator = readFileSync(new URL("../scripts/validate_routing_audit.mjs", import.meta.url), "utf8");
assert.match(auditValidator, /metadata\?\.cross_category_inference/);
assert.match(auditValidator, /if \(xci && xci\.enabled\)/);
assert.match(auditValidator, /xci\.by_target/);
assert.match(auditValidator, /is inferred but labeled confidence "measured"/);
assert.match(auditValidator, /is inferred but labeled interpolated/);
assert.match(auditValidator, /coverage_weight must be a number in \(0,1\]/);
assert.match(auditValidator, /"measured", "effort_interpolated", "version_promoted"/);
assert.match(auditValidator, /\["SENTINEL", "SOP-1", "INFERRED"\]/);
// F2 (defense-in-depth): under the opt-in, a version_promoted proxy anchor is rejected end-to-end.
assert.match(auditValidator, /is version_promoted \(cross-model\); unsupported as a proxy anchor under the opt-in/);
// issue #325 coverage gate: validator rejects missing authorization + mislabels.
assert.match(auditValidator, /const cg = xci\.coverage_gate;/);
assert.match(auditValidator, /coverage_gate is required under enabled proxy synthesis/);
assert.match(auditValidator, /inferred_counted_as_measured must be false/);
assert.match(auditValidator, /signal_pairing_ratio.*must be >= measured_pairing_ratio/);
assert.match(auditValidator, /requires coverage_gate\.owner_authorized_inferred_ranking === true \(missing owner authorization\)/);
assert.match(auditValidator, /gate must NOT rely on a gap_stub_override/);
assert.match(auditValidator, /signal_pairing_ratio \$\{cg\.signal_pairing_ratio\} < threshold/);
assert.match(auditValidator, /'full' mislabels thin measured coverage/);

// ---- issue #325 R2: BEHAVIORAL coverage-gate regression against the REAL validator --------------
// The assertions above pin the validator's SOURCE shape; they cannot prove the shipped command
// actually enforces the gate at runtime. This section closes that R2 gap by executing the real
// scripts/validate_routing_audit.mjs over on-disk audit fixtures (AUDIT_PATH/PROVIDER_PATH env) and
// asserting on its process exit code + stderr diagnostic — never mirroring the validator's own logic.
// It proves the command ACCEPTS a valid explicit owner-authorized inferred-ranking gate and REJECTS
// missing authorization, bad counts, a thin-coverage state hidden as "full", and an unsupported
// (version_promoted cross-model) proxy anchor. Fixtures live in a private mkdtemp dir, cleaned up
// scoped strictly to that dir (no cleanup outside it). The provider fixture omits the performance/
// cost_efficiency branches so the structural mirror short-circuits and the run reaches the gate.
{
  const VALIDATOR = fileURLToPath(new URL("../scripts/validate_routing_audit.mjs", import.meta.url));
  const fxDir = mkdtempSync(join(tmpdir(), "r2-audit-gate-"));
  const providerPath = join(fxDir, "routing-table.json");
  writeFileSync(providerPath, JSON.stringify({}));

  // A valid owner-authorized inferred-ranking gate: measured honestly below the 0.30 floor, signal
  // clears it, inferred never counted as measured, every required category non-null, no gap-stub.
  const baselineXci = () => ({
    enabled: true,
    method: "cross_category_proxy_synthesis",
    formula_id: "XCAT-PROXY-1",
    parent_map: { coding: ["debugging", "agentic_execution"] },
    coverage_gate: {
      policy: "owner_authorized_inferred_ranking",
      owner_authorized_inferred_ranking: true,
      measured_pairing_ratio: 0.115,
      signal_pairing_ratio: 0.394,
      threshold: 0.30,
      inferred_counted_as_measured: false,
      gap_stub_override_used: false,
      required_categories_all_nonnull: true,
      completeness_state: "thin_coverage",
    },
    by_target: {
      coding: {
        target_category: "coding",
        parent_categories: ["debugging", "agentic_execution"],
        counts: { direct_measured: 3, inferred: 2, unresolved_null: 1 },
        pairings: [{
          pairing_id: "m@high",
          coverage_weight: 0.5,
          source_categories: ["agentic_execution"],
          missing_categories: ["debugging"],
          parents: [{ category: "agentic_execution", score: 0.6, status: "measured" }],
        }],
      },
    },
  });
  const inferredRow = (extra = {}) => ({
    provider: "openai",
    model: "m",
    effort: "high",
    rank: 1,
    score: 0.6,
    cost_figure_used: 1,
    confidence: "inferred_low",
    basis: ["[INFERRED] coding cross-category proxy (XCAT-PROXY-1)"],
    citations: [{
      url: "",
      retrieved_at: "2026-01-01T00:00:00Z",
      annotation: "Inferred via XCAT-PROXY-1.",
      label: "[INFERRED]",
    }],
    ...extra,
  });
  const runValidator = (xci, auditBranches = {}) => {
    const auditPath = join(fxDir, "routing-table-audit.json");
    writeFileSync(auditPath, JSON.stringify({
      performance: auditBranches.performance || {},
      cost_efficiency: auditBranches.cost_efficiency || {},
      metadata: { cross_category_inference: xci },
    }));
    return spawnSync(process.execPath, [VALIDATOR], {
      env: { ...process.env, AUDIT_PATH: auditPath, PROVIDER_PATH: providerPath },
      encoding: "utf8",
    });
  };
  try {
    // ACCEPT: the valid explicit owner-authorized inferred-ranking gate -> exit 0, PASS.
    const ok = runValidator(baselineXci(), { performance: { coding: [inferredRow()] } });
    assert.equal(ok.status, 0, `valid owner-authorized gate must pass (stderr: ${ok.stderr})`);
    assert.match(ok.stdout, /validate_routing_audit: PASS/, "valid gate prints PASS");

    // REJECT 1 — missing authorization: policy=owner_authorized but flag !== true.
    const noAuth = baselineXci();
    noAuth.coverage_gate.owner_authorized_inferred_ranking = false;
    let r = runValidator(noAuth);
    assert.equal(r.status, 1, "missing owner authorization must exit non-zero");
    assert.match(r.stderr, /missing owner authorization/, "diagnostic names the missing authorization");

    // REJECT 2 — bad counts: a negative direct_measured is not a non-negative integer.
    const badCounts = baselineXci();
    badCounts.by_target.coding.counts.direct_measured = -1;
    r = runValidator(badCounts);
    assert.equal(r.status, 1, "negative counts must exit non-zero");
    assert.match(r.stderr, /counts\.direct_measured must be a non-negative integer/, "diagnostic names the bad count");

    // REJECT 3 — thin status hidden: measured below the floor may never be relabeled "full".
    const thinHidden = baselineXci();
    thinHidden.coverage_gate.completeness_state = "full";
    r = runValidator(thinHidden);
    assert.equal(r.status, 1, "'full' hiding thin measured coverage must exit non-zero");
    assert.match(r.stderr, /'full' mislabels thin measured coverage/, "diagnostic names the hidden thin coverage");

    // REJECT 4 — unavailable/unsupported parent: a version_promoted cross-model proxy anchor.
    const badParent = baselineXci();
    badParent.by_target.coding.pairings[0].parents[0].status = "version_promoted";
    r = runValidator(badParent);
    assert.equal(r.status, 1, "version_promoted proxy anchor must exit non-zero");
    assert.match(r.stderr, /version_promoted \(cross-model\); unsupported as a proxy anchor under the opt-in/, "diagnostic names the unsupported anchor");

    // REJECT 5: inferred proxy rows are not same-model upward effort interpolation.
    r = runValidator(baselineXci(), { performance: { coding: [inferredRow({ interpolated: true })] } });
    assert.equal(r.status, 1, "inferred row mislabeled interpolated must exit non-zero");
    assert.match(r.stderr, /is inferred but labeled interpolated/, "diagnostic names the collapsed provenance");
  } finally {
    rmSync(fxDir, { recursive: true, force: true });
  }
}

console.log("routing-profiler-builder: PASS");
