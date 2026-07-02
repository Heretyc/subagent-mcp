import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const forbiddenSymbols = /\bMAX_(?:CLAUDE|CODEX)\b/;
const providerCapError = /Maximum \d+ concurrent .* agents already running/i;

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

test("shipped entrypoints do not define per-provider cap symbols", () => {
  const texts = [
    readIfExists(join(repo, "src", "index.ts")),
    readIfExists(join(repo, "dist", "index.js")),
  ];

  assert.ok(texts.some(Boolean), "expected src or dist entrypoint to exist");
  for (const text of texts) {
    assert.doesNotMatch(text, forbiddenSymbols);
  }
});

test("source has no per-provider cap enforcement message", () => {
  const source = readFileSync(join(repo, "src", "index.ts"), "utf8");

  assert.doesNotMatch(source, forbiddenSymbols);
  assert.doesNotMatch(source, providerCapError);
});
