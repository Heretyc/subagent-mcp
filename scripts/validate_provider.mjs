import { existsSync, readFileSync } from "node:fs";
import { isLaunchableModel } from "./lib/launchable-models.mjs";

const providerPath = new URL("../src/routing-table.json", import.meta.url);
const auditPath = new URL("../src/routing-table-audit.json", import.meta.url);
const routingTablePath = new URL("../.spec/references/assets/routing-table.json", import.meta.url);
const branches = ["performance", "cost_efficiency"];

// Lean schema (schema_version 2). metadata carries EXACTLY these 5 keys; all removed detail
// (universe, formula_definitions, cost_blend, calibration_gate, rag_pointer) lives only in
// the audit sibling.
const requiredMetadata = ["version", "schema_version", "generated", "author", "author_url"];
// Lean pairing carries EXACTLY these 4 keys (score/cost_figure_used/basis/interpolated/
// confidence are retained only in routing-table-audit.json).
const requiredPairing = ["provider", "model", "effort", "rank"];

const VALID_PROVIDERS = new Set(["claude", "codex", "api"]);

// Full effort ladder, weakest -> strongest. `null` is the fixed-low/unconfigured tier
// (e.g. Haiku, gpt-5.5-pro). Any effort outside this ladder is flagged, never silently skipped.
const effortOrder = new Map([
  ["null", 0],
  ["none", 1],
  ["min", 2],
  ["light", 3],
  ["medium", 4],
  ["high", 5],
  ["xhigh", 6],
  ["max", 7],
  ["pro", 8],
  ["ultracode", 9],
]);
const NO_EFFORT_SENTINELS = new Set(["null", "none", "n/a"]);
const LOW_EFFORT = "low";

// Owner directive (2026-06-15): low effort is not valid in any committed
// routing-table branch or model-effort universe.
function isLowEffort(effortK) {
  return effortK === LOW_EFFORT;
}
// Owner directive (2026-06-11, FINAL AND BINDING — NO EXCEPTIONS): the performance branch
// carries ONLY pairings at effort >= 'high'. Low/medium (and weaker) reasoning-effort
// variants are a widely-bad choice for performance/deadlock situations and are
// hard-rejected from that branch. cost_efficiency is unaffected.
const PERFORMANCE_MIN_EFFORT = "high";
const PERFORMANCE_MIN_EFFORT_INDEX = effortOrder.get(PERFORMANCE_MIN_EFFORT);
function meetsPerformanceEffortFloor(effortK) {
  const idx = effortOrder.get(effortK);
  return idx !== undefined && idx >= PERFORMANCE_MIN_EFFORT_INDEX;
}
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
const COMPOSITE_PARENT_CATEGORIES = Object.freeze({
  prompt_engineering: ["knowledge_synthesis", "coding", "quality_review"],
  vulnerability_research: ["security_review", "debugging", "coding"],
  molecular_biology: ["knowledge_synthesis", "data_analysis", "math_proof"],
  ml_accelerator_design: ["architecture", "coding", "math_proof"],
});
const COMPOSITE_CATEGORIES = new Set(Object.keys(COMPOSITE_PARENT_CATEGORIES));

// #6: derive VALID_MODELS + MODEL_EFFORT_LADDERS from the audit's model_effort_universe at
// runtime (single source of truth — no more hardcoded mirror to maintain). Falls back to a
// hardcoded snapshot for pre-first-run / offline tolerance; warn for unknown provider prefixes.
const _HARDCODED_MODELS = new Set([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4-mini",
]);
const _HARDCODED_LADDERS = new Map([
  ["claude-opus-4-8", ["medium", "high", "xhigh", "max"]],
  ["claude-opus-4-7", ["medium", "high", "xhigh", "max"]],
  ["claude-sonnet-4-6", ["medium", "high", "max"]],
  ["claude-haiku-4-5", ["n/a"]],
  ["gpt-5.5", ["medium", "high", "xhigh"]],
  ["gpt-5.5-pro", ["medium", "high", "xhigh"]],
  ["gpt-5.4-mini", ["medium", "high", "xhigh"]],
]);
function deriveRosterFromAudit() {
  if (!existsSync(auditPath)) return null;
  let auditData;
  try { auditData = JSON.parse(readFileSync(auditPath, "utf8").replace(/^﻿/, "")); } catch { return null; }
  const universe = auditData && auditData.metadata && auditData.metadata.model_effort_universe;
  if (!Array.isArray(universe)) return null;
  const models = new Set();
  const ladders = new Map();
  for (const key of universe) {
    const at = key.lastIndexOf("@");
    if (at < 1) continue;
    const model = key.slice(0, at);
    const effort = key.slice(at + 1);
    // ISS-057: the audit universe carries the FULL benchmark roster; the shipped
    // table (and therefore VALID_MODELS / MODEL_EFFORT_LADDERS) is the launchable
    // subset only. Skip non-launchable ids so the derived mirror matches the table.
    if (!isLaunchableModel(model)) continue;
    models.add(model);
    const arr = ladders.get(model) || [];
    arr.push(effort);
    ladders.set(model, arr);
  }
  return models.size > 0 ? { models, ladders } : null;
}
const _derivedRoster = deriveRosterFromAudit();
const VALID_MODELS = _derivedRoster ? _derivedRoster.models : _HARDCODED_MODELS;
const MODEL_EFFORT_LADDERS = _derivedRoster ? _derivedRoster.ladders : _HARDCODED_LADDERS;

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
// consistent with the model. Launchable routing providers are {claude, codex, api}; non-wired
// advisory families use the generic "api" adapter slot until adapters/model ids are wired.
const PROVIDER_FAMILY_PREFIXES = [
  ["claude-", "claude"],
  ["gpt-", "codex"],
  ["codex-", "codex"],
  ["moonshotai/", "api"],
  ["zai-org/", "api"],
  ["deepseek-ai/", "api"],
  ["qwen/", "api"],
  ["xai/", "api"],
  ["openai-direct/", "api"],
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
  // 14 categories; `default_category` (`fallback_default`) is the precedence sentinel, not a
  // `categories` member. The provider routing-table spine is therefore those 14 categories,
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

// Per-branch, per-category expected coverage: the performance branch keeps only
// effort >= 'high' pairings (owner directive — the floor subsumes the no-effort
// exclusion there); cost_efficiency omits no-effort pairings in the excluded
// categories only.
function expectedUniverseForCategory(provider, branch, category, universeSet) {
  const audit = readJson(auditPath, "src/routing-table-audit.json", []);
  const exclusions = audit?.metadata?.composite_inference?.category_pairing_exclusions?.[category];
  const excluded = new Set(Array.isArray(exclusions) ? exclusions : []);
  const filteredUniverse = new Set([...universeSet].filter((key) => !excluded.has(key)));
  if (branch === "performance") {
    const floorUniverse = new Set(
      [...filteredUniverse].filter((key) =>
        meetsPerformanceEffortFloor(key.slice(key.lastIndexOf("@") + 1))
      )
    );
    if (!COMPOSITE_CATEGORIES.has(category)) return floorUniverse;
  }
  if (COMPOSITE_CATEGORIES.has(category) && isObject(provider[branch])) {
    const keys = new Set();
    for (const parent of COMPOSITE_PARENT_CATEGORIES[category]) {
      const entries = provider[branch][parent];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (isObject(entry) && typeof entry.model === "string" && Object.hasOwn(entry, "effort")) {
          keys.add(pairingKey(entry.model, entry.effort));
        }
      }
    }
    return new Set([...keys].filter((key) => !excluded.has(key)));
  }
  if (!NO_EFFORT_EXCLUDED_CATEGORIES.has(category)) return filteredUniverse;
  return new Set(
    [...filteredUniverse].filter((key) => {
      const effort = key.slice(key.lastIndexOf("@") + 1);
      return !NO_EFFORT_SENTINELS.has(effort);
    })
  );
}

// Canonicalize a model@effort key for cross-source comparison: collapse every no-effort
// sentinel (null/none/n/a) to one marker so the audit universe (`@null`) and the mirror
// ladders (`n/a`) compare as the same pairing, consistent with how NO_EFFORT_SENTINELS is
// treated interchangeably elsewhere in this validator.
function canonicalPairingKey(key) {
  const at = key.lastIndexOf("@");
  const model = key.slice(0, at);
  const effort = key.slice(at + 1);
  return `${model}@${NO_EFFORT_SENTINELS.has(effort) ? "<no-effort>" : effort}`;
}

function canonicalSet(keys) {
  return new Set([...keys].map(canonicalPairingKey));
}

function setDiff(a, b) {
  return [...a].filter((value) => !b.has(value));
}

// #11 — completeness cross-check: the audit's metadata.model_effort_universe must equal the
// table-derived universe (modulo no-effort sentinel spelling). A real mismatch (a pairing in
// one source and not the other) FAILs; otherwise the audit and committed table have drifted
// apart. Missing/malformed audit metadata is surfaced as an issue, not silently skipped.
function crossCheckAuditUniverse(derivedUniverse, issues) {
  const audit = readJson(auditPath, "src/routing-table-audit.json", issues);
  if (!audit) {
    return;
  }
  const rawUniverse = isObject(audit.metadata) ? audit.metadata.model_effort_universe : undefined;
  if (!Array.isArray(rawUniverse) || !rawUniverse.every((key) => typeof key === "string")) {
    issues.push("src/routing-table-audit.json metadata.model_effort_universe must be a string array");
    return;
  }
  // ISS-057: project the FULL audit universe onto the launchable subset before every
  // cross-check below. The shipped table intentionally omits non-launchable ids
  // (claude-opus-4-7 / gpt-5.5-pro / gpt-5.4-mini), so comparing the raw audit
  // universe against the table-derived universe would falsely report those ids as
  // drift. SSOT for launchability: scripts/lib/launchable-models.mjs (FULL_TO_SHORT).
  const universe = rawUniverse.filter((key) => {
    const at = key.lastIndexOf("@");
    return isLaunchableModel(at > 0 ? key.slice(0, at) : key);
  });
  const auditCanon = canonicalSet(universe);
  const derivedCanon = canonicalSet(derivedUniverse);
  const onlyAudit = setDiff(auditCanon, derivedCanon);
  const onlyDerived = setDiff(derivedCanon, auditCanon);
  if (onlyAudit.length > 0) {
    issues.push(`audit model_effort_universe has pairings absent from the table-derived universe: ${onlyAudit.join(", ")}`);
  }
  if (onlyDerived.length > 0) {
    issues.push(`table-derived universe has pairings absent from audit model_effort_universe: ${onlyDerived.join(", ")}`);
  }

  // #19/#20(B) — ladder drift: the validator's VALID_MODELS + MODEL_EFFORT_LADDERS mirror must
  // stay in lockstep with the audit universe. Any model/effort in the audit universe missing
  // from the mirror (or vice-versa) means the hard-coded mirror has drifted (e.g. a stale model
  // id like the removed claude-opus-4-6) and is FAILed with an explicit drift message.
  const mirror = new Set();
  for (const [model, ladder] of MODEL_EFFORT_LADDERS) {
    if (!VALID_MODELS.has(model)) {
      issues.push(`ladder drift: MODEL_EFFORT_LADDERS has model '${model}' absent from VALID_MODELS`);
    }
    for (const effort of ladder) {
      mirror.add(canonicalPairingKey(pairingKey(model, effort)));
    }
  }
  const mirrorOnly = setDiff(mirror, auditCanon);
  const universeOnly = setDiff(auditCanon, mirror);
  if (mirrorOnly.length > 0) {
    issues.push(`ladder drift: VALID_MODELS/MODEL_EFFORT_LADDERS pairings absent from audit universe: ${mirrorOnly.join(", ")}`);
  }
  if (universeOnly.length > 0) {
    issues.push(`ladder drift: audit universe pairings absent from VALID_MODELS/MODEL_EFFORT_LADDERS: ${universeOnly.join(", ")}`);
  }
  const auditModels = new Set(universe.map((key) => key.slice(0, key.lastIndexOf("@"))));
  const mirrorModelsOnly = setDiff(VALID_MODELS, auditModels);
  const auditModelsOnly = setDiff(auditModels, VALID_MODELS);
  if (mirrorModelsOnly.length > 0) {
    issues.push(`ladder drift: VALID_MODELS entries absent from audit universe: ${mirrorModelsOnly.join(", ")}`);
  }
  if (auditModelsOnly.length > 0) {
    issues.push(`ladder drift: audit universe model ids absent from VALID_MODELS: ${auditModelsOnly.join(", ")}`);
  }
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
      validatePairingArray(label, entries, expectedUniverseForCategory(provider, branch, category, universeSet), issues);
      // Performance effort floor: an explicit, specific failure for any below-floor
      // entry (the universe check above would only say "not in derived universe").
      if (branch === "performance") {
        for (const [index, entry] of entries.entries()) {
          if (!isObject(entry) || !Object.hasOwn(entry, "effort")) continue;
          if (!meetsPerformanceEffortFloor(effortKey(entry.effort))) {
            issues.push(
              `${label}[${index}] ${pairingKey(entry.model, entry.effort)} is below the performance ` +
              `effort floor ('${PERFORMANCE_MIN_EFFORT}'): below-high efforts are banned from the ` +
              `performance branch (owner directive, FINAL)`
            );
          }
        }
      }
    }
  }
}

function validateCompositeRankings(provider, spine, issues) {
  for (const category of COMPOSITE_CATEGORIES) {
    if (!spine.includes(category)) {
      issues.push(`composite category '${category}' missing from spine`);
    }
    for (const parent of COMPOSITE_PARENT_CATEGORIES[category]) {
      if (!spine.includes(parent)) {
        issues.push(`composite category '${category}' parent '${parent}' missing from spine`);
      }
    }
  }
  for (const branch of branches) {
    if (!isObject(provider[branch])) continue;
    for (const [category, parents] of Object.entries(COMPOSITE_PARENT_CATEGORIES)) {
      const entries = provider[branch][category];
      if (!Array.isArray(entries)) continue;
      const audit = readJson(auditPath, "src/routing-table-audit.json", []);
      const override = audit?.metadata?.composite_inference?.order_overrides?.[branch]?.[category];
      if (Array.isArray(override)) continue;
      const parentRanks = parents.map((parent) => {
        const map = new Map();
        const parentEntries = provider[branch][parent];
        if (!Array.isArray(parentEntries)) return map;
        for (const entry of parentEntries) {
          if (isObject(entry) && typeof entry.model === "string" && Object.hasOwn(entry, "effort")) {
            map.set(pairingKey(entry.model, entry.effort), entry.rank);
          }
        }
        return map;
      });
      let previousMean = -Infinity;
      for (const [index, entry] of entries.entries()) {
        if (!isObject(entry) || typeof entry.model !== "string" || !Object.hasOwn(entry, "effort")) continue;
        const key = pairingKey(entry.model, entry.effort);
        const ranks = parentRanks
          .map((map) => map.get(key))
          .filter((rank) => Number.isInteger(rank));
        if (ranks.length === 0) {
          issues.push(`${branch}.${category}[${index}] ${key} is absent from all composite parents`);
          continue;
        }
        const mean = ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
        if (mean < previousMean) {
          issues.push(
            `${branch}.${category}[${index}] ${key} mean parent rank ${mean.toFixed(4)} ` +
            `is ordered after worse mean ${previousMean.toFixed(4)}`
          );
        }
        previousMean = mean;
      }
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
    // provider in {claude, codex, api} and consistent with the model family.
    // #22: catch impliedProvider throw (unknown prefix) and record as an issue rather than crash.
    if (typeof entry.provider !== "string" || !VALID_PROVIDERS.has(entry.provider)) {
      issues.push(`${label}[${index}].provider must be one of ${[...VALID_PROVIDERS].join("|")}`);
    } else if (typeof entry.model === "string") {
      let expected;
      try { expected = impliedProvider(entry.model); } catch (e) {
        issues.push(`${label}[${index}] impliedProvider error: ${e.message}`);
      }
      if (expected && entry.provider !== expected) {
        issues.push(
          `${label}[${index}].provider '${entry.provider}' does not match model family of '${entry.model}' (expected '${expected}')`
        );
      }
    }
    // model: non-empty + known real model id. Unknown ids are soft-warned (not failed) —
    // the audit-derived VALID_MODELS is the SSOT; warn lets a brand-new model pass while still
    // surfacing it. Hard-fail only for unknown provider prefixes (impliedProvider throw above). (#6)
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`${label}[${index}].model must be a non-empty string`);
    } else if (!VALID_MODELS.has(entry.model)) {
      console.warn(`validate_provider: WARN ${label}[${index}].model unknown id (soft-warn, not fail): ${entry.model}`);
    }
    // effort: present + known ladder tier. Low effort is explicitly purged policy-wide.
    if (!Object.hasOwn(entry, "effort")) {
      issues.push(`${label}[${index}].effort missing`);
    } else if (isLowEffort(effortKey(entry.effort))) {
      issues.push(`${label}[${index}].effort is banned policy-wide: low`);
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
    ["composites", []],
    ["audit cross-check", []],
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
    validateCompositeRankings(provider, spine, issuesFor.composites);
    // #11 audit-universe completeness + #19/#20(B) ladder-drift cross-checks.
    crossCheckAuditUniverse(universeSet, issuesFor["audit cross-check"]);
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
