/**
 * Regression tests for scripts/validate_context_windows.mjs: the context-window
 * coverage gate the profiler runs after every routing-table emission.
 *
 * ISS-325 exposed an internal contradiction: the audit universe carries
 * account-verified DATED launchable ids (claude-opus-4-5-20251101,
 * claude-sonnet-4-5-20250929), but validateEntry forbids dated keys in
 * context-windows.json, so the old coverage check (raw hasOwn on the dated id)
 * could NEVER be satisfied. The fix normalizes the audit id to its canonical key
 * before the lookup. These tests pin that behavior so it cannot regress, and
 * assert the canonical entries expose the supported 200K/1M windows the runtime
 * (normalizeModelId in src/orchestration/metering.ts) resolves the dated ids to.
 *
 * Rule 9: each assertion comment encodes intent, not just behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { normalizedKey, auditModelCovered } from "../scripts/validate_context_windows.mjs";
import { LAUNCHABLE_TABLE_MODELS } from "../scripts/lib/launchable-models.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_PATH = join(__dirname, "..", "src", "context-windows.json");
const root = JSON.parse(readFileSync(CONTEXT_PATH, "utf8").replace(/^\uFEFF/, ""));

// The ISS-325 account-verified dated launchable pins the gate must now cover.
const DATED_OPUS = "claude-opus-4-5-20251101";
const DATED_SONNET = "claude-sonnet-4-5-20250929";

test("dated launchable ids are covered via their canonical context-windows key", () => {
  // The exact bug: dated ids were looked up raw and never matched. They must now
  // resolve to their undated canonical entry and count as covered.
  assert.equal(auditModelCovered(root, DATED_OPUS), true,
    "claude-opus-4-5-20251101 must be covered by the canonical claude-opus-4-5 entry");
  assert.equal(auditModelCovered(root, DATED_SONNET), true,
    "claude-sonnet-4-5-20250929 must be covered by the canonical claude-sonnet-4-5 entry");
});

test("dated 4.5 ids resolve to the supported 200K default window the runtime uses", () => {
  // Runtime parity: normalizeModelId strips the -YYYYMMDD suffix and reads the
  // same canonical entry, so coverage and metering agree on 200000/1000000.
  for (const dated of [DATED_OPUS, DATED_SONNET]) {
    const entry = root.claude[normalizedKey(dated)];
    assert.ok(entry, `${dated} must map to a present canonical claude entry`);
    assert.equal(entry.default, 200000, `${dated} default window must be 200000`);
    assert.equal(entry.long, 1000000, `${dated} long window must be 1000000`);
  }
});

test("undated canonical keys stay canonical and remain covered", () => {
  // normalizedKey is idempotent on already-canonical ids. Undated keys must not
  // be mangled, and each canonical family member stays covered.
  for (const id of ["claude-opus-4-5", "claude-sonnet-4-5", "claude-opus-4-8", "gpt-5.6-terra"]) {
    assert.equal(normalizedKey(id), id, `${id} is already canonical and must be unchanged`);
    assert.equal(auditModelCovered(root, id), true, `${id} canonical entry must be covered`);
  }
});

test("arbitrary unknown ids are rejected (gate is not weakened to a blanket pass)", () => {
  // A dated suffix must not smuggle an unknown model past the gate: only ids whose
  // CANONICAL key exists count as covered.
  assert.equal(auditModelCovered(root, "claude-ghost-9-9-20260101"), false,
    "unknown dated claude id must be rejected");
  assert.equal(auditModelCovered(root, "claude-ghost-9-9"), false,
    "unknown undated claude id must be rejected");
  assert.equal(auditModelCovered(root, "gpt-9.9-phantom"), false,
    "unknown codex id must be rejected");
});

test("pinned ISS-325 launch ids are unchanged in the launchable set", () => {
  // The fix must not require excluding or substituting any launchable model. The
  // dated pins stay exactly as ISS-325 verified them.
  assert.ok(LAUNCHABLE_TABLE_MODELS.has(DATED_OPUS),
    "claude-opus-4-5-20251101 must remain a pinned launchable id");
  assert.ok(LAUNCHABLE_TABLE_MODELS.has(DATED_SONNET),
    "claude-sonnet-4-5-20250929 must remain a pinned launchable id");
});
