// validate_routing_audit.mjs — structural + citation integrity check for routing-table-audit.json.
// §1b of validation.md: audit mirrors routing-table.json structure; every pairing has citations;
// each citation has url/[SENTINEL], ISO8601 retrieved_at, single-sentence annotation, label.
// Per item #11: also checks tier and source class on citations.
// DO-NOT-ADOPT #5: does NOT require non-null run-manifest fields (infeasible offline).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isLaunchableModel } from "./lib/launchable-models.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_PATH = process.env.AUDIT_PATH
  ? resolve(ROOT, process.env.AUDIT_PATH)
  : resolve(ROOT, "src/routing-table-audit.json");
const PROVIDER_PATH = process.env.PROVIDER_PATH
  ? resolve(ROOT, process.env.PROVIDER_PATH)
  : resolve(ROOT, "src/routing-table.json");

if (!existsSync(AUDIT_PATH)) {
  console.log(`validate_routing_audit: NOTICE audit absent (pre-first-run) — skipping.`);
  process.exit(0);
}
if (!existsSync(PROVIDER_PATH)) {
  console.log(`validate_routing_audit: NOTICE routing-table absent — skipping.`);
  process.exit(0);
}

const fail = (m) => { console.error(`validate_routing_audit: FAIL ${m}`); process.exit(1); };
const warn = (m) => console.warn(`validate_routing_audit: WARN ${m}`);

let audit, provider;
try { audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail(`audit unparseable: ${e.message}`); }
try { provider = JSON.parse(readFileSync(PROVIDER_PATH, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail(`routing-table unparseable: ${e.message}`); }

const runManifest = audit.metadata?.run_manifest;
const override = runManifest?.gap_stub_override;
if (runManifest?.completeness_state === "gap_stubbed") {
  if (!override || override.override_used !== true || typeof override.reason !== "string" || !override.reason.trim()) {
    fail("run_manifest.completeness_state=gap_stubbed requires gap_stub_override.override_used=true with a non-empty reason");
  }
}
if (override?.override_used === true) {
  warn(`gap_stub_override recorded: ${override.reason}`);
}

// 1. Structural mirror: same branches and categories as the routing table.
const BRANCHES = ["performance", "cost_efficiency"];
for (const branch of BRANCHES) {
  if (typeof audit[branch] !== "object" || audit[branch] === null) fail(`audit missing branch '${branch}'`);
  if (typeof provider[branch] !== "object" || provider[branch] === null) continue;
  const auditCats = Object.keys(audit[branch]);
  const provCats = Object.keys(provider[branch]);
  if (JSON.stringify(auditCats) !== JSON.stringify(provCats)) {
    fail(`${branch} category keys/order differ: audit=[${auditCats}] routing=[${provCats}]`);
  }
  for (const category of provCats) {
    const auditPairingsFull = audit[branch][category];
    const provPairings = provider[branch][category];
    if (!Array.isArray(auditPairingsFull)) { fail(`audit ${branch}.${category} not an array`); continue; }
    if (!Array.isArray(provPairings)) continue;
    // ISS-057: the audit carries the FULL benchmark universe (incl. non-launchable
    // ids like gpt-5.5-pro / gpt-5.4-mini), but the shipped table
    // carries only launchable pairings. Project the audit down to the launchable
    // subset (SSOT: FULL_TO_SHORT via scripts/lib/launchable-models.mjs) so the
    // count + set-equality checks compare like-for-like instead of flagging the
    // intentionally-excluded ids.
    const auditPairings = auditPairingsFull.filter((p) => isLaunchableModel(p.model));
    if (auditPairings.length !== provPairings.length) {
      fail(`${branch}.${category} launchable pairing count: audit=${auditPairings.length} routing=${provPairings.length}`);
    }
    // model+effort set equality (launchable subset)
    const auditKeys = new Set(auditPairings.map((p) => `${p.model}@${p.effort}`));
    const provKeys = new Set(provPairings.map((p) => `${p.model}@${p.effort}`));
    for (const k of provKeys) if (!auditKeys.has(k)) fail(`${branch}.${category} pairing ${k} in routing-table but absent from audit`);
    for (const k of auditKeys) if (!provKeys.has(k)) fail(`${branch}.${category} pairing ${k} in audit but absent from routing-table`);
  }
}

// 2. Citation checks: every pairing must have a non-empty citations array; each citation is validated.
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
let totalPairings = 0, totalCitations = 0, citationIssues = 0;

for (const branch of BRANCHES) {
  const branchObj = audit[branch];
  if (!branchObj) continue;
  for (const [category, pairings] of Object.entries(branchObj)) {
    if (!Array.isArray(pairings)) continue;
    for (let i = 0; i < pairings.length; i++) {
      totalPairings++;
      const p = pairings[i];
      const loc = `${branch}.${category}[${i}](${p.model}@${p.effort})`;
      if (!Array.isArray(p.citations) || p.citations.length === 0) {
        fail(`${loc}: missing or empty citations array`);
      }
      for (let j = 0; j < p.citations.length; j++) {
        totalCitations++;
        const c = p.citations[j];
        const cloc = `${loc}.citations[${j}]`;
        if (typeof c !== "object" || c === null) { fail(`${cloc}: not an object`); continue; }
        // url: must be a string; empty url REQUIRES [SENTINEL] label.
        if (typeof c.url !== "string") { fail(`${cloc}: url not a string`); citationIssues++; continue; }
        if (!c.url && (!c.label || !["SENTINEL", "SOP-1", "INFERRED"].some((tag) => String(c.label).includes(tag)))) {
          warn(`${cloc}: empty url without [SENTINEL], [SOP-1], or [INFERRED] label`);
          citationIssues++;
        }
        // retrieved_at: ISO8601
        if (typeof c.retrieved_at !== "string" || !ISO8601_RE.test(c.retrieved_at)) {
          fail(`${cloc}: retrieved_at not ISO8601 ('${c.retrieved_at}')`);
          citationIssues++;
        }
        // annotation: non-empty string
        if (typeof c.annotation !== "string" || !c.annotation.trim()) {
          fail(`${cloc}: annotation missing or empty`);
          citationIssues++;
        }
        // label: source class identifier (soft warn if absent)
        if (!("label" in c) || (typeof c.label !== "string")) {
          warn(`${cloc}: label absent or not a string (soft)`);
        }
        // tier: optional integer 0..5 (warn if present but invalid)
        if ("tier" in c && c.tier !== null && c.tier !== undefined) {
          if (!Number.isInteger(c.tier) || c.tier < 0 || c.tier > 5) {
            warn(`${cloc}: tier present but not int 0..5 (${c.tier})`);
          }
        }
      }
    }
  }
}

// 3. Sentinel-never-#1 assertion (#16): rank=1 pairing must not be a no-effort sentinel.
// No-effort sentinels: JSON null, or strings "n/a"/"null"/"none" (matches build_routing_table.mjs NO_EFFORT_SENTINELS).
const SENTINEL_EFFORTS = new Set(["n/a", "null", "none"]);
for (const branch of BRANCHES) {
  const branchObj = audit[branch];
  if (!branchObj) continue;
  for (const [category, pairings] of Object.entries(branchObj)) {
    if (!Array.isArray(pairings) || pairings.length === 0) continue;
    const topPick = pairings.find((p) => p.rank === 1) || pairings[0];
    if (!topPick) continue;
    const effortVal = topPick.effort;
    const isSentinel =
      effortVal === null || SENTINEL_EFFORTS.has(String(effortVal).toLowerCase());
    if (isSentinel) {
      fail(
        `#16 ${branch}.${category}: rank=1 pairing (${topPick.model}@${topPick.effort}) is a no-effort sentinel — sentinel-never-#1 violated`
      );
    }
  }
}

// 4. Cross-category inference provenance (issue #325 XCAT-PROXY-1). Present when the builder ran
// the generalized cross-category proxy synthesis (dataset opt-in). The metadata carries one record
// PER TARGET under `by_target`. When enabled, require per target: the declared parent set,
// per-pairing coverage + source status, and measured-vs-inferred counts; and forbid any inferred
// row (any synthesized target category) from being labeled a measurement. When opt-in is disabled
// (`enabled === false`) there is nothing to validate.
const xci = audit.metadata?.cross_category_inference;
if (xci && xci.enabled) {
  const VALID_STATUS = new Set(["measured", "effort_interpolated", "version_promoted"]);
  for (const f of ["method", "formula_id", "parent_map", "by_target"]) {
    if (!(f in xci)) fail(`metadata.cross_category_inference missing required field '${f}'`);
  }
  // issue #325 coverage gate: method/authorization/threshold/actual ratios must be unambiguous.
  // Reject a missing owner authorization and any mislabel (inferred-as-measured, gap-stub misuse,
  // signal < measured, or a "full" completeness_state that hides thin direct measured coverage).
  const cg = xci.coverage_gate;
  if (!cg || typeof cg !== "object") {
    fail("metadata.cross_category_inference.coverage_gate is required under enabled proxy synthesis");
  } else {
    for (const f of ["measured_pairing_ratio", "signal_pairing_ratio", "threshold"]) {
      if (typeof cg[f] !== "number" || !Number.isFinite(cg[f])) {
        fail(`coverage_gate.${f} must be a finite number (got ${cg[f]})`);
      }
    }
    // inferred is NEVER measured; signal (measured+inferred) can never be below measured.
    if (cg.inferred_counted_as_measured === true) {
      fail("coverage_gate.inferred_counted_as_measured must be false — inferred coverage is never counted as measured");
    }
    if (cg.signal_pairing_ratio + 1e-9 < cg.measured_pairing_ratio) {
      fail(`coverage_gate.signal_pairing_ratio (${cg.signal_pairing_ratio}) must be >= measured_pairing_ratio (${cg.measured_pairing_ratio})`);
    }
    if (cg.policy === "owner_authorized_inferred_ranking") {
      if (cg.owner_authorized_inferred_ranking !== true) {
        fail("owner_authorized_inferred_ranking gate requires coverage_gate.owner_authorized_inferred_ranking === true (missing owner authorization)");
      }
      if (cg.gap_stub_override_used === true) {
        fail("owner_authorized_inferred_ranking gate must NOT rely on a gap_stub_override");
      }
      if (cg.signal_pairing_ratio < cg.threshold) {
        fail(`owner_authorized_inferred_ranking gate: signal_pairing_ratio ${cg.signal_pairing_ratio} < threshold ${cg.threshold}`);
      }
      if (cg.required_categories_all_nonnull !== true) {
        fail("owner_authorized_inferred_ranking gate requires every required category to carry a non-null signal");
      }
    }
    // Honest completeness: a run below the measured floor must never be relabeled "full".
    if (cg.measured_pairing_ratio < cg.threshold && cg.completeness_state === "full") {
      fail(`coverage_gate.completeness_state 'full' mislabels thin measured coverage (measured ${cg.measured_pairing_ratio} < threshold ${cg.threshold})`);
    }
  }
  const byTarget = xci.by_target && typeof xci.by_target === "object" ? xci.by_target : {};
  const targetCategories = new Set();
  for (const [target, rec] of Object.entries(byTarget)) {
    targetCategories.add(rec?.target_category || target);
    const tloc = `metadata.cross_category_inference.by_target.${target}`;
    for (const f of ["target_category", "parent_categories", "counts", "pairings"]) {
      if (!(f in (rec || {}))) fail(`${tloc} missing required field '${f}'`);
    }
    if (!Array.isArray(rec.parent_categories) || rec.parent_categories.length === 0) {
      fail(`${tloc}.parent_categories must be a non-empty array`);
    }
    for (const k of ["direct_measured", "inferred", "unresolved_null"]) {
      if (!Number.isInteger(rec.counts?.[k]) || rec.counts[k] < 0) {
        fail(`${tloc}.counts.${k} must be a non-negative integer`);
      }
    }
    if (!Array.isArray(rec.pairings)) {
      fail(`${tloc}.pairings must be an array`);
    } else {
      for (let i = 0; i < rec.pairings.length; i++) {
        const pr = rec.pairings[i];
        const loc = `${tloc}.pairings[${i}]`;
        for (const f of ["pairing_id", "coverage_weight", "source_categories", "missing_categories", "parents"]) {
          if (!(f in (pr || {}))) fail(`${loc} missing required field '${f}'`);
        }
        if (typeof pr.coverage_weight !== "number" || pr.coverage_weight <= 0 || pr.coverage_weight > 1) {
          fail(`${loc}.coverage_weight must be a number in (0,1] (got ${pr.coverage_weight})`);
        }
        if (!Array.isArray(pr.source_categories) || pr.source_categories.length === 0) {
          fail(`${loc}.source_categories must be a non-empty array (>=1 available parent)`);
        }
        if (!Array.isArray(pr.parents) || pr.parents.length === 0) {
          fail(`${loc}.parents must be a non-empty array`);
        } else {
          for (const parent of pr.parents) {
            if (!parent || typeof parent.category !== "string" || typeof parent.score !== "number" || !Number.isFinite(parent.score)) {
              fail(`${loc}.parents entries need {category:string, score:finite number, status}`);
            } else if (!VALID_STATUS.has(parent.status)) {
              fail(`${loc}.parents ${parent.category} status invalid: ${parent.status}`);
            } else if (parent.status === "version_promoted") {
              // F2: under the proxy opt-in, cross-model SOP-1 version-promotion is disabled before
              // composition, so a proxy anchor can never rest on a cross-model version-promoted value.
              // Reject it end-to-end (a version_promoted anchor here means an unsupported cross-model
              // capability entered the direct snapshot).
              fail(`${loc}.parents ${parent.category} is version_promoted (cross-model); unsupported as a proxy anchor under the opt-in`);
            }
          }
        }
      }
    }
  }
  // Reject any inferred row labeled a measurement: a synthesized target-category pairing (basis
  // carries [INFERRED]) must never claim confidence "measured" — checked for EVERY target category.
  for (const branch of BRANCHES) {
    for (const target of targetCategories) {
      const rows = audit[branch]?.[target];
      if (!Array.isArray(rows)) continue;
      for (const p of rows) {
        const basisInferred = Array.isArray(p.basis) && p.basis.some((b) => String(b).includes("[INFERRED]"));
        if (basisInferred && p.confidence === "measured") {
          fail(`${branch}.${target} pairing ${p.model}@${p.effort} is inferred but labeled confidence "measured"`);
        }
        if (basisInferred && p.score !== null && p.interpolated === true) {
          fail(`${branch}.${target} pairing ${p.model}@${p.effort} is inferred but labeled interpolated`);
        }
      }
    }
  }
}

console.log(
  `validate_routing_audit: PASS — ${totalPairings} pairings, ${totalCitations} citations` +
  (citationIssues > 0 ? ` (${citationIssues} soft warnings)` : "")
);
