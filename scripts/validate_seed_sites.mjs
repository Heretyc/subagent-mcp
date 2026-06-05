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

console.log(`validate_seed_sites: PASS (${root.sites.length} sites).`);
