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
for (const k of ["author","author_url","schema_version","generated","last_run_at","site_count"]) {
  if (!(k in md)) fail(`metadata missing key '${k}'`);
}
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

console.log(`validate_seed_sites: PASS (${root.sites.length} sites).`);
