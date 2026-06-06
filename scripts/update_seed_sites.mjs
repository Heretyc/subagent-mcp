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
// Map<normUrl, {tier, label, categories:Set, benchmarks:Set, sourceClasses:Set,
//   providerFamilies:Set, attemptedAt:string|null}>
// refinement #12: providerFamilies + attemptedAt are the per-site attempt-ledger inputs
// harvested ALONGSIDE the existing fields — see the ledger assembly block below.
const harvested = new Map();
function getEntry(n) {
  if (!harvested.has(n)) {
    harvested.set(n, {
      tier: 0, label: "", categories: new Set(), benchmarks: new Set(), sourceClasses: new Set(),
      providerFamilies: new Set(), attemptedAt: null,
    });
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
function addCite(url, label, category, tier, providerFamily, retrievedAt) {
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
  // refinement #12: ledger inputs harvested from the SAME authoritative citation —
  // provider_family is the pairing's provider (genuine: which model family this source was
  // cited for); attempted_at is the citation's retrieved_at (the moment it was fetched). Both
  // are real audit data; neither is fabricated.
  if (providerFamily) e.providerFamilies.add(providerFamily);
  if (retrievedAt && !e.attemptedAt) e.attemptedAt = retrievedAt;
}
for (const branch of ["performance", "cost_efficiency"]) {
  const b = audit[branch] || {};
  for (const category of Object.keys(b)) {
    for (const pairing of b[category] || []) {
      for (const c of pairing.citations || []) {
        addCite(c.url, c.label, category, c.tier, pairing.provider, c.retrieved_at);
      }
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
// refinement #12: benchmarkOf[normUrl] = Set of benchmark NAMES this url anchored — the
// normalization_sources rows carry a real `benchmark` field, so this is genuine structured data
// (NOT scraped from prose). It populates BOTH seed.sites[].benchmarks (task 3) and the ledger's
// benchmark_names (task 1). Built here, applied in the merge below.
const benchmarkOf = new Map();
for (const a of audit.metadata?.normalization_sources || []) {
  const n = normalizeUrl(a.url);
  if (!n) continue; // skip anchor rows with no usable source url
  const e = getEntry(n);
  // refinement #7: keep the strongest (highest numeric) tier — same rule as pairing citations.
  e.tier = mergeTier(e.tier, Number(a.tier));
  if (a.category) e.categories.add(a.category);
  e.sourceClasses.add("scale_anchor");
  if (a.benchmark) {
    e.benchmarks.add(a.benchmark); // task 3: populate seed benchmarks from the real field
    if (!benchmarkOf.has(n)) benchmarkOf.set(n, new Set());
    benchmarkOf.get(n).add(a.benchmark);
  }
}

// refinement #12: rejectionOf[normUrl] = ordered list of rejection_reason strings for any
// benchmark this url anchored that the builder later NEUTRALIZED (thin-population down-weight,
// etc.). neutralized_benchmarks carries {benchmark, reason} but no url; we re-key it through the
// benchmark->url map above. A url with no neutralized benchmark gets rejection_reason: null (a
// HONEST "no rejection recorded", not a fabricated reason). last_checked / http_status are NOT
// derivable offline -> always null (we never invent a status code or a probe time).
const urlsByBenchmark = new Map();
for (const [n, bms] of benchmarkOf) {
  for (const bm of bms) {
    if (!urlsByBenchmark.has(bm)) urlsByBenchmark.set(bm, new Set());
    urlsByBenchmark.get(bm).add(n);
  }
}
const rejectionOf = new Map();
for (const nb of audit.metadata?.neutralized_benchmarks || []) {
  const urls = urlsByBenchmark.get(nb.benchmark);
  if (!urls) continue; // neutralized benchmark not anchored by any harvested url -> not attributable
  for (const n of urls) {
    if (!rejectionOf.has(n)) rejectionOf.set(n, []);
    rejectionOf.get(n).push({ benchmark: nb.benchmark, reason: nb.reason || "unknown" });
  }
}

// ---- optional ephemeral source dump (may add sources + structured benchmarks) -----
if (process.env.SEED_SOURCES_PATH && existsSync(process.env.SEED_SOURCES_PATH)) {
  const extra = JSON.parse(readFileSync(process.env.SEED_SOURCES_PATH, "utf8"));
  for (const s of Array.isArray(extra) ? extra : extra.sources || []) {
    const n = normalizeUrl(s.url);
    if (!n) continue;
    const e = getEntry(n); // refinement #12: use the canonical factory so ledger fields exist
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

// refinement #12: build the per-site attempt-ledger record for THIS run's harvest of `url`.
// Every field is either real audit data or an explicit null/"unknown" — nothing is fabricated.
// The ledger is REFRESHED each run (it describes the most-recent harvest attempt); the seed body
// around it still accumulates-forever. NULL-FOR-NOW fields: http_status and last_checked are not
// derivable from an offline audit (we never probe URLs), so they are always null here.
function buildLedger(url, h) {
  const provFams = sortUniq([...h.providerFamilies]);
  const srcClasses = sortUniq([...h.sourceClasses]);
  const bmNames = sortUniq([...(benchmarkOf.get(url) || [])]);
  const rejections = rejectionOf.get(url) || [];
  return {
    attempted_at: h.attemptedAt || null,          // genuine: citation retrieved_at, else null
    outcome: "harvested",                          // genuine: it was admitted into the seed this run
    provider_family: provFams.length ? provFams : null, // genuine: families this url was cited for
    categories: sortUniq([...h.categories]),       // genuine: same as the site's categories
    source_class: srcClasses.length ? srcClasses : null, // genuine: how it was harvested
    benchmark_names: bmNames,                      // genuine: from normalization_sources.benchmark
    rejection_reason: rejections.length ? rejections : null, // genuine where a bench was neutralized
    http_status: null,                             // NULL-FOR-NOW: no offline probe
    last_checked: null,                            // NULL-FOR-NOW: no offline probe
  };
}

for (const [url, h] of harvested) {
  const cur = byUrl.get(url);
  // refinement #8: source_classes accumulates how each url was harvested ("pairing_citation"
  // and/or "scale_anchor") — accumulate-forever, never narrowed on re-run.
  const harvestedClasses = sortUniq([...h.sourceClasses]);
  const ledger = buildLedger(url, h); // refinement #12
  if (!cur) {
    byUrl.set(url, {
      url, domain: hostOf(url), tier: h.tier,
      categories: sortUniq([...h.categories]),
      benchmarks: sortUniq([...h.benchmarks]),
      ...(harvestedClasses.length ? { source_classes: harvestedClasses } : {}),
      first_seen: RUN_DATE, last_seen: RUN_DATE, times_seen: 1,
      attempt_ledger: ledger, // refinement #12
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
    cur.attempt_ledger = ledger; // refinement #12: refresh to THIS run's attempt snapshot
  }
}

// ---- refinement #12: SELECTION policy — SEPARATE from storage, demote-without-delete ----------
// Storage above keeps EVERYTHING forever (never narrowed, never TTL'd). This pass adds a `selection`
// ANNOTATION to each site so a downstream consumer can prefer a balanced, de-skewed working set
// WITHOUT the seed ever dropping a row. Health is computed fresh each run from the current corpus;
// a demoted flag is a soft signal, NEVER a delete. NO TTL anywhere (the seed is accumulate-forever).
const SELECTION_POLICY = {
  // per-category minimum #sites we want covered before any over-cap demotion may bite (floor).
  category_min: 2,
  // per-provider-family minimum #sites cited for that family before its sites may be demoted (floor).
  provider_min: 2,
  // source-class cap: at most this many sites per (category, source_class) are "selected"; the
  // rest are DEMOTED (over-cap) — kept in storage, just flagged so the working set is not skewed by
  // one over-represented (category, source_class) bucket. Tuned high enough not to fire on the lean
  // current corpus (warn-not-fail spirit: a real over-skew trips it; a thin seed stays all-healthy).
  source_class_cap: 8,
};
{
  const allSites = [...byUrl.values()];
  // Count coverage so floors can protect the last/scarce sources for a category or provider family.
  const catCount = new Map();
  const provCount = new Map();
  for (const s of allSites) {
    for (const c of s.categories || []) catCount.set(c, (catCount.get(c) || 0) + 1);
    const fams = (s.attempt_ledger && s.attempt_ledger.provider_family) || [];
    for (const f of fams) provCount.set(f, (provCount.get(f) || 0) + 1);
  }
  // Bucket sites by (category, source_class); demote the weakest over the cap, never the scarce.
  const bucket = new Map(); // key -> [site,...]
  for (const s of allSites) {
    const classes = s.source_classes || [];
    for (const cat of s.categories || []) {
      for (const sc of classes) {
        const key = `${cat} ${sc}`;
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push(s);
      }
    }
  }
  const overCap = new Set(); // urls flagged over-cap by at least one bucket
  for (const [, arr] of bucket) {
    if (arr.length <= SELECTION_POLICY.source_class_cap) continue;
    // weakest first: lower tier, then fewer times_seen, then url for determinism.
    const ranked = [...arr].sort((a, b) =>
      (a.tier || 0) - (b.tier || 0) || (a.times_seen || 0) - (b.times_seen || 0) ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    for (let i = 0; i < ranked.length - SELECTION_POLICY.source_class_cap; i++) overCap.add(ranked[i].url);
  }
  for (const s of allSites) {
    const reasons = [];
    // low-health: tier 0 == unknown/unparsed provenance (weakest possible standing).
    const lowHealth = (s.tier || 0) === 0;
    if (lowHealth) reasons.push("low_health_tier0");
    if (overCap.has(s.url)) reasons.push("over_source_class_cap");
    // FLOOR PROTECTION: never demote a site if doing so would starve a category below category_min
    // or a provider family below provider_min — the floors win over caps (demote-without-delete must
    // not erase scarce coverage even from the WORKING set).
    const protectsCategory = (s.categories || []).some((c) => (catCount.get(c) || 0) <= SELECTION_POLICY.category_min);
    const fams = (s.attempt_ledger && s.attempt_ledger.provider_family) || [];
    const protectsProvider = fams.some((f) => (provCount.get(f) || 0) <= SELECTION_POLICY.provider_min);
    const floorProtected = protectsCategory || protectsProvider;
    const demoted = reasons.length > 0 && !floorProtected;
    s.selection = {
      demoted,
      health: demoted ? "demoted" : "healthy",
      demote_reasons: demoted ? sortUniq(reasons) : [],
      ...(floorProtected && reasons.length ? { floor_protected: true } : {}),
    };
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
