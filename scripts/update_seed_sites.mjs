// update_seed_sites.mjs — deterministic accumulating merge of research source URLs into
// research-seed-sites.json (the 3rd persisted artifact). Pure code, no model judgment.
// Source of truth = src/routing-table-audit.json citations (per-category nesting gives `categories`,
// the citation's numeric `tier` field gives `tier` — refinement #7; a provenance label such as
// [SEED]/[INFERRED]/[ASSUMPTION] used to MASK the [Tn] tier and forced every site to tier 0).
// Optional SEED_SOURCES_PATH may add sources + structured benchmarks.
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
// refinement #7: per-site tier AGGREGATION rule (documented, defensible, tier-semantics-aware).
// Repo TIER SEMANTICS: Tier 1 = vendor self-claim = WEAKEST; a HIGHER numeric tier is more
// independent / more corroborated = STRONGER. We keep the STRONGEST (max non-zero numeric)
// tier observed for a site across all its citations: a site that has produced even one
// independently-corroborated (high-tier) datapoint is, as a source, demonstrably capable of
// that level of independence, and the seed exists to prioritise such sources. (tier 0 = unknown
// is never preferred over a real tier.) This REPLACES the old "lowest non-zero" rule, which was
// written for [Tn]-label parsing where lower==more-authoritative under a DIFFERENT, now-stale
// convention; the live numeric tiers follow the repo convention (higher==stronger).
function mergeTier(prev, t) {
  if (!Number.isInteger(t) || t <= 0) return prev; // 0/non-int = unknown -> no signal
  return t > prev ? t : prev; // keep the strongest (most-independent) tier seen
}
function addCite(url, label, category, tier) {
  const n = normalizeUrl(url);
  if (!n) return; // skip empty-url sentinels ([SENTINEL]/[SOP-1])
  const e = getEntry(n);
  // refinement #7: read the NUMERIC tier DIRECTLY from the citation (builder now emits it),
  // not by regex on the provenance label — a [SEED]/[INFERRED]/[ASSUMPTION] label previously
  // masked the [Tn] tier and forced every site to tier 0.
  e.tier = mergeTier(e.tier, Number(tier));
  if (label && !e.label) e.label = label;
  if (category) e.categories.add(category);
  e.sourceClasses.add("pairing_citation");
}
for (const branch of ["performance", "cost_efficiency"]) {
  const b = audit[branch] || {};
  for (const category of Object.keys(b)) {
    for (const pairing of b[category] || []) {
      for (const c of pairing.citations || []) addCite(c.url, c.label, category, c.tier);
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
  // refinement #7: keep the strongest (highest numeric) tier — same rule as pairing citations.
  e.tier = mergeTier(e.tier, Number(a.tier));
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
    // External dumps still carry an explicit [Tn] label (NOT a masking provenance label), so
    // parse it; merge via the same strongest-tier rule (refinement #7). An explicit numeric
    // `s.tier`, if present, takes precedence over the label.
    const t = Number.isInteger(s.tier) ? s.tier : tierFromLabel(s.label);
    e.tier = mergeTier(e.tier, Number(t));
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
    // refinement #7: accumulate the strongest (highest numeric) tier across runs — a site that
    // ever surfaced an independently-corroborated datapoint keeps that standing (never demoted
    // back toward the weaker vendor-self-claim tier). Old seed entries default tier 0 (unknown),
    // so this simply LIFTS them to their real tier on first re-run after this fix.
    cur.tier = mergeTier(cur.tier || 0, Number(h.tier));
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
