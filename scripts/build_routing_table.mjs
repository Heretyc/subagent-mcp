// build_routing_table.mjs — Deterministic routing-table builder.
//
// Authority: giga-research/2026-06-03-profiling/builder-design.md (authoritative),
// skills/model-profiler/references/tier-ranking-and-scoring.md (SOP form),
// .spec/references/cost-model.md (rates). Reads the structured dataset, encodes the
// SOP constants/formula, and emits:
//   - src/routing-table.json                         (validate_provider.mjs shape)
//   - .spec/references/assets/routing-table.json     (NOT touched — frozen spine source)
//   - .spec/references/assets/routing-table-audit.json (NOT touched — frozen KB manifest)
//   - src/routing-table-audit.json                   (populated audit + per-pairing citations)
//
// DETERMINISM: stable sort with explicit tie-breakers; no wall-clock / RNG in ranking.
// Timestamps come from env (BUILD_TS / RETRIEVED_AT) or the dataset date '2026-06-03'.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DATASET_PATH = resolve(ROOT, "giga-research/2026-06-03-profiling/structured-dataset.json");
const SPINE_PATH = resolve(ROOT, ".spec/references/assets/routing-table.json");
const OUT_PROVIDER = resolve(ROOT, "src/routing-table.json");
const OUT_AUDIT = resolve(ROOT, "src/routing-table-audit.json");

// ---- fixed values (no wall-clock) -------------------------------------------------
const DATASET_DATE = "2026-06-03";
const GENERATED_MONTH = "2026-06"; // metadata.generated (YYYY-MM)
const GENERATED_AT = process.env.BUILD_TS || `${DATASET_DATE}T00:00:00Z`; // ISO8601
const DEFAULT_RETRIEVED_AT = process.env.RETRIEVED_AT || `${DATASET_DATE}T00:00:00Z`;

// ---- SOP / cost constants (cost-model.md §1/§3/§4) --------------------------------
const COST_BLEND = { input_tokens: 100000, output_tokens: 20000 }; // cost-model.md §4
const VISIBLE_OUT_TOK = 20000;
const INPUT_TOK = 100000;
// Effort hidden-output multiplier ladder (cost-model.md §4 / tier-ranking §B).
const HIDDEN_MULT = {
  none: 0,
  null: 0, // null == none == 0x (haiku / pro / mini fixed-low)
  min: 0.1, // nearest-lower documented tier -> low
  light: 0.1,
  low: 0.1,
  medium: 0.25,
  high: 0.75,
  xhigh: 1.5,
  max: 2.5,
  pro: 2.5, // off-ladder -> nearest-lower documented (max)
  ultracode: 2.5,
};
// Efforts that required an [ASSUMPTION] nearest-lower-tier resolution (label on basis).
const ASSUMED_EFFORTS = new Set(["null", "min", "light", "pro", "ultracode"]);
// Tokenizer inflation: 1.35x worst-case (SOP-2) for opus 4-7/4-8; 1.4x DEPRECATED.
const DEPRECATED_INFLATION = 1.4;
const OPUS_INFLATION = 1.35;

// validator effort ladder (weakest -> strongest); index used for tie-breaks.
const EFFORT_LADDER = [
  "null",
  "none",
  "min",
  "light",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "pro",
  "ultracode",
];
const EFFORT_INDEX = new Map(EFFORT_LADDER.map((e, i) => [e, i]));

// Lower-is-better benchmarks (invert during normalization). Dataset gives no polarity
// flag; per design these two bug/false-report density benchmarks are lower-is-better.
function isLowerBetter(benchmark) {
  const b = benchmark.toLowerCase();
  return (
    b.includes("bug density") ||
    b.includes("bug-density") ||
    b.includes("vulnerability density") ||
    b.includes("concurrency/threading bug") ||
    b.includes("false-number") ||
    b.includes("false number") ||
    b.includes("failed to raise")
  );
}

const SENTIMENT_CAP = 0.05; // < min benchmark weight (1.0); design §1.4
const SENTIMENT_ADJ = 0; // no free-text corpus -> 0 for every pairing
const NORMALIZATION = { method: "min-max", params: { clamp: [0, 1], empty_population: 1 } };

// ---- IO helpers -------------------------------------------------------------------
function readJsonStripBom(path) {
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
  return JSON.parse(raw);
}

function effortKey(effort) {
  return effort === null ? "null" : String(effort);
}

// Universe pairing id used in metadata.model_effort_universe and pairing keys.
function pairingId(model, effortK) {
  return `${model}@${effortK}`;
}

// ---- load -------------------------------------------------------------------------
const dataset = readJsonStripBom(DATASET_PATH);
const spineRoot = readJsonStripBom(SPINE_PATH);
// Post taxonomy-freeze, the provider routing-table spine is the canonical 10 categories
// recorded in the machine-mirror `categories` object (== classification_precedence,
// ordered math_proof…mechanical). `fallback_default` is the precedence sentinel only and
// is NOT a branch category in the provider table (matches validate_provider buildSpine).
const SPINE = Object.keys(spineRoot.categories); // 10 keys

const MODELS = dataset.models;
const UNIVERSE_MODELS = new Set(Object.keys(MODELS));

// Normalize dataset universe ("@n/a" -> "@null") into the canonical pairing list.
const UNIVERSE = dataset.model_effort_universe.map((entry) => {
  const at = entry.lastIndexOf("@");
  const model = entry.slice(0, at);
  const rawEffort = entry.slice(at + 1);
  const effort = rawEffort === "n/a" ? null : rawEffort;
  const effortK = effortKey(effort);
  return { id: pairingId(model, effortK), model, effort, effortK };
});
const UNIVERSE_IDS = UNIVERSE.map((p) => p.id);

// withdrawn (model+category+benchmark) — discard those rows entirely (SOP-3).
const WITHDRAWN = new Set(
  dataset.withdrawn.map((w) => `${w.model}|${w.category}|${(w.benchmark || "").toLowerCase()}`)
);
function isWithdrawn(category, row) {
  return WITHDRAWN.has(`${row.model}|${category}|${(row.benchmark || "").toLowerCase()}`);
}

// ---- cost figure (SOP-2 worst-case $/token) ---------------------------------------
// cost = (in_rate*0.1 + out_rate*(0.02 + 0.02*hidden_mult)) * tok_inflation  [per MTok]
// then /1e6 -> $/token. 0.1 = 100K/1M input; 0.02 = 20K/1M visible-out; hidden-out =
// 20K*hidden_mult billed at output rate.
function costFigureUsed(model, effortK) {
  const spec = MODELS[model];
  const cliff = spec.pricing.cliff;
  // 100K-in blend is provably sub-cliff (cliff threshold 272K) -> base rates ("below").
  const inRate = spec.pricing.input_per_mtok;
  const outRate = spec.pricing.output_per_mtok;
  const hiddenMult = HIDDEN_MULT[effortK];
  const tokInflation = spec.tokenizer_inflation ? OPUS_INFLATION : 1.0;
  const inputFrac = INPUT_TOK / 1e6; // 0.1
  const visibleOutFrac = VISIBLE_OUT_TOK / 1e6; // 0.02
  const hiddenOutFrac = visibleOutFrac * hiddenMult;
  const perMTok = (inRate * inputFrac + outRate * (visibleOutFrac + hiddenOutFrac)) * tokInflation;
  const perToken = perMTok / 1e6;
  const cliffSide = cliff ? "below" : "n/a"; // 100K blend certainly sub-cliff
  return { perToken, cliffSide, inRate, outRate, hiddenMult, tokInflation, hasCliff: Boolean(cliff) };
}

const COST = new Map(); // pairingId -> cost detail
for (const p of UNIVERSE) {
  COST.set(p.id, costFigureUsed(p.model, p.effortK));
}
// Aggregate cliff side for metadata: "below" if any member has a cliff (all sub-cliff), else "n/a".
const PRICE_CLIFF_SIDE = [...COST.values()].some((c) => c.hasCliff) ? "below" : "n/a";

// ---- per-category composite scoring (design §1) -----------------------------------
// For each category, build per-benchmark normalization population from ALL rows
// (universe + competitor, non-withdrawn). Then compute composite per universe pairing.
//
// Row selection for a universe pairing P=model@effortK: rows where row.model==P.model
// AND (row.effort==P.effort  OR  row.effort=="any").

function buildCategoryScores(category) {
  const rows = (dataset.category_benchmarks[category] || []).filter((r) => !isWithdrawn(category, r));
  // Per-benchmark min/max over ALL non-withdrawn rows (anchors the scale).
  const stats = new Map(); // benchmark -> {min,max}
  for (const r of rows) {
    const b = r.benchmark;
    const s = stats.get(b) || { min: Infinity, max: -Infinity };
    if (r.raw < s.min) s.min = r.raw;
    if (r.raw > s.max) s.max = r.raw;
    stats.set(b, s);
  }
  function normalize(benchmark, raw) {
    const s = stats.get(benchmark);
    let n;
    if (s.max === s.min) n = 1;
    else n = (raw - s.min) / (s.max - s.min);
    if (isLowerBetter(benchmark)) n = 1 - n;
    return n;
  }

  // Build composite + provenance for each universe pairing.
  const result = new Map(); // pairingId -> {score, rows:[selectedRows], confidence, tierFloor, basis:Set}
  for (const p of UNIVERSE) {
    const selected = rows.filter((r) => {
      if (r.model !== p.model) return false;
      const re = effortKey(r.effort);
      return re === p.effortK || re === "any";
    });
    if (selected.length === 0) {
      result.set(p.id, { score: null, rows: [], confidence: "low", basis: new Set(), tierFloor: null });
      continue;
    }
    // Group normalized values by benchmark; mean within benchmark, then equal-weight mean across.
    const byBench = new Map();
    for (const r of selected) {
      const n = normalize(r.benchmark, r.raw);
      const arr = byBench.get(r.benchmark) || [];
      arr.push(n);
      byBench.set(r.benchmark, arr);
    }
    let sumW = 0;
    let sumWV = 0;
    for (const [, vals] of byBench) {
      const meanN = vals.reduce((a, b) => a + b, 0) / vals.length;
      const w = 1.0; // equal weight per benchmark (design §1.3)
      sumW += w;
      sumWV += w * meanN;
    }
    const composite = sumW > 0 ? sumWV / sumW : 0;
    const performanceRaw = composite + SENTIMENT_ADJ; // sentiment_adjustment = 0

    // Confidence (design §1): measured if >=1 exact-effort non-thin row; high if
    // exact-effort thin OR any-effort non-thin; medium if only any-effort thin.
    const hasExact = selected.some((r) => effortKey(r.effort) === p.effortK);
    const nonThin = selected.some((r) => Number(r.tier) >= 2 && Number(r.tier) <= 3);
    let confidence;
    if (hasExact && nonThin) confidence = "measured";
    else if ((hasExact && !nonThin) || (!hasExact && nonThin)) confidence = "high";
    else confidence = "medium";

    const tierFloor = Math.min(...selected.map((r) => Number(r.tier)).filter((t) => Number.isFinite(t)));
    result.set(p.id, {
      score: performanceRaw,
      rows: selected,
      confidence,
      tierFloor: Number.isFinite(tierFloor) ? tierFloor : null,
      basis: new Set(selected.map((r) => r.label).filter(Boolean)),
    });
  }
  return result;
}

// ---- §A effort-interpolation (design §A; same-model, upward only) ------------------
// Distinct from SOP-1: §A fills a missing *higher effort* of a model that IS listed in C
// (has >=1 measured effort) from its nearest measured *lower* effort. Upward only — a
// lower effort with no measured lower-effort anchor stays null (-> data-free sentinel),
// since we cannot infer low-effort performance from high-effort data. This also satisfies
// validator rule 6 (a higher-effort gap above a measured lower effort would otherwise sit
// below it as a sentinel). Runs BEFORE SOP-1, so a genuinely absent version stays null.
function applyEffortInterpolation(scores) {
  const byModel = new Map();
  for (const p of UNIVERSE) {
    const arr = byModel.get(p.model) || [];
    arr.push(p);
    byModel.set(p.model, arr);
  }
  for (const [, members] of byModel) {
    const ordered = [...members].sort(
      (a, b) => (EFFORT_INDEX.get(a.effortK) ?? 0) - (EFFORT_INDEX.get(b.effortK) ?? 0)
    );
    let anchor = null; // nearest measured lower-effort {id, detail} for this model
    for (const p of ordered) {
      const s = scores.get(p.id);
      if (s.score !== null) {
        anchor = { id: p.id, detail: s };
        continue;
      }
      if (!anchor) continue; // no measured lower effort -> leave null (sentinel)
      scores.set(p.id, {
        score: anchor.detail.score,
        rows: anchor.detail.rows,
        confidence: "low",
        tierFloor: anchor.detail.tierFloor,
        basis: new Set([...anchor.detail.basis, `effort-interpolation(§A) from ${anchor.id}`]),
        interpolated: true,
      });
    }
  }
  return scores;
}

// ---- SOP-1 version-promotion (design §3) ------------------------------------------
// Lineages with >=2 universe members and a strict version_rank order: opus (4-7 rank47,
// 4-8 rank48). gpt-5.5 / gpt-5.5-pro share rank 55 -> NOT a chain. Others singletons.
// SOP-1 fills a WHOLE missing version: it fires only when the newer version V_new has NO
// measured score at ANY effort in C (a present-but-partial version is handled by §A, not
// here — cross-version filling of a single effort is not sanctioned by SOP-1). Each effort
// of V_new inherits its SAME-EFFORT predecessor V_old@E (so the splice in rankBranch can
// place V_new@E exactly one rank above V_old@E). `promotedFrom` records that same-effort
// predecessor id. GUARD: no strictly-older LISTED version -> no insert (data-free sentinel).
function applyVersionPromotion(category, scores) {
  // group universe pairings by lineage
  const byLineage = new Map();
  for (const p of UNIVERSE) {
    const lin = MODELS[p.model].version_lineage;
    const arr = byLineage.get(lin) || [];
    arr.push(p);
    byLineage.set(lin, arr);
  }
  const isListed = (model) =>
    UNIVERSE.some((p) => p.model === model && scores.get(p.id).score !== null);
  for (const [, members] of byLineage) {
    const distinctModels = [...new Set(members.map((m) => m.model))];
    if (distinctModels.length < 2) continue;
    for (const model of distinctModels) {
      const modelPairings = members.filter((m) => m.model === model);
      // SOP-1 gate: only a WHOLE absent version is version-promoted.
      const fullyAbsent = modelPairings.every((m) => scores.get(m.id).score === null);
      if (!fullyAbsent) continue;
      const myRank = MODELS[model].version_rank;
      // nearest strictly-older LISTED predecessor (highest rank below mine that has a score)
      const vOld = distinctModels
        .filter((m) => MODELS[m].version_rank < myRank && isListed(m))
        .sort((a, b) => MODELS[b].version_rank - MODELS[a].version_rank)[0];
      if (!vOld) continue; // GUARD: no older listed version -> falls to sentinel
      for (const p of modelPairings) {
        const predId = pairingId(vOld, p.effortK); // same-effort predecessor (splice target)
        const predScore = scores.get(predId);
        const donor =
          predScore && predScore.score !== null
            ? { id: predId, detail: predScore }
            : bestScoredOfModel(vOld, scores); // fallback if predecessor's same effort is null
        if (!donor) continue;
        scores.set(p.id, {
          score: donor.detail.score,
          rows: donor.detail.rows,
          confidence: "low",
          tierFloor: donor.detail.tierFloor,
          basis: new Set([...donor.detail.basis, `version-promotion(SOP-1) from ${predId}`]),
          interpolated: true,
          versionPromoted: true,
          promotedFrom: predId, // always the SAME-EFFORT predecessor, for the positional splice
        });
      }
    }
  }
  return scores;
}

function bestScoredOfModel(model, scores) {
  let best = null;
  for (const p of UNIVERSE) {
    if (p.model !== model) continue;
    const s = scores.get(p.id);
    if (s && s.score !== null) {
      if (!best || s.score > best.detail.score) best = { id: p.id, detail: s };
    }
  }
  return best;
}

// Validator rule 6: an interpolated higher-effort pairing must not score below a
// lower-effort variant of the SAME model. A promoted/interpolated low effort can inherit
// a high predecessor score that would sit above a measured higher effort. Repair
// deterministically: walk each model's efforts low->high; clamp any INTERPOLATED pairing
// UP to the running max of lower-effort same-model scores so higher effort >= lower
// effort. Measured pairings are never altered (rule 6 only constrains interpolated ones).
function enforceEffortMonotonicity(scores) {
  const byModel = new Map();
  for (const p of UNIVERSE) {
    const arr = byModel.get(p.model) || [];
    arr.push(p);
    byModel.set(p.model, arr);
  }
  for (const [, members] of byModel) {
    const ordered = [...members].sort(
      (a, b) => (EFFORT_INDEX.get(a.effortK) ?? 0) - (EFFORT_INDEX.get(b.effortK) ?? 0)
    );
    let runningMax = -Infinity;
    for (const p of ordered) {
      const s = scores.get(p.id);
      if (s.score === null) continue; // sentinels handled separately
      // SOP-1 version-promoted rows stay pinned to their same-effort predecessor's score so
      // the performance-branch splice keeps them exactly adjacent; never clamp them upward.
      if (s.versionPromoted) {
        runningMax = Math.max(runningMax, s.score);
        continue;
      }
      if (s.interpolated && s.score < runningMax) {
        scores.set(p.id, {
          ...s,
          score: runningMax,
          basis: new Set([
            ...s.basis,
            "effort-monotonicity clamp (rule 6): raised to >= lower-effort same-model score",
          ]),
        });
      }
      runningMax = Math.max(runningMax, scores.get(p.id).score);
    }
  }
  return scores;
}

// ---- build the two branches -------------------------------------------------------
// Performance branch score = the composite (or promoted) performance value.
// Cost-efficiency score = perf^a / cost^b.
const perfScores = new Map(); // category -> Map(pairingId -> detail)
for (const category of SPINE) {
  let scores;
  if (category === "fallback_default") {
    // no benchmarks; every universe pairing is a data-free sentinel
    scores = new Map();
    for (const p of UNIVERSE) {
      scores.set(p.id, { score: null, rows: [], confidence: "low", basis: new Set(), tierFloor: null });
    }
  } else {
    scores = buildCategoryScores(category);
    scores = applyEffortInterpolation(scores); // §A: same-model upward fill (before SOP-1)
    scores = applyVersionPromotion(category, scores); // SOP-1: whole absent version
    scores = enforceEffortMonotonicity(scores);
  }
  perfScores.set(category, scores);
}

function buildPairingObject(category, item, branch, exponents) {
  const { p, s } = item;
  const cost = COST.get(p.id).perToken;
  const interpolated = Boolean(s.interpolated) || s.score === null;
  const confidence = s.score === null ? "low" : s.confidence;

  let branchScore;
  if (branch === "performance") {
    branchScore = item.branchScore;
  } else {
    // cost_efficiency = perf^a / cost^b ; sentinels keep their sentinel ordering via perf=0
    const perf = s.score === null ? 0 : s.score;
    branchScore = Math.pow(Math.max(perf, 0), exponents.a) / Math.pow(cost, exponents.b);
  }

  const basis = [...s.basis];
  // record cost assumptions on basis
  if (ASSUMED_EFFORTS.has(p.effortK)) {
    basis.push(`[ASSUMPTION] effort '${p.effortK}' hidden-mult via nearest-lower documented tier`);
  }
  if (COST.get(p.id).tokInflation === OPUS_INFLATION) {
    basis.push(`[ASSUMPTION] tokenizer_inflation 1.35x worst-case (SOP-2; 1.4x deprecated)`);
  }
  if (s.score === null) basis.push("data-free sentinel (no measured rows; SOP-1 guard-blocked)");
  if (basis.length === 0) basis.push("[UNVERIFIED] vendor-only");

  return {
    model: p.model,
    effort: p.effort,
    rank: 0, // filled after sort positions assigned
    score: branchScore,
    cost_figure_used: cost,
    interpolated,
    confidence,
    basis,
    _detail: s,
  };
}

function buildBranch(branch, exponents) {
  const out = {};
  for (const category of SPINE) {
    const scores = perfScores.get(category);
    const { items } = rankBranch(branch, scores, exponents);
    const arr = items.map((item, idx) => {
      const obj = buildPairingObject(category, item, branch, exponents);
      obj.rank = idx + 1;
      delete obj._detail;
      return obj;
    });
    out[category] = arr;
  }
  return out;
}

// Rank for a given branch using the proper branch score per pairing.
function rankBranch(branch, scores, exponents) {
  const observed = [];
  for (const p of UNIVERSE) {
    const s = scores.get(p.id);
    if (s.score === null) continue;
    if (branch === "performance") observed.push(s.score);
    else observed.push(Math.pow(Math.max(s.score, 0), exponents.a) / Math.pow(COST.get(p.id).perToken, exponents.b));
  }
  const minObs = observed.length ? Math.min(...observed) : 0;
  const SENTINEL = observed.length ? minObs - 1e-6 : 0;

  const items = UNIVERSE.map((p) => {
    const s = scores.get(p.id);
    const hasScore = s.score !== null;
    let branchScore;
    if (!hasScore) branchScore = SENTINEL;
    else if (branch === "performance") branchScore = s.score;
    else branchScore = Math.pow(Math.max(s.score, 0), exponents.a) / Math.pow(COST.get(p.id).perToken, exponents.b);
    return {
      p,
      s,
      hasScore,
      branchScore,
      effIdx: EFFORT_INDEX.get(p.effortK) ?? 0,
      versionRank: MODELS[p.model].version_rank,
      lineage: MODELS[p.model].version_lineage,
    };
  });

  items.sort((a, b) => {
    if (b.branchScore !== a.branchScore) return b.branchScore - a.branchScore;
    if (a.lineage === b.lineage && a.versionRank !== b.versionRank) return b.versionRank - a.versionRank;
    if (a.p.model !== b.p.model) return a.p.model < b.p.model ? -1 : 1;
    if (a.effIdx !== b.effIdx) return a.effIdx - b.effIdx;
    return a.p.id < b.p.id ? -1 : 1;
  });
  // SOP-1 adjacency (FIX): score-tie + generic tie-break does NOT guarantee a promoted
  // version lands exactly one rank above its predecessor (a third model can tie and slip
  // between). Enforce it positionally on the performance branch: splice each version-
  // promoted pairing into the slot immediately ABOVE its same-effort predecessor. The
  // promoted row inherits the predecessor's score, so the formerly-above element (score >=
  // predecessor) keeps the array non-increasing. cost_efficiency keeps pure score order
  // (a pricier newer version is legitimately less cost-efficient than its predecessor).
  if (branch === "performance") spliceVersionPromotions(items);
  return { items, sentinel: SENTINEL };
}

// Positional insert for SOP-1: move each version-promoted item to immediately above its
// same-effort predecessor. Chain oldest->newest (ascending version_rank) so a multi-step
// lineage settles correctly. Re-densified ranks are assigned by the caller (idx + 1).
function spliceVersionPromotions(items) {
  const promos = items
    .filter((it) => it.s && it.s.versionPromoted && it.s.promotedFrom)
    .sort((a, b) => a.versionRank - b.versionRank);
  for (const promo of promos) {
    const from = items.indexOf(promo);
    if (from === -1) continue;
    items.splice(from, 1);
    const predIdx = items.findIndex((it) => it.p.id === promo.s.promotedFrom);
    if (predIdx === -1) {
      items.splice(from, 0, promo); // predecessor absent (shouldn't happen): restore in place
      continue;
    }
    items.splice(predIdx, 0, promo); // immediately ABOVE the predecessor
  }
}

// ---- calibration gate search (design §4/§5) ---------------------------------------
// Find smallest a>b (perf-bias) such that gate passes: k_observed >= k_categories_min
// AND m_observed >= m_rank_churn_min, and cheapest-AND-weakest is never rank-1 in
// cost_efficiency. Deterministic grid (no RNG).
const K_MIN = 3;
const M_MIN = 3;

function computeChurn(performance, costEff) {
  let k = 0;
  let mMax = 0;
  for (const category of SPINE) {
    const perfRank = new Map(performance[category].map((e) => [pairingId(e.model, effortKey(e.effort)), e.rank]));
    const costRank = new Map(costEff[category].map((e) => [pairingId(e.model, effortKey(e.effort)), e.rank]));
    let maxDelta = 0;
    for (const id of UNIVERSE_IDS) {
      if (perfRank.has(id) && costRank.has(id)) {
        maxDelta = Math.max(maxDelta, Math.abs(perfRank.get(id) - costRank.get(id)));
      }
    }
    mMax = Math.max(mMax, maxDelta);
    if (maxDelta >= M_MIN) k += 1;
  }
  return { k, mMax };
}

// Globally cheapest-AND-weakest (validator logic) for the ban check.
function cheapestWeakest(performance) {
  const costs = new Map();
  const perfRanks = new Map();
  for (const id of UNIVERSE_IDS) costs.set(id, COST.get(id).perToken); // shared scalar
  for (const category of SPINE) {
    for (const e of performance[category]) {
      const id = pairingId(e.model, effortKey(e.effort));
      const arr = perfRanks.get(id) || [];
      arr.push(e.rank);
      perfRanks.set(id, arr);
    }
  }
  const avgRanks = [...perfRanks].map(([id, arr]) => [id, arr.reduce((a, b) => a + b, 0) / arr.length]);
  const minCost = Math.min(...[...costs.values()]);
  const maxRank = Math.max(...avgRanks.map(([, v]) => v));
  const eps = 1e-12;
  const cheapest = new Set([...costs].filter(([, v]) => Math.abs(v - minCost) <= eps).map(([id]) => id));
  const weakest = new Set(avgRanks.filter(([, v]) => Math.abs(v - maxRank) <= eps).map(([id]) => id));
  return new Set([...cheapest].filter((id) => weakest.has(id)));
}

function banViolated(costEff, banned) {
  if (banned.size === 0) return false;
  for (const category of SPINE) {
    const top = costEff[category].find((e) => e.rank === 1);
    if (top && banned.has(pairingId(top.model, effortKey(top.effort)))) return true;
  }
  return false;
}

// performance branch is exponent-independent; build it once.
const performance = buildBranchPerf();
function buildBranchPerf() {
  const out = {};
  for (const category of SPINE) {
    const scores = perfScores.get(category);
    const { items } = rankBranch("performance", scores, { a: 1, b: 0 });
    out[category] = items.map((item, idx) => {
      const obj = buildPairingObject(category, item, "performance", { a: 1, b: 0 });
      obj.rank = idx + 1;
      delete obj._detail;
      return obj;
    });
  }
  return out;
}

// Deterministic exponent grid: widen a-b spread until gate passes.
function searchExponents() {
  const grid = [];
  for (let a = 1.0; a <= 3.0 + 1e-9; a += 0.25) {
    for (let b = 0.5; b >= 0.05 - 1e-9; b -= 0.05) {
      if (a > b) grid.push({ a: Number(a.toFixed(4)), b: Number(b.toFixed(4)) });
    }
  }
  // prefer smallest spread first (least-opinionated), then smallest a
  grid.sort((x, y) => x.a - x.b - (y.a - y.b) || x.a - y.a || y.b - x.b);
  for (const exp of grid) {
    const costEff = buildBranch("cost_efficiency", exp);
    const { k, mMax } = computeChurn(performance, costEff);
    const banned = cheapestWeakest(performance);
    const passed = k >= K_MIN && mMax >= M_MIN && !banViolated(costEff, banned);
    if (passed) {
      return { exp, costEff, k, mMax };
    }
  }
  // fall back to widest spread (record failure honestly)
  const exp = grid[grid.length - 1];
  const costEff = buildBranch("cost_efficiency", exp);
  const { k, mMax } = computeChurn(performance, costEff);
  return { exp, costEff, k, mMax, failed: true };
}

const { exp: EXPONENTS, costEff: costEfficiency, k: K_OBS, mMax: M_OBS, failed } = searchExponents();

// ---- citations for audit ----------------------------------------------------------
function citationsFor(detail) {
  const cites = [];
  const seen = new Set();
  for (const r of detail.rows || []) {
    const key = `${r.source_url}|${r.benchmark}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const retrieved = r.retrieved_at
      ? /\d{2}:\d{2}/.test(r.retrieved_at)
        ? r.retrieved_at
        : `${r.retrieved_at}T00:00:00Z`
      : DEFAULT_RETRIEVED_AT;
    const cite = {
      url: r.source_url || "",
      retrieved_at: retrieved,
      annotation: r.annotation || `${r.model} ${r.benchmark} = ${r.raw}${r.unit === "pct" ? "%" : ""}.`,
    };
    if (r.tier) cite.label = r.label || `[T${r.tier}]`;
    if (r.label) cite.source_id = r.label;
    cites.push(cite);
  }
  if (detail.promotedFrom) {
    cites.push({
      url: "",
      retrieved_at: DEFAULT_RETRIEVED_AT,
      annotation: `Score inherited via SOP-1 version-promotion from ${detail.promotedFrom}; predecessor rows cited above.`,
      label: "[SOP-1]",
    });
  }
  if (cites.length === 0) {
    cites.push({
      url: "",
      retrieved_at: DEFAULT_RETRIEVED_AT,
      annotation: "Data-free sentinel: no measured benchmark rows for this pairing in this category.",
      label: "[SENTINEL]",
    });
  }
  return cites;
}

// ---- assemble metadata + outputs --------------------------------------------------
const compositeWeights = {};
for (const category of SPINE) {
  if (category === "fallback_default") {
    compositeWeights[category] = {};
    continue;
  }
  const rows = (dataset.category_benchmarks[category] || []).filter((r) => !isWithdrawn(category, r));
  const benches = [...new Set(rows.map((r) => r.benchmark))].sort();
  const w = {};
  for (const b of benches) w[b] = 1.0; // equal weight
  compositeWeights[category] = w;
}

const metadata = {
  version: "1.0.0",
  schema_version: "1",
  generated: GENERATED_MONTH,
  author: "Lexi Blackburn",
  author_url: "https://github.com/Heretyc/",
  model_effort_universe: UNIVERSE_IDS,
  formula_definitions: {
    normalization: NORMALIZATION,
    composite_weights: compositeWeights,
    sentiment_cap: SENTIMENT_CAP,
    calibrated_exponents: { a: EXPONENTS.a, b: EXPONENTS.b },
  },
  cost_blend: {
    input_tokens: COST_BLEND.input_tokens,
    output_tokens: COST_BLEND.output_tokens,
    price_cliff_side: PRICE_CLIFF_SIDE,
  },
  rag_pointer: ".spec/references/retrieval-map.md",
  calibration_gate: {
    k_categories_min: K_MIN,
    m_rank_churn_min: M_MIN,
    k_observed: K_OBS,
    m_observed: M_OBS,
    passed: K_OBS >= K_MIN && M_OBS >= M_MIN,
  },
};

const providerTable = {
  metadata,
  performance,
  cost_efficiency: costEfficiency,
};

// strip any leftover _detail just in case
function stripInternal(branch) {
  for (const cat of Object.keys(branch)) {
    for (const e of branch[cat]) delete e._detail;
  }
}
stripInternal(providerTable.performance);
stripInternal(providerTable.cost_efficiency);

// ---- audit sibling (populated; src/routing-table-audit.json) ----------------------
function auditBranch(branch) {
  const out = {};
  for (const category of SPINE) {
    out[category] = providerTable[branch][category].map((e) => {
      const scores = perfScores.get(category);
      const detail = scores.get(pairingId(e.model, effortKey(e.effort)));
      return { ...e, citations: citationsFor(detail) };
    });
  }
  return out;
}

const auditTable = {
  metadata: {
    ...metadata,
    audits: "src/routing-table.json",
    generated_at: GENERATED_AT,
    source_ledger_pointer: ".spec/references/source-ledger.md",
  },
  performance: auditBranch("performance"),
  cost_efficiency: auditBranch("cost_efficiency"),
};

// ---- write ------------------------------------------------------------------------
writeFileSync(OUT_PROVIDER, JSON.stringify(providerTable, null, 2) + "\n", "utf8");
writeFileSync(OUT_AUDIT, JSON.stringify(auditTable, null, 2) + "\n", "utf8");

// ---- report -----------------------------------------------------------------------
console.log("build_routing_table: emitted");
console.log("  - src/routing-table.json");
console.log("  - src/routing-table-audit.json");
console.log(`  exponents a=${EXPONENTS.a} b=${EXPONENTS.b}`);
console.log(`  calibration k_observed=${K_OBS} (>=${K_MIN}) m_observed=${M_OBS} (>=${M_MIN}) passed=${metadata.calibration_gate.passed}`);
console.log(`  price_cliff_side=${PRICE_CLIFF_SIDE}`);
if (failed) {
  console.error("WARNING: calibration gate did NOT pass with any exponent in the grid.");
  process.exit(2);
}
