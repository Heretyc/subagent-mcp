import { existsSync, readFileSync } from "node:fs";
import { isLaunchableModel } from "./lib/launchable-models.mjs";

const contextPath = new URL("../src/context-windows.json", import.meta.url);
const routingAuditPath = new URL("../src/routing-table-audit.json", import.meta.url);

const REQUIRED_CLAUDE = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4-0",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-opus-4-1",
  "claude-opus-4-0",
  "claude-haiku-4-5",
];
const REQUIRED_CODEX = [
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5-codex",
  "gpt-5",
  "codex-auto-review",
  "o3",
  "o3-mini",
  "o4-mini",
];

function readJson(path, label, issues) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    issues.push(`${label} parse error: ${error.message}`);
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedKey(key) {
  return key.trim().toLowerCase().replace(/\[[^\]]+\]/g, "").replace(/-1m\b/g, "").replace(/-(20\d{6})$/, "");
}

function validateEntry(section, key, entry, issues) {
  if (key !== normalizedKey(key)) {
    issues.push(`${section}.${key} key must already be normalized`);
  }
  if (!isObject(entry)) {
    issues.push(`${section}.${key} must be an object`);
    return;
  }
  const keys = Object.keys(entry).sort();
  if (keys.join(",") !== "default,long") {
    issues.push(`${section}.${key} keys must be exactly default,long`);
  }
  if (!Number.isInteger(entry.default) || entry.default <= 0) {
    issues.push(`${section}.${key}.default must be a positive integer`);
  }
  if (
    entry.long !== null &&
    (!Number.isInteger(entry.long) || entry.long <= entry.default)
  ) {
    issues.push(`${section}.${key}.long must be null or an integer greater than default`);
  }
}

function validateSection(root, section, required, issues) {
  const map = root[section];
  if (!isObject(map)) {
    issues.push(`${section} must be an object`);
    return;
  }
  const seen = new Set();
  for (const [key, entry] of Object.entries(map)) {
    const norm = normalizedKey(key);
    if (seen.has(norm)) {
      issues.push(`${section} duplicate after normalization: ${key}`);
    }
    seen.add(norm);
    validateEntry(section, key, entry, issues);
  }
  for (const key of required) {
    if (!Object.hasOwn(map, key)) {
      issues.push(`${section} missing required model ${key}`);
    }
  }
}

function validateAuditCoverage(root, issues) {
  if (!existsSync(routingAuditPath)) return;
  const audit = readJson(routingAuditPath, "src/routing-table-audit.json", issues);
  const universe = audit?.metadata?.model_effort_universe;
  if (!Array.isArray(universe)) return;
  const models = new Set(
    universe
      .filter((key) => typeof key === "string" && key.includes("@"))
      .map((key) => key.slice(0, key.lastIndexOf("@"))),
  );
  for (const model of models) {
    if (!isLaunchableModel(model) && !REQUIRED_CLAUDE.includes(model) && !REQUIRED_CODEX.includes(model)) {
      continue;
    }
    if (model.startsWith("claude-") && !Object.hasOwn(root.claude ?? {}, model)) {
      issues.push(`profiler coverage: context-windows claude map missing audit model ${model}`);
    }
    if (
      (model.startsWith("gpt-") || model.startsWith("codex-")) &&
      !Object.hasOwn(root.codex ?? {}, model)
    ) {
      issues.push(`profiler coverage: context-windows codex map missing audit model ${model}`);
    }
  }
}

const issues = [];
if (!existsSync(contextPath)) {
  issues.push("src/context-windows.json is absent");
} else {
  const root = readJson(contextPath, "src/context-windows.json", issues);
  if (root) {
    if (root.schema_version !== 1) {
      issues.push("schema_version must be 1");
    }
    const familyDefault = root.family_defaults?.claude;
    if (!isObject(root.family_defaults) || !isObject(familyDefault)) {
      issues.push("family_defaults.claude is required for profiler family-default refresh coverage");
    } else {
      validateEntry("family_defaults", "claude", familyDefault, issues);
      if (familyDefault.default !== 200000 || familyDefault.long !== 1000000) {
        issues.push("family_defaults.claude must be default=200000 and long=1000000");
      }
    }
    validateSection(root, "claude", REQUIRED_CLAUDE, issues);
    validateSection(root, "codex", REQUIRED_CODEX, issues);
    validateAuditCoverage(root, issues);
  }
}

if (issues.length > 0) {
  console.log("FAIL src/context-windows.json validation");
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
  process.exit(1);
}

console.log("PASS src/context-windows.json validation");
