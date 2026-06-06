import { existsSync, readFileSync } from "node:fs";

const providerPath = new URL("../src/routing-table.json", import.meta.url);
const routingTablePath = new URL("../.spec/references/assets/routing-table.json", import.meta.url);
const branches = ["performance", "cost_efficiency"];

// Lean schema (schema_version 2). metadata carries EXACTLY these 5 keys; all removed detail
// (universe, formula_definitions, cost_blend, calibration_gate, rag_pointer) lives only in
// the audit sibling.
const requiredMetadata = ["version", "schema_version", "generated", "author", "author_url"];
// Lean pairing carries EXACTLY these 4 keys (score/cost_figure_used/basis/interpolated/
// confidence are retained only in routing-table-audit.json).
const requiredPairing = ["provider", "model", "effort", "rank"];

const VALID_PROVIDERS = new Set(["claude", "codex"]);

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
// Closed real-model set. The single source of truth for valid model ids now that the
// .spec KB validator is retired — update here whenever the model universe changes.
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
const NO_EFFORT_SENTINELS = new Set(["null", "none", "n/a"]);
// Categories from which no-effort (null/none/n/a) pairings are excluded — they are not
// ranked/listed here, so per-category coverage expects the universe MINUS no-effort pairings.
const NO_EFFORT_EXCLUDED_CATEGORIES = new Set([
  "agentic_execution",
  "architecture",
  "security_review",
  "debugging",
  "quality_review",
  "knowledge_synthesis",
]);
const MODEL_EFFORT_LADDERS = new Map([
  ["claude-opus-4-8", ["low", "medium", "high", "xhigh", "max"]],
  ["claude-opus-4-7", ["low", "medium", "high", "xhigh", "max"]],
  ["claude-opus-4-6", ["low", "medium", "high", "max"]],
  ["claude-sonnet-4-6", ["low", "medium", "high", "max"]],
  ["claude-haiku-4-5", ["n/a"]],
  ["gpt-5.5", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.5-pro", ["n/a"]],
  ["gpt-5.4-mini", ["n/a"]],
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(path, label, issues) {
  try {
    // Defensive UTF-8 BOM strip before parse.
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    issues.push(`${label} JSON parse error: ${error.message}`);
    return undefined;
  }
}

function effortKey(effort) {
  return effort === null ? "null" : String(effort);
}

function modelSupportsSelectableEffort(model) {
  const ladder = MODEL_EFFORT_LADDERS.get(model);
  return Array.isArray(ladder) && ladder.some((effort) => !NO_EFFORT_SENTINELS.has(effortKey(effort)));
}

function pairingKey(model, effort) {
  return `${model}@${effortKey(effort)}`;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Provider implied by a model id's family — used to assert the explicit `provider` field is
// consistent with the model. Explicit prefix -> family map (claude-* -> claude;
// gpt-*/codex-* -> codex). The universe is capped at two families (Anthropic + OpenAI);
// an unrecognized prefix is a scope error, so we THROW rather than silently skip the
// consistency check and let a mislabeled provider through.
const PROVIDER_FAMILY_PREFIXES = [
  ["claude-", "claude"],
  ["gpt-", "codex"],
  ["codex-", "codex"],
];
function impliedProvider(model) {
  for (const [prefix, family] of PROVIDER_FAMILY_PREFIXES) {
    if (model.startsWith(prefix)) return family;
  }
  throw new Error(
    `impliedProvider: unrecognized model prefix for '${model}'; expected one of ${PROVIDER_FAMILY_PREFIXES.map(([p]) => p).join(", ")}`
  );
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
  // Post taxonomy-freeze the machine-mirror `categories` object holds exactly the canonical
  // 10 categories; `default_category` (`fallback_default`) is the precedence sentinel, not a
  // `categories` member. The provider routing-table spine is therefore those 10 categories,
  // in the order recorded in `categories`, which must equal `classification_precedence`.
  const spine = categoryKeys;
  if (!arraysEqual(precedence, spine)) {
    issues.push(
      `assets/routing-table.json category spine/order mismatch: categories=${categoryKeys.join(", ")}, classification_precedence=${precedence.join(", ")}`
    );
  }
  return spine;
}

function validateMetadata(provider, issues) {
  const metadata = provider.metadata;
  if (!isObject(metadata)) {
    issues.push("metadata must be an object");
    return;
  }
  const keys = Object.keys(metadata).sort();
  if (!arraysEqual(keys, [...requiredMetadata].sort())) {
    issues.push(
      `metadata keys must be exactly {${requiredMetadata.join(", ")}}; got {${Object.keys(metadata).join(", ")}}`
    );
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
  if (typeof metadata.schema_version !== "string" || metadata.schema_version.length === 0) {
    issues.push("metadata.schema_version must be a non-empty string");
  }
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    issues.push("metadata.version must be a non-empty string");
  }
}

// Derive the model@effort universe FROM the table itself: the union of every pairing across
// both branches and all categories. The removed metadata.model_effort_universe is no longer
// consulted. Universe-completeness then asserts each category in BOTH branches contains every
// universe pairing exactly once.
function deriveUniverse(provider, spine) {
  const set = new Set();
  for (const branch of branches) {
    const branchObj = provider[branch];
    if (!isObject(branchObj)) continue;
    for (const category of spine) {
      const entries = branchObj[category];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (isObject(entry) && typeof entry.model === "string" && Object.hasOwn(entry, "effort")) {
          set.add(pairingKey(entry.model, entry.effort));
        }
      }
    }
  }
  return set;
}

// Per-category expected coverage: excluded categories omit the no-effort pairings.
function expectedUniverseForCategory(category, universeSet) {
  if (!NO_EFFORT_EXCLUDED_CATEGORIES.has(category)) return universeSet;
  return new Set(
    [...universeSet].filter((key) => {
      const effort = key.slice(key.lastIndexOf("@") + 1);
      return !NO_EFFORT_SENTINELS.has(effort);
    })
  );
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

function validateCategoryEntries(provider, spine, universeSet, issues) {
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
      validatePairingArray(label, entries, expectedUniverseForCategory(category, universeSet), issues);
    }
  }
}

function validatePairingArray(label, entries, universeSet, issues) {
  if (entries.length !== universeSet.size) {
    issues.push(`${label} must contain ${universeSet.size} pairings (the model@effort universe), found ${entries.length}`);
  }
  const keys = [];
  const ranks = [];
  for (const [index, entry] of entries.entries()) {
    if (!isObject(entry)) {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    // Lean pairing must carry EXACTLY the 4 keys — no removed fields, no extras.
    const entryKeys = Object.keys(entry).sort();
    if (!arraysEqual(entryKeys, [...requiredPairing].sort())) {
      issues.push(
        `${label}[${index}] keys must be exactly {${requiredPairing.join(", ")}}; got {${Object.keys(entry).join(", ")}}`
      );
    }
    // provider in {claude, codex} and consistent with the model family.
    if (typeof entry.provider !== "string" || !VALID_PROVIDERS.has(entry.provider)) {
      issues.push(`${label}[${index}].provider must be one of ${[...VALID_PROVIDERS].join("|")}`);
    } else if (typeof entry.model === "string") {
      const expected = impliedProvider(entry.model);
      if (expected && entry.provider !== expected) {
        issues.push(
          `${label}[${index}].provider '${entry.provider}' does not match model family of '${entry.model}' (expected '${expected}')`
        );
      }
    }
    // model: non-empty + known real model id.
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`${label}[${index}].model must be a non-empty string`);
    } else if (!VALID_MODELS.has(entry.model)) {
      issues.push(`${label}[${index}].model is not a known real model: ${entry.model}`);
    }
    // effort: present + known ladder tier.
    if (!Object.hasOwn(entry, "effort")) {
      issues.push(`${label}[${index}].effort missing`);
    } else if (!effortOrder.has(effortKey(entry.effort))) {
      issues.push(`${label}[${index}].effort is not a known effort tier: ${effortKey(entry.effort)}`);
    } else if (
      typeof entry.model === "string" &&
      modelSupportsSelectableEffort(entry.model) &&
      NO_EFFORT_SENTINELS.has(effortKey(entry.effort))
    ) {
      issues.push(
        `${label}[${index}] ${pairingKey(entry.model, entry.effort)} uses a no-effort sentinel, but ${entry.model} has selectable effort settings`
      );
    }
    // rank: dense, matches ordered array position.
    if (!Number.isInteger(entry.rank) || entry.rank < 1) {
      issues.push(`${label}[${index}].rank must be a positive integer`);
    } else {
      ranks.push(entry.rank);
      if (entry.rank !== index + 1) {
        issues.push(`${label}[${index}].rank must match ordered array position ${index + 1}`);
      }
    }
    if (typeof entry.model === "string" && Object.hasOwn(entry, "effort")) {
      const key = pairingKey(entry.model, entry.effort);
      keys.push(key);
      if (!universeSet.has(key)) {
        issues.push(`${label}[${index}] model+effort not in derived universe: ${key}`);
      }
    }
  }
  // Dense rank permutation 1..N.
  const rankSet = new Set(ranks);
  for (let rank = 1; rank <= entries.length; rank += 1) {
    if (!rankSet.has(rank)) {
      issues.push(`${label} rank permutation missing ${rank}`);
    }
  }
  // Each universe pairing exactly once: no duplicates within the category, and full coverage.
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key)) {
      issues.push(`${label} duplicate pairing: ${key}`);
    }
    seen.add(key);
  }
  const missing = [...universeSet].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    issues.push(`${label} missing pairings: ${missing.join(", ")}`);
  }
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
  ];
  const issuesFor = Object.fromEntries(checks);
  const spine = buildSpine(issuesFor["routing-table spine"]);
  const provider = readJson(providerPath, "src/routing-table.json", issuesFor["provider root"]);
  if (provider) {
    validateRoot(provider, issuesFor["provider root"]);
    validateMetadata(provider, issuesFor.metadata);
    validateBranchCategories(provider, spine, issuesFor.branches);
    const universeSet = deriveUniverse(provider, spine);
    if (universeSet.size === 0) {
      issuesFor.pairings.push("could not derive a non-empty model@effort universe from the table");
    }
    validateCategoryEntries(provider, spine, universeSet, issuesFor.pairings);
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
