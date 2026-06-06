// update_seed_sites.mjs — deterministic accumulating merge of research source URLs into
// research-seed-sites.json (the 3rd persisted artifact). Pure code, no model judgment.
// Source of truth = src/routing-table-audit.json citations (per-category nesting gives `categories`,
// the [T<n>] label gives `tier`). Optional SEED_SOURCES_PATH may add sources + structured benchmarks.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_PATH = resolve(ROOT, "src/routing-table-audit.json");
const SEED_PATH = resolve(ROOT, "research-seed-sites.json");
const RUN_DATE = process.env.DATASET_DATE || "2026-06-03";
if (!/^\d{4}-\d{2}-\d{2}$/.test(RUN_DATE)) {
  throw new Error(`DATASET_DATE must be YYYY-MM-DD; got '${RUN_DATE}'`);
}
if (!existsSync(AUDIT_PATH)) {
  throw new Error(`Audit not found at ${AUDIT_PATH}; run build_routing_table.mjs first.`);
}

const TRACKING = new Set(["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"]);
function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  let u;
  try { u = new URL(raw.trim()); } catch { return ""; }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);
  }
  let s = u.toString();
  if (s.endsWith("/") && u.pathname === "/") s = s.slice(0, -1); // strip bare trailing slash
  return s;
}
function hostOf(normUrl) {
  try { return new URL(normUrl).host.replace(/^www\./, ""); } catch { return ""; }
}
function tierFromLabel(label) {
  const m = /^\[T(\d)\]$/.exec(label || "");
  return m ? Number(m[1]) : 0;
}
const sortUniq = (a) => [...new Set(a)].sort();

// ---- harvest from audit (authoritative) -------------------------------------------
const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8"));
// Map<normUrl, {tier, label, categories:Set, benchmarks:Set, sourceClasses:Set}>
const harvested = new Map();
function getEntry(n) {
  if (!harvested.has(n)) {
    harvested.set(n, { tier: 0, label: "", categories: new Set(), benchmarks: new Set(), sourceClasses: new Set() });
  }
  return harvested.get(n);
}
function addCite(url, label, category) {
  const n = normalizeUrl(url);
  if (!n) return; // skip empty-url sentinels ([SENTINEL]/[SOP-1])
  const e = getEntry(n);
  const t = tierFromLabel(label);
  if (t && (e.tier === 0 || t < e.tier)) e.tier = t; // most authoritative (lower non-zero) tier
  if (label && !e.label) e.label = label;
  if (category) e.categories.add(category);
  e.sourceClasses.add("pairing_citation");
}
for (const branch of ["performance", "cost_efficiency"]) {
  const b = audit[branch] || {};
  for (const category of Object.keys(b)) {
    for (const pairing of b[category] || []) {
      for (const c of pairing.citations || []) addCite(c.url, c.label, category);
    }
  }
}

// ---- refinement #8: harvest scale-anchor normalization sources ---------------------
// build_routing_table emits audit.metadata.normalization_sources: the source row(s) that
// DEFINED each category benchmark's min/max normalization anchor. citationsFor only emits
// citations for SELECTED ranked pairings, so a source that CALIBRATED a category's scale but
// was not attached to a ranked pairing would otherwise be dropped from the seed. Harvest those
// here as source_class=scale_anchor (in ADDITION to the pairing-citation harvest above),
// respecting the same normalize/dedup-by-url. tier is taken from the row's numeric tier
// (audit normalization_sources carries `tier`, not a [T<n>] label).
for (const a of audit.metadata?.normalization_sources || []) {
  const n = normalizeUrl(a.url);
  if (!n) continue; // skip anchor rows with no usable source url
  const e = getEntry(n);
  const t = Number.isInteger(a.tier) ? a.tier : 0;
  if (t && (e.tier === 0 || t < e.tier)) e.tier = t; // most authoritative (lower non-zero) tier
  if (a.category) e.categories.add(a.category);
  e.sourceClasses.add("scale_anchor");
}

// ---- optional ephemeral source dump (may add sources + structured benchmarks) -----
if (process.env.SEED_SOURCES_PATH && existsSync(process.env.SEED_SOURCES_PATH)) {
  const extra = JSON.parse(readFileSync(process.env.SEED_SOURCES_PATH, "utf8"));
  for (const s of Array.isArray(extra) ? extra : extra.sources || []) {
    const n = normalizeUrl(s.url);
    if (!n) continue;
    if (!harvested.has(n)) harvested.set(n, { tier: 0, label: "", categories: new Set(), benchmarks: new Set() });
    const e = harvested.get(n);
    const t = tierFromLabel(s.label);
    if (t && (e.tier === 0 || t < e.tier)) e.tier = t;
    if (s.label && !e.label) e.label = s.label;
    for (const cat of s.categories || []) e.categories.add(cat);
    for (const bm of s.benchmarks || []) e.benchmarks.add(bm); // benchmarks ONLY from a real structured field
  }
}

// ---- merge into existing seed file (accumulate) -----------------------------------
let existing = { metadata: {}, sites: [] };
if (existsSync(SEED_PATH)) existing = JSON.parse(readFileSync(SEED_PATH, "utf8"));
const byUrl = new Map((existing.sites || []).map((s) => [s.url, s]));

for (const [url, h] of harvested) {
  const cur = byUrl.get(url);
  // refinement #8: source_classes accumulates how each url was harvested ("pairing_citation"
  // and/or "scale_anchor") — accumulate-forever, never narrowed on re-run.
  const harvestedClasses = sortUniq([...h.sourceClasses]);
  if (!cur) {
    byUrl.set(url, {
      url, domain: hostOf(url), tier: h.tier,
      categories: sortUniq([...h.categories]),
      benchmarks: sortUniq([...h.benchmarks]),
      ...(harvestedClasses.length ? { source_classes: harvestedClasses } : {}),
      first_seen: RUN_DATE, last_seen: RUN_DATE, times_seen: 1,
      ...(h.label ? { label: h.label } : {}),
    });
  } else {
    cur.last_seen = RUN_DATE;
    cur.times_seen = (cur.times_seen || 0) + 1;
    cur.categories = sortUniq([...(cur.categories || []), ...h.categories]);
    cur.benchmarks = sortUniq([...(cur.benchmarks || []), ...h.benchmarks]);
    cur.source_classes = sortUniq([...(cur.source_classes || []), ...harvestedClasses]);
    if (h.tier && (!cur.tier || h.tier < cur.tier)) cur.tier = h.tier;
    if (!cur.label && h.label) cur.label = h.label;
    cur.domain = cur.domain || hostOf(url);
  }
}

const sites = [...byUrl.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
const out = {
  metadata: {
    author: "Lexi Blackburn",
    author_url: "https://github.com/Heretyc/",
    schema_version: "1",
    generated: RUN_DATE.slice(0, 7),
    last_run_at: process.env.BUILD_TS || `${RUN_DATE}T00:00:00Z`,
    site_count: sites.length,
  },
  sites,
};
writeFileSync(SEED_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`update_seed_sites: research-seed-sites.json now has ${sites.length} sites (run ${RUN_DATE}).`);
