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
function resolveRunId() {
  if (process.env.RUN_ID) return process.env.RUN_ID;
  if (existsSync(RUN_ID_PATH)) {
    const fromFile = readFileSync(RUN_ID_PATH, "utf8").replace(/^﻿/, "").trim();
    if (fromFile) return fromFile;
  }
  return `run-${DATASET_DATE}`;
}
const RUN_ID = resolveRunId();
// Persist the resolved run-id so the seed-updater binds to this exact run (best-effort; a write
// failure must not fail the build — the seed-updater falls back to the same deterministic default).
try {
  writeFileSync(RUN_ID_PATH, RUN_ID + "\n", "utf8");
} catch (e) {
  console.warn(`refinement #21: could not persist run-id to ${RUN_ID_PATH}: ${e.message}`);
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
for (const category of SPINE) {
  const set = new Set();
  for (const row of dataset.category_benchmarks[category] || []) {
    if (isWithdrawn(category, row)) continue;
    if (row.benchmark) set.add(row.benchmark);
  }
  ALLOWED_BENCHMARKS.set(category, set);
}
// (a) cross-category: benchmark -> sorted SPINE-ordered categories it is keyed under.
const _benchToCats = new Map();
for (const category of SPINE) {
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
for (const category of SPINE) {
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
    result.set(p.id, {
      score: performanceRaw,
      rows: selected,
      confidence,
      tierFloor: Number.isFinite(tierFloor) ? tierFloor : null,
      thinBasis, // refinement #3: score rests entirely on neutralized single-obs evidence
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

// ---- refinements #1/#2/#9: data-missing coverage floor + non-semantic order + gaps --
// AUDIT-ONLY transparency (plus a sentinel-ORDER change within still-dense categories).
//
// #1 coverage-floor: a category is DATA_MISSING when NO universe pairing earns a real
// (non-null) score — i.e. every row is a data-free sentinel, so there is no measured
// benchmark signal at all. This RECORDS state in the audit; it never fails the build and
// never makes the lean table sparse (every category stays dense 1..N).
function categoryHasMeasuredSignal(category) {
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
const _PERF_COST_SORTED = UNIVERSE.map((p) => COST.get(p.id).perToken).sort((a, b) => a - b);
const PERF_COST_LOW = costPercentile(_PERF_COST_SORTED, PERF_COST_WINSOR.p_low);
const PERF_COST_HIGH = costPercentile(_PERF_COST_SORTED, PERF_COST_WINSOR.p_high);
function winsorizeCost(perToken) {
  return Math.min(Math.max(perToken, PERF_COST_LOW), PERF_COST_HIGH);
}
// Renormalize the winsorized cost by the winsorized universe max so cost_norm stays in (0,1].
const PERF_MAX_COST = Math.max(...UNIVERSE.map((p) => winsorizeCost(COST.get(p.id).perToken)));
const PERF_COST_NORM = new Map();
for (const p of UNIVERSE) PERF_COST_NORM.set(p.id, winsorizeCost(COST.get(p.id).perToken) / PERF_MAX_COST);
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

function buildFullBranch(branch, exponents) {
  const out = {};
  for (const category of SPINE) {
    const scores = perfScores.get(category);
    const dataMissing = DATA_MISSING_CATEGORIES.has(category);
    const { items } = rankBranch(branch, scores, exponents, categoryUniverse(category), dataMissing);
    out[category] = items.map((item, idx) => {
      const obj = buildFullPairingObject(item, category);
      obj.rank = idx + 1;
      return obj;
    });
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
function rankBranch(branch, scores, exponents, universe = UNIVERSE, dataMissing = false) {
  // refinement #6: the performance branch scores against the winsorized $/token cost_norm;
  // cost_efficiency keeps the raw cost_norm (it is intentionally cost-dominant).
  const costNormMap = branch === "performance" ? PERF_COST_NORM : COST_NORM;
  const observed = [];
  for (const p of universe) {
    const s = scores.get(p.id);
    if (s.score === null) continue;
    observed.push(powerScore(p, s, exponents, costNormMap));
  }
  const minObs = observed.length ? Math.min(...observed) : 0;
  const SENTINEL = observed.length ? minObs - 1e-6 : 0;

  const items = universe.map((p) => {
    const s = scores.get(p.id);
    const hasScore = s.score !== null;
    const branchScore = hasScore ? powerScore(p, s, exponents, costNormMap) : SENTINEL;
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
      return { ...rest, citations: citationsFor(detail, category) };
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

// #4 completeness_state in {full, bounded_reuse, gap_stubbed, phase2_deferred}, chosen HONESTLY
// from build signals: any DATA_MISSING (sentinel-stubbed) category present => "gap_stubbed";
// otherwise "full". bounded_reuse / phase2_deferred are not signalled by this offline build.
const COMPLETENESS_STATE = _dataMissingCats.length > 0 ? "gap_stubbed" : "full";
// validate_provider WARNs (not fails) when state != full ONLY if that warn can be added WITHOUT
// flipping the validator red on the regenerated audit. On this dataset the regenerated state is
// "gap_stubbed" (4 DATA_MISSING categories), so a hard validator warn would be noisy/at-risk;
// per the keep-green principle we record the state audit-only and emit a build-time console.warn
// that does NOT affect the build exit code (the deferral is noted here and in the handoff).
if (COMPLETENESS_STATE !== "full") {
  console.warn(
    `run_manifest.completeness_state=${COMPLETENESS_STATE} (${_dataMissingCats.length} DATA_MISSING ` +
    `categor${_dataMissingCats.length === 1 ? "y" : "ies"}: ${_dataMissingCats.join(", ")}). ` +
    `Recorded audit-only; not gated (keep-green).`
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

// drift vs prior audit: if a prior src/routing-table-audit.json exists at build time (BEFORE we
// overwrite it below), include a small drift summary (counts changed). Else null. Read defensively
// — a malformed/absent prior audit yields a null drift block, never a build failure.
function priorAuditDrift() {
  if (!existsSync(OUT_AUDIT)) return null;
  let prior;
  try {
    prior = readJsonStripBom(OUT_AUDIT);
  } catch {
    return { status: "prior_audit_unreadable" };
  }
  const pm = prior && prior.metadata ? prior.metadata : {};
  const priorUniverse = Array.isArray(pm.model_effort_universe) ? pm.model_effort_universe.length : null;
  const priorNeutralized = Array.isArray(pm.neutralized_benchmarks) ? pm.neutralized_benchmarks.length : null;
  const priorCompleteness = pm.category_completeness && typeof pm.category_completeness === "object"
    ? Object.values(pm.category_completeness).filter((v) => v === "DATA_MISSING").length
    : null;
  return {
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
  // dropped/neutralized pairings the builder already knows about (derivable)
  dropped_pairings: DROPPED_PAIRINGS,
  // #18 approach A provider coverage (transparency-only, no gating)
  provider_coverage: PROVIDER_COVERAGE,
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
    version: "2.0.0",
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
    // refinement #14: benchmarks keyed under MORE THAN ONE category (single-category-keying
    // rule violation). SURFACED for owner triage — NOT auto-reassigned to one category (the
    // #15 lesson: which single category is most-diagnostic is the dataset owner's domain call).
    cross_category_benchmarks: CROSS_CATEGORY_BENCHMARKS,
    // refinement #14: off-map rows (benchmark under a category whose canonical keying omits it).
    // The current dataset has none; a future off-map row THROWS (fail-loud). Recorded here only if
    // a future dataset already carried off-map rows (downgraded to warning to keep regen green).
    off_map_rows: OFF_MAP_ROWS,
    off_map_enforcement: OFF_MAP_DOWNGRADED ? "warning_downgraded" : "throw_on_future_off_map",
    // refinement #1: build-time coverage floor — per-category "DATA_MISSING" | "measured".
    // RECORDS state; never fails the build, never makes the lean table sparse.
    category_completeness: CATEGORY_COMPLETENESS,
    // refinement #9: dataset.gaps surfaced into the audit (reason + affected model +
    // remediation), grouped per category with each DATA_MISSING category's coverage state.
    gaps: GAPS_AUDIT,
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
      "SOP-2 worst-case $/token: fixed 100K-in / 20K-visible-out blend, opus tokenizer " +
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
