#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
const indexTs = readFileSync(join(root, "src", "index.ts"), "utf8");

const expected = pkg.version;
const checks = [
  ["package.json version", pkg.version],
  ["package-lock.json root version", lock.version],
  ["package-lock.json packages[\"\"] version", lock.packages?.[""]?.version],
];

const serverVersion = indexTs.match(/\bversion:\s*"([^"]+)"/)?.[1];
checks.push(["src/index.ts MCP server version", serverVersion]);

for (const [label, actual] of checks) {
  if (typeof actual !== "string" || actual.length === 0) {
    fail(`${label} is missing`);
  } else if (actual !== expected) {
    fail(`${label}=${actual} does not match package.json version=${expected}`);
  }
}

if (process.exitCode) process.exit();
console.log(`VERSION-SYNC: PASS ${expected}`);
