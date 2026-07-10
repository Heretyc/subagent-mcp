import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SKIP_DIRS = new Set([".git", "dist", "node_modules"]);
const SKIP_PATHS = new Set([join("tools", "vendor")]);
const MANAGED_BLOCK_RE =
  /<!-- subagent-mcp:managed:begin\b[^>]*-->[\s\S]*?<!-- subagent-mcp:managed:end -->/g;

const MOJIBAKE_RE = /(?:\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\uffff]{1,2})/u;
const BANNED_RE =
  /(?:[\u2010-\u2015\u2212\u2018\u2019\u201a-\u201f\u2026]|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udd00-\udfff])/u;

function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const rel = relative(ROOT, join(dir, entry.name)).split(sep).join(sep);
      if (!SKIP_DIRS.has(entry.name) && !SKIP_PATHS.has(rel))
        out.push(...markdownFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function lineColumn(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

const failures = [];

for (const file of markdownFiles(ROOT)) {
  const raw = readFileSync(file, "utf8");
  const text = raw.replace(MANAGED_BLOCK_RE, "");
  for (const check of [
    ["mojibake", MOJIBAKE_RE],
    ["banned non-ASCII prose", BANNED_RE],
  ]) {
    const [name, pattern] = check;
    const match = pattern.exec(text);
    if (match) failures.push({ file, name, ...lineColumn(text, match.index) });
  }
}

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`FAIL ${f.file}:${f.line}:${f.column} ${f.name}`);
  }
  process.exit(1);
}

console.log("PASS ascii prose check");
