import { existsSync, readFileSync } from "node:fs";

const providerPath = new URL("../src/routing-table.json", import.meta.url);
const routingTablePath = new URL("../.spec/references/assets/routing-table.json", import.meta.url);
const branches = ["performance", "cost_efficiency"];
const requiredMetadata = [
  "version",
  "schema_version",
  "generated",
  "author",
  "author_url",
  "model_effort_universe",
  "formula_definitions",
  "cost_blend",
  "rag_pointer",
];
const requiredPairing = [
  "model",
  "effort",
  "rank",
  "score",
  "cost_figure_used",
  "interpolated",
  "confidence",
];
// Full effort ladder, weakest -> strongest. `null` is the fixed-low/unconfigured tier
// (e.g. Haiku, gpt-5.5-pro). Any effort outside this ladder is flagged, never silently skipped.
const effortOrder = new Map([
  ["null", 0],
  ["none", 1],
  ["min", 2],
  ["light", 3],
  ["low", 4],
  ["medium", 5],
  ["high", 6],
  ["xhigh", 7],
  ["max", 8],
  ["pro", 9],
  ["ultracode", 10],
]);
// Closed real-model set. MIRRORS validate_kb.py VALID_MODELS — keep in sync whenever the
// model universe changes (this is a stricter check than model_effort_universe membership,
// which only constrains pairings to the run's declared universe, not to real model ids).
const VALID_MODELS = new Set([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4-mini",
]);
// Allowed `confidence` enum — mirrors provider-json-emission.md.
const VALID_CONFIDENCE = new Set(["measured", "high", "medium", "low"]);
const epsilon = 1e-12;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(path, label, issues) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    issues.push(`${label} JSON parse error: ${error.message}`);
    return undefined;
  }
}

function effortKey(effort) {
  return effort === null ? "null" : String(effort);
}

function pairingKey(model, effort) {
  return `${model}@${effortKey(effort)}`;
}

function keyFromUniverseEntry(entry, issues, location) {
  if (typeof entry === "string" && entry.length > 0) {
    return entry;
  }
  if (!isObject(entry)) {
    issues.push(`${location} must be a pairing object or non-empty string`);
    return undefined;
  }
  if (typeof entry.model !== "string" || entry.model.length === 0) {
    issues.push(`${location}.model must be a non-empty string`);
  }
  if (!Object.hasOwn(entry, "effort")) {
    issues.push(`${location}.effort missing`);
  }
  if (typeof entry.model !== "string" || !Object.hasOwn(entry, "effort")) {
    return undefined;
  }
  return pairingKey(entry.model, entry.effort);
}

function keyFromPairing(entry) {
  return pairingKey(entry.model, entry.effort);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function addSetDiffIssues(issues, label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !actualSet.has(key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0) {
    issues.push(`${label} missing pairings: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    issues.push(`${label} unknown pairings: ${extra.join(", ")}`);
  }
}

function buildSpine(issues) {
  const routing = readJson(routingTablePath, "assets/routing-table.json", issues);
  if (!routing) {
    return [];
  }
  const categories = routing.categories;
  if (!isObject(categories)) {
    issues.push("assets/routing-table.json categories must be an object");
    return [];
  }
  const categoryKeys = Object.keys(categories);
  const precedence = routing.classification_precedence;
  const defaultCategory = routing.default_category;
  if (!Array.isArray(precedence) || !precedence.every((key) => typeof key === "string")) {
    issues.push("assets/routing-table.json classification_precedence must be a string array");
    return categoryKeys;
  }
  if (typeof defaultCategory !== "string") {
    issues.push("assets/routing-table.json default_category must be a string");
    return categoryKeys;
  }
  const spine = [...precedence, defaultCategory];
  if (!arraysEqual(categoryKeys, spine)) {
    issues.push(
      `assets/routing-table.json category spine/order mismatch: categories=${categoryKeys.join(", ")}, spine=${spine.join(", ")}`
    );
  }
  return spine;
}

function validateMetadata(provider, issues) {
  const metadata = provider.metadata;
  if (!isObject(metadata)) {
    issues.push("metadata must be an object");
    return { universeKeys: [], thresholds: { k: 0, m: 2 } };
  }
  for (const field of requiredMetadata) {
    if (!Object.hasOwn(metadata, field)) {
      issues.push(`metadata.${field} missing`);
    }
  }
  if (metadata.author !== "Lexi Blackburn") {
    issues.push("metadata.author must be Lexi Blackburn");
  }
  if (metadata.author_url !== "https://github.com/Heretyc/") {
    issues.push("metadata.author_url must be https://github.com/Heretyc/");
  }
  if (typeof metadata.generated !== "string" || !/^\d{4}-\d{2}$/.test(metadata.generated)) {
    issues.push("metadata.generated must be YYYY-MM");
  }

  const exponents = metadata.formula_definitions?.calibrated_exponents;
  if (!isObject(metadata.formula_definitions)) {
    issues.push("metadata.formula_definitions must be an object");
  }
  if (!isObject(exponents)) {
    issues.push("metadata.formula_definitions.calibrated_exponents must be an object");
  } else {
    if (!isFiniteNumber(exponents.a)) {
      issues.push("metadata.formula_definitions.calibrated_exponents.a must be numeric");
    }
    if (!isFiniteNumber(exponents.b)) {
      issues.push("metadata.formula_definitions.calibrated_exponents.b must be numeric");
    }
    if (isFiniteNumber(exponents.a) && isFiniteNumber(exponents.b) && exponents.a <= exponents.b) {
      issues.push("metadata.formula_definitions.calibrated_exponents must satisfy a > b");
    }
  }

  const universe = metadata.model_effort_universe;
  const universeKeys = [];
  if (!Array.isArray(universe) || universe.length === 0) {
    issues.push("metadata.model_effort_universe must be a non-empty array");
  } else {
    for (const [index, entry] of universe.entries()) {
      const key = keyFromUniverseEntry(entry, issues, `metadata.model_effort_universe[${index}]`);
      if (key) {
        universeKeys.push(key);
      }
    }
    const seen = new Set();
    for (const key of universeKeys) {
      if (seen.has(key)) {
        issues.push(`metadata.model_effort_universe duplicate pairing: ${key}`);
      }
      seen.add(key);
    }
  }

  return { universeKeys };
}

// Reads the canonical metadata.calibration_gate block. Returns null (and records a failure)
// when absent or malformed — never silently defaults, so a missing gate cannot pass.
function readCalibrationGate(metadata, issues) {
  const gate = metadata?.calibration_gate;
  if (!isObject(gate)) {
    issues.push(
      "metadata.calibration_gate is required (object with k_categories_min, m_rank_churn_min, k_observed, m_observed, passed)"
    );
    return null;
  }
  let ok = true;
  if (!Number.isInteger(gate.k_categories_min) || gate.k_categories_min < 1) {
    issues.push("metadata.calibration_gate.k_categories_min must be a positive integer");
    ok = false;
  }
  if (!Number.isInteger(gate.m_rank_churn_min) || gate.m_rank_churn_min < 1) {
    issues.push("metadata.calibration_gate.m_rank_churn_min must be a positive integer");
    ok = false;
  }
  if (!Number.isInteger(gate.k_observed) || gate.k_observed < 0) {
    issues.push("metadata.calibration_gate.k_observed must be a non-negative integer");
    ok = false;
  }
  if (!Object.hasOwn(gate, "m_observed") || !Number.isInteger(gate.m_observed) || gate.m_observed < 0) {
    issues.push("metadata.calibration_gate.m_observed must be a non-negative integer");
    ok = false;
  }
  if (typeof gate.passed !== "boolean") {
    issues.push("metadata.calibration_gate.passed must be boolean");
    ok = false;
  }
  return ok ? gate : null;
}

function validateRoot(provider, issues) {
  if (!isObject(provider)) {
    issues.push("routing-table.json root must be an object");
    return;
  }
  const rootKeys = Object.keys(provider);
  const branchKeys = rootKeys.filter((key) => key !== "metadata");
  if (!arraysEqual(branchKeys.sort(), [...branches].sort())) {
    issues.push(`root branches must be exactly ${branches.join(", ")}`);
  }
  const unexpected = rootKeys.filter((key) => key !== "metadata" && !branches.includes(key));
  if (unexpected.length > 0) {
    issues.push(`unexpected root keys: ${unexpected.join(", ")}`);
  }
}

function validateBranchCategories(provider, spine, issues) {
  for (const branch of branches) {
    if (!isObject(provider[branch])) {
      issues.push(`${branch} must be an object`);
      continue;
    }
    const keys = Object.keys(provider[branch]);
    if (!arraysEqual(keys, spine)) {
      issues.push(`${branch} category keys/order must equal spine: ${spine.join(", ")}`);
    }
  }
}

function validateCategoryEntries(provider, spine, universeKeys, issues) {
  const universeSet = new Set(universeKeys);
  for (const branch of branches) {
    if (!isObject(provider[branch])) {
      continue;
    }
    for (const category of spine) {
      const entries = provider[branch][category];
      const label = `${branch}.${category}`;
      if (!Array.isArray(entries)) {
        issues.push(`${label} must be an array`);
        continue;
      }
      validatePairingArray(label, entries, universeKeys, universeSet, branch, issues);
    }
  }
}

function validatePairingArray(label, entries, universeKeys, universeSet, branch, issues) {
  if (entries.length !== universeKeys.length) {
    issues.push(`${label} must contain ${universeKeys.length} pairings, found ${entries.length}`);
  }
  const keys = [];
  const ranks = [];
  for (const [index, entry] of entries.entries()) {
    if (!isObject(entry)) {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    for (const field of requiredPairing) {
      if (!Object.hasOwn(entry, field)) {
        issues.push(`${label}[${index}].${field} missing`);
      }
    }
    if (!Object.hasOwn(entry, "basis") && !Object.hasOwn(entry, "provenance")) {
      issues.push(`${label}[${index}] must include basis or provenance`);
    }
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`${label}[${index}].model must be a non-empty string`);
    } else if (!VALID_MODELS.has(entry.model)) {
      issues.push(`${label}[${index}].model is not a known real model: ${entry.model}`);
    }
    if (!Object.hasOwn(entry, "effort")) {
      issues.push(`${label}[${index}].effort missing`);
    } else if (!effortOrder.has(effortKey(entry.effort))) {
      issues.push(`${label}[${index}].effort is not a known effort tier: ${effortKey(entry.effort)}`);
    }
    if (!Number.isInteger(entry.rank) || entry.rank < 1) {
      issues.push(`${label}[${index}].rank must be a positive integer`);
    } else {
      ranks.push(entry.rank);
      if (entry.rank !== index + 1) {
        issues.push(`${label}[${index}].rank must match ordered array position ${index + 1}`);
      }
    }
    if (!isFiniteNumber(entry.score)) {
      issues.push(`${label}[${index}].score must be numeric`);
    }
    if (!isFiniteNumber(entry.cost_figure_used) || entry.cost_figure_used <= 0) {
      issues.push(`${label}[${index}].cost_figure_used must be a positive number`);
    }
    if (typeof entry.interpolated !== "boolean") {
      issues.push(`${label}[${index}].interpolated must be boolean`);
    }
    if (Object.hasOwn(entry, "confidence") && entry.confidence !== "" && entry.confidence !== undefined) {
      if (typeof entry.confidence !== "string" || !VALID_CONFIDENCE.has(entry.confidence)) {
        issues.push(
          `${label}[${index}].confidence must be one of ${[...VALID_CONFIDENCE].join("|")}`
        );
      }
    }
    if (typeof entry.model === "string" && Object.hasOwn(entry, "effort")) {
      const key = keyFromPairing(entry);
      keys.push(key);
      if (!universeSet.has(key)) {
        issues.push(`${label}[${index}] model+effort not in metadata.model_effort_universe: ${key}`);
      }
    }
  }
  const rankSet = new Set(ranks);
  for (let rank = 1; rank <= entries.length; rank += 1) {
    if (!rankSet.has(rank)) {
      issues.push(`${label} rank permutation missing ${rank}`);
    }
  }
  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1];
    if (index > 0 && isFiniteNumber(previous?.score) && isFiniteNumber(entry?.score) && entry.score > previous.score + epsilon) {
      issues.push(`${label} score increases from rank ${index} to rank ${index + 1}`);
    }
  }
  const seen = new Set();
  const duplicates = [];
  for (const key of keys) {
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }
  for (const duplicate of [...new Set(duplicates)]) {
    issues.push(`${label} duplicate pairing: ${duplicate}`);
  }
  addSetDiffIssues(issues, label, keys, universeKeys);
  validateInterpolationFlags(label, entries, branch, issues);
}

function validateInterpolationFlags(label, entries, branch, issues) {
  // Deep cross-model interpolation-clamp correctness needs per-benchmark data NOT present in routing-table.json,
  // so this validator checks structure + monotonicity + flags only.
  const byModel = new Map();
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.model !== "string") {
      continue;
    }
    const modelEntries = byModel.get(entry.model) ?? [];
    modelEntries.push(entry);
    byModel.set(entry.model, modelEntries);
  }
  for (const [model, modelEntries] of byModel) {
    for (const higher of modelEntries) {
      if (higher.interpolated !== true) {
        continue;
      }
      const higherIndex = effortOrder.get(effortKey(higher.effort));
      if (higherIndex === undefined) {
        continue;
      }
      for (const lower of modelEntries) {
        const lowerIndex = effortOrder.get(effortKey(lower.effort));
        if (lowerIndex === undefined || lowerIndex >= higherIndex) {
          continue;
        }
        if (
          branch === "performance" &&
          isFiniteNumber(higher.score) &&
          isFiniteNumber(lower.score) &&
          higher.score + epsilon < lower.score
        ) {
          issues.push(`${label} ${model} interpolated higher effort scores below lower effort`);
        }
      }
    }
  }
}

function rankMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) {
    return map;
  }
  for (const entry of entries) {
    if (isObject(entry) && typeof entry.model === "string" && Object.hasOwn(entry, "effort") && Number.isInteger(entry.rank)) {
      map.set(keyFromPairing(entry), entry.rank);
    }
  }
  return map;
}

function validateCalibration(provider, spine, universeKeys, issues) {
  if (!isObject(provider.metadata) || !isObject(provider.performance) || !isObject(provider.cost_efficiency)) {
    return;
  }
  const gate = readCalibrationGate(provider.metadata, issues);
  if (gate === null) {
    return;
  }
  const m = gate.m_rank_churn_min;
  // Recompute observed churn from the performance vs cost_efficiency orderings.
  let churnedCategories = 0; // categories with per-category churn >= m_rank_churn_min
  let maxChurn = 0; // max per-category churn across all categories
  for (const category of spine) {
    const performanceRanks = rankMap(provider.performance[category]);
    const costRanks = rankMap(provider.cost_efficiency[category]);
    let maxDelta = 0;
    for (const key of universeKeys) {
      if (performanceRanks.has(key) && costRanks.has(key)) {
        maxDelta = Math.max(maxDelta, Math.abs(performanceRanks.get(key) - costRanks.get(key)));
      }
    }
    maxChurn = Math.max(maxChurn, maxDelta);
    if (maxDelta >= m) {
      churnedCategories += 1;
    }
  }
  // Assert the recomputed effect size clears the recorded floor.
  if (churnedCategories < gate.k_categories_min) {
    issues.push(
      `calibration gate failed: ${churnedCategories} categories have rank-churn >= ${m}; need >= ${gate.k_categories_min}`
    );
  }
  // Assert the recorded observed values match the recomputation (the run must not misreport them).
  if (gate.k_observed !== churnedCategories) {
    issues.push(
      `metadata.calibration_gate.k_observed (${gate.k_observed}) does not match recomputed value ${churnedCategories}`
    );
  }
  if (gate.m_observed !== maxChurn) {
    issues.push(
      `metadata.calibration_gate.m_observed (${gate.m_observed}) does not match recomputed max per-category churn ${maxChurn}`
    );
  }
  // Assert the recorded `passed` boolean is consistent with the recomputed gate verdict.
  const recomputedPassed = churnedCategories >= gate.k_categories_min && maxChurn >= m;
  if (gate.passed !== recomputedPassed) {
    issues.push(
      `metadata.calibration_gate.passed (${gate.passed}) is inconsistent with recomputed verdict ${recomputedPassed}`
    );
  }

  const banned = globallyCheapestWeakestPairings(provider, spine);
  if (banned.size === 0) {
    return;
  }
  for (const category of spine) {
    const entries = provider.cost_efficiency[category];
    if (!Array.isArray(entries)) {
      continue;
    }
    const top = entries.find((entry) => isObject(entry) && entry.rank === 1);
    if (top && banned.has(keyFromPairing(top))) {
      issues.push(`${category} cost_efficiency rank 1 is globally cheapest-and-weakest pairing: ${keyFromPairing(top)}`);
    }
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function globallyCheapestWeakestPairings(provider, spine) {
  const costs = new Map();
  const performanceRanks = new Map();
  for (const branch of branches) {
    for (const category of spine) {
      const entries = provider[branch]?.[category];
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        if (!isObject(entry) || typeof entry.model !== "string" || !Object.hasOwn(entry, "effort")) {
          continue;
        }
        const key = keyFromPairing(entry);
        if (isFiniteNumber(entry.cost_figure_used)) {
          const values = costs.get(key) ?? [];
          values.push(entry.cost_figure_used);
          costs.set(key, values);
        }
      }
    }
  }
  for (const category of spine) {
    const entries = provider.performance?.[category];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!isObject(entry) || typeof entry.model !== "string" || !Object.hasOwn(entry, "effort") || !Number.isInteger(entry.rank)) {
        continue;
      }
      const key = keyFromPairing(entry);
      const values = performanceRanks.get(key) ?? [];
      values.push(entry.rank);
      performanceRanks.set(key, values);
    }
  }
  if (costs.size === 0 || performanceRanks.size === 0) {
    return new Set();
  }
  const averagedCosts = [...costs].map(([key, values]) => [key, average(values)]);
  const averagedRanks = [...performanceRanks].map(([key, values]) => [key, average(values)]);
  const minCost = Math.min(...averagedCosts.map(([, value]) => value));
  const maxRank = Math.max(...averagedRanks.map(([, value]) => value));
  const cheapest = new Set(averagedCosts.filter(([, value]) => Math.abs(value - minCost) <= epsilon).map(([key]) => key));
  const weakest = new Set(averagedRanks.filter(([, value]) => Math.abs(value - maxRank) <= epsilon).map(([key]) => key));
  return new Set([...cheapest].filter((key) => weakest.has(key)));
}

function main() {
  if (!existsSync(providerPath)) {
    console.log("NOTICE src/routing-table.json is absent; provider validation skipped");
    return 0;
  }

  const checks = [
    ["routing-table spine", []],
    ["provider root", []],
    ["metadata", []],
    ["branches", []],
    ["pairings", []],
    ["calibration", []],
  ];
  const issuesFor = Object.fromEntries(checks);
  const spine = buildSpine(issuesFor["routing-table spine"]);
  const provider = readJson(providerPath, "src/routing-table.json", issuesFor["provider root"]);
  if (provider) {
    validateRoot(provider, issuesFor["provider root"]);
    const { universeKeys } = validateMetadata(provider, issuesFor.metadata);
    validateBranchCategories(provider, spine, issuesFor.branches);
    validateCategoryEntries(provider, spine, universeKeys, issuesFor.pairings);
    validateCalibration(provider, spine, universeKeys, issuesFor.calibration);
  }

  const failures = checks.filter(([, issues]) => issues.length > 0);
  if (failures.length > 0) {
    console.log("FAIL src/routing-table.json validation");
    for (const [name, issues] of failures) {
      console.log(`- ${name}:`);
      for (const issue of issues) {
        console.log(`  - ${issue}`);
      }
    }
    return 1;
  }

  console.log("PASS src/routing-table.json validation");
  for (const [name] of checks) {
    console.log(`- ${name}: ok`);
  }
  return 0;
}

process.exit(main());
