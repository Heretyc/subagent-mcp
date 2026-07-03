import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tables = [
  ".spec/references/assets/routing-table.json",
  "src/routing-table.json",
];

function collectPointers(value, out = []) {
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (key === "rag_pointer") out.push(child);
    collectPointers(child, out);
  }
  return out;
}

test("routing-table rag_pointer files exist", () => {
  const checked = [];

  for (const table of tables) {
    const tablePath = join(repoRoot, table);
    if (!existsSync(tablePath)) continue;

    const json = JSON.parse(readFileSync(tablePath, "utf8"));
    for (const pointer of collectPointers(json)) {
      assert.equal(typeof pointer, "string", `${table} has non-string rag_pointer`);
      checked.push(`${table}: ${pointer}`);
      assert.ok(
        existsSync(join(repoRoot, pointer)),
        `${table} references missing rag_pointer file: ${pointer}`,
      );
    }
  }

  assert.ok(checked.length > 0, "expected at least one rag_pointer to check");
});
