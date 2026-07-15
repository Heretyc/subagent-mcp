#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function fail(message) {
  console.error(`VERSION-SYNC: FAIL ${message}`);
  process.exitCode = 1;
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const plugin = readJson(".claude-plugin/plugin.json");
const codexPlugin = readJson(".codex-plugin/plugin.json");
const indexTs = readFileSync(join(root, "src", "index.ts"), "utf8");

const expected = pkg.version;
const checks = [
  ["package.json version", pkg.version],
  ["package-lock.json root version", lock.version],
  ["package-lock.json packages[\"\"] version", lock.packages?.[""]?.version],
  [".claude-plugin/plugin.json version", plugin.version],
  [".codex-plugin/plugin.json version", codexPlugin.version],
];

const serverVersion = indexTs.match(/\bversion:\s*"([^"]+)"/)?.[1];
checks.push(["src/index.ts MCP server version", serverVersion]);

for (const path of [".claude-plugin/marketplace.json", "marketplace.json"]) {
  if (!existsSync(join(root, path))) continue;
  const marketplace = readJson(path);
  for (const [index, plugin] of (marketplace.plugins ?? []).entries()) {
    if (Object.hasOwn(plugin, "version")) {
      checks.push([`${path} plugins[${index}].version`, plugin.version]);
    }
  }
}

for (const [label, actual] of checks) {
  if (typeof actual !== "string" || actual.length === 0) {
    fail(`${label} is missing`);
  } else if (actual !== expected) {
    fail(`${label}=${actual} does not match package.json version=${expected}`);
  }
}

if (process.exitCode) process.exit();
console.log(`VERSION-SYNC: PASS ${expected}`);
