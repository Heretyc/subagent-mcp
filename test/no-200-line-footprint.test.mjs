/**
 * no-200-line-footprint.test.mjs - GATING regression grep gate.
 *
 * Asserts ZERO occurrences of the retired context-footprint doctrine under
 * shipped source, directives, and normative orchestration architecture leaves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const PATTERNS = [
  /exceeds 200 lines/i,
  /200-line cumulative footprint/i,
  /model self-estimat/i,
];

const ROOTS = [
  "src",
  "directives",
  join("docs", "spec", "dev-loop", "orchestration-directive-architecture"),
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".json", ".jsonc",
  ".md", ".markdown", ".txt", ".yml", ".yaml", ".toml", ".sh", ".ps1",
  ".html", ".css", ".xml", ".env", ".cfg", ".ini",
]);

function isTextFile(path) {
  const ext = extname(path).toLowerCase();
  return ext === "" || TEXT_EXT.has(ext);
}

function looksBinary(text) {
  const cap = Math.min(text.length, 8192);
  for (let i = 0; i < cap; i++) {
    if (text.charCodeAt(i) === 0) return true;
  }
  return false;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile() && isTextFile(full)) {
      out.push(full);
    }
  }
}

test("no retired 200-line footprint doctrine remains in shipped text", () => {
  const files = [];
  for (const root of ROOTS) {
    const abs = join(REPO, root);
    if (existsSync(abs)) walk(abs, files);
  }

  assert.ok(files.length > 0, "expected to scan at least one file; scan found none");

  const offenders = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (looksBinary(text)) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of PATTERNS) {
        if (pattern.test(lines[i])) {
          offenders.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          break;
        }
      }
    }
  }

  assert.equal(
    offenders.length,
    0,
    `The retired 200-line footprint doctrine reappeared:\n${offenders.join("\n")}`,
  );
});
