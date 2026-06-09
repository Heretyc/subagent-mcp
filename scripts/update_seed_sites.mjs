// update_seed_sites.mjs — deterministic accumulating merge of research source URLs into
// research-seed-sites.json (the 3rd persisted artifact). Pure code, no model judgment.
// Source of truth = src/routing-table-audit.json citations (per-category nesting gives `categories`,
// the citation's numeric `tier` field gives `tier` — refinement #7; a provenance label such as
// [SEED]/[INFERRED]/[ASSUMPTION] used to MASK the [Tn] tier and forced every site to tier 0).
// Optional SEED_SOURCES_PATH may add sources + structured benchmarks.
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_PATH = resolve(ROOT, "src/routing-table-audit.json");
const SEED_PATH = resolve(ROOT, "research-seed-sites.json");
// refinement #21: DATASET_DATE is REQUIRED — fail loud rather than defaulting to a stale literal
// date. A silent default mis-stamps the run and decoupled this stamp from the builder's; the regen
// always sets DATASET_DATE, so this only bites an un-pinned invocation.
const RUN_DATE = process.env.DATASET_DATE;
if (!RUN_DATE) {
  throw new Error(
    "DATASET_DATE is required (YYYY-MM-DD) — refusing to default to a stale literal date. " +
    "Set DATASET_DATE to the run's dataset date so the seed and audit share one run stamp."
  );
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(RUN_DATE)) {
  throw new Error(`DATASET_DATE must be YYYY-MM-DD; got '${RUN_DATE}'`);
}
if (!existsSync(AUDIT_PATH)) {
  throw new Error(`Audit not found at ${AUDIT_PATH}; run build_routing_table.mjs first.`);
}

// refinement #21: bind to the SAME run-id the builder used. Resolution mirrors build_routing_table:
//   1. process.env.RUN_ID            — explicit override.
//   2. <tmpdir>/model-profiler/run-id — the file the builder wrote this run (authoritative link).
//   3. deterministic default `run-${RUN_DATE}` — same value both scripts derive offline.
// Preferring the builder's run-id file ties the seed to the exact run that produced the audit it is
// harvesting; the deterministic default keeps both scripts in lockstep when no file is present.
const RUN_ID_PATH = resolve(tmpdir(), "model-profiler", "run-id");
function resolveRunId() {
  if (process.env.RUN_ID) return process.env.RUN_ID;
  if (existsSync(RUN_ID_PATH)) {
    const fromFile = readFileSync(RUN_ID_PATH, "utf8").replace(/^﻿/, "").trim();
    if (fromFile) return fromFile;
  }
  return `run-${RUN_DATE}`;
}
const RUN_ID = resolveRunId();

// #20: expanded tracking-param strip list (ref/via/_bhlid/rd added).
// Redirect resolution is an online-only step; results would be cached in ledger — deferred.
const TRACKING = new Set(["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","ref","via","_bhlid","rd"]);
function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  let u;
  try { u = new URL(raw.trim()); } catch { return ""; }
  // Seed registry holds EXTERNAL web sources only. Reject non-http(s) URLs (e.g.
  // file://, skill://) — they carry no real domain and are internal/audit-only
  // provenance (e.g. owner-directive [ASSUMPTION] rows cite file://...consent.md).
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
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
// #17: attempt_ledger is append-only; runs ring capped to last N; accumulated counters never shrink.
const LEDGER_RING_CAP = 10;

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

// #17: attempt_ledger is append-only: a bounded runs ring + accumulated-forever counters.
// buildRunRecord builds the per-run snapshot for THIS run. buildAccumulated initialises
// counters from a set of run records (used only for migration from old flat format).
// appendToLedger migrates old flat format, appends the new record, caps the ring, and
// increments accumulated counters — counters never shrink even as old runs roll off the ring.
function buildRunRecord(url, h) {
  const provFams = sortUniq([...h.providerFamilies]);
  const srcClasses = sortUniq([...h.sourceClasses]);
  const bmNames = sortUniq([...(benchmarkOf.get(url) || [])]);
  const rejections = rejectionOf.get(url) || [];
  return {
    run_id: RUN_ID,
    attempted_at: h.attemptedAt || null,
    outcome: "harvested",
    provider_family: provFams.length ? provFams : null,
    categories: sortUniq([...h.categories]),
    source_class: srcClasses.length ? srcClasses : null,
    benchmark_names: bmNames,
    rejection_reason: rejections.length ? rejections : null,
    http_status: null,
    last_checked: null,
  };
}
function buildAccumulated(runs) {
  const pfc = {}, cc = {};
  for (const r of runs) {
    for (const pf of r.provider_family || []) pfc[pf] = (pfc[pf] || 0) + 1;
    for (const cat of r.categories || []) cc[cat] = (cc[cat] || 0) + 1;
  }
  return { provider_family_counts: pfc, category_counts: cc, total_runs: runs.length };
}
// newRecord may be null for a migration-only call (existing site not cited this run).
function appendToLedger(existing, newRecord) {
  let runs, accumulated;
  if (existing && Array.isArray(existing.runs)) {
    // inject run_id sentinel into any legacy run records that lack it
    runs = existing.runs.map((r) =>
      ("run_id" in r) ? r : { run_id: "pre-#17-legacy", ...r }
    );
    accumulated = existing.accumulated
      ? { ...existing.accumulated,
          provider_family_counts: { ...(existing.accumulated.provider_family_counts || {}) },
          category_counts: { ...(existing.accumulated.category_counts || {}) } }
      : buildAccumulated(runs);
  } else if (existing && typeof existing === "object" && existing.attempted_at !== undefined) {
    // migrate old flat-object format: inject run_id sentinel if absent
    const migrated = "run_id" in existing ? existing : { run_id: "pre-#17-legacy", ...existing };
    runs = [migrated];
    accumulated = buildAccumulated(runs);
  } else {
    runs = [];
    accumulated = { provider_family_counts: {}, category_counts: {}, total_runs: 0 };
  }
  if (!newRecord) return { runs, accumulated }; // migration-only: shape fix, no new run
  runs.push(newRecord);
  if (runs.length > LEDGER_RING_CAP) runs = runs.slice(runs.length - LEDGER_RING_CAP);
  for (const pf of newRecord.provider_family || []) {
    accumulated.provider_family_counts[pf] = (accumulated.provider_family_counts[pf] || 0) + 1;
  }
  for (const cat of newRecord.categories || []) {
    accumulated.category_counts[cat] = (accumulated.category_counts[cat] || 0) + 1;
  }
  accumulated.total_runs = (accumulated.total_runs || 0) + 1;
  return { runs, accumulated };
}

for (const [url, h] of harvested) {
  const cur = byUrl.get(url);
  // refinement #8: source_classes accumulates how each url was harvested ("pairing_citation"
  // and/or "scale_anchor") — accumulate-forever, never narrowed on re-run.
  const harvestedClasses = sortUniq([...h.sourceClasses]);
  const runRecord = buildRunRecord(url, h); // #17: per-run snapshot
  if (!cur) {
    byUrl.set(url, {
      url, domain: hostOf(url), tier: h.tier,
      categories: sortUniq([...h.categories]),
      benchmarks: sortUniq([...h.benchmarks]),
      ...(harvestedClasses.length ? { source_classes: harvestedClasses } : {}),
      first_seen: RUN_DATE, last_seen: RUN_DATE, times_seen: 1,
      attempt_ledger: appendToLedger(null, runRecord), // #17: ring from first run
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
    cur.attempt_ledger = appendToLedger(cur.attempt_ledger, runRecord); // #17: append + cap + accumulate
  }
}

// #17: migrate any existing seed sites that still carry the old flat attempt_ledger format,
// or have a partial ring (runs array present but individual records lack run_id).
// Happens to sites not cited in THIS run's audit (harvest loop never touched them).
for (const s of byUrl.values()) {
  if (!s.attempt_ledger) continue;
  if (!Array.isArray(s.attempt_ledger.runs)) {
    // old flat format: full migration via appendToLedger (migration-only: newRecord=null)
    s.attempt_ledger = appendToLedger(s.attempt_ledger, null);
  } else {
    // partial ring: inject run_id sentinel into any legacy run records that lack it
    const needsInjection = s.attempt_ledger.runs.some((r) => !("run_id" in r));
    if (needsInjection) {
      s.attempt_ledger = {
        ...s.attempt_ledger,
        runs: s.attempt_ledger.runs.map((r) =>
          ("run_id" in r) ? r : { run_id: "pre-#17-legacy", ...r }
        ),
      };
    }
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
  // one over-represented (category, source_class) bucket. (#3 fix: cap=3 per owner, down from 8.)
  source_class_cap: 3,
};
{
  const allSites = [...byUrl.values()];
  // Count coverage so floors can protect the last/scarce sources for a category or provider family.
  const catCount = new Map();
  const provCount = new Map();
  for (const s of allSites) {
    for (const c of s.categories || []) catCount.set(c, (catCount.get(c) || 0) + 1);
    const fams = Object.keys((s.attempt_ledger && s.attempt_ledger.accumulated && s.attempt_ledger.accumulated.provider_family_counts) || {});
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
    const fams = Object.keys((s.attempt_ledger && s.attempt_ledger.accumulated && s.attempt_ledger.accumulated.provider_family_counts) || {});
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

// #3d corpus-skew report: per-tier, per-domain, per-provider-family distribution.
// Diagnostic only — never a gate. Helps surface citation-cartel skew from audit citations.
function buildCorpusSkew(allSites) {
  const byTier = {};
  const byDomain = {};
  const byProviderFamily = {};
  for (const s of allSites) {
    const t = String(s.tier || 0);
    byTier[t] = (byTier[t] || 0) + 1;
    const d = s.domain || "";
    if (d) byDomain[d] = (byDomain[d] || 0) + 1;
    const fams = Object.keys((s.attempt_ledger && s.attempt_ledger.accumulated && s.attempt_ledger.accumulated.provider_family_counts) || {});
    for (const f of fams) byProviderFamily[f] = (byProviderFamily[f] || 0) + 1;
  }
  const demoted = allSites.filter((s) => s.selection && s.selection.demoted).length;
  return { by_tier: byTier, by_domain: byDomain, by_provider_family: byProviderFamily, demoted_count: demoted };
}
const CORPUS_SKEW = buildCorpusSkew(sites);

const out = {
  metadata: {
    author: "Lexi Blackburn",
    author_url: "https://github.com/Heretyc/",
    schema_version: "1",
    generated: RUN_DATE.slice(0, 7),
    last_run_at: process.env.BUILD_TS || `${RUN_DATE}T00:00:00Z`,
    // refinement #21: the SHARED run-id this seed was merged under — equals
    // audit.metadata.run_manifest.run_id, so the seed and audit are provably from one run.
    run_id: RUN_ID,
    site_count: sites.length,
    // #3d corpus-skew report (diagnostic, not a gate)
    corpus_skew: CORPUS_SKEW,
  },
  sites,
};
// #25 atomic: stage to .tmp, validate parses, rename to final.
const seedJson = JSON.stringify(out, null, 2) + "\n";
const STAGE_SEED = SEED_PATH + ".tmp";
writeFileSync(STAGE_SEED, seedJson, "utf8");
JSON.parse(seedJson); // staged shape sanity
renameSync(STAGE_SEED, SEED_PATH);
console.log(`update_seed_sites: research-seed-sites.json now has ${sites.length} sites (run ${RUN_DATE}, run_id ${RUN_ID}).`);
