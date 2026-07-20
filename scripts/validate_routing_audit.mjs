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
try { audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8").replace(/^﻿/, "")); } catch (e) { fail(`audit unparseable: ${e.message}`); }
try { provider = JSON.parse(readFileSync(PROVIDER_PATH, "utf8").replace(/^﻿/, "")); } catch (e) { fail(`routing-table unparseable: ${e.message}`); }

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
    // ids like claude-opus-4-7 / gpt-5.5-pro / gpt-5.4-mini), but the shipped table
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
        if (!c.url && (!c.label || !String(c.label).includes("SENTINEL") && !String(c.label).includes("SOP-1"))) {
          warn(`${cloc}: empty url without [SENTINEL] or [SOP-1] label`);
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

console.log(
  `validate_routing_audit: PASS — ${totalPairings} pairings, ${totalCitations} citations` +
  (citationIssues > 0 ? ` (${citationIssues} soft warnings)` : "")
);
