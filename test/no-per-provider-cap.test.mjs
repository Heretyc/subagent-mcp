import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const forbiddenSymbols = [
  { symbol: "MAX_CLAUDE/MAX_CODEX", pattern: /\bMAX_(?:CLAUDE|CODEX)\b/ },
  { symbol: "countProcessing", pattern: /\bcountProcessing\b/ },
];
const providerCapError = /Maximum \d+ concurrent .* agents already running/i;

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function srcTsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return srcTsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function checkFile(path, text, violations) {
  const displayPath = relative(repo, path).replaceAll("\\", "/");
  for (const { symbol, pattern } of forbiddenSymbols) {
    if (pattern.test(text)) {
      violations.push(`${displayPath}: forbidden per-provider cap symbol ${symbol}`);
    }
  }
  if (providerCapError.test(text)) {
    violations.push(`${displayPath}: forbidden per-provider cap enforcement message`);
  }
}

try {
  const srcFiles = srcTsFiles(join(repo, "src"));
  const files = [
    ...srcFiles,
    join(repo, "dist", "index.js"),
  ];
  const violations = [];

  assert.ok(srcFiles.length > 0, "expected src TypeScript files to exist");

  for (const path of files) {
    const text = readIfExists(path);
    if (text) checkFile(path, text, violations);
  }

  assert.deepEqual(violations, [], violations.join("\n"));
  console.log("PASS no per-provider cap symbols found in src/**/*.ts or dist/index.js");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
