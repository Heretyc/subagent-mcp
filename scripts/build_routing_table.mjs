// build_routing_table.mjs — Deterministic routing-table builder.
//
// Authority: skills/model-profiler/references/tier-ranking-and-scoring.md +
//   .../tier-ranking-and-scoring/01-sops.md (SOP form). Cost rates come from the dataset's
//   per-model `pricing` block (the ephemeral research dataset), not a committed KB file.
// DATASET is ephemeral (%TEMP%); DATASET_PATH env overrides the default temp location.
// Reads the structured dataset, encodes the SOP constants/formula, and emits:
//   - src/routing-table.json                         (validate_provider.mjs shape)
//   - .spec/references/assets/routing-table.json     (NOT touched — frozen spine source)
//   - src/routing-table-audit.json                   (populated audit + per-pairing citations)
//
// DETERMINISM: stable sort with explicit tie-breakers; no wall-clock / RNG in ranking.
// Timestamps come from env (BUILD_TS / RETRIEVED_AT) or the dataset date (DATASET_DATE,
// env-overridable; default '2026-06-03').

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Dataset is EPHEMERAL research scratch (never committed). Resolution order:
//   1. process.env.DATASET_PATH  (absolute or repo-relative) — set by the skill run.
//   2. <os.tmpdir()>/model-profiler/structured-dataset.json  — default %TEMP% scratch.
// The builder MUST NOT depend on any committed giga-research/** path.
const DATASET_PATH = process.env.DATASET_PATH
  ? (isAbsolute(process.env.DATASET_PATH)
      ? process.env.DATASET_PATH
      : resolve(ROOT, process.env.DATASET_PATH))
  : resolve(tmpdir(), "model-profiler", "structured-dataset.json");
const SPINE_PATH = resolve(ROOT, ".spec/references/assets/routing-table.json");
const OUT_PROVIDER = resolve(ROOT, "src/routing-table.json");
const OUT_AUDIT = resolve(ROOT, "src/routing-table-audit.json");

// ---- fail-loud guards (run BEFORE deriving GENERATED_MONTH) ------------------------
const _DATASET_DATE = process.env.DATASET_DATE || "2026-06-03";
if (!/^\d{4}-\d{2}-\d{2}$/.test(_DATASET_DATE)) {
  throw new Error(`DATASET_DATE must be YYYY-MM-DD; got '${_DATASET_DATE}'`);
}
const _GENERATED_MONTH = process.env.GENERATED_MONTH || _DATASET_DATE.slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(_GENERATED_MONTH)) {
  throw new Error(`GENERATED_MONTH must be YYYY-MM; got '${_GENERATED_MONTH}'`);
}
if (!existsSync(DATASET_PATH)) {
  throw new Error(
    `Dataset not found at ${DATASET_PATH}. Set DATASET_PATH to the run's ephemeral ` +
    `structured-dataset.json (skill writes it under %TEMP%).`
  );
}

// ---- run-stamped values (env-overridable; deterministic given env) ----------------
const DATASET_DATE = _DATASET_DATE;                                   // "YYYY-MM-DD"
const GENERATED_MONTH = _GENERATED_MONTH;                              // "YYYY-MM"
const GENERATED_AT = process.env.BUILD_TS || `${DATASET_DATE}T00:00:00Z`;       // ISO8601
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
const NO_EFFORT_SENTINELS = new Set(["n/a", "null", "none"]);

// Owner directive: models with NO selectable effort (null/none/n/a) are EXCLUDED from
// ranking/listing in these higher-reasoning task categories. They remain ranked in the
// other 4 (math_proof, data_analysis, coding, mechanical).
const NO_EFFORT_EXCLUDED_CATEGORIES = new Set([
  "agentic_execution",
  "architecture",
  "security_review",
  "debugging",
  "quality_review",
  "knowledge_synthesis",
]);

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

// ---- refinement #10: optional explicit per-row polarity (approach A) ---------------
// An OPTIONAL `row.polarity` ("lower_is_better" / "higher_is_better"; "lower"/"higher"
// tolerated) OVERRIDES the name-based isLowerBetter inference. When a row carries NO
// explicit polarity AND its benchmark name does NOT match the isLowerBetter substring
// list (so the scorer defaults to higher-is-better purely by absence of a match), we
// record a WARNING in the audit so silent backwards-ranking risk is surfaced. Warnings
// are deduped by benchmark+category. The live dataset carries no polarity field, so this
// is purely additive (warn, never fail).
const POLARITY_WARNINGS = new Map(); // `${benchmark}|${category}` -> {benchmark, category, assumed}
function parseExplicitPolarity(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).toLowerCase();
  if (v === "lower_is_better" || v === "lower" || v === "lower-is-better") return true;
  if (v === "higher_is_better" || v === "higher" || v === "higher-is-better") return false;
  return null; // unrecognized -> treat as no explicit polarity (fall back to name inference)
}
function rowIsLowerBetter(category, row) {
  const explicit = parseExplicitPolarity(row.polarity);
  if (explicit !== null) return explicit;
  const inferred = isLowerBetter(row.benchmark);
  if (!inferred) {
    const key = `${row.benchmark}|${category}`;
    if (!POLARITY_WARNINGS.has(key)) {
      POLARITY_WARNINGS.set(key, { benchmark: row.benchmark, category, assumed: "higher_is_better" });
    }
  }
  return inferred;
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

// ---- refinement #25: dataset-shape preflight --------------------------------------
// Fail LOUD and SPECIFIC before any field is dereferenced below. Requires ONLY the
// structural fields the builder actually consumes: dataset.models (object),
// dataset.model_effort_universe (array), dataset.category_benchmarks (object) with an
// array present for every SPINE taxonomy category, the per-benchmark-row fields the
// scorer/citations read (benchmark/raw/tier/source_url), and the per-model fields the
// builder dereferences unconditionally (pricing.input_per_mtok/output_per_mtok plus
// version_rank/version_lineage). Fields the builder defaults internally are NOT required:
// `withdrawn` (treated as [] when absent), `gaps`, `effort_ladder` (|| []), pricing.cliff
// (falsy-safe), tokenizer_inflation, and per-row label/unit/retrieved_at/annotation.
function validateDatasetShape(ds) {
  const errs = [];
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObj(ds.models) || Object.keys(ds.models).length === 0) {
    errs.push("dataset.models: missing or empty (expected a non-empty model->spec object)");
  }
  if (!Array.isArray(ds.model_effort_universe)) {
    errs.push("dataset.model_effort_universe: missing or not an array");
  }
  if (!isObj(ds.category_benchmarks)) {
    errs.push("dataset.category_benchmarks: missing or not an object");
  } else {
    for (const category of SPINE) {
      const rows = ds.category_benchmarks[category];
      if (!Array.isArray(rows)) {
        errs.push(`dataset.category_benchmarks.${category}: missing or not an array (required for taxonomy category)`);
        continue;
      }
      rows.forEach((row, i) => {
        if (!isObj(row)) {
          errs.push(`dataset.category_benchmarks.${category}[${i}]: not an object`);
          return;
        }
        for (const f of ["benchmark", "raw", "tier", "source_url"]) {
          if (!(f in row)) errs.push(`dataset.category_benchmarks.${category}[${i}].${f}: missing required benchmark-row field`);
        }
      });
    }
  }
  if (isObj(ds.models)) {
    for (const [model, spec] of Object.entries(ds.models)) {
      if (!isObj(spec)) {
        errs.push(`dataset.models.${model}: not an object`);
        continue;
      }
      if (!isObj(spec.pricing)) {
        errs.push(`dataset.models.${model}.pricing: missing or not an object`);
      } else {
        for (const f of ["input_per_mtok", "output_per_mtok"]) {
          if (!(f in spec.pricing)) errs.push(`dataset.models.${model}.pricing.${f}: missing required pricing field`);
        }
      }
      if (!("version_rank" in spec)) errs.push(`dataset.models.${model}.version_rank: missing required field`);
      if (!("version_lineage" in spec)) errs.push(`dataset.models.${model}.version_lineage: missing required field`);
    }
  }
  if (errs.length > 0) {
    throw new Error(`Invalid dataset shape (${DATASET_PATH}):\n- ${errs.join("\n- ")}`);
  }
}
validateDatasetShape(dataset);

const MODELS = dataset.models;
const UNIVERSE_MODELS = new Set(Object.keys(MODELS));

function modelSupportsSelectableEffort(model) {
  const ladder = MODELS[model]?.effort_ladder;
  return Array.isArray(ladder) && ladder.some((effort) => !NO_EFFORT_SENTINELS.has(effortKey(effort)));
}

function validateNoEffortSentinel(label, model, rawEffort, issues) {
  const effortK = effortKey(rawEffort);
  if (NO_EFFORT_SENTINELS.has(effortK) && modelSupportsSelectableEffort(model)) {
    issues.push(`${label}: ${model}@${effortK} uses a no-effort sentinel, but ${model} has selectable effort settings`);
  }
}

function validateEffortCapabilityInput() {
  const issues = [];

  for (const [model, spec] of Object.entries(MODELS)) {
    if (!modelSupportsSelectableEffort(model)) continue;
    for (const effort of spec.effort_ladder || []) {
      validateNoEffortSentinel(`models.${model}.effort_ladder`, model, effort, issues);
    }
  }

  for (const entry of dataset.model_effort_universe || []) {
    const at = entry.lastIndexOf("@");
    const model = entry.slice(0, at);
    const rawEffort = entry.slice(at + 1);
    validateNoEffortSentinel(`model_effort_universe.${entry}`, model, rawEffort, issues);
  }

  for (const [category, rows] of Object.entries(dataset.category_benchmarks || {})) {
    for (const [index, row] of rows.entries()) {
      validateNoEffortSentinel(`category_benchmarks.${category}[${index}]`, row.model, row.effort, issues);
    }
  }

  for (const [index, gap] of (dataset.gaps || []).entries()) {
    validateNoEffortSentinel(`gaps[${index}]`, gap.model, gap.effort, issues);
  }

  if (issues.length > 0) {
    throw new Error(`Invalid effort-capability data:\n- ${issues.join("\n- ")}`);
  }
}

validateEffortCapabilityInput();

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
// Absent `withdrawn` is treated as [] (refinement #25: not a required dataset field).
const WITHDRAWN = new Set(
  (dataset.withdrawn || []).map((w) => `${w.model}|${w.category}|${(w.benchmark || "").toLowerCase()}`)
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
    // refinement #10: surface polarity-by-absence over every non-withdrawn row (deduped),
    // not just the rows later selected for a universe pairing.
    rowIsLowerBetter(category, r);
  }
  function normalize(row) {
    const s = stats.get(row.benchmark);
    let n;
    if (s.max === s.min) n = 1;
    else n = (row.raw - s.min) / (s.max - s.min);
    if (rowIsLowerBetter(category, row)) n = 1 - n;
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
      const n = normalize(r);
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

// ---- per-category capability composites (drive both branch power-law scores) -------
// Both branches score by perf_norm^a / cost_norm^b; the perf_norm composite is built once
// here (benchmark normalization + §A effort-interpolation + SOP-1 + monotonicity clamp).
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

// ---- provider derivation (owner schema A) -----------------------------------------
// Explicit prefix -> family map. The universe is capped at two families
// (Anthropic + OpenAI); an unrecognized prefix is a data/scope error, not a silent
// default, so we THROW rather than mislabel an unknown third family as "codex".
const PROVIDER_FAMILY_PREFIXES = [
  ["claude-", "claude"],
  ["gpt-", "codex"],
  ["codex-", "codex"],
];
function providerOf(model) {
  for (const [prefix, family] of PROVIDER_FAMILY_PREFIXES) {
    if (model.startsWith(prefix)) return family;
  }
  throw new Error(
    `providerOf: unrecognized model prefix for '${model}'; expected one of ${PROVIDER_FAMILY_PREFIXES.map(([p]) => p).join(", ")}`
  );
}

// ---- cost normalization: cost_norm in (0,1] (owner schema C) -----------------------
// Power-law scoring uses a normalized worst-case $/token in (0,1]: divide each pairing's
// SOP-2 $/token by the universe max so the most-expensive pairing = 1.0. This is a global
// constant rescale -> rank-preserving within a branch; it only keeps the denominator sane
// and honors the (0,1] contract.
const MAX_COST = Math.max(...[...COST.values()].map((c) => c.perToken));
const COST_NORM = new Map();
for (const p of UNIVERSE) COST_NORM.set(p.id, COST.get(p.id).perToken / MAX_COST);

// ---- two-branch power-law weights (owner schema C) --------------------------------
// score = perf_norm^a / cost_norm^b. The a:b ratio sets perf-vs-cost influence (log-space):
//   performance     a=0.8 b=0.2  -> 80:20 capability:cost (cost a light nudge)
//   cost_efficiency a=0.4 b=0.6  -> 40:60 perf:cost (cost-dominant)
const PERF_EXP = { a: 0.8, b: 0.2 };
const COST_EXP = { a: 0.4, b: 0.6 };

// Power-law branch score. Sentinels (perf=null) collapse to 0 here but are placed strictly
// last by rankBranch's SENTINEL value, not by this 0.
function powerScore(p, s, exponents) {
  const perf = s.score === null ? 0 : Math.max(s.score, 0);
  const costNorm = COST_NORM.get(p.id);
  return Math.pow(perf, exponents.a) / Math.pow(costNorm, exponents.b);
}

// Full per-pairing object (AUDIT shape). The lean canonical table keeps only
// {provider, model, effort, rank}; every other field here lives ONLY in the audit sibling.
function buildFullPairingObject(item) {
  const { p, s, branchScore } = item;
  const cost = COST.get(p.id).perToken;
  const interpolated = Boolean(s.interpolated) || s.score === null;
  const confidence = s.score === null ? "low" : s.confidence;

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
    provider: providerOf(p.model),
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

// Per-category ranked universe: drop no-effort pairings from the excluded categories.
function categoryUniverse(category) {
  if (!NO_EFFORT_EXCLUDED_CATEGORIES.has(category)) return UNIVERSE;
  return UNIVERSE.filter((p) => !NO_EFFORT_SENTINELS.has(p.effortK));
}

function buildFullBranch(branch, exponents) {
  const out = {};
  for (const category of SPINE) {
    const scores = perfScores.get(category);
    const { items } = rankBranch(branch, scores, exponents, categoryUniverse(category));
    out[category] = items.map((item, idx) => {
      const obj = buildFullPairingObject(item);
      obj.rank = idx + 1;
      return obj;
    });
  }
  return out;
}

// Rank a branch by power-law score (desc), dense 1..N. Both branches use the same
// score = perf_norm^a / cost_norm^b form; only the exponents differ.
function rankBranch(branch, scores, exponents, universe = UNIVERSE) {
  const observed = [];
  for (const p of universe) {
    const s = scores.get(p.id);
    if (s.score === null) continue;
    observed.push(powerScore(p, s, exponents));
  }
  const minObs = observed.length ? Math.min(...observed) : 0;
  const SENTINEL = observed.length ? minObs - 1e-6 : 0;

  const items = universe.map((p) => {
    const s = scores.get(p.id);
    const hasScore = s.score !== null;
    const branchScore = hasScore ? powerScore(p, s, exponents) : SENTINEL;
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

// ---- build both branches at fixed owner-spec exponents (no calibration search) ----
// calibration_gate + cheapest-AND-weakest ban are RETIRED (owner schema D): both branches
// now rank by the same power law at fixed a:b ratios, so there is no exponent to search.
const performanceFull = buildFullBranch("performance", PERF_EXP);
const costEfficiencyFull = buildFullBranch("cost_efficiency", COST_EXP);

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

// ---- lean canonical table (owner schema A/B) --------------------------------------
// Pairings carry EXACTLY {provider, model, effort, rank}; metadata EXACTLY the 5 keys.
// All removed detail (score, cost_figure_used, basis, interpolated, confidence, formula
// definitions, universe, exponents, citations) lives ONLY in the audit sibling below.
function leanBranch(fullBranch) {
  const out = {};
  for (const category of SPINE) {
    out[category] = fullBranch[category].map((e) => ({
      provider: e.provider,
      model: e.model,
      effort: e.effort,
      rank: e.rank,
    }));
  }
  return out;
}

const metadata = {
  author: "Lexi Blackburn",
  author_url: "https://github.com/Heretyc/",
  generated: GENERATED_MONTH,
  schema_version: "2",
  version: "2.0.0",
};

const providerTable = {
  metadata,
  performance: leanBranch(performanceFull),
  cost_efficiency: leanBranch(costEfficiencyFull),
};

// ---- audit sibling (full per-pairing detail + citations; src/routing-table-audit.json)
// The audit is the ONLY place the removed detail is retained. Its metadata MAY carry the
// richer fields and records the realized exponents + cost-figure methodology.
function auditBranch(fullBranch) {
  const out = {};
  for (const category of SPINE) {
    out[category] = fullBranch[category].map((e) => {
      const detail = perfScores.get(category).get(pairingId(e.model, effortKey(e.effort)));
      const { _detail, ...rest } = e;
      return { ...rest, citations: citationsFor(detail) };
    });
  }
  return out;
}

// refinement #10: polarity-by-absence warnings, deterministically ordered (SPINE category
// order, then benchmark name). Populated during buildCategoryScores; additive audit-only.
const SPINE_ORDER = new Map(SPINE.map((c, i) => [c, i]));
const polarityInferenceWarnings = [...POLARITY_WARNINGS.values()].sort((a, b) => {
  const ca = SPINE_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER;
  const cb = SPINE_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  return a.benchmark < b.benchmark ? -1 : a.benchmark > b.benchmark ? 1 : 0;
});

const auditTable = {
  metadata: {
    author: "Lexi Blackburn",
    author_url: "https://github.com/Heretyc/",
    generated: GENERATED_MONTH,
    generated_at: GENERATED_AT,
    schema_version: "2",
    version: "2.0.0",
    audits: "src/routing-table.json",
    seed_sites_pointer: "research-seed-sites.json",
    model_effort_universe: UNIVERSE_IDS,
    polarity_inference_warnings: polarityInferenceWarnings,
    realized_exponents: {
      performance: { a: PERF_EXP.a, b: PERF_EXP.b },
      cost_efficiency: { a: COST_EXP.a, b: COST_EXP.b },
    },
    cost_figure_methodology:
      "SOP-2 worst-case $/token: fixed 100K-in / 20K-visible-out blend, opus tokenizer " +
      "inflation 1.35x (1.4x deprecated), effort hidden-output multiplier ladder, gpt-5.5 " +
      "272K cliff sub-cliff at this blend. cost_norm = $/token / universe-max in (0,1]. " +
      "Branch score = perf_norm^a / cost_norm^b.",
    formula_definitions: {
      normalization: NORMALIZATION,
      composite_weights: compositeWeights,
      sentiment_cap: SENTIMENT_CAP,
    },
    cost_blend: {
      input_tokens: COST_BLEND.input_tokens,
      output_tokens: COST_BLEND.output_tokens,
      price_cliff_side: PRICE_CLIFF_SIDE,
    },
  },
  performance: auditBranch(performanceFull),
  cost_efficiency: auditBranch(costEfficiencyFull),
};

// ---- write ------------------------------------------------------------------------
writeFileSync(OUT_PROVIDER, JSON.stringify(providerTable, null, 2) + "\n", "utf8");
writeFileSync(OUT_AUDIT, JSON.stringify(auditTable, null, 2) + "\n", "utf8");

// ---- report -----------------------------------------------------------------------
console.log("build_routing_table: emitted");
console.log("  - src/routing-table.json (lean canonical)");
console.log("  - src/routing-table-audit.json (full audit + citations)");
console.log(`  performance exponents a=${PERF_EXP.a} b=${PERF_EXP.b}`);
console.log(`  cost_efficiency exponents a=${COST_EXP.a} b=${COST_EXP.b}`);
console.log(`  price_cliff_side=${PRICE_CLIFF_SIDE}`);
