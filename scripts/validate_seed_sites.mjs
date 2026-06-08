// validate_seed_sites.mjs — schema gate for research-seed-sites.json (the 3rd persisted artifact).
// Fresh-clone tolerance: if the file is ABSENT, print NOTICE and exit 0 (npm test stays green before
// the first profiling run ever). After a run, the run's own validation leaf (validation.md §1c)
// asserts existence + growth — that gate is NOT here.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = process.env.SEED_SITES_PATH
  ? resolve(ROOT, process.env.SEED_SITES_PATH)
  : resolve(ROOT, "research-seed-sites.json");

if (!existsSync(SEED_PATH)) {
  console.log(`validate_seed_sites: NOTICE research-seed-sites.json absent (pre-first-run) — skipping.`);
  process.exit(0);
}

const fail = (m) => { console.error(`validate_seed_sites: FAIL ${m}`); process.exit(1); };
let root;
try { root = JSON.parse(readFileSync(SEED_PATH, "utf8")); } catch (e) { fail(`unparseable JSON: ${e.message}`); }

if (typeof root !== "object" || root === null) fail("root is not an object");
const md = root.metadata;
if (typeof md !== "object" || md === null) fail("missing metadata");
for (const k of ["author","author_url","schema_version","generated","last_run_at","run_id","site_count"]) {
  if (!(k in md)) fail(`metadata missing key '${k}'`);
}
// #27: run_id must be a non-empty string.
if (typeof md.run_id !== "string" || !md.run_id.trim()) fail("metadata.run_id must be a non-empty string");
if (!Array.isArray(root.sites)) fail("sites is not an array");

const seen = new Set();
let prevUrl = null;
for (let i = 0; i < root.sites.length; i++) {
  const s = root.sites[i];
  const at = (m) => fail(`sites[${i}] ${m}`);
  if (typeof s !== "object" || s === null) at("not an object");
  for (const k of ["url","domain","tier","categories","first_seen","last_seen","times_seen"]) {
    if (!(k in s)) at(`missing required key '${k}'`);
  }
  if (typeof s.url !== "string" || !s.url) at("url not a non-empty string");
  if (typeof s.domain !== "string" || !s.domain) at("domain not a non-empty string");
  if (!Number.isInteger(s.tier) || s.tier < 0 || s.tier > 5) at(`tier not int 0..5 (${s.tier})`);
  if (!Array.isArray(s.categories)) at("categories not an array");
  if ("benchmarks" in s && !Array.isArray(s.benchmarks)) at("benchmarks present but not an array");
  // refinement #12: benchmarks, if present, must be an array of non-empty strings (names harvested
  // from normalization_sources.benchmark — a real structured field, never scraped prose).
  if (Array.isArray(s.benchmarks)) {
    for (const b of s.benchmarks) if (typeof b !== "string" || !b) at("benchmarks contains a non-string/empty entry");
  }
  // #17: attempt_ledger is now a bounded ring + accumulated counters object.
  // Schema: { runs: [...], accumulated: { provider_family_counts, category_counts, total_runs } }
  // Each run record in runs[] carries the per-run snapshot fields.
  if ("attempt_ledger" in s) {
    const L = s.attempt_ledger;
    if (typeof L !== "object" || L === null || Array.isArray(L)) {
      at("attempt_ledger not an object");
    } else if (!Array.isArray(L.runs)) {
      at("attempt_ledger.runs not an array");
    } else {
      if (typeof L.accumulated !== "object" || L.accumulated === null || Array.isArray(L.accumulated)) {
        at("attempt_ledger.accumulated not an object");
      } else {
        if (typeof L.accumulated.total_runs !== "number") at("attempt_ledger.accumulated.total_runs not a number");
        if (typeof L.accumulated.provider_family_counts !== "object" || L.accumulated.provider_family_counts === null) at("attempt_ledger.accumulated.provider_family_counts not an object");
        if (typeof L.accumulated.category_counts !== "object" || L.accumulated.category_counts === null) at("attempt_ledger.accumulated.category_counts not an object");
      }
      for (let ri = 0; ri < L.runs.length; ri++) {
        const R = L.runs[ri];
        const rl = `attempt_ledger.runs[${ri}]`;
        if (typeof R !== "object" || R === null) { at(`${rl} not an object`); continue; }
        for (const k of ["run_id","attempted_at","outcome","provider_family","categories","source_class","benchmark_names","rejection_reason","http_status","last_checked"]) {
          if (!(k in R)) at(`${rl} missing key '${k}'`);
        }
        if (typeof R.run_id !== "string" || !R.run_id) at(`${rl}.run_id not a non-empty string`);
        if (R.attempted_at !== null && (typeof R.attempted_at !== "string" || !R.attempted_at)) at(`${rl}.attempted_at not null or non-empty string`);
        if (typeof R.outcome !== "string" || !R.outcome) at(`${rl}.outcome not a non-empty string`);
        if (R.provider_family !== null && !Array.isArray(R.provider_family)) at(`${rl}.provider_family not null or array`);
        if (!Array.isArray(R.categories)) at(`${rl}.categories not an array`);
        if (R.source_class !== null && !Array.isArray(R.source_class)) at(`${rl}.source_class not null or array`);
        if (!Array.isArray(R.benchmark_names)) at(`${rl}.benchmark_names not an array`);
        if (R.rejection_reason !== null && !Array.isArray(R.rejection_reason)) at(`${rl}.rejection_reason not null or array`);
        if (R.http_status !== null && !Number.isInteger(R.http_status)) at(`${rl}.http_status not null or integer`);
        if (R.last_checked !== null && (typeof R.last_checked !== "string" || !R.last_checked)) at(`${rl}.last_checked not null or non-empty string`);
      }
    }
  }
  // refinement #12: selection annotation schema gate (SEPARATE from storage; demote-without-delete).
  // selection.demoted is a SOFT flag — its presence must NEVER coincide with the row being absent
  // (storage keeps everything; a demoted row is still a row). No TTL field is permitted anywhere.
  if ("selection" in s) {
    const sel = s.selection;
    if (typeof sel !== "object" || sel === null || Array.isArray(sel)) at("selection not an object");
    else {
      for (const k of ["demoted","health","demote_reasons"]) if (!(k in sel)) at(`selection missing key '${k}'`);
      if (typeof sel.demoted !== "boolean") at("selection.demoted not a boolean");
      if (sel.health !== "healthy" && sel.health !== "demoted") at(`selection.health not 'healthy'|'demoted' (${sel.health})`);
      if (!Array.isArray(sel.demote_reasons)) at("selection.demote_reasons not an array");
      if (sel.demoted && sel.demote_reasons.length === 0) at("selection.demoted true but demote_reasons empty");
      if (!sel.demoted && sel.demote_reasons.length > 0) at("selection.demoted false but demote_reasons non-empty");
      if (sel.demoted !== (sel.health === "demoted")) at("selection.demoted/health disagree");
      if ("ttl" in sel || "expires_at" in sel || "delete_after" in sel) at("selection carries a TTL/expiry field (forbidden: demote-without-delete, no TTL)");
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.first_seen)) at("first_seen not YYYY-MM-DD");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.last_seen)) at("last_seen not YYYY-MM-DD");
  if (!Number.isInteger(s.times_seen) || s.times_seen < 1) at("times_seen not int >=1");
  if (seen.has(s.url)) at(`duplicate url '${s.url}'`);
  seen.add(s.url);
  if (prevUrl !== null && s.url < prevUrl) at("sites not sorted ascending by url");
  prevUrl = s.url;
}
if (md.site_count !== root.sites.length) fail(`metadata.site_count ${md.site_count} != sites.length ${root.sites.length}`);

// refinement #7: dead-signal detector. tier 0 = unknown/unparsed. Before this fix a provenance
// label ([SEED]/[INFERRED]/[ASSUMPTION]) masked each citation's numeric [Tn] tier, so EVERY site
// landed at tier 0 while the schema (tier int 0..5) happily accepted it — a silently dead tier
// signal. WARN (never fail: tier 0 is schema-valid and a genuinely thin pre-first-run seed may be
// legitimately all-unknown) when >90% of sites are tier 0, so a regressed/masked tier pipeline is
// surfaced loudly instead of passing green.
if (root.sites.length > 0) {
  const tier0 = root.sites.filter((s) => s.tier === 0).length;
  const pct = tier0 / root.sites.length;
  if (pct > 0.9) {
    console.warn(
      `validate_seed_sites: WARNING ${tier0}/${root.sites.length} sites (${(pct * 100).toFixed(1)}%) are tier 0 ` +
      `(>90%). Possible dead/masked tier signal — verify build_routing_table emits numeric citation ` +
      `tiers and update_seed_sites reads them (refinement #7). Not a hard failure (tier 0 is schema-valid).`
    );
  }
}

// #3f: hard-fail when any category present in the seed has ZERO independent sources.
// "Independent" = tier >= 2 (tier 1 = vendor self-claim; tier 0 = unknown). Owner decision.
// Only fires when the seed has >=1 site (pre-first-run tolerance: absent file exits 0 above).
if (root.sites.length > 0) {
  const catIndependent = new Map(); // category -> count of sites with tier >= 2
  for (const s of root.sites) {
    for (const c of s.categories || []) {
      if (!catIndependent.has(c)) catIndependent.set(c, 0);
      if ((s.tier || 0) >= 2) catIndependent.set(c, catIndependent.get(c) + 1);
    }
  }
  const zeroCats = [...catIndependent.entries()].filter(([, count]) => count === 0).map(([c]) => c);
  if (zeroCats.length > 0) {
    fail(
      `#3f zero independent sources (tier>=2) for categories: ${zeroCats.join(", ")}. ` +
      `Add at least one non-vendor corroborating source per category before this run can pass.`
    );
  }
}

console.log(`validate_seed_sites: PASS (${root.sites.length} sites).`);
