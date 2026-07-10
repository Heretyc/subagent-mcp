import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const updateCheckSource = "src/orchestration/update-check.ts";
const forbiddenSymbols = [
  { symbol: "ANTHROPIC_API_KEY", pattern: /\bANTHROPIC_API_KEY\b/ },
  { symbol: "OPENAI_API_KEY", pattern: /\bOPENAI_API_KEY\b/ },
  { symbol: "api.anthropic.com", pattern: /\bapi\.anthropic\.com\b/ },
  { symbol: "api.openai.com", pattern: /\bapi\.openai\.com\b/ },
];
const rawHttpCallSite = /\b(?:fetch|https\.request)\s*\(/;

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

function display(path) {
  return relative(repo, path).replaceAll("\\", "/");
}

function checkFile(path, text, violations) {
  const displayPath = display(path);
  for (const { symbol, pattern } of forbiddenSymbols) {
    if (pattern.test(text)) {
      violations.push(`${displayPath}: forbidden direct model API key/host symbol ${symbol}`);
    }
  }
  if (rawHttpCallSite.test(text) && displayPath !== updateCheckSource) {
    violations.push(`${displayPath}: forbidden raw HTTP model-inference call site`);
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
  console.log(
    "PASS no Anthropic/OpenAI API keys, direct API hosts, or unapproved raw HTTP call sites found in src/**/*.ts or dist/index.js"
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
