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
// Timestamps come from env (BUILD_TS / RETRIEVED_AT) or the dataset date (DATASET_DATE, which is
// REQUIRED — refinement #21 fails loud if unset rather than defaulting to a stale literal date).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

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
// refinement #21: DATASET_DATE is REQUIRED — fail loud rather than defaulting to a stale
// literal date. A silent default silently mis-stamps the run (and decoupled the two scripts'
// stamps); the regen always sets DATASET_DATE, so this only bites an un-pinned invocation.
const _DATASET_DATE = process.env.DATASET_DATE;
if (!_DATASET_DATE) {
  throw new Error(
    "DATASET_DATE is required (YYYY-MM-DD) — refusing to default to a stale literal date. " +
    "Set DATASET_DATE to the run's dataset date so the audit and seed share one run stamp."
  );
}
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

// ---- refinement #21: ONE shared run-id across both artifacts -----------------------
// Both the audit (audit.metadata.run_manifest.run_id) and the seed stamp must reference a
// SINGLE run-id so the two artifacts are provably from the same run. Resolution order:
//   1. process.env.RUN_ID            — explicit override (honored; preserves prior behavior).
//   2. <tmpdir>/model-profiler/run-id — a run-id file (lets an external orchestrator pin one).
//   3. deterministic default `run-${DATASET_DATE}` — same value both scripts derive offline.
// The builder runs FIRST and WRITES the resolved run-id to the run-id file, so update_seed_sites
// (which runs after) reads the IDENTICAL id even if its env differs. Pure offline, deterministic.
const RUN_ID_PATH = resolve(tmpdir(), "model-profiler", "run-id");
// #13: content-hash run-id. Default = run-<date>-<sha256[0:12]>(dataset). Both the human-readable
// date AND the dataset content-hash are embedded so cross-run contamination is detectable
// (a run-id whose date ≠ today is stale; same date but different hash = different dataset).
// Env override (RUN_ID) and file override still take precedence for orchestrated runs.
function resolveRunId() {
  if (process.env.RUN_ID) return process.env.RUN_ID;
  if (existsSync(RUN_ID_PATH)) {
    const fromFile = readFileSync(RUN_ID_PATH, "utf8").replace(/^﻿/, "").trim();
    if (fromFile) {
      // #13: ignore a stale run-id whose date doesn't match DATASET_DATE (cross-run contamination).
      const match = /^run-(\d{4}-\d{2}-\d{2})-/.exec(fromFile);
      if (match && match[1] !== DATASET_DATE) {
        console.warn(`#13: stale run-id file (date ${match[1]} ≠ DATASET_DATE ${DATASET_DATE}); using fresh content-hash id.`);
      } else if (fromFile) {
        return fromFile;
      }
    }
  }
  return `run-${DATASET_DATE}-${DATASET_HASH_SHORT}`;
}
const RUN_ID = resolveRunId();
// #13: write run-id to both the legacy fixed path (for update_seed_sites backward compat) AND
// the run-specific isolated path so cross-run contamination between audit and seed is detectable.
const RUN_ID_DIR = resolve(tmpdir(), "model-profiler", RUN_ID);
try {
  mkdirSync(RUN_ID_DIR, { recursive: true });
  writeFileSync(resolve(RUN_ID_DIR, "run-id"), RUN_ID + "\n", "utf8");
  writeFileSync(RUN_ID_PATH, RUN_ID + "\n", "utf8");
} catch (e) {
  console.warn(`#13: could not persist run-id to ${RUN_ID_PATH}: ${e.message}`);
}

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
// #19: above-cliff rates for G_CTX_272 (gpt-5.5 ≥272K context; SOP-2 §74-76).
// These are hardcoded from public OpenAI pricing; recorded audit-only in cost_blend.above_cliff_cost_figure.
const G_CTX_272_CLIFF_INPUT_PER_MTOK = 10;  // $/MTok above 272K (post-cliff input rate)
const G_CTX_272_CLIFF_OUTPUT_PER_MTOK = 45; // $/MTok (post-cliff output rate)

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

// Owner directive (2026-06-11, FINAL AND BINDING — NO EXCEPTIONS): the performance
// branch must never rank a pairing whose effort sits below 'high' on the ladder
// (null/none/min/light/low/medium). Low/medium-effort variants are a widely-bad
// choice for performance/deadlock situations. Enforced on EVERY build: the branch
// filter blocks new below-floor entries AND purges existing ones on rebuild; the
// post-build assertion fails loud if one ever slips through. cost_efficiency is
// unaffected. For the performance branch this overrides invariant #14's 4-category
// retention of no-effort models (they stay ranked there in cost_efficiency only).
const PERFORMANCE_MIN_EFFORT = "high";
const PERFORMANCE_MIN_EFFORT_INDEX = EFFORT_INDEX.get(PERFORMANCE_MIN_EFFORT);
function meetsPerformanceEffortFloor(effortK) {
  const idx = EFFORT_INDEX.get(effortK);
  return idx !== undefined && idx >= PERFORMANCE_MIN_EFFORT_INDEX;
}

// Owner directive: models with NO selectable effort (null/none/n/a) are EXCLUDED from
// ranking/listing in these higher-reasoning task categories. They remain ranked in the
// full-universe parent categories (math_proof, data_analysis, coding, mechanical).
// Composite categories inherit parent eligibility and average eligible parent ranks only.
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
// is purely additive (warn, never fail) — EXCEPT for high-risk categories (#24).
const POLARITY_WARNINGS = new Map(); // `${benchmark}|${category}` -> {benchmark, category, assumed}
// #24: hard-fail for high-risk categories when polarity is inferred (not explicit).
// security_review/debugging/quality_review: a wrong polarity silently inverts ranking.
const HIGH_RISK_POLARITY_CATEGORIES = new Set(["security_review", "debugging", "quality_review"]);
const POLARITY_ERRORS = []; // {benchmark, category, assumed} — fail-on-any after scoring
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
    // #24: hard-fail accumulator for high-risk categories
    if (HIGH_RISK_POLARITY_CATEGORIES.has(category)) {
      POLARITY_ERRORS.push({ benchmark: row.benchmark, category, assumed: "higher_is_better" });
    }
  }
  return inferred;
}

const SENTIMENT_CAP = 0.05; // < min benchmark weight (1.0); design §1.4
const SENTIMENT_ADJ = 0; // no free-text corpus -> 0 for every pairing

// ---- refinement #3: neutralize thin single-reporter evidence -----------------------
// min-max maps a single-observation benchmark population (min==max) to n=1.0 = MAX
// capability, so a lone UNCORROBORATED row can silently define a category's ceiling while
// the computed confidence/tierFloor are ignored by powerScore. Per repo TIER SEMANTICS +
// SOP-3 (thin/vendor-only/uncorroborated = LOW confidence, DOWN-weighted), a benchmark
// whose normalization basis has <2 independent reporters is NON-DISCRIMINATING: it cannot
// define the category max. The dataset carries no explicit reporter count, so per spec the
// single-benchmark-row (n=1) population IS the thin case. Such rows are normalized to a
// NEUTRAL value (0.5) instead of 1.0, and every neutralized benchmark is surfaced in the
// audit. A population with >=2 reporters (even if their values coincide) is corroborated
// and keeps the standard min-max result.
const THIN_MIN_REPORTERS = 2; // <2 distinct rows in the normalization basis -> thin
const THIN_NEUTRAL_N = 0.5; // neutralized normalized value for a thin single-obs population
// #5 epsilon floor: a measured (non-thin) pairing must never normalize to exactly 0, which
// collapses to 0^0.8 = 0 in powerScore — visually indistinguishable from a data-free sentinel.
// Applied after min-max; z-score-then-squash (for >=3-reporter populations) is documented as
// an alternative in NORMALIZATION.params but not yet activated.
const NORM_EPSILON_FLOOR = 0.001;
const NEUTRALIZED_BENCHMARKS = []; // {benchmark, category, model, reason} (audit-only)

// ---- refinement #8: scale-anchor normalization sources -----------------------------
// buildCategoryScores anchors each benchmark's min/max over ALL non-withdrawn rows, but
// citationsFor only emits citations for SELECTED ranked pairings — so a row that CALIBRATED
// a category's min/max scale (defined an anchor) but was not attached to a ranked pairing is
// dropped from the audit citations, and therefore from the seed (update_seed_sites harvests
// only audit citations). This accumulator records, per category+benchmark, the source row(s)
// (url + benchmark + model + raw + tier) that defined that benchmark's MIN and MAX anchors,
// so those scale-defining sources are surfaced in the audit (and reach the seed as
// source_class=scale_anchor). Additive audit-only; never affects scoring/ranking.
const NORMALIZATION_SOURCES = []; // {category, benchmark, role, model, url, raw, tier} per anchor row
// #18: per-benchmark normalization metadata — collected alongside NORMALIZATION_SOURCES.
// Reports row_count, estimated independent_reporter_count (unique source-URL domains),
// score_range, and is_thin. Audit-only. Rank bands deferred (Bradley-Terry MLE needs
// pairwise win data not present in the per-pairing score structure).
const BENCHMARK_META = []; // {category, benchmark, row_count, independent_reporter_count, score_range, is_thin}
const _NEUTRALIZED_SEEN = new Set(); // dedupe by benchmark|category|model
function recordNeutralized(benchmark, category, model, reason) {
  const key = `${benchmark}|${category}|${model}`;
  if (_NEUTRALIZED_SEEN.has(key)) return;
  _NEUTRALIZED_SEEN.add(key);
  NEUTRALIZED_BENCHMARKS.push({ benchmark, category, model, reason });
}
const NORMALIZATION = {
  method: "min-max",
  params: {
    clamp: [0, 1],
    empty_population: 1,
    // refinement #3: single-observation (n<2 reporters) populations are neutralized.
    thin_min_reporters: THIN_MIN_REPORTERS,
    thin_neutral_n: THIN_NEUTRAL_N,
    // #5 epsilon floor: applied post-normalization so a measured pairing never reaches exactly 0.
    epsilon_floor: NORM_EPSILON_FLOOR,
    // Alternative for >=3-reporter populations: z-score-then-squash (tanh(z/2) rescaled to (0,1)).
    // Not yet activated; set method to "z-score" to enable. See tier-ranking-and-scoring.md §C.
    alt_method_ge3: "z-score-then-squash",
  },
};

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
// #12/#13: compute SHA-256 hash of the raw dataset bytes for content-addressed run-id
// and replay audit. Hash is computed from the raw bytes (BOM-stripped, UTF-8) so the
// same dataset always hashes identically regardless of JSON key ordering.
const _rawDataset = readFileSync(DATASET_PATH, "utf8").replace(/^﻿/, "");
const DATASET_HASH_SHORT = createHash("sha256").update(_rawDataset).digest("hex").slice(0, 12);
const DATASET_SHA256 = createHash("sha256").update(_rawDataset).digest("hex");
const dataset = JSON.parse(_rawDataset);
const spineRoot = readJsonStripBom(SPINE_PATH);
// Post taxonomy-freeze, the provider routing-table spine is the canonical 14 categories
// recorded in the machine-mirror `categories` object (== classification_precedence):
// The parent set has ten directly benchmarked categories, plus 4 composite-inferred categories.
// `fallback_default` is the precedence sentinel only and is NOT a branch category in
// the provider table (matches validate_provider buildSpine).
const SPINE = Object.keys(spineRoot.categories); // 14 keys
const COMPOSITE_PARENT_CATEGORIES = Object.freeze({
  prompt_engineering: ["knowledge_synthesis", "coding", "quality_review"],
  vulnerability_research: ["security_review", "debugging", "coding"],
  molecular_biology: ["knowledge_synthesis", "data_analysis", "math_proof"],
  ml_accelerator_design: ["architecture", "coding", "math_proof"],
});
const COMPOSITE_CATEGORIES = new Set(Object.keys(COMPOSITE_PARENT_CATEGORIES));
const BASE_SPINE = SPINE.filter((category) => !COMPOSITE_CATEGORIES.has(category));
for (const [category, parents] of Object.entries(COMPOSITE_PARENT_CATEGORIES)) {
  if (!SPINE.includes(category)) {
    throw new Error(`composite category '${category}' is missing from routing spine`);
  }
  for (const parent of parents) {
    if (!SPINE.includes(parent) || COMPOSITE_CATEGORIES.has(parent)) {
      throw new Error(`composite category '${category}' has invalid parent '${parent}'`);
    }
  }
}

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
    for (const category of BASE_SPINE) {
      const rows = ds.category_benchmarks[category];
      if (!Array.isArray(rows)) {
        errs.push(`dataset.category_benchmarks.${category}: missing or not an array (required for directly benchmarked taxonomy category)`);
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

// performance_rank_pin: Map<category, Set<model>> — performance branch only; no cost_efficiency effect.
const SPINE_SET = new Set(SPINE);
const PERF_RANK_PINS = new Map();
for (const [model, spec] of Object.entries(MODELS)) {
  const pin = spec.performance_rank_pin;
  if (!pin) continue;
  if (!Array.isArray(pin.categories)) {
    throw new Error(`MODELS.${model}.performance_rank_pin.categories must be an array of SPINE categories`);
  }
  for (const cat of pin.categories) {
    if (!SPINE_SET.has(cat)) {
      throw new Error(`MODELS.${model}.performance_rank_pin.categories: unknown category '${cat}' (must be a known SPINE category)`);
    }
    if (!PERF_RANK_PINS.has(cat)) PERF_RANK_PINS.set(cat, new Set());
    PERF_RANK_PINS.get(cat).add(model);
  }
}

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
// refinement #2: canonical universe order — the dataset's own model_effort_universe
// sequence (stable, capability-NEUTRAL). Used as the deterministic tie-break for
// all-sentinel (DATA_MISSING) categories so their rank order is NOT a de-facto capability
// signal (it replaces the model-id-ascending / version_rank de-facto proxy there).
const UNIVERSE_ORDER = new Map(UNIVERSE.map((p, i) => [p.id, i]));

// withdrawn (model+category+benchmark) — discard those rows entirely (SOP-3).
// Absent `withdrawn` is treated as [] (refinement #25: not a required dataset field).
const WITHDRAWN = new Set(
  (dataset.withdrawn || []).map((w) => `${w.model}|${w.category}|${(w.benchmark || "").toLowerCase()}`)
);
function isWithdrawn(category, row) {
  return WITHDRAWN.has(`${row.model}|${category}|${(row.benchmark || "").toLowerCase()}`);
}

// ---- refinement #14: single-category benchmark keying (detect + surface) -----------
// SOP rule: each benchmark score should be keyed to the ONE most-diagnostic category. The
// per-category allowed-benchmark set IS dataset.category_benchmarks (its authored keying):
// the distinct benchmark names listed under each category. We do NOT auto-decide which single
// category is canonical for a duplicated benchmark (the #15 lesson — that is the dataset
// owner's domain call); we only SURFACE it for owner triage. Two detections:
//   (a) CROSS-CATEGORY: a benchmark keyed under >1 category. Recorded in
//       audit.metadata.cross_category_benchmarks; rows are NOT dropped or reassigned.
//   (b) OFF-MAP: a row whose benchmark is absent from its own category's allowed set. By
//       construction the allowed set is derived from those very rows, so the CURRENT dataset
//       has ZERO off-map rows -> we THROW on any future off-map row (fail-loud). If the dataset
//       ever already contains off-map rows, we DOWNGRADE to a recorded WARNING so regen stays
//       green (and note the downgrade). Withdrawn rows are excluded (discarded per SOP-3).
const ALLOWED_BENCHMARKS = new Map(); // category -> Set(benchmark) — the authored keying
for (const category of BASE_SPINE) {
  const set = new Set();
  for (const row of dataset.category_benchmarks[category] || []) {
    if (isWithdrawn(category, row)) continue;
    if (row.benchmark) set.add(row.benchmark);
  }
  ALLOWED_BENCHMARKS.set(category, set);
}
// (a) cross-category: benchmark -> sorted SPINE-ordered categories it is keyed under.
const _benchToCats = new Map();
for (const category of BASE_SPINE) {
  for (const b of ALLOWED_BENCHMARKS.get(category)) {
    (_benchToCats.get(b) || _benchToCats.set(b, []).get(b)).push(category);
  }
}
const CROSS_CATEGORY_BENCHMARKS = [...(_benchToCats)]
  .filter(([, cats]) => cats.length > 1)
  .map(([benchmark, categories]) => ({ benchmark, categories }))
  .sort((a, b) => (a.benchmark < b.benchmark ? -1 : a.benchmark > b.benchmark ? 1 : 0));
// (b) off-map: a non-withdrawn row keyed under a category whose canonical allowed set (the
// `category_benchmarks` keying captured above, BEFORE any later row mutation) does not list that
// benchmark. The CURRENT dataset has ZERO off-map rows. Fail-loud enforcement (this dataset's
// state): a future dataset that introduces an off-map row -> THROW with a clear, specific message.
// Downgrade contract: ONLY if a FUTURE dataset is shipped already carrying off-map rows would we
// downgrade to a recorded WARNING (audit.metadata.off_map_rows) to keep regen green; that branch
// is documented but NOT taken here because the present keying yields none.
const OFF_MAP_ROWS = [];
for (const category of BASE_SPINE) {
  const allowed = ALLOWED_BENCHMARKS.get(category);
  for (const row of dataset.category_benchmarks[category] || []) {
    if (isWithdrawn(category, row)) continue;
    if (row.benchmark && !allowed.has(row.benchmark)) {
      OFF_MAP_ROWS.push({ category, benchmark: row.benchmark, model: row.model });
    }
  }
}
const OFF_MAP_BASELINE_CLEAN = true; // observed: current dataset has zero off-map rows.
const OFF_MAP_DOWNGRADED = OFF_MAP_ROWS.length > 0 && !OFF_MAP_BASELINE_CLEAN;
if (OFF_MAP_ROWS.length > 0 && !OFF_MAP_DOWNGRADED) {
  const detail = OFF_MAP_ROWS
    .map((r) => `${r.category} <- '${r.benchmark}' (${r.model})`)
    .join("; ");
  throw new Error(
    `refinement #14: off-map benchmark row(s) detected — a benchmark is keyed under a category ` +
    `whose canonical category_benchmarks keying does not list it. The owner must key each ` +
    `benchmark to its single most-diagnostic category (do NOT auto-reassign). Off-map: ${detail}`
  );
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
// assumed_cost cost-pin: for models with assumed_cost.multiplier, override perToken to M * max(non-assumed).
// Affects COST only; scoring/perf composite is never touched. Recompute MAX_COST/COST_NORM below.
const ASSUMED_COST_PAIRINGS = new Map(); // pairingId -> audit note
const REAL_PERTOKEN = new Map();
for (const p of UNIVERSE) REAL_PERTOKEN.set(p.id, COST.get(p.id).perToken);
{
  for (const [model, spec] of Object.entries(MODELS)) {
    if (spec.assumed_cost === undefined) continue;
    const M = spec.assumed_cost?.multiplier;
    if (typeof M !== "number" || M <= 0) {
      throw new Error(`assumed_cost.multiplier must be a positive number for model '${model}'; got ${M}`);
    }
  }
  const nonAssumedPerTokens = UNIVERSE
    .filter(p => !MODELS[p.model].assumed_cost)
    .map(p => COST.get(p.id).perToken);
  if (nonAssumedPerTokens.length > 0) {
    const baseMaxPerToken = Math.max(...nonAssumedPerTokens);
    for (const p of UNIVERSE) {
      const spec = MODELS[p.model];
      if (!spec.assumed_cost) continue;
      const M = spec.assumed_cost.multiplier;
      COST.get(p.id).perToken = M * baseMaxPerToken;
      ASSUMED_COST_PAIRINGS.set(
        p.id,
        `[ASSUMPTION] assumed_cost: cost pinned to ${M}x most-expensive incumbent (owner-directed; cost-only)`
      );
    }
  }
}
// Aggregate cliff side for metadata: "below" if any member has a cliff (all sub-cliff), else "n/a".
const PRICE_CLIFF_SIDE = [...COST.values()].some((c) => c.hasCliff) ? "below" : "n/a";
// #19: above_cliff_cost_figure — audit-only blend cost at G_CTX_272 post-cliff rates, no hidden
// multiplier (effort-agnostic baseline). Non-null only when at least one model has a cliff.
const ABOVE_CLIFF_COST_FIGURE = PRICE_CLIFF_SIDE !== "n/a"
  ? (() => {
      const inputFrac = INPUT_TOK / 1e6;
      const visibleOutFrac = VISIBLE_OUT_TOK / 1e6;
      const perMTok = G_CTX_272_CLIFF_INPUT_PER_MTOK * inputFrac +
        G_CTX_272_CLIFF_OUTPUT_PER_MTOK * visibleOutFrac;
      return {
        blend_per_mtok: Math.round(perMTok * 1e6) / 1e6,
        blend_per_token: Math.round(perMTok / 1e6 * 1e12) / 1e12,
        cliff_input_per_mtok: G_CTX_272_CLIFF_INPUT_PER_MTOK,
        cliff_output_per_mtok: G_CTX_272_CLIFF_OUTPUT_PER_MTOK,
        note: "above-cliff rate at reference blend (100K in / 20K out), hiddenMult=0 excluded; for G_CTX_272 routes only",
      };
    })()
  : null;

// ---- per-category composite scoring (design §1) -----------------------------------
// For each category, build per-benchmark normalization population from ALL rows
// (universe + competitor, non-withdrawn). Then compute composite per universe pairing.
//
// Row selection for a universe pairing P=model@effortK: rows where row.model==P.model
// AND (row.effort==P.effort  OR  row.effort=="any").

function buildCategoryScores(category) {
  const rows = (dataset.category_benchmarks[category] || []).filter((r) => !isWithdrawn(category, r));
  // Per-benchmark min/max + reporter count over ALL non-withdrawn rows (anchors the scale).
  // refinement #8: also retain the row(s) that DEFINED each benchmark's min and max anchor
  // (ties keep all rows at the anchor value) so the scale-calibrating sources can be surfaced.
  const stats = new Map(); // benchmark -> {min,max,count,minRows:[],maxRows:[]}
  for (const r of rows) {
    const b = r.benchmark;
    const s = stats.get(b) || { min: Infinity, max: -Infinity, count: 0, minRows: [], maxRows: [] };
    if (r.raw < s.min) { s.min = r.raw; s.minRows = [r]; }
    else if (r.raw === s.min) s.minRows.push(r);
    if (r.raw > s.max) { s.max = r.raw; s.maxRows = [r]; }
    else if (r.raw === s.max) s.maxRows.push(r);
    s.count += 1; // refinement #3: independent-reporter count = rows in the basis
    stats.set(b, s);
    // refinement #10: surface polarity-by-absence over every non-withdrawn row (deduped),
    // not just the rows later selected for a universe pairing.
    rowIsLowerBetter(category, r);
  }
  // #18: populate BENCHMARK_META for each benchmark in this category (audit-only metadata).
  // independent_reporter_count = unique source-URL domains (best offline proxy; note: multiple
  // rows from the same site still count as one independent reporter by this estimate).
  for (const [benchmark, s] of stats) {
    const domainRows = rows.filter((r) => r.benchmark === benchmark);
    const uniqueDomains = new Set(domainRows.map((r) => {
      try { return new URL(r.source_url || "").hostname.replace(/^www\./, ""); } catch { return ""; }
    }).filter(Boolean));
    BENCHMARK_META.push({
      category,
      benchmark,
      row_count: s.count,
      independent_reporter_count: uniqueDomains.size || null,
      score_range: { min: s.min === Infinity ? null : s.min, max: s.max === -Infinity ? null : s.max },
      is_thin: s.count < THIN_MIN_REPORTERS,
    });
  }

  // refinement #8: record the min/max anchor source rows for this category's benchmarks.
  // role distinguishes the lower (min) and upper (max) scale anchor. Single-observation
  // (thin) benchmarks have min==max (one row, both roles) — still scale-defining sources, so
  // they are recorded too (flagged via thin). Per-row entries; dedup-by-url happens at the
  // seed merge (update_seed_sites) and in the audit assembly below.
  for (const [benchmark, s] of stats) {
    const thin = s.count < THIN_MIN_REPORTERS;
    for (const role of ["min", "max"]) {
      for (const r of role === "min" ? s.minRows : s.maxRows) {
        NORMALIZATION_SOURCES.push({
          category,
          benchmark,
          role,
          model: r.model,
          url: r.source_url || "",
          raw: r.raw,
          tier: Number.isFinite(Number(r.tier)) ? Number(r.tier) : null,
          thin,
        });
      }
    }
  }
  // refinement #3: a benchmark population with <THIN_MIN_REPORTERS rows is single-observation
  // (non-discriminating). It must NOT define the category max; it is neutralized to a neutral n.
  function isThinBenchmark(benchmark) {
    const s = stats.get(benchmark);
    return Boolean(s) && s.count < THIN_MIN_REPORTERS;
  }
  function normalize(row) {
    const s = stats.get(row.benchmark);
    let n;
    if (isThinBenchmark(row.benchmark)) {
      // single-observation population: neutralize so a lone uncorroborated row cannot earn
      // MAX capability (SOP-3 thin -> down-weight). Recorded in the audit (per selected pairing).
      n = THIN_NEUTRAL_N;
    } else if (s.max === s.min) {
      // >=2 corroborating reporters that coincide -> legitimately at the population ceiling.
      n = 1;
    } else {
      n = (row.raw - s.min) / (s.max - s.min);
      // #5 epsilon floor: a measured pairing must never normalize to exactly 0 (collapses to 0
      // in powerScore, indistinguishable from a data-free sentinel). Thin rows keep THIN_NEUTRAL_N.
      n = Math.max(n, NORM_EPSILON_FLOOR);
    }
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
      // refinement #3: surface every thin (single-observation) benchmark this pairing rests on.
      if (isThinBenchmark(r.benchmark)) {
        recordNeutralized(
          r.benchmark,
          category,
          r.model,
          `single-observation population (<${THIN_MIN_REPORTERS} reporters); normalized to ${THIN_NEUTRAL_N} so it cannot define the category max (SOP-3 thin -> down-weight)`
        );
      }
      const arr = byBench.get(r.benchmark) || [];
      arr.push(n);
      byBench.set(r.benchmark, arr);
    }
    // refinement #3: pairing rests ENTIRELY on neutralized thin evidence when every distinct
    // benchmark in its basis is single-observation. Such a pairing is rank-1 INELIGIBLE on thin
    // evidence alone (gated downstream in powerScore alongside the computed confidence).
    const thinBasis = byBench.size > 0 && [...byBench.keys()].every((b) => isThinBenchmark(b));
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
    const perfOnly = selected.length > 0 && selected.every(r => r.performance_only === true);
    result.set(p.id, {
      score: performanceRaw,
      rows: selected,
      confidence,
      tierFloor: Number.isFinite(tierFloor) ? tierFloor : null,
      thinBasis, // refinement #3: score rests entirely on neutralized single-obs evidence
      performanceOnly: perfOnly,
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
const perfScores = new Map(); // directly benchmarked category -> Map(pairingId -> detail)
for (const category of BASE_SPINE) {
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

// ---- refinements #1/#2/#9: data-missing coverage floor + non-semantic order + gaps --
// AUDIT-ONLY transparency (plus a sentinel-ORDER change within still-dense categories).
//
// #1 coverage-floor: a category is DATA_MISSING when NO universe pairing earns a real
// (non-null) score — i.e. every row is a data-free sentinel, so there is no measured
// benchmark signal at all. This RECORDS state in the audit; it never fails the build and
// never makes the lean table sparse (every category stays dense 1..N).
function categoryHasMeasuredSignal(category) {
  if (COMPOSITE_CATEGORIES.has(category)) return true;
  const scores = perfScores.get(category);
  for (const p of UNIVERSE) {
    const s = scores.get(p.id);
    if (s && s.score !== null) return true;
  }
  return false;
}
const DATA_MISSING_CATEGORIES = new Set(
  SPINE.filter((category) => !categoryHasMeasuredSignal(category))
);
// audit.metadata.category_completeness: per-category build-time coverage state.
const CATEGORY_COMPLETENESS = {};
for (const category of SPINE) {
  CATEGORY_COMPLETENESS[category] = DATA_MISSING_CATEGORIES.has(category)
    ? "DATA_MISSING"
    : "measured";
}

// #9 gaps: the dataset carries dataset.gaps (reason + affected model + remediation) that
// the builder otherwise only validates (no-effort sentinel) and drops. Index them by
// category for (a) audit.metadata.gaps, (b) per-category DATA_MISSING summaries, and (c)
// referencing the SPECIFIC gap reason in sentinel pairings' basis/citation text. Absent
// `gaps` is treated as [] (refinement #25: not a required dataset field). Order is the
// dataset's own gap order (deterministic, source-faithful).
const GAPS_BY_CATEGORY = new Map(); // category -> [{model, effort, reason}, ...]
for (const gap of dataset.gaps || []) {
  const arr = GAPS_BY_CATEGORY.get(gap.category) || [];
  arr.push({ model: gap.model, effort: gap.effort, reason: gap.reason });
  GAPS_BY_CATEGORY.set(gap.category, arr);
}
// Structured gaps for audit.metadata.gaps, deterministically ordered: DATA_MISSING
// categories in SPINE order first (the ones these gaps explain), then any remaining
// gap categories in SPINE order, preserving each category's source gap order within.
const _gapCatOrder = [
  ...SPINE.filter((c) => GAPS_BY_CATEGORY.has(c)),
  ...[...GAPS_BY_CATEGORY.keys()].filter((c) => !SPINE.includes(c)),
];
const GAPS_AUDIT = _gapCatOrder.map((category) => ({
  category,
  state: CATEGORY_COMPLETENESS[category] || "measured",
  entries: GAPS_BY_CATEGORY.get(category),
}));
// First gap reason per DATA_MISSING category — the specific basis/citation text the
// sentinel pairings reference instead of the generic "no measured benchmark rows".
function primaryGapReason(category) {
  const arr = GAPS_BY_CATEGORY.get(category);
  return arr && arr.length ? arr[0].reason : null;
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

// ---- refinement #6: winsorize $/token (PERFORMANCE branch only) ---------------------
// Approach B (owner-chosen, DISPUTED): the performance branch is capability-DOMINANT
// (PERF_EXP a=0.8 b=0.2). With raw cost_norm, an extreme price ratio R in the universe can
// still swing the score by R^b = R^0.2 — a ~100x ratio swings the score ~2.5x, which is
// enough for a cheap-but-weaker tier to lift above a strong high-effort pairing (e.g.
// sonnet@low above opus@max). We winsorize the per-token cost to the [p05, p95] window of
// the universe $/token distribution BEFORE normalizing, so the single cheapest / single
// priciest outliers (here both off-ladder @null sentinels) cannot dominate. This CLIPS the
// realized cost ratio (~40x raw -> ~15x clipped on this dataset; swing ~2.1x -> ~1.7x) yet
// leaves the entire in-window cost ORDER intact. cost_efficiency is UNCHANGED (it is meant
// to be cost-dominant; clipping there would defeat its intent), so this is performance-only.
const PERF_COST_WINSOR = { p_low: 0.05, p_high: 0.95 };
function costPercentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}
const _PERF_COST_SORTED = UNIVERSE.map((p) => REAL_PERTOKEN.get(p.id)).sort((a, b) => a - b);
const PERF_COST_LOW = costPercentile(_PERF_COST_SORTED, PERF_COST_WINSOR.p_low);
const PERF_COST_HIGH = costPercentile(_PERF_COST_SORTED, PERF_COST_WINSOR.p_high);
function winsorizeCost(perToken) {
  return Math.min(Math.max(perToken, PERF_COST_LOW), PERF_COST_HIGH);
}
// Renormalize the winsorized cost by the winsorized universe max so cost_norm stays in (0,1].
const PERF_MAX_COST = Math.max(...UNIVERSE.map((p) => winsorizeCost(REAL_PERTOKEN.get(p.id))));
const PERF_COST_NORM = new Map();
for (const p of UNIVERSE) PERF_COST_NORM.set(p.id, winsorizeCost(REAL_PERTOKEN.get(p.id)) / PERF_MAX_COST);
const PERF_COST_WINSOR_AUDIT = {
  applies_to: "performance",
  method: "winsorize_percentile_window",
  p_low: PERF_COST_WINSOR.p_low,
  p_high: PERF_COST_WINSOR.p_high,
  clip_low_per_token: PERF_COST_LOW,
  clip_high_per_token: PERF_COST_HIGH,
  raw_cost_ratio: MAX_COST / Math.min(..._PERF_COST_SORTED),
  clipped_cost_ratio: PERF_COST_HIGH / PERF_COST_LOW,
  note:
    "Performance-branch only: per-pairing $/token clipped to the [p05,p95] universe window " +
    "before cost_norm (renormalized by the winsorized max), so an extreme price ratio cannot " +
    "swing the capability-dominant score (~R^0.2). cost_efficiency uses the raw cost_norm.",
};

// ---- two-branch power-law weights (owner schema C) --------------------------------
// score = perf_norm^a / cost_norm^b. The a:b ratio sets perf-vs-cost influence (log-space):
//   performance     a=0.8 b=0.2  -> 80:20 capability:cost (cost a light nudge)
//   cost_efficiency a=0.4 b=0.6  -> 40:60 perf:cost (cost-dominant)
const PERF_EXP = { a: 0.8, b: 0.2 };
const COST_EXP = { a: 0.4, b: 0.6 };

// refinement #3: rank-1 eligibility gate. The already-computed confidence/tierFloor (and the
// thinBasis flag) were previously IGNORED by powerScore, so a thin/uncorroborated pairing could
// reach perf=1.0 (max capability) and claim rank-1 on thin evidence alone. Per SOP-3 (thin ->
// down-weight) a pairing is thin-gated when its confidence is below "high"/"measured" OR its
// score rests entirely on neutralized single-observation evidence (thinBasis). A thin-gated
// pairing's effective perf is CAPPED strictly below the 1.0 ceiling, so a corroborated pairing
// (perf may reach 1.0) always outranks it: thin evidence alone can never claim max capability.
// Non-thin/corroborated pairings are untouched. (On the live dataset every measured pairing is
// "high" confidence, so this gate primarily bites via thinBasis; it remains a dormant safety
// guard for any future low/medium-confidence pairing — warn-not-fail, never sparsifies.)
const RANK1_THIN_PERF_CAP = 0.999; // strictly < 1.0 ceiling reserved for corroborated evidence
function isThinGated(s) {
  if (s.score === null) return false; // sentinels handled separately (placed strictly last)
  if (s.thinBasis) return true; // score rests entirely on neutralized single-obs evidence
  return s.confidence !== "high" && s.confidence !== "measured"; // low/medium = thin/uncorroborated
}

// Power-law branch score. Sentinels (perf=null) collapse to 0 here but are placed strictly
// last by rankBranch's SENTINEL value, not by this 0. `costNormMap` selects the cost basis:
// the performance branch passes PERF_COST_NORM (refinement #6 winsorized $/token); the
// cost_efficiency branch passes the raw COST_NORM (unchanged).
function powerScore(p, s, exponents, costNormMap = COST_NORM) {
  let perf = s.score === null ? 0 : Math.max(s.score, 0);
  // refinement #3: thin/uncorroborated pairings cannot claim the 1.0 max-capability ceiling.
  if (isThinGated(s)) perf = Math.min(perf, RANK1_THIN_PERF_CAP);
  const costNorm = costNormMap.get(p.id);
  return Math.pow(perf, exponents.a) / Math.pow(costNorm, exponents.b);
}

// Full per-pairing object (AUDIT shape). The lean canonical table keeps only
// {provider, model, effort, rank}; every other field here lives ONLY in the audit sibling.
function buildFullPairingObject(item, category) {
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
  if (ASSUMED_COST_PAIRINGS.has(p.id)) {
    basis.push(ASSUMED_COST_PAIRINGS.get(p.id));
  }
  if (item.costPerfOnly) {
    basis.push("[ASSUMPTION] performance-only pin: excluded from cost_efficiency scoring (owner: exception is performance-branch only); ranked by cost");
  }
  if (item.perfPinned) {
    const pin = MODELS[item.p.model]?.performance_rank_pin;
    basis.push(pin?.basis ?? "[ASSUMPTION] owner-directed performance rank-pin; performance branch only; not a measured benchmark");
  }
  if (s.score === null) {
    basis.push("data-free sentinel (no measured rows; SOP-1 guard-blocked)");
    // refinement #2: in a DATA_MISSING category the rank order is non-semantic.
    if (DATA_MISSING_CATEGORIES.has(category)) {
      basis.push("order non-semantic: data-missing category (canonical universe order, not capability)");
      // refinement #9: cite the SPECIFIC dataset gap reason, not the generic line.
      const reason = primaryGapReason(category);
      if (reason) basis.push(`[GAP] ${reason}`);
    }
  }
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

// #2 honest pairing-level coverage: per-category measured/positive ratios.
// Owner thresholds: warn when measured_pairing_ratio < 0.50; reclassify completeness_state
// as "thin_coverage" when overall measured_pairing_ratio < 0.30 (even if no DATA_MISSING cats).
const COVERAGE_WARN_THRESHOLD = 0.50;
const COVERAGE_BLOCK_THRESHOLD = 0.30;
function computePairingCoverageRatios() {
  const perCategory = {};
  let totalPairings = 0, totalMeasured = 0, totalPositive = 0;
  for (const category of SPINE) {
    if (category === "fallback_default") continue;
    if (COMPOSITE_CATEGORIES.has(category)) {
      perCategory[category] = {
        total_pairings: categoryUniverse(category).length,
        measured_pairings: null,
        positive_score_pairings: null,
        measured_pairing_ratio: null,
        positive_score_pairing_ratio: null,
      };
      continue;
    }
    const catUniverse = categoryUniverse(category);
    const scores = perfScores.get(category);
    const total = catUniverse.length;
    let measured = 0, positive = 0;
    for (const p of catUniverse) {
      const s = scores && scores.get(p.id);
      if (s && s.score !== null) {
        measured++;
        if (s.score > 0) positive++;
      }
    }
    const mRatio = total > 0 ? measured / total : 0;
    const pRatio = total > 0 ? positive / total : 0;
    perCategory[category] = {
      total_pairings: total,
      measured_pairings: measured,
      positive_score_pairings: positive,
      measured_pairing_ratio: Math.round(mRatio * 10000) / 10000,
      positive_score_pairing_ratio: Math.round(pRatio * 10000) / 10000,
    };
    if (!DATA_MISSING_CATEGORIES.has(category) && mRatio < COVERAGE_WARN_THRESHOLD) {
      console.warn(
        `#2 coverage: ${category} measured_pairing_ratio=${mRatio.toFixed(3)} < warn threshold ${COVERAGE_WARN_THRESHOLD}`
      );
    }
    totalPairings += total;
    totalMeasured += measured;
    totalPositive += positive;
  }
  const oMRatio = totalPairings > 0 ? totalMeasured / totalPairings : 0;
  const oPRatio = totalPairings > 0 ? totalPositive / totalPairings : 0;
  return {
    warn_threshold: COVERAGE_WARN_THRESHOLD,
    block_threshold: COVERAGE_BLOCK_THRESHOLD,
    overall: {
      total_pairings: totalPairings,
      measured_pairings: totalMeasured,
      positive_score_pairings: totalPositive,
      measured_pairing_ratio: Math.round(oMRatio * 10000) / 10000,
      positive_score_pairing_ratio: Math.round(oPRatio * 10000) / 10000,
    },
    per_category: perCategory,
  };
}
const PAIRING_COVERAGE_RATIOS = computePairingCoverageRatios();

function buildBaseFullBranch(branch, exponents) {
  const out = {};
  for (const category of BASE_SPINE) {
    const scores = perfScores.get(category);
    const dataMissing = DATA_MISSING_CATEGORIES.has(category);
    let universe = categoryUniverse(category);
    // Performance effort floor (owner directive, FINAL): drop every below-'high'
    // pairing from the performance branch before ranking. Purges existing
    // entries on every rebuild; cost_efficiency keeps the full universe.
    if (branch === "performance") {
      universe = universe.filter((p) => meetsPerformanceEffortFloor(p.effortK));
    }
    const { items } = rankBranch(branch, scores, exponents, universe, dataMissing, category);
    out[category] = items.map((item, idx) => {
      const obj = buildFullPairingObject(item, category);
      obj.rank = idx + 1;
      return obj;
    });
  }
  return out;
}

function dedupeCitations(citations) {
  const seen = new Set();
  const out = [];
  for (const citation of citations) {
    const key = JSON.stringify(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out;
}

function compositeCitations(parent, entry) {
  const detail = perfScores.get(parent)?.get(pairingId(entry.model, effortKey(entry.effort)));
  return detail ? citationsFor(detail, parent) : [];
}

function buildCompositeCategory(branch, category, branchFull) {
  const parents = COMPOSITE_PARENT_CATEGORIES[category];
  const byPairing = new Map();
  for (const parent of parents) {
    for (const entry of branchFull[parent] || []) {
      const key = pairingId(entry.model, effortKey(entry.effort));
      const item = byPairing.get(key) || {
        provider: entry.provider,
        model: entry.model,
        effort: entry.effort,
        parentRanks: [],
        parentRankNotes: [],
        citations: [],
      };
      item.parentRanks.push(entry.rank);
      item.parentRankNotes.push(`${parent}:${entry.rank}`);
      item.citations.push(...compositeCitations(parent, entry));
      byPairing.set(key, item);
    }
  }
  const items = [...byPairing.values()].map((item) => ({
    ...item,
    meanRank: item.parentRanks.reduce((sum, rank) => sum + rank, 0) / item.parentRanks.length,
  }));
  items.sort((a, b) => {
    if (a.meanRank !== b.meanRank) return a.meanRank - b.meanRank;
    const ae = EFFORT_INDEX.get(effortKey(a.effort)) ?? 0;
    const be = EFFORT_INDEX.get(effortKey(b.effort)) ?? 0;
    if (branch === "performance" && a.model === b.model && ae !== be) return be - ae;
    const av = MODELS[a.model].version_rank;
    const bv = MODELS[b.model].version_rank;
    const al = MODELS[a.model].version_lineage;
    const bl = MODELS[b.model].version_lineage;
    if (al === bl && av !== bv) return bv - av;
    if (a.model !== b.model) return a.model < b.model ? -1 : 1;
    if (ae !== be) return ae - be;
    return pairingId(a.model, effortKey(a.effort)) < pairingId(b.model, effortKey(b.effort)) ? -1 : 1;
  });
  return items.map((item, idx) => ({
    provider: item.provider,
    model: item.model,
    effort: item.effort,
    rank: idx + 1,
    score: 1 / item.meanRank,
    cost_figure_used: COST.get(pairingId(item.model, effortKey(item.effort)))?.perToken ?? null,
    interpolated: false,
    confidence: item.parentRanks.length === parents.length ? "high" : "medium",
    basis: [`parent-rank mean ${item.meanRank.toFixed(4)} (${item.parentRankNotes.join(", ")})`],
    citations: dedupeCitations(item.citations),
  }));
}

function buildFullBranch(branch, exponents) {
  const base = buildBaseFullBranch(branch, exponents);
  const out = {};
  for (const category of SPINE) {
    out[category] = COMPOSITE_CATEGORIES.has(category)
      ? buildCompositeCategory(branch, category, base)
      : base[category];
  }
  return out;
}

// Rank a branch by power-law score (desc), dense 1..N. Both branches use the same
// score = perf_norm^a / cost_norm^b form; only the exponents differ.
// `dataMissing` (refinement #2): when the WHOLE category is data-free (every pairing is a
// sentinel), the score tie cascades into version_rank-desc / model-id-ascending — a
// de-facto, MEANINGLESS capability proxy. For such categories we instead order by the
// canonical universe sequence (capability-NEUTRAL, documented, deterministic). The table
// still ends up dense 1..N; only the ORDERING BASIS among the (tied) sentinels changes.
function rankBranch(branch, scores, exponents, universe = UNIVERSE, dataMissing = false, category = null) {
  // refinement #6: the performance branch scores against the winsorized $/token cost_norm;
  // cost_efficiency keeps the raw cost_norm (it is intentionally cost-dominant).
  const costNormMap = branch === "performance" ? PERF_COST_NORM : COST_NORM;
  const observed = [];
  for (const p of universe) {
    const s = scores.get(p.id);
    if (s.score === null) continue;
    // performance-only pairings are excluded from cost_efficiency scoring
    if (branch === "cost_efficiency" && s.performanceOnly === true) continue;
    observed.push(powerScore(p, s, exponents, costNormMap));
  }
  const minObs = observed.length ? Math.min(...observed) : 0;
  const SENTINEL = observed.length ? minObs - 1e-6 : 0;

  const items = universe.map((p) => {
    const s = scores.get(p.id);
    const costPerfOnly = (branch === "cost_efficiency" && s.performanceOnly === true);
    const hasScore = s.score !== null && !costPerfOnly;
    const branchScore = hasScore ? powerScore(p, s, exponents, costNormMap) : SENTINEL;
    const perfPinned = branch === "performance" && (PERF_RANK_PINS.get(category)?.has(p.model) ?? false);
    return {
      p,
      s,
      hasScore,
      costPerfOnly,
      branchScore,
      effIdx: EFFORT_INDEX.get(p.effortK) ?? 0,
      versionRank: MODELS[p.model].version_rank,
      lineage: MODELS[p.model].version_lineage,
      perfPinned,
    };
  });

  items.sort((a, b) => {
    // performance_rank_pin: pinned pairings sort above ALL non-pinned (performance branch only).
    const aPin = a.perfPinned;
    const bPin = b.perfPinned;
    if (aPin !== bPin) return aPin ? -1 : 1;
    if (aPin && bPin && a.effIdx !== b.effIdx) return b.effIdx - a.effIdx;
    // #1 fix (performance branch only): same model + equal measured perf_norm → effort descending
    // (max-effort first), before cost can discriminate. Cost separates only ACROSS models here.
    // Bound: non-null, non-interpolated scores; sentinels (null) stay last via SENTINEL constant.
    if (
      branch === "performance" &&
      a.p.model === b.p.model &&
      a.s.score !== null && b.s.score !== null &&
      a.s.score === b.s.score &&
      a.effIdx !== b.effIdx
    ) return b.effIdx - a.effIdx;
    if (b.branchScore !== a.branchScore) return b.branchScore - a.branchScore;
    // cost_efficiency sentinels: cheaper first = better cost_efficiency. Precedes dataMissing so
    // DATA_MISSING categories (all sentinels) rank by cost, not universe order.
    if (branch === "cost_efficiency" && a.branchScore === SENTINEL && b.branchScore === SENTINEL) {
      const ca = COST.get(a.p.id)?.perToken ?? Infinity;
      const cb = COST.get(b.p.id)?.perToken ?? Infinity;
      if (ca !== cb) return ca - cb;
    }
    // refinement #2: data-missing category -> ALL sentinels tie on score; do NOT let the
    // version_rank/model-id chain below stand in as a fake capability ranking. Break the tie
    // by canonical universe order only (capability-neutral, deterministic). Still dense 1..N.
    if (dataMissing) {
      const ua = UNIVERSE_ORDER.get(a.p.id) ?? Number.MAX_SAFE_INTEGER;
      const ub = UNIVERSE_ORDER.get(b.p.id) ?? Number.MAX_SAFE_INTEGER;
      if (ua !== ub) return ua - ub;
      return a.p.id < b.p.id ? -1 : 1;
    }
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

// Performance effort floor vs performance_rank_pin: the floor is FINAL and
// wins, but a pin whose model has NO surviving >=high pairing in a pinned
// category would otherwise no-op silently — surface the directive conflict.
for (const [category, models] of PERF_RANK_PINS) {
  for (const model of models) {
    if (!performanceFull[category]?.some((e) => e.model === model)) {
      console.warn(
        `performance effort floor purged ALL pairings of rank-pinned model '${model}' from ` +
        `performance.${category} — the pin no-ops (floor is FINAL and overrides the pin)`
      );
    }
  }
}

// Performance effort floor — post-build hard assertion (belt to the filter's
// suspenders). A single below-'high' pairing in any performance category fails
// the build loud; nothing may re-introduce one downstream of the filter.
for (const [category, entries] of Object.entries(performanceFull)) {
  for (const e of entries) {
    const ek = effortKey(e.effort);
    if (!meetsPerformanceEffortFloor(ek)) {
      throw new Error(
        `performance effort floor violated: ${e.model}@${ek} ranked in performance.${category} ` +
        `(below '${PERFORMANCE_MIN_EFFORT}'; owner directive FINAL — no exceptions)`
      );
    }
  }
}

// ---- citations for audit ----------------------------------------------------------
function citationsFor(detail, category) {
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
    // refinement #7: emit the row's NUMERIC tier directly on the citation, ALONGSIDE the
    // provenance label. Previously the [Tn] tier was only ever encoded into `cite.label`, and
    // a provenance label ([SEED]/[INFERRED]/[ASSUMPTION]) on the row MASKED it — so the seed
    // harvester (which regexed /^\[T(\d)\]$/ off the label) read tier 0 for every such site.
    // Carrying the numeric tier on its own field lets update_seed_sites read the real tier.
    const numericTier = Number.isFinite(Number(r.tier)) ? Number(r.tier) : null;
    if (numericTier !== null) cite.tier = numericTier;
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
    // refinement #9: for a DATA_MISSING category, cite the SPECIFIC dataset gap reason and
    // flag the non-semantic ordering, instead of the generic "no measured benchmark rows".
    const gapReason = DATA_MISSING_CATEGORIES.has(category) ? primaryGapReason(category) : null;
    cites.push({
      url: "",
      retrieved_at: DEFAULT_RETRIEVED_AT,
      annotation: gapReason
        ? `Data-missing category (rank order non-semantic: canonical universe order, not capability). Gap reason: ${gapReason}`
        : "Data-free sentinel: no measured benchmark rows for this pairing in this category.",
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
  if (COMPOSITE_CATEGORIES.has(category)) {
    compositeWeights[category] = Object.fromEntries(
      COMPOSITE_PARENT_CATEGORIES[category].map((parent) => [parent, 1 / 3])
    );
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
  version: "2.1.0",
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
      const detail = perfScores.get(category)?.get(pairingId(e.model, effortKey(e.effort)));
      const { _detail, citations, ...rest } = e;
      return { ...rest, citations: citations || citationsFor(detail, category) };
    });
  }
  return out;
}

// refinement #10: polarity-by-absence warnings, deterministically ordered (SPINE category
// #24: hard-fail if any high-risk category (security_review/debugging/quality_review) has a
// benchmark with inferred polarity. Must be checked AFTER buildCategoryScores populates it.
if (POLARITY_ERRORS.length > 0) {
  const msgs = POLARITY_ERRORS.map((e) => `  ${e.category} benchmark "${e.benchmark}" assumed ${e.assumed}`).join("\n");
  throw new Error(
    `#24 polarity explicit-or-fail: ${POLARITY_ERRORS.length} benchmark(s) in high-risk categories ` +
    `lack explicit row.polarity. Add polarity field or extend isLowerBetter():\n${msgs}`
  );
}

// order, then benchmark name). Populated during buildCategoryScores; additive audit-only.
const SPINE_ORDER = new Map(SPINE.map((c, i) => [c, i]));
const polarityInferenceWarnings = [...POLARITY_WARNINGS.values()].sort((a, b) => {
  const ca = SPINE_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER;
  const cb = SPINE_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  return a.benchmark < b.benchmark ? -1 : a.benchmark > b.benchmark ? 1 : 0;
});

// refinement #3: neutralized single-observation benchmarks, deterministically ordered
// (SPINE category order, then benchmark, then model). Populated during buildCategoryScores;
// additive audit-only — surfaces every thin row that was down-weighted from MAX capability.
const neutralizedBenchmarks = [...NEUTRALIZED_BENCHMARKS].sort((a, b) => {
  const ca = SPINE_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER;
  const cb = SPINE_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  if (a.benchmark !== b.benchmark) return a.benchmark < b.benchmark ? -1 : 1;
  return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
});

// refinement #8: scale-anchor normalization sources, deterministically ordered (SPINE
// category order, then benchmark, then role min<max, then model, then url). Populated during
// buildCategoryScores; additive audit-only. Surfaces every source row that DEFINED a category
// benchmark's min/max normalization anchor so a scale-calibrating source that was not attached
// to a ranked pairing still reaches the audit (and the seed, as source_class=scale_anchor).
const normalizationSources = [...NORMALIZATION_SOURCES].sort((a, b) => {
  const ca = SPINE_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER;
  const cb = SPINE_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  if (a.benchmark !== b.benchmark) return a.benchmark < b.benchmark ? -1 : 1;
  if (a.role !== b.role) return a.role < b.role ? -1 : 1; // "max" < "min" lexically -> max first
  if (a.model !== b.model) return a.model < b.model ? -1 : 1;
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
});

// ---- refinements #5/#4/#16/#18: run_manifest umbrella (additive AUDIT metadata) -----
// ONE audit.metadata.run_manifest block. The validator ignores extra audit.metadata.* keys,
// so this is purely additive (stays green). HONESTY: any field NOT genuinely derivable from
// the ephemeral dataset / this offline single-process build is emitted as explicit null or
// "unavailable_offline" rather than fabricated. The STRUCTURE is the deliverable.
//
// Optional run-context env (read but NOT required — null when unset; the present run sets none
// of these, so they resolve to null honestly rather than to a fabricated value).
// refinement #21: run_id is NO LONGER null — it is the shared run-id resolved above (env RUN_ID,
// the temp run-id file, or the deterministic `run-${DATASET_DATE}` default) and the seed stamp
// references the SAME id, so both artifacts are provably from one run.
const RUN_TRIGGER = process.env.RUN_TRIGGER || null;
const RECENCY_WINDOW = process.env.RECENCY_WINDOW || null;

// provider_scope / provider_coverage (#18 approach A — transparency-only, NO gating).
// realized = provider families actually present in the universe (derivable). requested =
// from env (REQUESTED_PROVIDERS, comma-separated) if supplied, else defaults to realized.
// degraded = realized fewer than requested. NO auto-degrade, NO gating on this signal.
const REALIZED_FAMILIES = [...new Set([...UNIVERSE_MODELS].map((m) => providerOf(m)))].sort();
const REQUESTED_FAMILIES = (process.env.REQUESTED_PROVIDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .sort();
const _requested = REQUESTED_FAMILIES.length ? REQUESTED_FAMILIES : REALIZED_FAMILIES;
const PROVIDER_COVERAGE = {
  requested: _requested,
  realized: REALIZED_FAMILIES,
  degraded: REALIZED_FAMILIES.length < _requested.length,
};
// #30: neutral provider_mix field. Purely informational — invariant #5 guarantees single-family
// is first-class, never a degrade. "partial" only when a multi-scope run realizes one family
// (requires owner sign-off per the within-family adversary note in adversarial-loop.md).
const PROVIDER_MIX = REALIZED_FAMILIES.length > 1
  ? "multi_family"
  : (PROVIDER_COVERAGE.degraded ? "partial" : "single_family");

// #9 provider-bias metrics: computed from citation rows (via _detail.rows[].tier) rather than
// seed rows. Diagnostic only — not a gate (gameable as a target). Audit-only; lean table lean.
function computeProviderBiasMetrics(perfFull, costFull) {
  const provRanks = {}; // provider -> {performance: [], cost_efficiency: []}
  const provTierCounts = {}; // provider -> {tier: count}
  const catBalance = {}; // category -> {provider: citation_count}
  for (const [branch, full] of [["performance", perfFull], ["cost_efficiency", costFull]]) {
    for (const [category, pairings] of Object.entries(full)) {
      if (category === "fallback_default") continue;
      for (const e of pairings) {
        const prov = e.provider || providerOf(e.model);
        if (!provRanks[prov]) provRanks[prov] = { performance: [], cost_efficiency: [] };
        provRanks[prov][branch].push(e.rank);
        if (!provTierCounts[prov]) provTierCounts[prov] = {};
        for (const r of (e._detail && e._detail.rows) || []) {
          const t = String(r.tier !== undefined ? Number(r.tier) : 0);
          provTierCounts[prov][t] = (provTierCounts[prov][t] || 0) + 1;
        }
        if (branch === "performance") {
          if (!catBalance[category]) catBalance[category] = {};
          catBalance[category][prov] = (catBalance[category][prov] || 0) + 1;
        }
      }
    }
  }
  const rankStats = {};
  for (const [prov, brs] of Object.entries(provRanks)) {
    rankStats[prov] = {};
    for (const [branch, ranks] of Object.entries(brs)) {
      if (!ranks.length) { rankStats[prov][branch] = null; continue; }
      const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
      rankStats[prov][branch] = { mean: Math.round(mean * 100) / 100, count: ranks.length };
    }
  }
  const asymmetryFlags = [];
  for (const [prov, byTier] of Object.entries(provTierCounts)) {
    const total = Object.values(byTier).reduce((a, b) => a + b, 0);
    const tier1 = byTier["1"] || 0;
    const indep = Object.entries(byTier).filter(([t]) => Number(t) >= 2).reduce((a, [, v]) => a + v, 0);
    if (total > 0 && tier1 / total > 0.9) {
      asymmetryFlags.push({ provider: prov, vendor_card_pct: Math.round(tier1 / total * 1000) / 10, independent_pct: Math.round(indep / total * 1000) / 10, total_citations: total });
    }
  }
  return {
    provider_rank_stats: rankStats,
    provider_citations_by_tier: provTierCounts,
    category_family_balance: catBalance,
    asymmetry_flags: asymmetryFlags,
    note: "diagnostic only — not a gate",
  };
}
const PROVIDER_BIAS_METRICS = computeProviderBiasMetrics(performanceFull, costEfficiencyFull);

// model-discovery diff (derivable): discovered = every model spec in the dataset; included =
// models that actually appear in the ranked universe. Identical on this dataset (no model is
// discovered-but-excluded), but the diff structure surfaces any future divergence.
const DISCOVERED_MODELS = [...UNIVERSE_MODELS].sort();
const INCLUDED_MODELS = [...new Set(UNIVERSE.map((p) => p.model))].sort();
const MODEL_DISCOVERY = {
  discovered: DISCOVERED_MODELS,
  included: INCLUDED_MODELS,
  discovered_count: DISCOVERED_MODELS.length,
  included_count: INCLUDED_MODELS.length,
  discovered_not_included: DISCOVERED_MODELS.filter((m) => !INCLUDED_MODELS.includes(m)),
};

// per-category measured-vs-sentinel counts (DERIVABLE from CATEGORY_COMPLETENESS): a category
// is "measured" when >=1 universe pairing earns a real score, else DATA_MISSING (sentinel-only).
const _measuredCats = SPINE.filter((c) => CATEGORY_COMPLETENESS[c] === "measured");
const _dataMissingCats = SPINE.filter((c) => CATEGORY_COMPLETENESS[c] === "DATA_MISSING");
const CATEGORY_COVERAGE = {
  total_categories: SPINE.length,
  measured_categories: _measuredCats.length,
  data_missing_categories: _dataMissingCats.length,
  measured: _measuredCats,
  data_missing: _dataMissingCats,
};

// dropped_pairings: rows the builder discarded or neutralized (reuses what the builder already
// knows). withdrawn rows are discarded entirely (SOP-3); neutralized thin single-observation
// benchmarks are down-weighted from MAX capability (refinement #3). Both are derivable.
const DROPPED_PAIRINGS = {
  withdrawn: (dataset.withdrawn || []).map((w) => ({
    model: w.model,
    category: w.category,
    benchmark: w.benchmark || null,
  })),
  withdrawn_count: (dataset.withdrawn || []).length,
  neutralized_count: neutralizedBenchmarks.length,
};

// #4 completeness_state in {full, thin_coverage, bounded_reuse, gap_stubbed, phase2_deferred},
// chosen HONESTLY: gap_stubbed when any DATA_MISSING category; thin_coverage when no DATA_MISSING
// but overall measured_pairing_ratio < COVERAGE_BLOCK_THRESHOLD (0.30); otherwise "full".
// "full" now requires BOTH category-level and pairing-level coverage. (#2 honest coverage fix)
const _overallMeasuredRatio = PAIRING_COVERAGE_RATIOS.overall.measured_pairing_ratio;
const COMPLETENESS_STATE =
  _dataMissingCats.length > 0
    ? "gap_stubbed"
    : _overallMeasuredRatio < COVERAGE_BLOCK_THRESHOLD
    ? "thin_coverage"
    : "full";
if (COMPLETENESS_STATE === "gap_stubbed") {
  console.warn(
    `run_manifest.completeness_state=gap_stubbed (${_dataMissingCats.length} DATA_MISSING ` +
    `categor${_dataMissingCats.length === 1 ? "y" : "ies"}: ${_dataMissingCats.join(", ")}). ` +
    `Recorded audit-only; not gated (keep-green).`
  );
} else if (COMPLETENESS_STATE === "thin_coverage") {
  console.warn(
    `run_manifest.completeness_state=thin_coverage: overall measured_pairing_ratio=` +
    `${_overallMeasuredRatio.toFixed(3)} < block threshold ${COVERAGE_BLOCK_THRESHOLD}. ` +
    `Recorded audit-only; not gated (keep-green). (#2)`
  );
}

// #16 agent-provenance: which agent produced vs critiqued each artifact. No agent/build context
// is available in this offline single-process build, so each slot is explicit null /
// "unavailable_offline" rather than fabricated (HONESTY directive). Structure is the deliverable.
const _agentEnv = (name) => process.env[name] || null;
const AGENT_PROVENANCE = {
  status: "unavailable_offline",
  routing_table: { produced_by: _agentEnv("AGENT_PRODUCER"), critiqued_by: _agentEnv("AGENT_CRITIC") },
  audit: { produced_by: _agentEnv("AGENT_PRODUCER"), critiqued_by: _agentEnv("AGENT_CRITIC") },
  dataset: { produced_by: _agentEnv("DATASET_PRODUCER"), critiqued_by: _agentEnv("DATASET_CRITIC") },
};

// #21 drift vs prior: use the GIT-committed baseline (git show HEAD:path), not the working-tree
// file which may already be from a prior build this session. Records prior/current SHA256 +
// semantic diffs. Falls back gracefully on any error (git absent, no commit, unreadable — never a
// build failure; drift block is null/status-annotated to signal degraded baseline honestly).
function priorAuditDrift() {
  const relPath = "src/routing-table-audit.json";
  // Try to read the committed version via git
  let priorRaw = null;
  let priorGitRef = null;
  try {
    const r = spawnSync("git", ["show", `HEAD:${relPath}`], { cwd: ROOT, encoding: "buffer" });
    if (r.status === 0 && r.stdout && r.stdout.length > 0) {
      priorRaw = r.stdout.toString("utf8").replace(/^﻿/, "");
      priorGitRef = "HEAD";
    } else {
      return { status: "no_committed_baseline", note: "HEAD does not contain src/routing-table-audit.json" };
    }
  } catch {
    return { status: "git_unavailable", note: "git not found or errored; drift baseline skipped" };
  }
  let prior;
  try { prior = JSON.parse(priorRaw); } catch {
    return { status: "prior_baseline_unreadable", prior_git_ref: priorGitRef };
  }
  const priorSha = createHash("sha256").update(priorRaw).digest("hex");
  const pm = prior && prior.metadata ? prior.metadata : {};
  const priorUniverse = Array.isArray(pm.model_effort_universe) ? pm.model_effort_universe.length : null;
  const priorNeutralized = Array.isArray(pm.neutralized_benchmarks) ? pm.neutralized_benchmarks.length : null;
  const priorCompleteness = pm.category_completeness && typeof pm.category_completeness === "object"
    ? Object.values(pm.category_completeness).filter((v) => v === "DATA_MISSING").length
    : null;
  return {
    prior_git_ref: priorGitRef,
    prior_sha256: priorSha,
    prior_generated_at: typeof pm.generated_at === "string" ? pm.generated_at : null,
    universe_count: { prior: priorUniverse, current: UNIVERSE_IDS.length },
    neutralized_count: { prior: priorNeutralized, current: neutralizedBenchmarks.length },
    data_missing_categories: { prior: priorCompleteness, current: _dataMissingCats.length },
  };
}
const PRIOR_AUDIT_DRIFT = priorAuditDrift();

const RUN_MANIFEST = {
  // run identity / context. refinement #21: run_id is the shared run-id (deterministic from
  // DATASET_DATE, env-/run-id-file-overridable) that the seed stamp ALSO references, so the two
  // artifacts are provably one run. trigger/recency stay null when their env is unset (honest).
  run_id: RUN_ID,
  trigger: RUN_TRIGGER,
  recency_window: RECENCY_WINDOW,
  provider_scope: REALIZED_FAMILIES,
  generated_at: GENERATED_AT,
  // #4 completeness umbrella
  completeness_state: COMPLETENESS_STATE,
  // model discovery diff (derivable)
  model_discovery: MODEL_DISCOVERY,
  // source attempt counts by provider/category/outcome — NOT derivable: the ephemeral dataset
  // carries no per-source attempt log in this offline build.
  source_attempt_counts: "unavailable_offline",
  // phase statuses + budget — NOT derivable in this single-process build.
  phase_statuses: "unavailable_offline",
  budget_consumed: null,
  // per-category measured-vs-sentinel coverage (derivable)
  category_coverage: CATEGORY_COVERAGE,
  // #2 honest pairing-level coverage: measured/positive ratios per category + overall.
  // completeness_state="full" now requires overall measured_pairing_ratio >= block threshold (0.30).
  pairing_coverage_ratios: PAIRING_COVERAGE_RATIOS,
  // dropped/neutralized pairings the builder already knows about (derivable)
  dropped_pairings: DROPPED_PAIRINGS,
  // #18 approach A provider coverage (transparency-only, no gating)
  provider_coverage: PROVIDER_COVERAGE,
  // #30: neutral provider_mix — informational only; single_family|multi_family|partial; no degrade semantics
  provider_mix: PROVIDER_MIX,
  // #16 agent provenance (structure; null/unavailable_offline when no agent context)
  agent_provenance: AGENT_PROVENANCE,
  // drift vs prior committed audit (null when no prior audit existed at build time)
  drift_vs_prior_audit: PRIOR_AUDIT_DRIFT,
};

const auditTable = {
  metadata: {
    author: "Lexi Blackburn",
    author_url: "https://github.com/Heretyc/",
    generated: GENERATED_MONTH,
    generated_at: GENERATED_AT,
    schema_version: "2",
    version: "2.1.0",
    audits: "src/routing-table.json",
    seed_sites_pointer: "research-seed-sites.json",
    model_effort_universe: UNIVERSE_IDS,
    polarity_inference_warnings: polarityInferenceWarnings,
    // refinement #3: every benchmark dropped/neutralized because its normalization basis had
    // <2 independent reporters (single observation). Each was normalized to a neutral value so
    // a lone uncorroborated row could not define the category max (SOP-3 thin -> down-weight).
    neutralized_benchmarks: neutralizedBenchmarks,
    // refinement #8: the source row(s) that DEFINED each category benchmark's min/max
    // normalization anchor (role: "min"|"max"; thin==single-observation min==max population).
    // These calibrate the scale even when not attached to a ranked pairing, so they are
    // surfaced here and harvested into the seed as source_class=scale_anchor. Additive only.
    normalization_sources: normalizationSources,
    // #18: per-benchmark normalization metadata (row_count, independent_reporter_count,
    // score_range, is_thin). Rank-band Bradley-Terry CIs deferred (needs pairwise win data).
    benchmark_normalization_meta: BENCHMARK_META,
    // refinement #14 / #31: benchmarks keyed under MORE THAN ONE category (single-category-keying
    // rule violation). SURFACED for owner adjudication — NEVER auto-reassigned or auto-failed
    // (DO-NOT-ADOPT #3: hard-fail on cross-category reuse would break regen-green and is wrong
    // because the dataset owner decides which category is most-diagnostic, not the builder).
    // Rows are retained in all categories they appear under; the owner resolves at their cadence.
    cross_category_benchmarks: CROSS_CATEGORY_BENCHMARKS,
    // refinement #14: off-map rows (benchmark under a category whose canonical keying omits it).
    // The current dataset has none; a future off-map row THROWS (fail-loud). Recorded here only if
    // a future dataset already carried off-map rows (downgraded to warning to keep regen green).
    off_map_rows: OFF_MAP_ROWS,
    off_map_enforcement: OFF_MAP_DOWNGRADED ? "warning_downgraded" : "throw_on_future_off_map",
    // refinement #1: build-time coverage floor — per-category "DATA_MISSING" | "measured".
    // RECORDS state; never fails the build, never makes the lean table sparse.
    category_completeness: CATEGORY_COMPLETENESS,
    composite_inference: {
      method: "simple_mean_of_available_parent_ranks_per_branch",
      parent_categories: COMPOSITE_PARENT_CATEGORIES,
    },
    // refinement #9: dataset.gaps surfaced into the audit (reason + affected model +
    // remediation), grouped per category with each DATA_MISSING category's coverage state.
    gaps: GAPS_AUDIT,
    // #12 dataset hash + shape summary for replay. Owner decision: keep exactly 3 artifacts;
    // hash + summary embedded in audit only (no 4th snapshot file). SHA-256 of raw bytes.
    raw_inputs_hash: { algorithm: "sha256", hex: DATASET_SHA256, short: DATASET_HASH_SHORT, path: DATASET_PATH },
    dataset_shape_summary: {
      model_count: Object.keys(dataset.models || {}).length,
      category_count: Object.keys(dataset.category_benchmarks || {}).length,
      routing_category_count: SPINE.length,
      directly_benchmarked_category_count: BASE_SPINE.length,
      universe_count: Array.isArray(dataset.model_effort_universe) ? dataset.model_effort_universe.length : null,
      gap_count: Array.isArray(dataset.gaps) ? dataset.gaps.length : 0,
    },
    // #4 per-judge rankings + adversarial passes: injected by the orchestrator via env vars
    // (ADVERSARIAL_PASSES_JSON). The offline builder cannot run the adversarial loop itself;
    // the structure below is the injection contract — all fields present, null when unavailable.
    adversarial_passes: (() => {
      const raw = process.env.ADVERSARIAL_PASSES_JSON;
      if (raw) { try { return JSON.parse(raw); } catch {} }
      return {
        status: "unavailable_offline",
        passes: null,
        inter_judge_dissent: null,
        reconciliation_note: null,
      };
    })(),
    // #9 provider-bias metrics: per-provider citation counts by tier, mean rank per branch,
    // per-category evidence-family balance, asymmetry flags. Diagnostic only, not a gate.
    provider_bias_metrics: PROVIDER_BIAS_METRICS,
    // refinements #5/#4/#16/#18: run_manifest umbrella — additive audit metadata (run identity,
    // completeness_state, model-discovery diff, per-category coverage, dropped/neutralized
    // pairings, provider_coverage transparency, agent provenance, drift vs prior audit). Fields
    // not genuinely derivable in this offline build are explicit null / "unavailable_offline".
    run_manifest: RUN_MANIFEST,
    realized_exponents: {
      performance: { a: PERF_EXP.a, b: PERF_EXP.b },
      cost_efficiency: { a: COST_EXP.a, b: COST_EXP.b },
    },
    // refinement #6: the winsorization guard applied to the performance-branch cost term so an
    // extreme price ratio cannot dominate the capability-dominant score. cost_efficiency is
    // unaffected and continues to use the raw cost_norm.
    performance_cost_winsorization: PERF_COST_WINSOR_AUDIT,
    cost_figure_methodology:
      "SOP-2 worst-case $/token: constant 100K-in / 20K-visible-out blend, opus tokenizer " +
      "inflation 1.35x (1.4x deprecated), effort hidden-output multiplier ladder, gpt-5.5 " +
      "272K cliff sub-cliff at this blend. cost_norm = $/token / universe-max in (0,1]. " +
      "Branch score = perf_norm^a / cost_norm^b. Refinement #6: the PERFORMANCE branch " +
      "winsorizes $/token to the [p05,p95] universe window before cost_norm (see " +
      "performance_cost_winsorization) so an extreme price ratio cannot swing the " +
      "capability-dominant score; cost_efficiency uses the raw cost_norm.",
    formula_definitions: {
      normalization: NORMALIZATION,
      composite_weights: compositeWeights,
      sentiment_cap: SENTIMENT_CAP,
      performance_branch_tiebreak:
        "same-model equal measured perf_norm → effort descending (max-effort first) before cost " +
        "can discriminate. Cost separates only across models on the performance branch. (#1 fix)",
    },
    cost_blend: {
      label: "reference-blend cost",
      input_tokens: COST_BLEND.input_tokens,
      output_tokens: COST_BLEND.output_tokens,
      price_cliff_side: PRICE_CLIFF_SIDE,
      above_cliff_cost_figure: ABOVE_CLIFF_COST_FIGURE,
    },
  },
  performance: auditBranch(performanceFull),
  cost_efficiency: auditBranch(costEfficiencyFull),
};

// ---- write (#25 atomic: stage to .tmp, validate set, rename to final) ----------------
// Stage both artifacts before promoting to avoid a partial-write state.
const STAGE_PROVIDER = OUT_PROVIDER + ".tmp";
const STAGE_AUDIT = OUT_AUDIT + ".tmp";
const providerJson = JSON.stringify(providerTable, null, 2) + "\n";
const auditJson = JSON.stringify(auditTable, null, 2) + "\n";
writeFileSync(STAGE_PROVIDER, providerJson, "utf8");
writeFileSync(STAGE_AUDIT, auditJson, "utf8");
// Staged shape sanity: both parse as JSON (if either throws, staged files remain for debug)
JSON.parse(providerJson);
JSON.parse(auditJson);
// Promote (rename is atomic on the same filesystem; replaces existing final file)
renameSync(STAGE_PROVIDER, OUT_PROVIDER);
renameSync(STAGE_AUDIT, OUT_AUDIT);

// ---- report -----------------------------------------------------------------------
console.log("build_routing_table: emitted");
console.log("  - src/routing-table.json (lean canonical)");
console.log("  - src/routing-table-audit.json (full audit + citations)");
console.log(`  performance exponents a=${PERF_EXP.a} b=${PERF_EXP.b}`);
console.log(`  cost_efficiency exponents a=${COST_EXP.a} b=${COST_EXP.b}`);
console.log(`  price_cliff_side=${PRICE_CLIFF_SIDE}`);
