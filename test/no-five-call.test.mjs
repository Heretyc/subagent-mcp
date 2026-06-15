/**
 * no-five-call.test.mjs — GATING regression grep gate (D24).
 *
 * Asserts ZERO occurrences of the retired "5-call rule" anywhere under src/ and
 * directives/. The rule was removed in wave-2; this gate FAILS LOUDLY if any
 * variant ("5-call", "5 call", "5call", any case) ever reappears.
 *
 * SCOPE: src/ + directives/ ONLY. docs/ legitimately documents the removal and
 * test/ contains this regex literal, so both are excluded by design.
 *
 * WHY (Rule 9): the invariant is "the 5-call rule no longer exists in shipped
 * source or directives." A test that merely checked behavior could pass while
 * the dead rule lingered in text; this encodes the actual intent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const PATTERN = /5[ -]?call/i;

// Directories to scan (relative to repo root).
const ROOTS = ["src", "directives"];

// Never descend into these.
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

// Treat only these extensions as text (extensionless files also scanned).
const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".json", ".jsonc",
  ".md", ".markdown", ".txt", ".yml", ".yaml", ".toml", ".sh", ".ps1",
  ".html", ".css", ".xml", ".env", ".cfg", ".ini",
]);

function isTextFile(path) {
  const ext = extname(path).toLowerCase();
  if (ext === "") return true; // extensionless (e.g. directive stubs) — scan
  return TEXT_EXT.has(ext);
}

// A NUL byte signals binary content; skip such files.
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

test("no '5-call' rule remains under src/ and directives/", () => {
  const files = [];
  for (const root of ROOTS) {
    const abs = join(REPO, root);
    if (existsSync(abs)) walk(abs, files);
  }

  assert.ok(files.length > 0, "expected to scan at least one file; scan found none (wrong cwd?)");

  const offenders = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable — skip
    }
    if (looksBinary(text)) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (PATTERN.test(lines[i])) {
        offenders.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }

  assert.equal(
    offenders.length,
    0,
    `The retired 5-call rule reappeared:\n${offenders.join("\n")}`,
  );
});
